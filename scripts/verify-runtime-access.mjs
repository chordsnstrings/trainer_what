import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
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
  const expected = (
    await readdir(new URL("../packages/db/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.slice(0, -4));
  const applied = new Set(
    (await query("SELECT version FROM schema_migrations")).map(
      (row) => row.version,
    ),
  );
  assert.deepEqual(
    expected.filter((version) => !applied.has(version)),
    [],
    "Apply every repository migration before runtime verification",
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
    acquisition_events: ["SELECT", "INSERT", "DELETE"],
    acquisition_consents: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    privacy_erasure_registry: ["SELECT", "INSERT"],
    workspace_lifecycle_requests: ["SELECT", "INSERT", "UPDATE"],
    mfa_recovery_codes: ["SELECT", "INSERT", "DELETE"],
    auth_passkeys: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    auth_passkey_challenges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    brand_media: ["SELECT"],
    coach_galleries: ["SELECT"],
    coach_gallery_photos: ["SELECT"],
    coach_sites: ["SELECT"],
    coach_design_drafts: ["SELECT"],
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
    "chat_attachments",
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
    "export_personal_chat_media(uuid)",
    "erase_personal_chat_media(uuid)",
    "expire_unattached_chat_media()",
    "erase_workspace_chat_media()",
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
      "acquisition_events",
      "acquisition_consents",
      "mfa_recovery_codes",
      "auth_passkeys",
      "auth_passkey_challenges",
      "privacy_erasure_registry",
      "workspace_lifecycle_requests",
    ]) {
      const [r] = await query(
        "SELECT has_table_privilege(current_user,$1,'SELECT') AS allowed",
        [table],
      );
      assert.equal(r.allowed, false, `Tenant actor must not read ${table}`);
    }
    for (const table of [
      ...scopedTables,
      "brand_media",
      "coach_galleries",
      "coach_gallery_photos",
      "coach_sites",
      "coach_design_drafts",
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
