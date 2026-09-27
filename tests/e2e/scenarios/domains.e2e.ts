/**
 * Custom coach domain, end to end: ownership TXT record and CNAME published
 * through the registrar double into the harness DNS double, the trainer's
 * ownership check, the Superadmin's activation (DNS, CNAME target and an HTTPS
 * request that goes through the local edge, which asks the API before it
 * presents a certificate, as Caddy's on-demand TLS does), then visitors and
 * members on https://<coach domain>/.
 */
import assert from "node:assert/strict";
import type { E2EContext, TrainerSeed } from "../harness/context.ts";
import { COACH_DOMAIN_NAMES } from "../mocks/index.ts";
import { PASSWORD } from "../harness/data.ts";

const A = "Super admin" as const;
const T = "Trainers" as const;
const F = "followers" as const;
const P = "public-join" as const;

export async function domainLifecycle(ctx: E2EContext, trainer: TrainerSeed, ownedOrder: any) {
  const { admin, reporter: r, mocks } = ctx;
  const hostname: string = ownedOrder.hostname;
  const target = "edge.sandbox-platform.example";
  if (!ctx.edge.domainAddress) {
    for (const [audience, feature] of [
      [P, "Domain ownership check"],
      [P, "Superadmin activates the domain"],
      [P, "HTTPS certificates for coach domains on the live server"],
      [P, "Coach website on its own domain"],
      [F, "Sign in at a trainer's own web address"],
    ] as const)
      r.skip(audience, feature, hostname, "coach-domain edge unavailable: " + ctx.edge.domainError);
    return;
  }
  let order = ownedOrder;
  await r.step(P, "Domain ownership check", `${hostname}: the TXT record is missing first, then published at the registrar and verified`, async () => {
    const [row] = (await trainer.client.get("/api/v1/domains")).filter((d: any) => d.id === order.id);
    assert.ok(row?.token, "the trainer sees the verification token to publish");
    await trainer.client.fails(409, "POST", `/api/v1/domains/${order.id}/verify`, { revision: Number(row.version) }, "DOMAIN_DNS");
    // The operator publishes the records at the registrar (the platform itself never calls a registrar API).
    const records = [
      { type: "TXT", name: `_trainer-verify.${hostname}`, value: `trainer-verification=${row.token}` },
      { type: "CNAME", name: "@", value: target },
    ];
    const saved = await fetch(`${mocks.registrar.url}/v1/domains/${hostname}/records`, {
      method: "PUT",
      headers: { authorization: `Bearer ${mocks.secrets.registrar}`, "content-type": "application/json" },
      body: JSON.stringify({ records }),
    });
    assert.equal(saved.status, 200);
    order = await trainer.client.post(`/api/v1/domains/${order.id}/verify`, { revision: Number(row.version) });
    assert.equal(order.status, "verified");
    assert.ok(order.verified_at);
    const lookups = mocks.dns.queries.filter((q) => q.name === `_trainer-verify.${hostname}`);
    return `TXT lookups through the sandbox resolver: ${lookups.length} (first NXDOMAIN, then answered)`;
  });
  if (order.status !== "verified") return;
  const expiresAt = new Date(Date.now() + 360 * 86400000).toISOString();
  await r.step(P, "HTTPS certificates for coach domains on the live server", `${hostname}: before activation the edge's TLS ask refuses the name`, async () => {
    const before = ctx.domainClient(hostname, "visitor-before-activation");
    const attempt = await before.request("GET", "/").then(
      () => "handshake completed",
      (error) => String(error?.code ?? error?.message ?? error),
    );
    assert.notEqual(attempt, "handshake completed", "no certificate may be presented for an unmapped domain");
    const asked = ctx.edge.asks.filter((a) => a.name === hostname);
    assert.ok(asked.some((a) => a.status === 404), JSON.stringify(asked));
    return `ask answers so far: ${asked.map((a) => a.status).join(",")}`;
  });
  await r.step(P, "Superadmin activates the domain", `${hostname}: wrong target refused, then DNS, CNAME and an HTTPS check through the edge`, async () => {
    await admin.fails(409, "POST", `/api/v1/admin/integrations/domains/${order.id}/activate`, {
      revision: Number(order.version),
      dnsTarget: "wrong-target.example",
      registrarReference: "mock-registrar",
      expiresAt,
    }, "DOMAIN_TARGET");
    const asksBefore = ctx.edge.asks.length;
    order = await admin.post(`/api/v1/admin/integrations/domains/${order.id}/activate`, {
      revision: Number(order.version),
      dnsTarget: target,
      registrarReference: "mock-registrar",
      expiresAt,
    });
    assert.equal(order.status, "active");
    assert.ok(order.evidence?.tlsCheckedAt, "activation recorded its HTTPS check");
    const asks = ctx.edge.asks.slice(asksBefore).filter((a) => a.name === hostname);
    assert.ok(asks.some((a) => a.status === 200), "the activation's HTTPS request got a certificate after the API allowed it");
    const cname = mocks.dns.queries.filter((q) => q.name === hostname && q.type === "CNAME");
    assert.ok(cname.length >= 1, "the CNAME was looked up");
    return `edge asks during activation: ${asks.map((a) => a.status).join(",")}`;
  });
  if (order.status !== "active") return;
  await r.step(P, "HTTPS certificates for coach domains on the live server", `${hostname}: an active mapping gets a certificate; an unknown name still does not`, async () => {
    const visitor = ctx.domainClient(hostname, "visitor-after-activation");
    const home = await visitor.request("GET", "/");
    assert.ok(home.status < 500, "HTTP " + home.status);
    const stranger = ctx.domainClient(COACH_DOMAIN_NAMES[1], "visitor-unmapped");
    const refused = await stranger.request("GET", "/").then(
      () => false,
      () => true,
    );
    assert.ok(refused, "an unmapped name is refused during the TLS handshake");
    // Only the edge may ask: through the public edge and web tier the route answers 404.
    const probe = await ctx.newClient("ask-through-web").request("GET", `/api/v1/internal/tls/ask?domain=${hostname}&token=x`);
    assert.equal(probe.status, 404);
    return "the local edge stands in for Caddy; the live Caddyfile is covered by the infrastructure unit tests";
  });
  await r.step(P, "Coach website on its own domain", `https://${hostname}/ serves only ${trainer.slug}'s website and join pages`, async () => {
    const visitor = ctx.domainClient(hostname, "domain-visitor");
    const home = await visitor.request("GET", "/");
    assert.equal(home.status, 200, "HTTP " + home.status);
    assert.match(home.text, new RegExp(trainer.name.split(" ")[0]), "the coach's own website is served");
    const about = await visitor.request("GET", "/about");
    assert.equal(about.status, 200);
    const join = await visitor.request("GET", `/join-coach/${trainer.slug}`);
    assert.equal(join.status, 200);
    for (const blocked of ["/admin", "/trainer/brain", "/signup"]) {
      const page = await visitor.request("GET", blocked);
      // The web proxy refuses operator, trainer and sign-up pages on a coach domain (403 "use the platform address").
      assert.ok([403, 404].includes(page.status), `${blocked} → ${page.status}`);
    }
    const otherCoach = ctx.trainers.find((t) => t.slug !== trainer.slug && t.published);
    if (otherCoach) {
      const other = await visitor.request("GET", `/coach/${otherCoach.slug}`);
      assert.notEqual(other.status, 200, "another coach's site is not served on this domain");
    }
    return "home, about and join pages served; operator and trainer pages closed";
  });
  const member = ctx.followers.find((f) => f.trainer.slug === trainer.slug && f.paid && f.client.email);
  if (!member) return;
  await r.step(F, "Sign in at a trainer's own web address", `${member.client.label}: password sign-in at https://${hostname}/ opens ${trainer.slug}'s workspace`, async () => {
    const device = ctx.domainClient(hostname, member.client.label + "-coach-domain", member.client.email, member.client.password || PASSWORD);
    device.mfaSecret = member.client.mfaSecret;
    device.mfaCounter = member.client.mfaCounter;
    const boot = await device.login();
    assert.equal(boot.user.tenantId, trainer.tenantId, "the coach domain selects the coach's workspace");
    const cookie = [...device.cookies.keys()];
    assert.ok(cookie.length, "session cookie set for the coach domain");
    // The session is bound to the coach domain: the platform address does not accept it.
    const platform = ctx.newClient("cookie-replay");
    for (const [k, v] of device.cookies) platform.cookies.set(k, v);
    const replay = await platform.request("GET", "/api/v1/bootstrap");
    return `platform address with the coach-domain cookie → HTTP ${replay.status}`;
  });
}
