import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createDatabase } from "@trainer/db";
import { buildApp } from "../apps/api/src/app.ts";
import { tokenHash } from "../apps/api/src/auth.ts";

test("saved Superadmin configuration reaches subsequent authenticated app requests without an environment mutation", async () => {
  // An isolated embedded DB prevents a global settings fixture from changing
  // provider behavior for unrelated network-database test processes.
  const db = await createDatabase({ memory: true, url: "" });
  const encryption = process.env.SECURITY_ENCRYPTION_KEY;
  const originalName = process.env.APP_NAME,
    originalKey = process.env.MODEL_API_KEY;
  const fetch = globalThis.fetch;
  process.env.SECURITY_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const app = await buildApp({ db, testing: true });
  const origin = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
  let cookie = "";
  const request = (url: string, method: any = "GET", payload?: any) =>
    app.inject({
      url: "/api/v1" + url,
      method,
      headers: { origin, cookie },
      payload,
    });
  try {
    const registered = await request("/auth/register", "POST", {
      name: "Config operator",
      email: "request-config@example.test",
      password: "SyntheticRequestConfig2026!",
      slug: "request-config",
      accepted: true,
    });
    assert.equal(registered.statusCode, 201, registered.body);
    cookie = String(registered.headers["set-cookie"]).split(";")[0];
    const actor = (await request("/bootstrap")).json().user;
    await db.system(async (tx) => {
      await tx.query("UPDATE users SET platform_role='admin' WHERE id=$1", [
        actor.userId,
      ]);
      await tx.query("UPDATE sessions SET mfa_at=now() WHERE token_hash=$1", [
        tokenHash(cookie.slice("session=".length)),
      ]);
    });
    const saved = await request("/admin/settings/application", "PUT", {
      revision: 0,
      enabled: true,
      values: {
        APP_NAME: "Coach Atlas",
        SUPPORT_EMAIL: "support@example.test",
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual((await request("/bootstrap")).json().platform, {
      name: "Coach Atlas",
      supportEmail: "support@example.test",
    });
    const provider = await request("/admin/settings/model", "PUT", {
      revision: 0,
      enabled: true,
      values: {
        MODEL_BASE_URL: "https://runtime-model.test/v1",
        MODEL_NAME: "fixture-model",
        MODEL_INPUT_USD_PER_MILLION: "1",
        MODEL_OUTPUT_USD_PER_MILLION: "2",
        MODEL_PRICE_VERSION: "fixture-v1",
        MODEL_MAX_DAILY_CALLS: "100",
      },
      secrets: { MODEL_API_KEY: "fixture_scoped_api_key" },
    });
    assert.equal(provider.statusCode, 200, provider.body);
    assert.equal(provider.json().active, false);
    assert.equal(
      (await request("/bootstrap"))
        .json()
        .integrations.find((item: any) => item.id === "model").configured,
      false,
    );
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), "https://runtime-model.test/v1/models");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer fixture_scoped_api_key",
      );
      return Response.json({ data: [{ id: "fixture-model" }] });
    };
    const checked = await request("/admin/settings/model/test", "POST", {
      revision: provider.json().revision,
    });
    assert.equal(checked.statusCode, 200, checked.body);
    assert.equal(checked.json().active, true);
    assert.equal(
      (await request("/bootstrap"))
        .json()
        .integrations.find((item: any) => item.id === "model").configured,
      true,
    );
    const disabled = await request("/admin/settings/model", "PUT", {
      revision: checked.json().revision,
      enabled: false,
      values: {},
    });
    assert.equal(disabled.statusCode, 200, disabled.body);
    assert.equal(
      (await request("/bootstrap"))
        .json()
        .integrations.find((item: any) => item.id === "model").configured,
      false,
    );
    assert.equal(process.env.MODEL_API_KEY, originalKey);
    assert.equal(process.env.APP_NAME, originalName);
    assert.equal(
      JSON.stringify((await request("/bootstrap")).json()).includes(
        "fixture_scoped_api_key",
      ),
      false,
    );
  } finally {
    globalThis.fetch = fetch;
    if (encryption === undefined) delete process.env.SECURITY_ENCRYPTION_KEY;
    else process.env.SECURITY_ENCRYPTION_KEY = encryption;
    await app.close();
    await db.close();
  }
});
