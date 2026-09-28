import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

/** Read-only verification through the real non-owner runtime connection. */
export async function verifyRuntimeAccess(client) {
  const query = async (sql, values = []) =>
    (await client.query(sql, values)).rows;
  const [role] = await query(
    "SELECT current_user AS name,r.rolsuper,r.rolbypassrls,r.rolinherit,r.rolcreatedb,r.rolcreaterole FROM pg_roles r WHERE r.rolname=current_user",
  );
  assert.equal(
    role.name,
    "trainer_service",
    "Use the dedicated runtime connection",
  );
  for (const property of [
    "rolsuper",
    "rolbypassrls",
    "rolinherit",
    "rolcreatedb",
    "rolcreaterole",
  ])
    assert.equal(
      role[property],
      false,
      `Runtime role must not have ${property}`,
    );
  // Tenant transactions SET ROLE to trainer_app, so it must obey RLS too.
  assert.deepEqual(
    (
      await query(
        "SELECT r.rolname FROM pg_roles r WHERE (r.rolname IN ('trainer_app',current_user) OR pg_has_role(current_user,r.oid,'MEMBER')) AND (r.rolsuper OR r.rolbypassrls)",
      )
    ).map((row) => row.rolname),
    [],
    "Runtime and tenant roles must not bypass RLS",
  );
  const migrations = new URL("../packages/db/migrations/", import.meta.url);
  const expected = (await readdir(migrations))
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.slice(0, -4));
  const applied = new Map(
    (await query("SELECT version,checksum FROM schema_migrations")).map(
      (row) => [row.version, row.checksum],
    ),
  );
  assert.deepEqual(
    expected.filter((version) => !applied.has(version)),
    [],
    "Apply every repository migration before runtime verification",
  );
  for (const version of expected)
    assert.equal(
      applied.get(version),
      createHash("sha256")
        .update(await readFile(new URL(version + ".sql", migrations), "utf8"))
        .digest("hex"),
      `Migration ${version} changed after it was applied or lacks a checksum`,
    );
  const systemTables = {
    schema_migrations: ["SELECT"],
    users: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    tenants: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    memberships: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    sessions: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    one_time_tokens: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    user_security: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    provider_events: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    provider_objects: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    domain_mappings: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    platform_settings: ["SELECT", "INSERT", "UPDATE"],
    platform_settings_audit: ["SELECT", "INSERT"],
    admin_documents: ["SELECT", "INSERT", "UPDATE"],
    admin_experiments: ["SELECT", "INSERT", "UPDATE"],
    admin_operations_audit: ["SELECT", "INSERT"],
    platform_role_changes: ["SELECT", "INSERT"],
    support_preview_grants: ["SELECT", "INSERT", "UPDATE"],
    support_preview_elevations: ["SELECT", "INSERT", "UPDATE"],
    infrastructure_observations: ["SELECT", "INSERT"],
    infrastructure_policies: ["SELECT", "INSERT"],
    infrastructure_recommendations: ["SELECT", "INSERT", "UPDATE"],
    infrastructure_execution_policies: ["SELECT", "INSERT"],
    infrastructure_worker_control: ["SELECT", "UPDATE"],
    infrastructure_actions: ["SELECT", "INSERT", "UPDATE"],
    host_status: ["SELECT", "INSERT", "UPDATE"],
    host_monitor_policies: ["SELECT", "INSERT"],
    host_action_requests: ["SELECT", "INSERT", "UPDATE"],
    tls_issuance_allowances: ["SELECT", "INSERT", "UPDATE"],
    acquisition_events: ["SELECT", "INSERT", "DELETE"],
    acquisition_consents: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    privacy_erasure_registry: ["SELECT", "INSERT"],
    workspace_lifecycle_requests: ["SELECT", "INSERT", "UPDATE"],
    mfa_recovery_codes: ["SELECT", "INSERT", "DELETE"],
    auth_passkeys: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    auth_passkey_challenges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    account_identities: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    oidc_sign_in_requests: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    email_change_requests: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    account_recovery_grants: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    account_notices: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    brand_media: ["SELECT"],
    coach_galleries: ["SELECT"],
    coach_gallery_photos: ["SELECT"],
    coach_sites: ["SELECT"],
    coach_design_drafts: ["SELECT"],
    complimentary_access_directory: ["SELECT"],
    workspace_suspensions: ["SELECT", "INSERT", "UPDATE"],
    account_locks: ["SELECT", "INSERT", "UPDATE"],
    platform_alerts: ["SELECT", "INSERT", "UPDATE"],
    platform_alert_deliveries: ["SELECT", "INSERT"],
    coach_directory_profiles: ["SELECT"],
    workspace_app_icons: ["SELECT", "INSERT"],
    tenant_slug_redirects: ["SELECT", "INSERT", "UPDATE"],
    early_access_requests: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    // Domain pricing (071): registrar prices per ending, platform-level.
    registrar_prices: ["SELECT", "INSERT", "UPDATE"],
    // Platform finance reference data (072, 073): append-only, service only.
    exchange_rates: ["SELECT", "INSERT"],
    model_prices: ["SELECT", "INSERT"],
    // Platform finance phase B (075): summary cache and job runs, service only.
    platform_finance_months: ["SELECT", "INSERT", "UPDATE"],
    platform_finance_runs: ["SELECT", "INSERT", "UPDATE"],
    // Platform finance phase C (076): append-only, service only.
    platform_costs: ["SELECT", "INSERT"],
    platform_recurring_costs: ["SELECT", "INSERT", "UPDATE"],
    provider_invoices: ["SELECT", "INSERT"],
    stripe_fees: ["SELECT", "INSERT"],
  };
  for (const [table, grants] of Object.entries(systemTables)) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const [result] = await query(
        "SELECT has_table_privilege(current_user,$1,$2) AS allowed",
        [table, privilege],
      );
      assert.equal(
        result.allowed,
        grants.includes(privilege),
        `${table}: unexpected ${privilege} permission`,
      );
    }
    // Also plans actual statements, exercising RLS helper-function permissions.
    await query(`SELECT * FROM public.${table} LIMIT 0`);
  }
  // Domain pricing (071): registrar prices are platform rows hidden from the
  // tenant role by row security as well as by grants.
  const [prices] = await query(
    "SELECT relrowsecurity,relforcerowsecurity,EXISTS(SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename='registrar_prices' AND p.qual LIKE '%trainer_app%') AS service_only FROM pg_class WHERE oid='registrar_prices'::regclass",
  );
  assert.deepEqual(
    prices,
    { relrowsecurity: true, relforcerowsecurity: true, service_only: true },
    "registrar_prices must be service-only under forced row security",
  );
  // Journals carry their currency (071): only web address journals may use
  // another currency than AED, and the balance check keeps such journals off
  // every account but the web address and registrar ones.
  const [currency] = await query(
    "SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid='journals'::regclass AND c.conname='journals_currency_check'",
  );
  assert.match(
    String(currency?.def ?? ""),
    /currency = 'AED'::text\) OR \(source_key ~~ 'web-address-%'::text/,
    "journals: only web address journals may use another currency",
  );
  const [balance] = await query(
    "SELECT prosrc FROM pg_proc WHERE oid='balanced_journal()'::regprocedure",
  );
  assert.match(
    String(balance?.prosrc ?? ""),
    /NEW\.currency<>'AED'[\s\S]*web_address_receivable[\s\S]*registrar_prepaid/,
    "journals: the balance check must keep other currencies off AED accounts",
  );
  const scopedTables = [
    "affiliate_contracts",
    "affiliate_receipts",
    "affiliate_statements",
    "affiliate_statement_receipts",
    "affiliate_settlements",
    "records",
    "jobs",
    "events",
    "subscriptions",
    "workout_events",
    "consent_records",
    "journals",
    "journal_lines",
    "payouts",
    "cost_events",
    "usage_statements",
    "booking_slots",
    "bookings",
    "nutrition_foods",
    "nutrition_recipes",
    "nutrition_recipe_options",
    "nutrition_ingredients",
    "meal_captures",
    "privacy_followups",
    "integration_connections",
    "integration_oauth_states",
    "trainer_voices",
    "guided_audio",
    "domain_orders",
    "notification_preferences",
    "notifications",
    "push_subscriptions",
    "chat_attachments",
    "membership_exits",
    "complimentary_access",
    "healthkit_devices",
    "healthkit_sync_batches",
    // Voice-led sessions (065): tenant tables, no direct service grants.
    "voice_session_styles",
    "voice_sessions",
    "voice_session_clips",
    "registrar_operations",
    // Trainer voice clones (069): owner-only tenant tables; the deletion queue
    // has no DELETE grant so it outlives erasure and workspace closure.
    "trainer_voice_clones",
    "trainer_voice_samples",
    "voice_provider_deletions",
  ];
  const classifiedTables = new Set([
    ...Object.keys(systemTables),
    ...scopedTables,
  ]);
  const actualTables = await query(
    "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')",
  );
  assert.deepEqual(
    actualTables
      .filter(({ relname }) => !classifiedTables.has(relname))
      .map(({ relname }) => relname),
    [],
    "Classify new application tables in the runtime privilege gate",
  );
  for (const table of scopedTables) {
    const [r] = await query(
      "SELECT has_table_privilege(current_user,$1,'SELECT') AS direct,relrowsecurity,relforcerowsecurity,pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid=$1::regclass",
      [table],
    );
    assert.equal(
      r.direct,
      false,
      `Do not grant direct unscoped service access to ${table}`,
    );
    assert.equal(r.relrowsecurity, true, `${table} must enable RLS`);
    assert.equal(r.relforcerowsecurity, true, `${table} must force RLS`);
    assert.notEqual(r.owner, "trainer_service");
  }
  // Trainer voice clones (069): members, team members and other roles never
  // read a clone, a recording or a provider reference (restrictive owner-only
  // policy), and the provider deletion queue outlives erasure and closure
  // because the application role cannot delete from it.
  for (const table of [
    "trainer_voice_clones",
    "trainer_voice_samples",
    "voice_provider_deletions",
  ]) {
    const policies = await query(
      "SELECT policyname,permissive,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' AND tablename=$1 AND policyname='voice_clone_owner'",
      [table],
    );
    assert.equal(policies.length, 1, `${table}: owner-only policy missing`);
    const [policy] = policies;
    assert.equal(policy.permissive, "RESTRICTIVE", `${table}: owner-only policy must be restrictive`);
    assert.equal(policy.cmd, "ALL", `${table}: owner-only policy must cover every command`);
    for (const clause of [policy.qual, policy.with_check])
      assert.match(
        String(clause ?? ""),
        /current_setting\('app\.role'::text,\s*true\)\s*=\s*'owner'::text/,
        `${table}: owner-only policy must require app.role = 'owner'`,
      );
  }
  const [queueDelete] = await query(
    "SELECT has_table_privilege('trainer_app','voice_provider_deletions','DELETE') AS app,has_table_privilege(current_user,'voice_provider_deletions','DELETE') AS service",
  );
  assert.deepEqual(
    queueDelete,
    { app: false, service: false },
    "voice_provider_deletions must not be deletable by the runtime roles",
  );
  const functions = [
    "trainer_media_brand_reference(uuid,uuid)",
    "trainer_brand_tenant()",
    "training_actor_is_current(uuid,uuid,text)",
    "integration_actor_is_current(uuid,uuid)",
    "published_notification_template(text)",
    "published_safety_policy()",
    "notification_workspace_name()",
    "export_personal_chat_media(uuid)",
    "erase_personal_chat_media(uuid)",
    "expire_unattached_chat_media()",
    "erase_workspace_chat_media()",
    // Trigger-only: writes the operator directory's keys and dates.
    "complimentary_access_directory_sync()",
    "current_workspace_state()",
    // Migration 061: narrow helpers that replace in-transaction elevation of
    // follower requests (docs/features/isolation.md).
    "notification_recipient(uuid,text,text)",
    "enqueue_notification(uuid,uuid,text,text,text,text,text,text,jsonb)",
    "notification_team()",
    "membership_exit_blockers(uuid)",
    "booking_slot_taken(uuid)",
    "booking_fee_policy()",
    "checkout_promotion(text,uuid)",
    "member_charges()",
    "member_charge(text)",
    "model_usage_today(text[],uuid)",
    "voice_guidance_spent_today()",
    "guided_voice()",
    "coach_wearable_policy()",
    "withdraw_accepted_invitation_emails(uuid,text)",
    "personal_export_records(uuid)",
    "personal_export_followups(uuid)",
    "personal_export_usage(uuid)",
    "personal_export_audit(uuid)",
    "erase_brand_theme_media(text[])",
    "member_nutrition_foods()",
    "member_nutrition_recipes()",
    "member_nutrition_recipe_options()",
    "member_nutrition_ingredients()",
    "member_material(text)",
    "member_takeover_active()",
    "workspace_member_role(uuid)",
    "member_policy_review_append(jsonb,jsonb,integer)",
    // Migration 063: a follower's own plan-generation state (docs/features/brain-plans.md).
    "member_plan_status()",
    // Migration 065: the trainer's current voice-session style for members.
    "voice_session_style()",
    // Migration 069: Pro clone slots in use across the provider account (a count).
    "voice_pro_clones_in_use()",
    // Migration 069: platform administrators only (checked inside): open
    // provider deletions across workspaces, and the settings guard's counts.
    "voice_provider_deletions_outstanding(integer)",
    "voice_provider_work_outstanding()",
    // Migration 070: whether another open order uses a lapsed domain's name
    // (the worker, for its own order only).
    "domain_name_other_order(uuid)",
  ];
  for (const name of functions) {
    const [r] = await query(
      "SELECT has_function_privilege('trainer_service',$1,'EXECUTE') AS service,has_function_privilege('trainer_app',$1,'EXECUTE') AS tenant,prosecdef,pg_get_userbyid(proowner) AS owner,EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute FROM pg_proc WHERE oid=$1::regprocedure",
      [name],
    );
    assert.equal(
      r.service,
      name.startsWith("trainer_media_brand_reference"),
      `${name}: unexpected direct service access`,
    );
    assert.equal(r.tenant, true, `${name}: tenant helper grant missing`);
    assert.equal(
      r.prosecdef,
      true,
      `${name}: expected a scoped definer helper`,
    );
    assert.equal(
      r.public_execute,
      false,
      `${name}: PUBLIC must not execute privileged helpers`,
    );
    assert.notEqual(
      r.owner,
      "trainer_service",
      `${name}: runtime must not own privileged helpers`,
    );
  }
  // The public discovery predicate runs with the caller's own rights: the
  // service role may execute it, PUBLIC may not, and it must not be a definer.
  const [discovery] = await query(
    "SELECT has_function_privilege('trainer_service','public_discovery_tenant(uuid)','EXECUTE') AS service,prosecdef,EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute FROM pg_proc WHERE oid='public_discovery_tenant(uuid)'::regprocedure",
  );
  assert.deepEqual(
    discovery,
    { service: true, prosecdef: false, public_execute: false },
    "public_discovery_tenant(uuid) must be a service-executable invoker function",
  );
  await query(
    "SELECT public_discovery_tenant('00000000-0000-0000-0000-000000000000')",
  );
  // Bearer-secret lookups (migration 061): definers only the service role may
  // execute, in a workspace-bound service transaction; never the tenant role
  // or PUBLIC.
  const serviceDefiners = [
    "healthkit_device_for_token(text)",
    "integration_oauth_relay(text,text)",
  ];
  for (const name of serviceDefiners) {
    const [r] = await query(
      "SELECT has_function_privilege('trainer_service',$1,'EXECUTE') AS service,has_function_privilege('trainer_app',$1,'EXECUTE') AS tenant,prosecdef,pg_get_userbyid(proowner)<>'trainer_service' AS foreign_owner,EXISTS(SELECT 1 FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) acl WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute FROM pg_proc WHERE oid=$1::regprocedure",
      [name],
    );
    assert.deepEqual(
      r,
      {
        service: true,
        tenant: false,
        prosecdef: true,
        foreign_owner: true,
        public_execute: false,
      },
      `${name}: expected a service-only definer lookup`,
    );
  }
  // An unbound service transaction gets no answer from them.
  for (const statement of [
    "SELECT * FROM healthkit_device_for_token(repeat('0',64))",
    "SELECT integration_oauth_relay(repeat('0',64),'whoop')",
  ]) {
    await client.query("BEGIN");
    let refused = false;
    try {
      await client.query(statement);
    } catch (error) {
      refused = error.code === "42501";
    }
    await client.query("ROLLBACK");
    assert.equal(refused, true, `Unbound lookup must be refused: ${statement}`);
  }
  // Trigger-only definers (the ledger balance check fires at COMMIT, after the
  // scope settings are cleared): no runtime role may execute them directly.
  const triggerDefiners = ["balanced_journal()"];
  for (const name of triggerDefiners) {
    const [r] = await query(
      "SELECT has_function_privilege('trainer_service',$1,'EXECUTE') AS service,has_function_privilege('trainer_app',$1,'EXECUTE') AS tenant,prosecdef,prorettype='trigger'::regtype AS trigger FROM pg_proc WHERE oid=$1::regprocedure",
      [name],
    );
    assert.deepEqual(
      r,
      { service: false, tenant: false, prosecdef: true, trigger: true },
      `${name}: expected a trigger-only definer`,
    );
  }
  const definerFunctions = await query(
    "SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef",
  );
  assert.deepEqual(
    definerFunctions
      .filter(
        ({ signature }) =>
          !functions.includes(signature) &&
          !triggerDefiners.includes(signature) &&
          !serviceDefiners.includes(signature),
      )
      .map(({ signature }) => signature),
    [],
    "Classify new privileged helpers in the runtime permission gate",
  );
  // Tenant scope is fixed once a transaction becomes trainer_app: only the
  // service role (scope entry, before SET ROLE) may call set_config.
  const [setConfig] = await query(
    "SELECT has_function_privilege('trainer_app','pg_catalog.set_config(text,text,boolean)','EXECUTE') AS tenant,has_function_privilege('trainer_service','pg_catalog.set_config(text,text,boolean)','EXECUTE') AS service,EXISTS(SELECT 1 FROM pg_proc p,aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.oid='pg_catalog.set_config(text,text,boolean)'::regprocedure AND acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute",
  );
  assert.deepEqual(
    setConfig,
    { tenant: false, service: true, public_execute: false },
    "Only the service role may set scope settings (infra/tenant-scope.sql)",
  );
  // Service tables that carry a workspace deny the tenant role every row and
  // honour a service transaction's workspace binding (app.service_tenant_id).
  const boundTables = [
    "sessions",
    "one_time_tokens",
    "provider_objects",
    "acquisition_consents",
    "acquisition_events",
    "auth_passkey_challenges",
    "complimentary_access_directory",
    "email_change_requests",
    "oidc_sign_in_requests",
    "privacy_erasure_registry",
    "support_preview_grants",
    "tls_issuance_allowances",
    "workspace_lifecycle_requests",
    "workspace_suspensions",
    "tenants",
    "memberships",
    "domain_mappings",
    "tenant_slug_redirects",
  ];
  for (const table of boundTables) {
    const [r] = await query(
      "SELECT c.relrowsecurity,c.relforcerowsecurity,EXISTS(SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=$1 AND p.permissive='PERMISSIVE' AND p.qual LIKE '%app.service_tenant_id%' AND p.qual LIKE '%trainer_app%') AS bound FROM pg_class c WHERE c.oid=$1::regclass",
      [table],
    );
    assert.deepEqual(
      r,
      { relrowsecurity: true, relforcerowsecurity: true, bound: true },
      `${table}: service rows must be workspace-bindable and hidden from the tenant role`,
    );
  }
  // A bound service transaction sees only its own workspace.
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.service_tenant_id',$1,true)", [
      "00000000-0000-0000-0000-000000000000",
    ]);
    for (const table of boundTables) {
      const key = table === "tenants" ? "id" : "tenant_id";
      const [r] = await query(
        `SELECT count(*)::int AS n FROM public.${table} WHERE ${key}<>'00000000-0000-0000-0000-000000000000'`,
      );
      assert.equal(
        r.n,
        0,
        `${table}: a bound transaction saw another workspace`,
      );
    }
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  await client.query("BEGIN");
  try {
    await client.query(
      "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$1,true),set_config('app.role','subscriber',true)",
      ["00000000-0000-0000-0000-000000000000"],
    );
    await client.query("SET LOCAL ROLE trainer_app");
    // Neither the role nor any scope setting can change from a tenant scope.
    for (const statement of [
      "SELECT set_config('role','none',true)",
      "SELECT set_config('app.tenant_id','00000000-0000-0000-0000-000000000001',true)",
      "SELECT set_config('app.role','owner',true)",
    ]) {
      await client.query("SAVEPOINT scope_probe");
      let refused = false;
      try {
        await client.query(statement);
      } catch (error) {
        refused = error.code === "42501";
      }
      await client.query("ROLLBACK TO SAVEPOINT scope_probe");
      assert.equal(refused, true, `Tenant scope must refuse: ${statement}`);
    }
    const [scope] = await query(
      "SELECT current_user AS role,current_setting('app.role',true) AS app_role",
    );
    assert.deepEqual(
      scope,
      { role: "trainer_app", app_role: "subscriber" },
      "Tenant scope changed during the probes",
    );
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE trainer_app");
    for (const table of [
      "schema_migrations",
      "tenants",
      "provider_objects",
      "provider_events",
      "sessions",
      "one_time_tokens",
      "user_security",
      "platform_settings",
      "platform_settings_audit",
      "admin_documents",
      "admin_experiments",
      "admin_operations_audit",
      "platform_role_changes",
      "support_preview_grants",
      "support_preview_elevations",
      "infrastructure_observations",
      "infrastructure_policies",
      "infrastructure_recommendations",
      "host_status",
      "host_monitor_policies",
      "host_action_requests",
      "tls_issuance_allowances",
      "acquisition_events",
      "acquisition_consents",
      "mfa_recovery_codes",
      "auth_passkeys",
      "auth_passkey_challenges",
      "privacy_erasure_registry",
      "workspace_lifecycle_requests",
      "account_identities",
      "oidc_sign_in_requests",
      "email_change_requests",
      "account_recovery_grants",
      "account_notices",
      "complimentary_access_directory",
      "workspace_suspensions",
      "account_locks",
      "platform_alerts",
      "platform_alert_deliveries",
      "workspace_app_icons",
      "tenant_slug_redirects",
      "early_access_requests",
      "registrar_prices",
      "exchange_rates",
      "model_prices",
      "platform_finance_months",
      "platform_finance_runs",
      "platform_costs",
      "platform_recurring_costs",
      "provider_invoices",
      "stripe_fees",
    ]) {
      const [r] = await query(
        "SELECT has_table_privilege(current_user,$1,'SELECT') AS allowed",
        [table],
      );
      assert.equal(r.allowed, false, `Tenant actor must not read ${table}`);
    }
    // Host routing trusts domain_mappings: tenants read their own rows and
    // owners may only disconnect them. Payout and subscription rows persist.
    const [mapping] = await query(
      "SELECT has_table_privilege(current_user,'domain_mappings','SELECT') AS can_select,has_table_privilege(current_user,'domain_mappings','INSERT') AS can_insert,has_table_privilege(current_user,'domain_mappings','UPDATE') AS can_update,has_table_privilege(current_user,'domain_mappings','DELETE') AS can_delete,has_column_privilege(current_user,'domain_mappings','active','UPDATE') AS disconnect,has_any_column_privilege(current_user,'domain_mappings','INSERT') AS insert_column,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='domain_mappings'::regclass",
    );
    assert.deepEqual(
      mapping,
      {
        can_select: true,
        can_insert: false,
        can_update: false,
        can_delete: false,
        disconnect: true,
        insert_column: false,
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      "Tenant actors must not reassign or create domain mappings",
    );
    // redirect (070) decides whether a mapped name forwards elsewhere: only
    // the service sets it, from the owner's audited choice.
    for (const column of ["hostname", "tenant_id", "verified_at", "redirect"]) {
      const [r] = await query(
        "SELECT has_column_privilege(current_user,'domain_mappings',$1,'UPDATE') AS allowed",
        [column],
      );
      assert.equal(r.allowed, false, `Tenant actor must not set ${column}`);
    }
    for (const table of ["payouts", "subscriptions", "membership_exits"]) {
      const [r] = await query(
        "SELECT has_table_privilege(current_user,$1,'DELETE') AS allowed",
        [table],
      );
      assert.equal(r.allowed, false, `Tenant actor must not delete ${table}`);
    }
    for (const table of [
      ...scopedTables,
      "brand_media",
      "coach_galleries",
      "coach_gallery_photos",
      "coach_sites",
      "coach_design_drafts",
      "coach_directory_profiles",
    ])
      await query(`SELECT * FROM public.${table} LIMIT 0`);
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  return {
    migrations: expected.length,
    systemTables: Object.keys(systemTables).length,
    scopedTables: scopedTables.length,
    helpers: functions.length,
    serviceLookups: serviceDefiners.length,
    workspaceBoundServiceTables: boundTables.length,
    tenantScopeFixed: true,
  };
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL must identify the non-owner runtime role");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await verifyRuntimeAccess(client);
    console.log(JSON.stringify({ runtimeAccess: "verified", ...result }));
  } finally {
    await client.end();
  }
}
