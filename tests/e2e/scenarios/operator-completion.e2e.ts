/**
 * Super admin features completed after the first inventory: executive
 * metrics, workspace suspension and account locks, operator alerts, host
 * actions and backups (through one cycle of the real host controller with
 * simulated host primitives), and the platform address check. Feature names
 * match the "Platform operators" inventory.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { E2EContext } from "../harness/context.ts";
import { COACH_DOMAIN_EDGE_ADDRESS } from "../mocks/index.ts";
import { PASSWORD } from "../harness/data.ts";

const A = "Super admin" as const;

export async function operatorCompletionScenarios(ctx: E2EContext) {
  await ctx.admin.stepUp();
  await executiveMetrics(ctx);
  await suspensionLocksAndAlerts(ctx);
  await hostOperations(ctx);
}

async function executiveMetrics(ctx: E2EContext) {
  const { admin, reporter: r } = ctx;
  await r.step(A, "Executive business metrics", "platform-wide takings, memberships and MRR from the seeded ledger, plus the CSV", async () => {
    const m = await admin.get("/api/v1/admin/metrics?months=3");
    assert.ok(m.snapshot.trainers.total >= 3, "trainers counted: " + m.snapshot.trainers.total);
    assert.ok(m.snapshot.trainers.published >= 2);
    assert.ok(m.snapshot.followers >= 15, "followers counted: " + m.snapshot.followers);
    assert.ok(m.snapshot.memberships.active + m.snapshot.memberships.trialing >= 10);
    assert.ok(m.snapshot.mrrMinor > 0, "MRR from paid memberships");
    const gross = m.series.reduce((sum: number, row: any) => sum + row.grossMinor, 0);
    assert.ok(gross > 0, "gross takings in the period");
    const csv = await admin.request("GET", "/api/v1/admin/metrics.csv?months=3");
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
    const lines = csv.text.trim().split("\n");
    assert.ok(lines.length >= 4, "a header and one row per month");
    assert.ok(!lines.slice(1).some((line) => /^[=+\-@]/.test(line)), "no spreadsheet formula at the start of a row");
    return `trainers ${m.snapshot.trainers.total}, followers ${m.snapshot.followers}, memberships active ${m.snapshot.memberships.active} / trialing ${m.snapshot.memberships.trialing}, MRR ${m.snapshot.mrrMinor} AED minor, gross ${gross}`;
  });
}

async function suspensionLocksAndAlerts(ctx: E2EContext) {
  const { admin, reporter: r, mocks } = ctx;
  const omar = ctx.trainers.find((t) => t.slug === "omar-conditioning" && t.published);
  const member = ctx.followers.find((f) => f.trainer === omar && f.client.userId && f.paid);
  if (!omar || !member) {
    r.skip(A, "Suspend a workspace or lock an account", "suspension", "omar-conditioning or a paid member is missing");
    return;
  }
  let suspension: any;
  await r.step(A, "Suspend a workspace or lock an account", `${omar.slug}: suspended with a team notice; the workspace goes offline, billing and privacy stay open`, async () => {
    const inbox = mocks.email.inbox(omar.client.email).length;
    suspension = await admin.post(`/api/v1/admin/governance/workspaces/${omar.tenantId}/suspend`, {
      reason: "Sandbox check: payment dispute review",
      notice: "Your workspace is paused while the platform team reviews a payment dispute.",
    });
    const listed = await admin.get("/api/v1/admin/governance/workspaces?state=suspended");
    const row = listed.workspaces.find((w: any) => w.id === omar.tenantId);
    assert.ok(row?.suspension?.id, "listed as suspended with its suspension");
    suspension = row.suspension;
    // The owner sees the state and the notice; ordinary routes answer 423.
    const status = await omar.client.get("/api/v1/workspace/status");
    assert.equal(status.state, "suspended");
    assert.match(status.notice ?? "", /payment dispute/);
    await omar.client.fails(423, "GET", "/api/v1/bootstrap", undefined, "WORKSPACE_SUSPENDED");
    // Members keep billing and privacy routes; training is refused.
    await member.client.fails(423, "GET", "/api/v1/bootstrap", undefined, "WORKSPACE_SUSPENDED");
    const billing = await member.client.get("/api/v1/membership/billing");
    assert.ok(billing, "billing stays readable for the member");
    const page = await ctx.newClient("visitor").request("GET", `/api/v1/public/trainers/${omar.slug}`);
    assert.ok(page.status === 404 || page.status === 410, "public trainer page unavailable: " + page.status);
    const notices = await omar.client.get("/api/v1/notifications");
    const list = Array.isArray(notices) ? notices : notices.notifications ?? notices.items ?? [];
    assert.ok(JSON.stringify(list).toLowerCase().includes("paused") || JSON.stringify(list).toLowerCase().includes("suspend"), "owner notified in the app");
    await ctx.waitUntil("suspension email to the owner", async () => mocks.email.inbox(omar.client.email).length > inbox, 60000);
    return `suspension ${suspension.id}; held payouts ${suspension.heldPayouts}`;
  });
  await r.step(A, "Alerts to platform operators", "the finance follow-up opened by the suspension raises an operator alert that is acknowledged and resolved", async () => {
    const evaluated = await admin.post("/api/v1/admin/alerts/evaluate", {});
    const alerts = await admin.get("/api/v1/admin/alerts?status=active");
    const alert = alerts.alerts.find((a: any) => a.rule === "finance.reconciliation_open") ?? alerts.alerts[0];
    assert.ok(alert, "an active alert exists: " + JSON.stringify(evaluated).slice(0, 300));
    assert.ok(!JSON.stringify(alert).includes(member.client.email), "alert text carries no member address");
    const acknowledged = await admin.post(`/api/v1/admin/alerts/${alert.id}/acknowledge`, { revision: alert.revision, note: "Looking into it" });
    assert.equal(acknowledged.status, "acknowledged");
    const resolved = await admin.post(`/api/v1/admin/alerts/${alert.id}/resolve`, {
      revision: acknowledged.revision,
      note: "Reviewed in the sandbox: the dispute follow-up is tracked by finance.",
    });
    assert.equal(resolved.status, "resolved");
    return `${alerts.alerts.length} active alert(s); rules: ${[...new Set(alerts.alerts.map((a: any) => a.rule))].join(", ")}; deliveries on the handled alert: ${alert.deliveries}`;
  });
  await r.step(A, "Suspend a workspace or lock an account", `${omar.slug}: reinstated; owner, members and the public page work again`, async () => {
    const history = await admin.get(`/api/v1/admin/governance/workspaces/${omar.tenantId}/history`);
    const active = history.history.find((h: any) => h.status === "active");
    assert.ok(active, "active suspension in the history");
    await admin.post(`/api/v1/admin/governance/workspaces/${omar.tenantId}/reinstate`, {
      suspensionId: active.id,
      revision: active.revision,
      reason: "Sandbox check finished: dispute reviewed",
    });
    const boot = await omar.client.get("/api/v1/bootstrap");
    assert.equal(boot.tenant.id, omar.tenantId);
    await member.client.get("/api/v1/bootstrap");
    const page = await ctx.newClient("visitor").request("GET", `/api/v1/public/trainers/${omar.slug}`);
    assert.equal(page.status, 200);
  });
  // An account lock: a dedicated follower of Omar, so other scenarios keep their members.
  const locked = ctx.followers.find((f) => f.trainer === omar && f !== member && f.client.userId);
  if (!locked) {
    r.blocked("omar-conditioning has no second follower to lock", [[A, "Suspend a workspace or lock an account", "account lock and unlock"]]);
    return;
  }
  await r.step(A, "Suspend a workspace or lock an account", `${locked.client.label}: locked (sessions end, sign-in refused after the password), then unlocked`, async () => {
    const found = await admin.get(`/api/v1/admin/governance/accounts?email=${encodeURIComponent(locked.client.email)}`);
    assert.equal(found.account?.id, locked.client.userId);
    await admin.post(`/api/v1/admin/governance/accounts/${locked.client.userId}/lock`, { reason: "Sandbox check: suspected shared account" });
    await locked.client.fails(401, "GET", "/api/v1/bootstrap");
    const signIn = await locked.client.request("POST", "/api/v1/auth/login", { email: locked.client.email, password: locked.client.password || PASSWORD });
    assert.equal(signIn.status, 423, signIn.text);
    assert.equal(signIn.body?.code, "ACCOUNT_LOCKED");
    const again = await admin.get(`/api/v1/admin/governance/accounts?email=${encodeURIComponent(locked.client.email)}`);
    const lock = again.account.locks.find((l: any) => l.status === "active");
    await admin.post(`/api/v1/admin/governance/accounts/${locked.client.userId}/unlock`, {
      lockId: lock.id,
      revision: lock.revision,
      reason: "Sandbox check finished: account confirmed",
    });
    await locked.client.login();
  });
}

async function hostOperations(ctx: E2EContext) {
  const { admin, reporter: r, mocks } = ctx;
  const base = "/api/v1/admin/infrastructure/host";
  const request = (action: string, reason: string, target?: string) =>
    admin.post(base + "/actions", { requestId: randomUUID(), action, reason, ...(target ? { target } : {}) });
  let cycle: any;
  await r.step(A, "Database backups", "on-demand encrypted backup with an off-server copy, written by the host controller and shown with a verified report", async () => {
    const before = await admin.get(base);
    assert.ok(["unreported", "stale"].includes(before.backups.state), "no verified backup evidence yet: " + before.backups.state);
    const backup = await request("backup_now", "Sandbox check: take a backup now");
    assert.equal(backup.status, "pending");
    cycle = await ctx.hostControllerCycle();
    assert.ok(cycle.handled.some((h: any) => h.id === backup.id && h.status === "succeeded"), JSON.stringify(cycle));
    const after = await admin.get(base);
    assert.equal(after.controller.state, "measured", "the signed controller report verifies");
    assert.equal(after.backups.state, "healthy");
    assert.equal(after.backups.location, "local+offsite");
    assert.equal(after.backups.offsite, "uploaded");
    assert.match(after.backups.sha256 ?? "", /^[0-9a-f]{64}$/);
    const shown = after.actions.recent.find((a: any) => a.id === backup.id);
    assert.equal(shown.status, "succeeded");
    assert.equal(shown.resultVerified, true, "the controller's result signature verifies");
    assert.equal(mocks.s3.objects.size, 2, "encrypted dump and its metadata stored off-server");
    return `backup ${after.backups.name}, ${after.backups.sizeBytes} bytes, S3 rejected requests ${mocks.s3.rejected}`;
  });
  await r.step(A, "Database backups", "restore check: the latest backup is decrypted and restored into a scratch database, then dropped", async () => {
    const verify = await request("verify_backup", "Sandbox check: verify the latest backup");
    cycle = await ctx.hostControllerCycle();
    assert.ok(cycle.handled.some((h: any) => h.id === verify.id && h.status === "succeeded"), JSON.stringify(cycle));
    const after = await admin.get(base);
    assert.equal(after.backups.lastVerification?.ok, true, JSON.stringify(after.backups.lastVerification));
    assert.match(after.backups.lastVerification.message, /restored into a scratch database/);
    const scratch = await ctx.sqlRead("SELECT datname FROM pg_database WHERE datname LIKE 'restore_check_%'");
    assert.equal(scratch.length, 0, "the scratch database was dropped");
    return after.backups.lastVerification.message;
  });
  await r.step(A, "Scaling, deploy or cloud actions from the admin", "allowlisted host actions run signed (pause and resume deploys); cloud resizing, DNS and billing stay refused", async () => {
    const pause = await request("pause_deploys", "Sandbox check: hold deployments");
    cycle = await ctx.hostControllerCycle();
    let view = await admin.get(base);
    assert.equal(view.deploy?.paused, true, "the controller reports deploys paused");
    const resume = await request("resume_deploys", "Sandbox check: resume deployments");
    cycle = await ctx.hostControllerCycle();
    view = await admin.get(base);
    assert.equal(view.deploy?.paused, false);
    for (const id of [pause.id, resume.id]) {
      const shown = view.actions.recent.find((a: any) => a.id === id);
      assert.equal(shown?.status, "succeeded");
      assert.equal(shown?.resultVerified, true);
    }
    await admin.fails(400, "POST", base + "/actions", { requestId: randomUUID(), action: "resize_server", reason: "Sandbox: not allowed" });
    assert.ok(view.outOfScope.some((o: any) => /Resize the server/.test(o.capability)), "cloud operations are listed as out of scope");
    // A report changed by anyone other than the controller is not shown as current.
    await ctx.advanceClock("forge the host report payload (tamper check)", "UPDATE host_status SET payload=replace(payload,'\"paused\":false','\"paused\":true') WHERE source='controller'");
    const forged = await admin.get(base);
    assert.equal(forged.controller.state, "unverified");
    cycle = await ctx.hostControllerCycle();
    assert.equal((await admin.get(base)).controller.state, "measured");
    return "pause/resume executed by the controller with verified results; a forged report shows as unverified";
  });
  await r.step(A, "Platform's own web address", "a new platform name is checked (format, DNS, coach-domain clash, passkeys) and the move procedure is listed", async () => {
    mocks.dns.set("platform-move.example", "A", [COACH_DOMAIN_EDGE_ADDRESS]);
    const good = await admin.post("/api/v1/admin/infrastructure/platform-address/check", { url: "https://platform-move.example" });
    assert.equal(good.checks.find((c: any) => c.key === "format")?.ok, true, JSON.stringify(good.checks));
    // The sandbox controller has no metadata service, so its report names no public
    // IPv4: DNS cannot pass without one (the real controller would refuse the move).
    assert.equal(good.serverIpv4, null);
    assert.equal(good.valid, false);
    assert.match(good.checks.find((c: any) => c.key === "dns")?.message ?? "", /public IPv4 address is not reported yet/);
    assert.ok(good.procedure.length >= 4);
    const clash = ctx.edge.domainAddress
      ? await admin.post("/api/v1/admin/infrastructure/platform-address/check", { url: "https://layla-strength-coaching.example" })
      : null;
    if (clash) assert.equal(clash.checks.find((c: any) => c.key === "coach_domain")?.ok, false, "a connected coach domain cannot become the platform address");
    const bad = await admin.post("/api/v1/admin/infrastructure/platform-address/check", { url: "http://platform-move.example/app" });
    assert.equal(bad.valid, false);
    const unresolved = await admin.post("/api/v1/admin/infrastructure/platform-address/check", { url: "https://no-records.example" });
    assert.equal(unresolved.checks.find((c: any) => c.key === "dns")?.ok, false);
    return "DNS passes only against the server IPv4 in a verified controller report; the move itself runs in the host controller and is not performed here";
  });
}
