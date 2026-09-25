import { test } from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "@trainer/db";
import { bootstrapAdmin } from "../apps/api/src/bootstrap-admin.ts";
import { passwordMatches } from "../apps/api/src/auth.ts";

test("first-admin bootstrap is host-only, stores a password hash and cannot run twice", async () => {
  const db = await createDatabase({ memory: true });
  try {
    const email = "bootstrap-" + Date.now() + "@example.test";
    const input = {
      email,
      name: "Initial operator",
      password: "SyntheticBootstrapOnly2026!",
    };
    const made = await bootstrapAdmin(db, input);
    const [account] = await db.system((tx) =>
      tx.query("SELECT * FROM users WHERE id=$1", [made.userId]),
    );
    assert.equal(account.platform_role, "admin");
    assert.notEqual(account.password_hash, input.password);
    assert.equal(
      await passwordMatches(input.password, account.password_hash),
      true,
    );
    await assert.rejects(
      bootstrapAdmin(db, { ...input, email: "other-" + email }),
      /already exists/,
    );
    const [count] = await db.system((tx) =>
      tx.query(
        "SELECT count(*)::int AS n FROM users WHERE platform_role='admin'",
      ),
    );
    assert.equal(count.n, 1);
    await db.system((tx) =>
      tx.query("UPDATE users SET platform_role='none' WHERE id=$1", [
        made.userId,
      ]),
    );
  } finally {
    await db.close();
  }
});
