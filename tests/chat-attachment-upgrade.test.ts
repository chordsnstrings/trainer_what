import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// A private embedded database reproduces the historical schema without
// downgrading or resetting the shared PostgreSQL integration-test database.
test("030 upgrades existing chat media without resetting conversations", async (t) => {
  const db = new PGlite();
  const migrations = new URL("../packages/db/migrations/", import.meta.url);
  const upgrade = "030_chat_attachment_completion.sql";
  const ids = Object.fromEntries(
    [
      "tenant",
      "foreignTenant",
      "client",
      "coach",
      "foreignClient",
      "admin",
      "message",
      "nextMessage",
      "foreignMessage",
      "bound",
      "draft",
      "expired",
      "foreignBound",
      "foreignExpired",
    ].map((key) => [key, randomUUID()]),
  );
  const bytes = Buffer.from("synthetic migration media");
  async function snapshot() {
    return {
      media: (
        await db.query<{ tenant_id: string }>(
          "SELECT id,tenant_id,uploaded_by,subject_user_id,message_id,file_name,encode(media,'hex') AS bytes,details,created_at,expires_at FROM chat_attachments ORDER BY id",
        )
      ).rows,
      messages: (
        await db.query<{ tenant_id: string; data: { attachments: unknown[] } }>(
          "SELECT id,tenant_id,owner_user_id,data,version,created_at,updated_at FROM records ORDER BY id",
        )
      ).rows,
    };
  }
  async function scoped<T>(
    userId: string,
    role: string | null,
    fn: () => Promise<T>,
    tenantId = ids.tenant,
  ): Promise<T> {
    await db.exec("BEGIN; SET LOCAL ROLE trainer_app;");
    try {
      await db.query(
        "SELECT set_config('app.tenant_id',$1,true),set_config('app.user_id',$2,true)",
        [tenantId, userId],
      );
      if (role !== null)
        await db.query("SELECT set_config('app.role',$1,true)", [role]);
      const value = await fn();
      await db.exec("COMMIT;");
      return value;
    } catch (error) {
      await db.exec("ROLLBACK;");
      throw error;
    }
  }
  try {
    for (const file of (await readdir(migrations))
      .filter((file) => file.endsWith(".sql") && file < upgrade)
      .sort()) {
      await db.exec(
        "BEGIN;" +
          (await readFile(new URL(file, migrations), "utf8")) +
          "COMMIT;",
      );
    }
    for (const key of ["client", "coach", "foreignClient", "admin"]) {
      await db.query(
        "INSERT INTO users(id,email,name,password_hash,platform_role) VALUES($1,$2,$3,'synthetic',$4)",
        [
          ids[key],
          `${key}@upgrade.example.test`,
          key,
          key === "admin" ? "admin" : "none",
        ],
      );
    }
    for (const key of ["tenant", "foreignTenant"])
      await db.query("INSERT INTO tenants(id,slug,name) VALUES($1,$2,$2)", [
        ids[key],
        key,
      ]);
    await db.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'subscriber'),($4,$5,'subscriber')",
      [ids.tenant, ids.coach, ids.client, ids.foreignTenant, ids.foreignClient],
    );
    for (const [message, tenant, user, attachments] of [
      [ids.message, ids.tenant, ids.client, [ids.bound]],
      [ids.nextMessage, ids.tenant, ids.client, []],
      [
        ids.foreignMessage,
        ids.foreignTenant,
        ids.foreignClient,
        [ids.foreignBound],
      ],
    ] as const) {
      await db.query(
        "INSERT INTO records(id,tenant_id,kind,owner_user_id,status,data) VALUES($1,$2,'message',$3,'sent',$4)",
        [
          message,
          tenant,
          user,
          JSON.stringify({
            authorUserId: user,
            text: "Existing conversation",
            attachments: attachments.map((id) => ({ id })),
          }),
        ],
      );
    }
    for (const [id, tenant, uploader, subject, message, expired] of [
      [ids.bound, ids.tenant, ids.client, ids.client, ids.message, true],
      [ids.draft, ids.tenant, ids.client, ids.client, null, false],
      [ids.expired, ids.tenant, ids.coach, ids.client, null, true],
      [
        ids.foreignBound,
        ids.foreignTenant,
        ids.foreignClient,
        ids.foreignClient,
        ids.foreignMessage,
        true,
      ],
      [
        ids.foreignExpired,
        ids.foreignTenant,
        ids.foreignClient,
        ids.foreignClient,
        null,
        true,
      ],
    ] as const) {
      await db.query(
        "INSERT INTO chat_attachments(id,tenant_id,uploaded_by,subject_user_id,request_key,fingerprint,message_id,file_name,mime_type,media,byte_count,details,expires_at) VALUES($1,$2,$3,$4,$5,'synthetic',$6,'Existing.jpg','image/jpeg',$7,$8,$9,now()+$10::interval)",
        [
          id,
          tenant,
          uploader,
          subject,
          randomUUID(),
          message,
          bytes,
          bytes.length,
          JSON.stringify({ original: true }),
          expired ? "-1 hour" : "1 hour",
        ],
      );
    }
    const before = await snapshot();
    assert.equal(
      (
        await db.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM schema_migrations WHERE version='030_chat_attachment_completion'",
        )
      ).rows[0].n,
      0,
    );
    await db.exec(
      "BEGIN;" +
        (await readFile(new URL(upgrade, migrations), "utf8")) +
        "COMMIT;",
    );

    await t.test(
      "preserves existing messages, drafts, attachment bytes and timestamps",
      async () => {
        assert.deepEqual(await snapshot(), before);
        assert.equal(
          (
            await db.query<{ n: number }>(
              "SELECT count(*)::int AS n FROM schema_migrations WHERE version='030_chat_attachment_completion'",
            )
          ).rows[0].n,
          1,
        );
      },
    );

    await t.test(
      "all privacy helpers reject an absent role before reading or deleting",
      async () => {
        // This runs before setting app.role, so the custom GUC is truly NULL.
        for (const [sql, values] of [
          ["SELECT * FROM export_personal_chat_media($1)", [ids.client]],
          ["SELECT erase_personal_chat_media($1)", [ids.client]],
          ["SELECT expire_unattached_chat_media()", []],
          ["SELECT erase_workspace_chat_media()", []],
        ] as const) {
          await assert.rejects(
            scoped(ids.client, null, async () => {
              assert.equal(
                (
                  await db.query<{ role: string | null }>(
                    "SELECT current_setting('app.role',true) AS role",
                  )
                ).rows[0].role,
                null,
              );
              await db.query(sql, [...values]);
            }),
            { code: "42501" },
          );
        }
        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test(
      "upgraded drafts bind once and already bound media can be locked",
      async () => {
        await scoped(ids.client, "subscriber", async () => {
          const bound = await db.query(
            "UPDATE chat_attachments SET message_id=$2 WHERE id=$1 RETURNING id,message_id",
            [ids.draft, ids.nextMessage],
          );
          assert.deepEqual(bound.rows, [
            { id: ids.draft, message_id: ids.nextMessage },
          ]);
          assert.equal(
            (
              await db.query(
                "SELECT id FROM chat_attachments WHERE id=$1 FOR UPDATE",
                [ids.draft],
              )
            ).rows.length,
            1,
          );
          await db.query(
            "UPDATE records SET data=jsonb_set(data,'{attachments}',$2::jsonb) WHERE id=$1",
            [ids.nextMessage, JSON.stringify([{ id: ids.draft }])],
          );
        });
        await assert.rejects(
          scoped(ids.client, "subscriber", () =>
            db.query("UPDATE chat_attachments SET message_id=$2 WHERE id=$1", [
              ids.draft,
              ids.message,
            ]),
          ),
          /bind to one message only/,
        );
        await assert.rejects(
          scoped(ids.client, "subscriber", () =>
            db.query(
              "UPDATE chat_attachments SET file_name='Changed.jpg' WHERE id=$1",
              [ids.draft],
            ),
          ),
          /content and ownership are immutable/,
        );
        await assert.rejects(
          scoped(ids.coach, "owner", () =>
            db.query("UPDATE chat_attachments SET message_id=$2 WHERE id=$1", [
              ids.expired,
              ids.nextMessage,
            ]),
          ),
          /Draft attachment has expired/,
        );
      },
    );

    await t.test(
      "export and expiry preserve bound and foreign media",
      async () => {
        const exported = await scoped(ids.client, "owner", () =>
          db.query<{ id: string; content_base64: string | null }>(
            "SELECT * FROM export_personal_chat_media($1)",
            [ids.client],
          ),
        );
        assert.equal(exported.rows.length, 3);
        assert.equal(
          exported.rows.find((row) => row.id === ids.bound)?.content_base64,
          bytes.toString("base64"),
        );
        assert.equal(
          exported.rows.find((row) => row.id === ids.expired)?.content_base64,
          null,
        );
        const removed = await scoped(ids.coach, "owner", () =>
          db.query<{ n: number }>("SELECT expire_unattached_chat_media() AS n"),
        );
        assert.equal(removed.rows[0].n, 1);
        const remaining = (
          await db.query<{ id: string }>(
            "SELECT id FROM chat_attachments ORDER BY id",
          )
        ).rows.map((row) => row.id);
        assert.deepEqual(
          remaining,
          [ids.bound, ids.draft, ids.foreignBound, ids.foreignExpired].sort(),
        );
      },
    );

    await t.test(
      "workspace erasure requires an operator and retains other tenants",
      async () => {
        await assert.rejects(
          scoped(ids.coach, "owner", () =>
            db.query("SELECT erase_workspace_chat_media()"),
          ),
          { code: "42501" },
        );
        const removed = await scoped(ids.admin, "owner", () =>
          db.query<{ n: number }>("SELECT erase_workspace_chat_media() AS n"),
        );
        assert.equal(removed.rows[0].n, 2);
        const remaining = await snapshot();
        assert.deepEqual(
          remaining.media,
          before.media.filter((row) => row.tenant_id === ids.foreignTenant),
        );
        assert.deepEqual(
          remaining.messages.filter(
            (row) => row.tenant_id === ids.foreignTenant,
          ),
          before.messages.filter((row) => row.tenant_id === ids.foreignTenant),
        );
        for (const message of remaining.messages.filter(
          (row) => row.tenant_id === ids.tenant,
        ))
          assert.deepEqual(message.data.attachments, []);
      },
    );
  } finally {
    await db.close();
  }
});
