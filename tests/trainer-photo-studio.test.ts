import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import Fastify from "fastify";
import sharp from "sharp";
import { z } from "zod";
import { createDatabase, type Actor, type Database } from "@trainer/db";
import { withRuntimeConfig } from "../packages/providers/src/configuration.ts";
import {
  photoConnection,
  photoPrompt,
  photoEstimate,
  DEFAULT_PHOTO_MODEL,
} from "../packages/providers/src/trainer-photo.ts";
import { registerTrainerPhotoStudio } from "../apps/api/src/trainer-photo-studio.ts";
import { periodUsage } from "../apps/api/src/cost-accounting.ts";
import {
  registerCoachSite,
  eraseOwnedBrandMedia,
} from "../apps/api/src/coach-site.ts";
let db: Database, app: ReturnType<typeof Fastify>, picture: Buffer;
const actors = new Map<string, Actor>();
const config = {
  MODEL_BASE_URL: "https://photo-studio.invalid/api/v3",
  MODEL_API_KEY: "synthetic",
  MODEL_NAME: "seed-2-0-pro",
  MODEL_IMAGE_DAILY_CALLS: "6",
  MODEL_IMAGE_DAILY_USD_LIMIT: "0.15",
};
async function trainer() {
  const actor: Actor = {
    tenantId: randomUUID(),
    userId: randomUUID(),
    role: "owner",
  };
  await db.system(async (tx) => {
    await tx.query(
      "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Synthetic Coach')",
      [actor.tenantId, "photo-" + actor.tenantId],
    );
    await tx.query(
      "INSERT INTO users(id,name,email,password_hash) VALUES($1,'Synthetic Coach',$2,'synthetic')",
      [actor.userId, actor.userId + "@example.test"],
    );
    await tx.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')",
      [actor.tenantId, actor.userId],
    );
  });
  actors.set(actor.userId, actor);
  const [photo] = await db.tenant(actor, (tx) =>
    tx.query(
      "INSERT INTO brand_media(id,tenant_id,owner_user_id,digest,media,width,height,filename) VALUES($1,$2,$3,$4,$5,40,60,'original.jpg') RETURNING id",
      [
        randomUUID(),
        actor.tenantId,
        actor.userId,
        createHash("sha256").update(picture).digest("hex"),
        picture,
      ],
    ),
  );
  return { actor, photoId: photo.id as string };
}
const request = (
  actor: Actor,
  path = "",
  method: "GET" | "POST" | "DELETE" = "GET",
  payload?: any,
) =>
  app.inject({
    method,
    url: "/api/v1/tenant/photo-studio" + path,
    headers: { "x-actor": actor.userId },
    ...(payload ? { payload } : {}),
  });
const input = (photoId: string, extra = {}) => ({
  requestId: randomUUID(),
  referenceIds: [photoId],
  style: "portrait",
  detail: "Warm studio light",
  consent: true,
  ...extra,
});
async function fixture(
  fn: (calls: any[]) => Promise<void>,
  response?: (calls: any[]) => Promise<Response> | Response,
  overrides = {},
) {
  const previous = globalThis.fetch,
    calls: any[] = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), config.MODEL_BASE_URL + "/images/generations");
    calls.push(JSON.parse(String(init?.body)));
    return response
      ? response(calls)
      : Response.json({
          data: [{ b64_json: picture.toString("base64") }],
          usage: { generated_images: 1 },
        });
  };
  try {
    await withRuntimeConfig({ ...config, ...overrides }, () => fn(calls));
  } finally {
    globalThis.fetch = previous;
  }
}
before(async () => {
  picture = await sharp({
    create: { width: 40, height: 60, channels: 3, background: "#dfd5ca" },
  })
    .jpeg()
    .toBuffer();
  db = await createDatabase({ memory: true });
  app = Fastify();
  app.addHook("onRequest", async (req: any) => {
    req.identity = actors.get(req.headers["x-actor"]);
  });
  app.setErrorHandler((error: any, _req: any, reply: any) =>
    reply
      .code(error instanceof z.ZodError ? 400 : (error.statusCode ?? 500))
      .send({ code: error.code, message: error.message }),
  );
  registerCoachSite(app, db);
  registerTrainerPhotoStudio(app, db);
  await app.ready();
});
after(async () => {
  await app?.close();
  await db?.close();
});

test("Seedream request uses owned image bytes, one bounded image, identity-preserving directions and no external output URL", async () => {
  const { actor, photoId } = await trainer();
  await fixture(async (calls) => {
    const ready = await request(actor, "", "POST", input(photoId));
    assert.equal(ready.statusCode, 200, ready.body);
    assert.equal(ready.json().status, "ready");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, DEFAULT_PHOTO_MODEL);
    assert.equal(calls[0].size, "1536x2048");
    assert.equal(calls[0].response_format, "b64_json");
    assert.ok(calls[0].image[0].startsWith("data:image/jpeg;base64,"));
    assert.equal(calls[0].sequential_image_generation, undefined);
    assert.match(calls[0].prompt, /preserve identity/);
    assert.match(calls[0].prompt, /Do not beautify, slim, add muscle/);
    const rows = await db.tenant(actor, (tx) =>
      tx.query(
        "SELECT status,cost_usd,estimated_cost_usd,product FROM cost_events WHERE task='trainer_photo'",
      ),
    );
    assert.equal(rows[0].status, "estimated");
    assert.equal(Number(rows[0].cost_usd), 0.018);
    assert.equal(rows[0].product, "trainer_setup");
    const usage = await db.tenant(actor, async (tx) => {
      const [month] = await tx.query("SELECT to_char(now() AT TIME ZONE 'Asia/Dubai','YYYY-MM') AS period");
      return periodUsage(tx, month.period, 3.6725);
    });
    assert.equal(usage.chargeMinor, 0, "Website photo setup must not enter the trainer service fee");
    assert.equal(Number(usage.platformBorneUsd), 0.018);
  });
});
test("same request, concurrent duplicate and changed intent cannot buy a second generation", async () => {
  const { actor, photoId } = await trainer(),
    body = input(photoId);
  let release!: () => void, started!: () => void;
  const hold = new Promise<void>((r) => (release = r)),
    entered = new Promise<void>((r) => (started = r));
  await fixture(
    async (calls) => {
      const first = request(actor, "", "POST", body);
      void first.then(() => {});
      await entered;
      assert.equal(
        (await request(actor, "", "POST", body)).json().status,
        "running",
      );
      assert.equal(
        (await request(actor, "", "POST", { ...body, detail: "changed" }))
          .statusCode,
        409,
      );
      release();
      const result = await first;
      assert.equal(result.json().status, "ready");
      assert.equal(
        (await request(actor, "", "POST", body)).json().id,
        result.json().id,
      );
      assert.equal(calls.length, 1);
    },
    async () => {
      started();
      await hold;
      return Response.json({
        data: [{ b64_json: picture.toString("base64") }],
      });
    },
  );
});
test("draft is private, tenant isolated, explicitly reviewed, and only then enters the existing media library", async () => {
  const a = await trainer(),
    b = await trainer();
  await fixture(async (calls) => {
    assert.equal(
      (await request(a.actor, "", "POST", input(b.photoId))).statusCode,
      400,
    );
    assert.equal(calls.length, 0);
    const ready = (await request(a.actor, "", "POST", input(a.photoId))).json();
    assert.equal(
      (await request(b.actor, `/${ready.id}/image`)).statusCode,
      404,
    );
    assert.equal((await app.inject({ url: ready.url })).statusCode, 401);
    assert.equal(
      (await request(a.actor, `/${ready.id}/image`)).headers["cache-control"],
      "private, no-store",
    );
    assert.equal(
      (
        await request(a.actor, `/${ready.id}/keep`, "POST", {
          likenessConfirmed: false,
        })
      ).statusCode,
      400,
    );
    const kept = (
      await request(a.actor, `/${ready.id}/keep`, "POST", {
        likenessConfirmed: true,
      })
    ).json();
    assert.equal(kept.status, "kept");
    assert.equal(
      (
        await request(a.actor, `/${ready.id}/keep`, "POST", {
          likenessConfirmed: true,
        })
      ).json().photo.id,
      kept.photo.id,
    );
    assert.equal((await app.inject({ url: kept.photo.url })).statusCode, 404);
    assert.equal(
      (await request(a.actor, `/${ready.id}/image`)).statusCode,
      404,
    );
    assert.equal(
      (
        await db.tenant(b.actor, (tx) =>
          tx.query("SELECT id FROM trainer_photo_jobs"),
        )
      ).length,
      0,
    );
  });
});
test("timeouts retain the spending reservation and fence a fresh request for the same intent", async () => {
  const { actor, photoId } = await trainer(),
    body = input(photoId);
  await fixture(
    async (calls) => {
      const failed = (await request(actor, "", "POST", body)).json();
      assert.equal(failed.status, "unknown");
      assert.equal(
        (await request(actor, "", "POST", body)).json().status,
        "unknown",
      );
      assert.equal(
        (await request(actor, "", "POST", { ...body, requestId: randomUUID() }))
          .statusCode,
        409,
      );
      assert.equal(
        (await request(actor, `/${failed.id}`, "DELETE")).statusCode,
        409,
      );
      assert.equal(calls.length, 1);
      const [cost] = await db.tenant(actor, (tx) =>
        tx.query(
          "SELECT status,cost_usd,estimated_cost_usd FROM cost_events WHERE task='trainer_photo'",
        ),
      );
      assert.equal(cost.status, "unknown");
      assert.equal(cost.cost_usd, null);
      assert.equal(Number(cost.estimated_cost_usd), 0.018);
    },
    () => {
      throw Error("Synthetic lost response");
    },
  );
});
test("confirmed provider refusal is not retried and records no successful image charge", async () => {
  const { actor, photoId } = await trainer();
  await fixture(
    async (calls) => {
      const result = await request(actor, "", "POST", input(photoId));
      assert.equal(result.json().status, "failed");
      assert.equal(calls.length, 1);
      const [cost] = await db.tenant(actor, (tx) =>
        tx.query(
          "SELECT status,cost_usd FROM cost_events WHERE task='trainer_photo'",
        ),
      );
      assert.equal(cost.status, "recorded");
      assert.equal(Number(cost.cost_usd), 0);
    },
    () =>
      Response.json(
        {
          error: {
            message: "Untrusted provider text must not reach a trainer",
          },
        },
        { status: 403 },
      ),
  );
});
test("daily budget and request allowance include reservations before another provider call", async () => {
  const { actor, photoId } = await trainer();
  await fixture(
    async (calls) => {
      assert.equal(
        (await request(actor, "", "POST", input(photoId))).json().status,
        "ready",
      );
      assert.equal(
        (
          await request(
            actor,
            "",
            "POST",
            input(photoId, { detail: "Another setting" }),
          )
        ).statusCode,
        429,
      );
      assert.equal(calls.length, 1);
    },
    undefined,
    { MODEL_IMAGE_DAILY_USD_LIMIT: "0.02" },
  );
});
test("privacy erasure while a provider is running cannot restore a deleted draft or reference", async () => {
  const { actor, photoId } = await trainer();
  await fixture(
    async () => {
      const result = await request(actor, "", "POST", input(photoId));
      assert.equal(result.statusCode, 409);
      assert.equal(result.json().code, "PHOTO_ACCESS_CHANGED");
      const [job] = await db.tenant(actor, (tx) =>
        tx.query("SELECT status,media,input FROM trainer_photo_jobs"),
      );
      assert.equal(job.status, "deleted");
      assert.equal(job.media, null);
      assert.deepEqual(job.input, {});
      const [cost] = await db.tenant(actor, (tx) =>
        tx.query("SELECT status FROM cost_events WHERE task='trainer_photo'"),
      );
      assert.equal(cost.status, "estimated");
    },
    async () => {
      await db.tenant(actor, (tx) => eraseOwnedBrandMedia(tx, actor.userId), {
        privacyErasure: true,
      });
      return Response.json({
        data: [{ b64_json: picture.toString("base64") }],
      });
    },
  );
});
test("deleted drafts remain idempotent tombstones; roles and inactive model connection cannot generate", async () => {
  const { actor, photoId } = await trainer(),
    body = input(photoId);
  await fixture(async (calls) => {
    const job = (await request(actor, "", "POST", body)).json();
    assert.equal(
      (await request(actor, `/${job.id}`, "DELETE")).statusCode,
      200,
    );
    assert.equal(
      (await request(actor, "", "POST", body)).json().status,
      "deleted",
    );
    assert.equal(calls.length, 1);
    actors.set(actor.userId, { ...actor, role: "staff" });
    assert.equal((await request(actor)).statusCode, 403);
    actors.set(actor.userId, actor);
    await withRuntimeConfig({ MODEL_IMAGE_ENABLED: "false" }, async () => {
      assert.equal((await request(actor)).json().available, false);
      assert.equal(
        (await request(actor, "", "POST", input(photoId))).statusCode,
        503,
      );
    });
  });
});
test("connection and prompt reject arbitrary providers and preserve bounded scene preferences", () => {
  assert.equal(
    photoConnection({
      ...config,
      MODEL_BASE_URL: "https://unrelated.example/api/v3",
    }),
    null,
  );
  assert.equal(
    photoConnection({ ...config, MODEL_IMAGE_DAILY_CALLS: "100" }),
    null,
  );
  assert.equal(
    photoConnection({ ...config, MODEL_IMAGE_NAME: "unknown-model" }),
    null,
  );
  assert.equal(photoEstimate(photoConnection(config)!, 3), 0.018);
  assert.match(photoPrompt("website", "A calm room"), /A calm room/);
  assert.match(photoPrompt("website", "A calm room"), /No extra people/);
});

test("photo cost finalization is service-only and workspace-bound; receipts cannot be changed or deleted", async () => {
  const { actor, photoId } = await trainer();
  await fixture(async () => {
    const job = (await request(actor, "", "POST", input(photoId))).json();
    await assert.rejects(
      () =>
        db.tenant(actor, (tx) =>
          tx.query("SELECT finish_trainer_photo_cost($1,'generated',NULL)", [
            job.id,
          ]),
        ),
      (error: any) => error.code === "42501",
    );
    await assert.rejects(
      () =>
        db.system((tx) =>
          tx.query("SELECT finish_trainer_photo_cost($1,'unknown',NULL)", [
            job.id,
          ]),
        ),
      (error: any) => error.code === "42501",
    );
    await assert.rejects(
      () =>
        db.tenant(actor, (tx) =>
          tx.query(
            "UPDATE trainer_photo_jobs SET input_hash='changed' WHERE id=$1",
            [job.id],
          ),
        ),
      /Photo request identity cannot be changed/,
    );
    await assert.rejects(
      () =>
        db.tenant(actor, (tx) =>
          tx.query("DELETE FROM trainer_photo_jobs WHERE id=$1", [job.id]),
        ),
      (error: any) => error.code === "42501",
    );
    const exported = await db.tenant(actor, (tx) =>
      tx.query("SELECT * FROM export_personal_photo_drafts($1)", [
        actor.userId,
      ]),
    );
    assert.equal(exported[0].id, job.id);
    assert.equal(exported[0].media, undefined);
    await assert.rejects(
      () =>
        db.tenant(actor, (tx) =>
          tx.query("SELECT * FROM export_personal_photo_drafts($1)", [
            randomUUID(),
          ]),
        ),
      (error: any) => error.code === "42501",
    );
  });
});
