import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../packages/db/src/migrations.ts";

test("upgrading preserves each trainer's approved style, leaves history untouched and restores forced RLS", async () => {
  const folder = new URL("../packages/db/migrations/", import.meta.url);
  const older = await mkdtemp(join(tmpdir(), "shared-brain-upgrade-"));
  const pg = new PGlite();
  const client = { query: (sql: string, values?: any[]) => pg.query(sql, values), exec: (sql: string) => pg.exec(sql) };
  try {
    for (const file of await readdir(folder))
      if (file.endsWith(".sql") && file < "093") await cp(new URL(file, folder), join(older, file));
    await applyMigrations(client, older);
    const releases: Array<{ live: string; archived: string; open: string }> = [];
    for (const open of ["Welcome back.", "Ready when you are."]) {
      const tenant = randomUUID(), user = randomUUID(), live = randomUUID(), archived = randomUUID();
      await pg.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Upgrade coach')", [tenant, tenant]);
      await pg.query("INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Upgrade coach','fixture')", [user, user + "@example.test"]);
      await pg.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [tenant, user]);
      const style = { tone: "calm", intro: [open], oneOnOne: { answers: { open: "UNCONFIRMED DRAFT" }, confirmed: { summary: "Use practical words.", answers: { open } } } };
      await pg.query("INSERT INTO voice_session_styles(tenant_id,style,updated_by) VALUES($1,$2,$3)", [tenant, JSON.stringify(style), user]);
      for (const [id, status] of [[live, "published"], [archived, "archived"]])
        await pg.query("INSERT INTO records(id,tenant_id,kind,status,data) VALUES($1,$2,'brain_release',$3,$4)", [id, tenant, status, JSON.stringify({ rules: [] })]);
      releases.push({ live, archived, open });
    }
    await applyMigrations(client);
    for (const r of releases) {
      const { rows } = await pg.query<any>("SELECT id,data FROM records WHERE id IN ($1,$2)", [r.live, r.archived]);
      const current = rows.find(x => x.id === r.live).data;
      assert.equal(current.communication.oneOnOne.answers.open, r.open);
      assert.deepEqual(current.communication.intro, [r.open]);
      assert.ok(!JSON.stringify(current).includes("UNCONFIRMED"));
      assert.equal(rows.find(x => x.id === r.archived).data.communication, undefined);
    }
    const { rows } = await pg.query<any>("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('records','voice_session_styles')");
    assert.equal(rows.length, 2);
    assert.ok(rows.every(r => r.relrowsecurity && r.relforcerowsecurity));
    assert.deepEqual((await applyMigrations(client)).applied, [], "restarts do not overwrite later publications");
  } finally {
    await pg.close(); await rm(older, { recursive: true, force: true });
  }
});
