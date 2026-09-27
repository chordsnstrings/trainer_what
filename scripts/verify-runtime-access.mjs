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
  const definerFunctions = await query(
    "SELECT p.oid::regprocedure::text AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef",
  );
  assert.deepEqual(
    definerFunctions
      .filter(({ signature }) => !functions.includes(signature))
      .map(({ signature }) => signature),
    [],
    "Classify new privileged helpers in the runtime permission gate",
  );
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL ROLE trainer_app");
    for (const table of [
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
    for (const column of ["hostname", "tenant_id", "verified_at"]) {
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
