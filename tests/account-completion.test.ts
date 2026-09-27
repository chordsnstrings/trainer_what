import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  randomBytes,
  randomUUID,
  createHash,
  generateKeyPairSync,
  sign,
  type KeyObject,
} from "node:crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { encodeCBOR } from "@levischuck/tiny-cbor";
import { z } from "zod";
import { createDatabase, type Database } from "@trainer/db";
import { passwordHash, newToken, tokenHash } from "../apps/api/src/auth.ts";
import { securityRoutes, totpAt } from "../apps/api/src/security.ts";
import { registerAccountCompletion } from "../apps/api/src/account-completion.ts";
import { registerPasskeys } from "../apps/api/src/passkeys.ts";
import { buildApp } from "../apps/api/src/app.ts";
import { customHostPath } from "../apps/web/host-proxy.ts";
let db: Database, app: ReturnType<typeof Fastify>, passwordEncoded: string;
const password = "SyntheticAccountOnly2026!",
  origin = "http://localhost:3000",
  hosts = new Map<string, any>();
const oldKey = process.env.SECURITY_ENCRYPTION_KEY;
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest();
function setCookie(r: any, name: string) {
  return (
    (Array.isArray(r.headers["set-cookie"])
      ? r.headers["set-cookie"]
      : [r.headers["set-cookie"]]
    )
      .find((x: any) => String(x).startsWith(name + "="))
      ?.split(";")[0] ?? ""
  );
}
async function person(role = "owner", host = "public") {
  const tenantId = randomUUID(),
    userId = randomUUID(),
    token = newToken();
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash,email_verified) VALUES($1,'Synthetic',$2,$3,true)",
      [userId, userId + "@example.test", passwordEncoded],
    );
    await tx.query(
      "INSERT INTO tenants(id,slug,name,published) VALUES($1,$2,'Synthetic',true)",
      [tenantId, "test-" + tenantId],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
      [tenantId, userId, role],
    );
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,tenant_id,expires_at,mfa_at) VALUES($1,$2,$3,now()+interval '7 days',now())",
      [tokenHash(token), userId, tenantId],
    );
  });
  return {
    tenantId,
    userId,
    role,
    email: userId + "@example.test",
    cookie: "session=" + token,
    host,
  };
}
function req(a: any, path: string, body?: unknown, extraCookie = "") {
  return app.inject({
    method: body ? "POST" : "GET",
    url: "/api/v1/auth/" + path,
    headers: {
      cookie: [a?.cookie ?? "", extraCookie].filter(Boolean).join("; "),
      "x-test-host": a?.host ?? "public",
    },
    payload: body,
  });
}
async function linkFor(a: any, purpose = "magic") {
  const jobs = await db.tenant({ ...a, role: "owner" }, (tx) =>
    tx.query(
      "SELECT data FROM jobs WHERE intent_key LIKE $1 AND data->>'to'=$2 ORDER BY created_at DESC",
      [purpose + ":%", a.email],
    ),
  );
  return jobs[0].data.text.split("\n")[0].split("/").pop();
}
async function enableMfa(a: any) {
  let r = await req(a, "mfa/enroll", { password });
  assert.equal(r.statusCode, 200, r.body);
  const secret = r.json().secret;
  r = await req(a, "mfa/confirm", {
    code: totpAt(secret, Math.floor(Date.now() / 30000)),
  });
  assert.equal(r.statusCode, 200, r.body);
  return secret;
}
before(async () => {
  process.env.SECURITY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  passwordEncoded = await passwordHash(password);
  db = await createDatabase({ memory: true });
  app = Fastify();
  await app.register(cookie);
  app.addHook("onRequest", async (req: any) => {
    (req as any).hostContext = hosts.get(
      String(req.headers["x-test-host"]),
    ) ?? {
      host: "localhost:3000",
      origin,
      tenantId: null,
      tenantSlug: null,
      custom: false,
      verifiedProxy: false,
    };
    const token = req.cookies.session;
    if (token) {
      const [row] = await db.system((tx) =>
        tx.query(
          "SELECT s.user_id,s.tenant_id,m.role,u.email,u.name,u.email_verified,s.mfa_at FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id AND m.tenant_id=s.tenant_id WHERE token_hash=$1 AND expires_at>now()",
          [tokenHash(token)],
        ),
      );
      if (row)
        (req as any).testIdentity = {
          tenantId: row.tenant_id,
          userId: row.user_id,
          role: row.role,
          name: row.name,
          email: row.email,
          emailVerified: row.email_verified,
          mfaAt: row.mfa_at,
        };
    }
  });
  app.setErrorHandler((error: Error, r: any, reply: any) => {
    const e = error as any;
    reply
      .code(
        error instanceof z.ZodError
          ? 400
          : e.name === "ProviderUnavailable"
            ? 503
            : (e.statusCode ?? 500),
      )
      .send({ code: e.code ?? e.name, message: e.message });
  });
  const identity = (r: any) => {
    if (!r.testIdentity)
      throw Object.assign(new Error("Sign in"), { statusCode: 401 });
    return r.testIdentity;
  };
  securityRoutes(app, db, identity);
  registerAccountCompletion(app, db, identity);
  registerPasskeys(app, db, identity);
  await app.ready();
});
after(async () => {
  await app.close();
  await db.close();
  if (oldKey === undefined) delete process.env.SECURITY_ENCRYPTION_KEY;
  else process.env.SECURITY_ENCRYPTION_KEY = oldKey;
});

test("sessions are private, expose no token hashes and individual revocation invalidates only the chosen session", async () => {
  const a = await person(),
    b = await person();
  const account = await req(a, "account");
  assert.equal(account.statusCode, 200, account.body);
  const own = account.json().sessions[0],
    other = (await req(b, "account")).json().sessions[0];
  assert.equal(own.current, true);
  assert.doesNotMatch(account.body, /token_hash|password_hash/);
  assert.equal(
    (await req(a, "sessions/" + other.id + "/revoke", {})).statusCode,
    404,
  );
  const removed = await req(a, "sessions/" + own.id + "/revoke", {});
  assert.equal(removed.statusCode, 200);
  assert.equal(removed.json().current, true);
  assert.equal((await req(a, "account")).statusCode, 401);
  assert.equal((await req(b, "account")).statusCode, 200);
});

test("assembled application exposes account and passkey routes, updates session activity and preserves custom-host recovery paths", async () => {
  const a = await person(),
    assembled = await buildApp({ db, testing: true });
  try {
    await db.system((tx) =>
      tx.query(
        "UPDATE sessions SET last_seen_at=now()-interval '1 day' WHERE user_id=$1",
        [a.userId],
      ),
    );
    const account = await assembled.inject({
      method: "GET",
      url: "/api/v1/auth/account",
      headers: { cookie: a.cookie },
    });
    assert.equal(account.statusCode, 200, account.body);
    assert.ok(
      Date.now() - new Date(account.json().sessions[0].last_seen_at).getTime() <
        60_000,
    );
    const passkeys = await assembled.inject({
      method: "GET",
      url: "/api/v1/auth/passkeys",
      headers: { cookie: a.cookie },
    });
    assert.equal(passkeys.statusCode, 200, passkeys.body);
    assert.equal(
      (await assembled.inject({ method: "GET", url: "/api/v1/auth/account" }))
        .statusCode,
      401,
    );
    for (const path of [
      "/magic-link",
      "/magic-link/synthetic-token",
      "/recover-authenticator",
    ])
      assert.equal(customHostPath(path, "fixture-coach"), path);
    assert.equal(customHostPath("/trainer/settings", "fixture-coach"), null);
    assert.equal(customHostPath("/coach/another", "fixture-coach"), null);
  } finally {
    await assembled.close();
  }
});

test("recovery codes are hashed, shown once and burn all codes/sessions without granting privileged MFA", async () => {
  const a = await person();
  await enableMfa(a);
  const made = await req(a, "mfa/recovery-codes", { password });
  assert.equal(made.statusCode, 200, made.body);
  const codes = made.json().codes;
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  const stored = await db.system((tx) =>
    tx.query("SELECT code_hash FROM mfa_recovery_codes WHERE user_id=$1", [
      a.userId,
    ]),
  );
  assert.ok(stored.every((x) => !codes.includes(x.code_hash)));
  assert.equal(
    (
      await req(null, "mfa/recover", {
        email: a.email,
        password,
        recoveryCode: "11111111-11111111-11111111-11111111",
      })
    ).statusCode,
    401,
  );
  const recovery = await req(null, "mfa/recover", {
    email: a.email,
    password,
    recoveryCode: codes[0],
  });
  assert.equal(recovery.statusCode, 200, recovery.body);
  const cookie = setCookie(recovery, "session");
  assert.ok(cookie);
  assert.equal((await req(a, "account")).statusCode, 401);
  const restored = await req({ ...a, cookie }, "account");
  assert.equal(restored.json().recoveryCodesRemaining, 0);
  assert.equal(restored.json().mfaEnabled, false);
  assert.equal(
    (await req({ ...a, cookie }, "mfa/recovery-codes", { password }))
      .statusCode,
    403,
  );
  assert.equal(
    (
      await req(null, "mfa/recover", {
        email: a.email,
        password,
        recoveryCode: codes[1],
      })
    ).statusCode,
    401,
  );
});

test("magic links are single-use, expire, preserve authenticator requirements and report unknown emails uniformly", async () => {
  const a = await person(),
    secret = await enableMfa(a);
  const unknown = await req(null, "magic-link", {
      email: "unknown@example.test",
    }),
    known = await req(null, "magic-link", { email: a.email });
  assert.deepEqual(known.json(), unknown.json());
  const token = await linkFor(a);
  assert.equal(
    (await req(null, "magic-link/consume", { token })).statusCode,
    401,
  );
  const done = await req(null, "magic-link/consume", {
    token,
    code: totpAt(secret, Math.floor(Date.now() / 30000) + 1),
  });
  assert.equal(done.statusCode, 200, done.body);
  assert.ok(setCookie(done, "session"));
  assert.equal(
    (await req(null, "magic-link/consume", { token })).statusCode,
    400,
  );
  await req(null, "magic-link", { email: a.email });
  const expired = await linkFor(a);
  await db.system((tx) =>
    tx.query(
      "UPDATE one_time_tokens SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",
      [tokenHash(expired)],
    ),
  );
  assert.equal(
    (await req(null, "magic-link/consume", { token: expired })).statusCode,
    400,
  );
});

test("magic and password reset links bind the issuing host and reject closed workspaces", async () => {
  const a = await person("subscriber", "coach");
  hosts.set("coach", {
    host: "coach.example.test",
    origin: "https://coach.example.test",
    tenantId: a.tenantId,
    tenantSlug: "synthetic",
    custom: true,
    verifiedProxy: true,
  });
  await req(a, "magic-link", { email: a.email });
  const magic = await linkFor(a);
  assert.equal(
    (await req(null, "magic-link/consume", { token: magic })).statusCode,
    400,
  );
  assert.equal(
    (await req({ ...a, cookie: "" }, "magic-link/consume", { token: magic }))
      .statusCode,
    200,
  );
  await req(a, "forgot-password", { email: a.email });
  const reset = await linkFor(a, "reset");
  assert.equal(
    (
      await req(null, "reset-password", {
        token: reset,
        password: "ChangedPassword2026!",
      })
    ).statusCode,
    400,
  );
  await db.system((tx) =>
    tx.query("UPDATE tenants SET lifecycle_state='closed' WHERE id=$1", [
      a.tenantId,
    ]),
  );
  assert.equal(
    (
      await req({ ...a, cookie: "" }, "reset-password", {
        token: reset,
        password: "ChangedPassword2026!",
      })
    ).statusCode,
    403,
  );
});

test("email provider availability is checked before existence lookup", async () => {
  const a = await person(),
    previous = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "production" });
  try {
    for (const path of ["magic-link", "forgot-password"]) {
      const x = await req(null, path, { email: a.email }),
        y = await req(null, path, { email: "absent@example.test" });
      assert.equal(x.statusCode, 503, x.body);
      assert.deepEqual(x.json(), y.json());
    }
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Object.assign(process.env, { NODE_ENV: previous });
  }
});

function softwareAuthenticator(userId: string) {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" }),
    jwk = keys.publicKey.export({ format: "jwk" }),
    credential = randomBytes(32),
    cose = Buffer.from(
      encodeCBOR(
        new Map<any, any>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
          [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
        ]),
      ),
    );
  return { userId, privateKey: keys.privateKey, credential, cose };
}
function clientData(type: string, challenge: string, clientOrigin: string) {
  return Buffer.from(
    JSON.stringify({
      type,
      challenge,
      origin: clientOrigin,
      crossOrigin: false,
    }),
  );
}
function registration(
  auth: ReturnType<typeof softwareAuthenticator>,
  options: any,
  clientOrigin = origin,
) {
  const client = clientData("webauthn.create", options.challenge, clientOrigin),
    size = Buffer.alloc(2);
  size.writeUInt16BE(auth.credential.length);
  const authData = Buffer.concat([
    sha(options.rp.id),
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    size,
    auth.credential,
    auth.cose,
  ]);
  return {
    id: auth.credential.toString("base64url"),
    rawId: auth.credential.toString("base64url"),
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: client.toString("base64url"),
      attestationObject: Buffer.from(
        encodeCBOR(
          new Map<any, any>([
            ["fmt", "none"],
            ["attStmt", new Map()],
            ["authData", new Uint8Array(authData)],
          ]),
        ),
      ).toString("base64url"),
      transports: ["internal"],
    },
  };
}
function assertion(
  auth: ReturnType<typeof softwareAuthenticator>,
  options: any,
  counter = 1,
  flags = 0x05,
  clientOrigin = origin,
) {
  const client = clientData("webauthn.get", options.challenge, clientOrigin),
    count = Buffer.alloc(4);
  count.writeUInt32BE(counter);
  const authData = Buffer.concat([
      sha(options.rpId),
      Buffer.from([flags]),
      count,
    ]),
    signature = sign(
      "sha256",
      Buffer.concat([authData, sha(client)]),
      auth.privateKey,
    );
  return {
    id: auth.credential.toString("base64url"),
    rawId: auth.credential.toString("base64url"),
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: client.toString("base64url"),
      authenticatorData: authData.toString("base64url"),
      signature: signature.toString("base64url"),
      userHandle: Buffer.from(auth.userId).toString("base64url"),
    },
  };
}
async function createKey(a: any) {
  const response = await req(a, "passkeys/register/options", {
    label: "Synthetic key",
    password,
  });
  assert.equal(response.statusCode, 200, response.body);
  const start = response.json(),
    auth = softwareAuthenticator(a.userId),
    cookie = setCookie(response, "passkey_nonce");
  const verified = await req(
    a,
    "passkeys/register/verify",
    {
      challengeId: start.challengeId,
      response: registration(
        auth,
        start.options,
        hosts.get(a.host)?.origin ?? origin,
      ),
    },
    cookie,
  );
  assert.equal(verified.statusCode, 200, verified.body);
  return { auth, id: verified.json().id };
}
async function challengeFor(a: any = null) {
  const r = await req(a, "passkeys/authenticate/options", {});
  assert.equal(r.statusCode, 200, r.body);
  return { ...r.json(), cookie: setCookie(r, "passkey_nonce") };
}

test("real WebAuthn verifier accepts a signed registration/assertion and creates a UV-verified session", async () => {
  const a = await person(),
    { auth } = await createKey(a),
    c = await challengeFor();
  const signed = await req(
    null,
    "passkeys/authenticate/verify",
    { challengeId: c.challengeId, response: assertion(auth, c.options) },
    c.cookie,
  );
  assert.equal(signed.statusCode, 200, signed.body);
  const sessionCookie = setCookie(signed, "session");
  assert.ok(sessionCookie);
  const security = await req({ ...a, cookie: sessionCookie }, "security");
  assert.ok(security.json().mfaAt);
  assert.equal(
    (
      await req(
        null,
        "passkeys/authenticate/verify",
        { challengeId: c.challengeId, response: assertion(auth, c.options) },
        c.cookie,
      )
    ).statusCode,
    400,
  );
  const saved = await db.system((tx) =>
    tx.query("SELECT counter FROM auth_passkeys WHERE user_id=$1", [a.userId]),
  );
  assert.equal(Number(saved[0].counter), 1);
});

test("passkey verification rejects forged signatures, counter replay, missing UV and cross-browser nonce", async () => {
  const a = await person(),
    { auth } = await createKey(a);
  let c = await challengeFor();
  const body = {
    challengeId: c.challengeId,
    response: assertion(auth, c.options),
  };
  assert.equal(
    (
      await req(
        null,
        "passkeys/authenticate/verify",
        body,
        "passkey_nonce=other-browser",
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await req(null, "passkeys/authenticate/verify", body, c.cookie))
      .statusCode,
    200,
  );
  c = await challengeFor();
  assert.equal(
    (
      await req(
        null,
        "passkeys/authenticate/verify",
        { challengeId: c.challengeId, response: assertion(auth, c.options, 1) },
        c.cookie,
      )
    ).statusCode,
    401,
  );
  c = await challengeFor();
  assert.equal(
    (
      await req(
        null,
        "passkeys/authenticate/verify",
        {
          challengeId: c.challengeId,
          response: assertion(auth, c.options, 2, 0x01),
        },
        c.cookie,
      )
    ).statusCode,
    401,
  );
  c = await challengeFor();
  const forged = assertion(auth, c.options, 2);
  forged.response.signature = randomBytes(72).toString("base64url");
  assert.equal(
    (
      await req(
        null,
        "passkeys/authenticate/verify",
        { challengeId: c.challengeId, response: forged },
        c.cookie,
      )
    ).statusCode,
    401,
  );
  assert.equal(
    (
      await req(
        null,
        "passkeys/authenticate/verify",
        { challengeId: c.challengeId, response: assertion(auth, c.options, 2) },
        c.cookie,
      )
    ).statusCode,
    400,
  );
});

test("passkey revocation and removed memberships are rechecked before granting access", async () => {
  const a = await person(),
    { auth, id } = await createKey(a),
    c = await challengeFor();
  const revoked = await req(a, "passkeys/" + id + "/revoke", { password });
  assert.equal(revoked.statusCode, 200, revoked.body);
  assert.equal(
    (
      await req(
        null,
        "passkeys/authenticate/verify",
        { challengeId: c.challengeId, response: assertion(auth, c.options) },
        c.cookie,
      )
    ).statusCode,
    401,
  );
  const b = await person(),
    second = await createKey(b),
    d = await challengeFor();
  await db.system((tx) =>
    tx.query("DELETE FROM memberships WHERE user_id=$1", [b.userId]),
  );
  assert.equal(
    (
      await req(
        null,
        "passkeys/authenticate/verify",
        {
          challengeId: d.challengeId,
          response: assertion(second.auth, d.options),
        },
        d.cookie,
      )
    ).statusCode,
    403,
  );
});

test("passkey registration is session-bound and custom-host credentials do not survive domain reassignment", async () => {
  const a = await person(),
    start = await req(a, "passkeys/register/options", {
      label: "Pending key",
      password,
    }),
    auth = softwareAuthenticator(a.userId),
    c = start.json();
  await db.system((tx) =>
    tx.query("DELETE FROM sessions WHERE user_id=$1", [a.userId]),
  );
  assert.equal(
    (
      await req(
        a,
        "passkeys/register/verify",
        { challengeId: c.challengeId, response: registration(auth, c.options) },
        setCookie(start, "passkey_nonce"),
      )
    ).statusCode,
    401,
  );
  const b = await person("subscriber", "passkey-coach");
  hosts.set(b.host, {
    host: "key.example.test",
    origin: "https://key.example.test",
    tenantId: b.tenantId,
    custom: true,
    verifiedProxy: true,
  });
  const key = await createKey(b),
    d = await challengeFor({ ...b, cookie: "" });
  hosts.set(b.host, { ...hosts.get(b.host), tenantId: randomUUID() });
  assert.equal(
    (
      await req(
        { ...b, cookie: "" },
        "passkeys/authenticate/verify",
        {
          challengeId: d.challengeId,
          response: assertion(
            key.auth,
            d.options,
            1,
            0x05,
            "https://key.example.test",
          ),
        },
        d.cookie,
      )
    ).statusCode,
    400,
  );
});
