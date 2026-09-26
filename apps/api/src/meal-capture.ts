import { legalAcceptanceVersion } from "./legal.ts";
import { nutritionCatalog } from "./nutrition.ts";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  event,
  putRecord,
  type Actor,
  type Database,
  type Tx,
} from "@trainer/db";
import { ProviderUnavailable } from "@trainer/providers";
import { runtimeConfig } from "../../../packages/providers/src/configuration.ts";
import {
  capturedFoodSchema,
  captureTotals,
  estimateMealPhoto,
  lookupBarcode,
  normalizeGtin,
} from "../../../packages/providers/src/food.ts";
import { localDate } from "../../../packages/domain/src/nutrition.ts";
import { nutritionEntitlement } from "./nutrition.ts";
import { modelAccounting } from "./model-accounting.ts";

const id = z.string().uuid();
const MAX_IMAGE = 2 * 1024 * 1024;
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const internal = (a: Actor) => ({ ...a, role: "owner" });
async function lock(tx: Tx, a: Actor) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    a.tenantId + ":nutrition:" + a.userId,
  ]);
}
async function consent(tx: Tx, userId: string, type: string) {
  const [r] = await tx.query(
    "SELECT id,granted FROM consent_records WHERE user_id=$1 AND document_type=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
    [userId, type],
  );
  return r ?? { id: null, granted: false };
}
async function permission(tx: Tx, a: Actor, photo = false) {
  const [membership] = await tx.query(
    "SELECT role FROM memberships WHERE tenant_id=$1 AND user_id=$2 AND role='subscriber'",
    [a.tenantId, a.userId],
  );
  if (!membership)
    throw fail(
      403,
      "MEMBERSHIP_REMOVED",
      "This nutrition membership is no longer available",
    );
  if (!(await nutritionEntitlement(tx, a.userId)))
    throw fail(
      402,
      "NUTRITION_MEMBERSHIP",
      "Workout + nutrition membership is required to record a new meal.",
    );
  const processing = await consent(tx, a.userId, "nutrition"),
    model = await consent(tx, a.userId, "nutrition_model"),
    image = await consent(tx, a.userId, "nutrition_photo");
  if (!processing.granted || (photo && (!model.granted || !image.granted)))
    throw fail(
      403,
      "NUTRITION_PERMISSION",
      photo
        ? "Nutrition, AI and separate photo-analysis permission are required. You can still use manual entry with nutrition permission."
        : "Nutrition permission is required for this action.",
    );
  const [profile] = await tx.query(
    "SELECT * FROM records WHERE owner_user_id=$1 AND kind='nutrition_profile' ORDER BY created_at DESC,id DESC LIMIT 1",
    [a.userId],
  );
  if (!profile)
    throw fail(
      409,
      "PROFILE_REQUIRED",
      "Complete your food preferences before recording a meal.",
    );
  return { processing, model, image, profile };
}
const consentKey = (p: Awaited<ReturnType<typeof permission>>) =>
  [p.processing.id, p.model.id, p.image.id, p.profile.id].join(":");
function visible(row: Record<string, any>) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    data: row.data,
    logId: row.log_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

// Decode before any external call, reject disguised/animated images, then re-encode without EXIF/GPS.
export async function sanitizeMealPhoto(
  base64: string,
  mime: string,
): Promise<Buffer> {
  if (
    !/^(image\/jpeg|image\/png|image\/webp)$/.test(mime) ||
    base64.length > Math.ceil(MAX_IMAGE / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)
  )
    throw fail(
      400,
      "MEAL_IMAGE",
      "Choose a JPEG, PNG or WebP meal photo under 2 MB.",
    );
  const raw = Buffer.from(base64, "base64");
  if (
    !raw.length ||
    raw.length > MAX_IMAGE ||
    raw.toString("base64") !== base64
  )
    throw fail(400, "MEAL_IMAGE", "The image data is invalid or too large.");
  const signature = raw.subarray(0, 12);
  const kind =
    signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff
      ? "image/jpeg"
      : signature
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : signature.toString("ascii", 0, 4) === "RIFF" &&
            signature.toString("ascii", 8, 12) === "WEBP"
          ? "image/webp"
          : null;
  if (kind !== mime)
    throw fail(
      400,
      "MEAL_IMAGE",
      "The file contents do not match the selected image type.",
    );
  try {
    const image = sharp(raw, {
      limitInputPixels: 16000000,
      failOn: "warning",
      animated: false,
    });
    const info = await image.metadata();
    if (
      !info.width ||
      !info.height ||
      info.width < 16 ||
      info.height < 16 ||
      (info.pages ?? 1) > 1
    )
      throw new Error("Unsupported dimensions or animation");
    const result = await image
      .rotate()
      .resize({
        width: 1536,
        height: 1536,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 82 })
      .toBuffer();
    if (result.length > MAX_IMAGE) throw new Error("Oversized image");
    return result;
  } catch {
    throw fail(
      400,
      "MEAL_IMAGE",
      "This photo could not be decoded safely. Use a still JPEG, PNG or WebP image under 16 megapixels.",
    );
  }
}

export async function exportMealCaptures(tx: Tx, userId: string) {
  return tx.query(
    "SELECT id,kind,status,CASE WHEN expires_at>now() THEN data ELSE '{\"expired\":true}'::jsonb END AS data,created_at,expires_at,media_type,CASE WHEN expires_at>now() THEN encode(media,'base64') ELSE NULL END AS photo_base64 FROM meal_captures WHERE user_id=$1",
    [userId],
  );
}
// Keep only the intent key/fingerprint after removal, so cancellation or expiry cannot replay paid analysis.
export async function eraseMealCaptures(tx: Tx, userId: string) {
  await tx.query(
    "UPDATE meal_captures SET media=NULL,media_type=NULL,data='{\"removed\":true}'::jsonb,status=CASE WHEN status='confirmed' THEN status ELSE 'failed' END,expires_at=now(),updated_at=now() WHERE user_id=$1",
    [userId],
  );
}
async function expire(tx: Tx, userId?: string) {
  await tx.query(
    "UPDATE meal_captures SET media=NULL,media_type=NULL,data='{\"expired\":true}'::jsonb,status=CASE WHEN status='confirmed' THEN status ELSE 'failed' END,updated_at=now() WHERE expires_at<=now() AND ($1::uuid IS NULL OR user_id=$1) AND (media IS NOT NULL OR data<>'{\"expired\":true}'::jsonb)",
    [userId ?? null],
  );
}
export async function purgeExpiredMealCaptures(db: Database) {
  const owners = await db.system((tx) =>
    tx.query("SELECT tenant_id,user_id FROM memberships WHERE role='owner'"),
  );
  for (const owner of owners)
    await db.tenant(
      { tenantId: owner.tenant_id, userId: owner.user_id, role: "owner" },
      (tx) => expire(tx),
    );
}

export function mealCaptureRoutes(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Actor,
) {
  const prefix = "/api/v1/nutrition/captures";
  function client(req: FastifyRequest) {
    const a = identity(req);
    if (a.role !== "subscriber")
      throw fail(
        403,
        "SUBSCRIBER_REQUIRED",
        "Meal capture is available in the subscriber's own account.",
      );
    return a;
  }
  async function current(tx: Tx, a: Actor, captureId: string) {
    const [r] = await tx.query(
      "SELECT * FROM meal_captures WHERE id=$1 AND user_id=$2 AND expires_at>now()",
      [id.parse(captureId), a.userId],
    );
    if (!r)
      throw fail(
        404,
        "CAPTURE_UNAVAILABLE",
        "This meal draft is unavailable, expired or was removed.",
      );
    return r;
  }
  async function start(
    a: Actor,
    kind: "photo" | "barcode",
    requestKey: string,
    fingerprint: string,
    data: Record<string, unknown>,
    jpeg?: Buffer,
  ) {
    const photoVersion =
      kind === "photo"
        ? await legalAcceptanceVersion(db, "nutrition_photo")
        : null;
    return db.tenant(internal(a), async (tx) => {
      await lock(tx, a);
      await expire(tx, a.userId);
      const [prior] = await tx.query(
        "SELECT * FROM meal_captures WHERE user_id=$1 AND request_key=$2",
        [a.userId, requestKey],
      );
      if (prior) {
        await permission(tx, a, kind === "photo");
        if (prior.fingerprint !== fingerprint || prior.kind !== kind)
          throw fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This capture request already belongs to a different meal.",
          );
        if (new Date(prior.expires_at).getTime() <= Date.now())
          throw fail(
            410,
            "CAPTURE_EXPIRED",
            "This capture was removed or expired. Its analysis will not be repeated. Start a new capture or enter the meal manually.",
          );
        return { prior };
      }
      await permission(tx, a);
      if (kind === "photo") {
        const model = await consent(tx, a.userId, "nutrition_model");
        if (!model.granted)
          throw fail(
            403,
            "NUTRITION_PERMISSION",
            "Enable nutrition AI permission in Food preferences before analysing a photo.",
          );
        await tx.query(
          "INSERT INTO consent_records(id,tenant_id,user_id,document_type,document_version,granted) VALUES($1,$2,$3,'nutrition_photo',$4,true)",
          [randomUUID(), a.tenantId, a.userId, photoVersion],
        );
      }
      const p = await permission(tx, a, kind === "photo");
      const [count] = await tx.query(
        "SELECT count(*)::int AS n FROM meal_captures WHERE user_id=$1 AND created_at>now()-interval '24 hours'",
        [a.userId],
      );
      if (count.n >= 50)
        throw fail(
          429,
          "CAPTURE_LIMIT",
          "Your daily photo and barcode capture limit has been reached. Manual meal entry is available.",
        );
      const [row] = await tx.query(
        "INSERT INTO meal_captures(id,tenant_id,user_id,request_key,fingerprint,kind,status,media,media_type,data) VALUES($1,$2,$3,$4,$5,$6,'running',$7,$8,$9) RETURNING *",
        [
          randomUUID(),
          a.tenantId,
          a.userId,
          requestKey,
          fingerprint,
          kind,
          jpeg ?? null,
          jpeg ? "image/jpeg" : null,
          JSON.stringify({ ...data, consentKey: consentKey(p) }),
        ],
      );
      await event(tx, a, "nutrition.capture_started", row.id, { kind });
      return { row, p };
    });
  }
  async function finish(
    a: Actor,
    row: Record<string, any>,
    p: Awaited<ReturnType<typeof permission>>,
    data: Record<string, unknown>,
  ) {
    return db.tenant(internal(a), async (tx) => {
      await lock(tx, a);
      const now = await permission(tx, a, row.kind === "photo"),
        active = await current(tx, a, row.id);
      if (consentKey(now) !== consentKey(p) || active.status !== "running")
        throw fail(
          409,
          "CAPTURE_CHANGED",
          "Your profile, permission or meal draft changed while preparing the estimate. Nothing was added to your diary.",
        );
      const [result] = await tx.query(
        "UPDATE meal_captures SET status='draft',media=NULL,media_type=NULL,data=data||$2::jsonb,updated_at=now() WHERE id=$1 RETURNING *",
        [row.id, JSON.stringify(data)],
      );
      await event(tx, a, "nutrition.capture_prepared", row.id, {
        kind: row.kind,
      });
      return visible(result);
    });
  }
  async function failed(a: Actor, captureId: string, error: unknown) {
    const message =
      error instanceof ProviderUnavailable
        ? error.message
        : "This capture could not be completed. No diary entry was saved. The same request will not repeat a paid analysis; use manual entry or start a new photo.";
    await db.tenant(internal(a), async (tx) => {
      await lock(tx, a);
      await tx.query(
        "UPDATE meal_captures SET status='failed',media=NULL,media_type=NULL,data=data||$3::jsonb,updated_at=now() WHERE id=$1 AND user_id=$2 AND status='running'",
        [captureId, a.userId, JSON.stringify({ message })],
      );
      await event(tx, a, "nutrition.capture_failed", captureId);
    });
  }
  app.get(prefix, async (req) => {
    const a = client(req),
      c = runtimeConfig();
    return db.tenant(internal(a), async (tx) => {
      await expire(tx, a.userId);
      const processing = await consent(tx, a.userId, "nutrition"),
        model = await consent(tx, a.userId, "nutrition_model"),
        image = await consent(tx, a.userId, "nutrition_photo");
      const entitled = await nutritionEntitlement(tx, a.userId);
      const rows = await tx.query(
        "SELECT id,kind,status,data,log_id,created_at,expires_at FROM meal_captures WHERE user_id=$1 AND status<>'confirmed' AND expires_at>now() ORDER BY created_at DESC LIMIT 20",
        [a.userId],
      );
      return {
        photosEnabled:
          c.MEAL_PHOTOS_ENABLED === "true" &&
          c.MODEL_VISION_ENABLED === "true" &&
          !!c.MODEL_API_KEY &&
          !!c.MODEL_BASE_URL &&
          !!c.MODEL_NAME,
        barcodeEnabled: c.FOOD_LOOKUP_ENABLED === "true",
        entitled,
        processingConsent: !!processing.granted,
        modelConsent: !!model.granted,
        photoConsent: !!image.granted,
        retentionHours: 24,
        drafts: rows.map(visible),
      };
    });
  });
  app.post(
    prefix + "/photo",
    {
      bodyLimit: 3 * 1024 * 1024,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req) => {
      const a = client(req),
        b = z
          .object({
            requestKey: id,
            base64: z.string().max(Math.ceil(MAX_IMAGE / 3) * 4),
            mime: z.enum(["image/jpeg", "image/png", "image/webp"]),
            context: z.string().max(1000).default(""),
            photoConsent: z.literal(true),
          })
          .strict()
          .parse(req.body);
      const c = runtimeConfig();
      if (c.MEAL_PHOTOS_ENABLED !== "true" || c.MODEL_VISION_ENABLED !== "true")
        throw new ProviderUnavailable(
          "model",
          "Meal-photo analysis is not enabled. Manual entry is available.",
        );
      const jpeg = await sanitizeMealPhoto(b.base64, b.mime);
      const s = await start(
        a,
        "photo",
        b.requestKey,
        hash(b),
        {
          notes: b.context,
          promptVersion: "meal-photo-v1",
          model: c.MODEL_NAME ?? null,
        },
        jpeg,
      );
      if (s.prior) return visible(s.prior);
      try {
        const draft = await estimateMealPhoto(
          jpeg,
          b.context,
          modelAccounting(db, a, "meal_photo_estimate"),
        );
        return await finish(a, s.row!, s.p!, {
          estimate: draft,
          source: "photo_model_estimate",
          estimated: true,
        });
      } catch (error) {
        await failed(a, s.row!.id, error);
        throw error;
      }
    },
  );
  app.post(
    prefix + "/barcode",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      const a = client(req),
        b = z
          .object({ requestKey: id, code: z.string().max(40) })
          .strict()
          .parse(req.body);
      let code: string;
      try {
        code = normalizeGtin(b.code);
      } catch (error) {
        throw fail(400, "BARCODE_INVALID", (error as Error).message);
      }
      if (runtimeConfig().FOOD_LOOKUP_ENABLED !== "true")
        throw new ProviderUnavailable(
          "food",
          "Barcode lookup is not enabled. Enter the product label manually.",
        );
      const s = await start(a, "barcode", b.requestKey, hash({ code }), {
        code,
      });
      if (s.prior) return visible(s.prior);
      try {
        const product = await lookupBarcode(code);
        if (!product)
          throw fail(
            404,
            "BARCODE_NOT_FOUND",
            "No product matched this barcode. You can enter its name, portion and label values manually.",
          );
        return await finish(a, s.row!, s.p!, {
          product,
          source: "barcode_label",
          estimated: true,
        });
      } catch (error) {
        await failed(a, s.row!.id, error);
        throw error;
      }
    },
  );
  app.get(prefix + "/food-options", async (req) => {
    const a = client(req);
    return db.tenant(internal(a), async (tx) => {
      await permission(tx, a);
      return (await nutritionCatalog(tx)).foods;
    });
  });
  app.post(prefix + "/:id/ground", async (req) => {
    const a = client(req),
      captureId = id.parse((req.params as any).id),
      b = z
        .object({
          index: z.number().int().min(0).max(11),
          foodId: id,
          grams: z.number().positive().max(10000),
        })
        .strict()
        .parse(req.body);
    return db.tenant(internal(a), async (tx) => {
      await lock(tx, a);
      await permission(tx, a, true);
      const row = await current(tx, a, captureId);
      if (
        row.kind !== "photo" ||
        row.status !== "draft" ||
        !row.data.estimate?.items[b.index]
      )
        throw fail(
          409,
          "CAPTURE_NOT_READY",
          "Choose a food in an active photo draft",
        );
      const food = (await nutritionCatalog(tx)).foods.find(
        (f) => f.id === b.foodId,
      );
      if (!food)
        throw fail(
          404,
          "FOOD_VERSION",
          "The selected ingredient facts are no longer current",
        );
      const item = {
        ...row.data.estimate.items[b.index],
        name: food.name,
        preparation: food.preparation,
        amount: b.grams,
        unit: "g",
        portion: `${b.grams} g`,
        ...Object.fromEntries(
          Object.entries(food.nutrientsPer100g).map(([k, v]) => [
            k,
            v === null ? null : Math.round(v * b.grams) / 100,
          ]),
        ),
        uncertainty:
          "Matched by the client to coach ingredient facts; verify preparation and portion.",
      };
      const estimate = {
          ...row.data.estimate,
          items: row.data.estimate.items.map((x: any, i: number) =>
            i === b.index ? item : x,
          ),
        },
        groundedFacts = {
          ...row.data.groundedFacts,
          [b.index]: {
            food,
            grams: b.grams,
            confirmedBy: a.userId,
            at: new Date().toISOString(),
          },
        };
      const [updated] = await tx.query(
        "UPDATE meal_captures SET data=data||$2::jsonb,updated_at=now() WHERE id=$1 RETURNING *",
        [
          row.id,
          JSON.stringify({
            estimate,
            groundedFacts,
            originalEstimate: row.data.originalEstimate ?? row.data.estimate,
          }),
        ],
      );
      await event(tx, a, "nutrition.photo_grounded", row.id, {
        foodId: food.id,
        index: b.index,
      });
      return visible(updated);
    });
  });
  app.get(prefix + "/:id", async (req) => {
    const a = client(req);
    return db.tenant(internal(a), async (tx) =>
      visible(await current(tx, a, (req.params as any).id)),
    );
  });
  app.delete(prefix + "/:id", async (req) => {
    const a = client(req),
      captureId = id.parse((req.params as any).id);
    return db.tenant(internal(a), async (tx) => {
      await lock(tx, a);
      await tx.query(
        "UPDATE meal_captures SET media=NULL,media_type=NULL,data='{\"removed\":true}'::jsonb,status=CASE WHEN status='confirmed' THEN status ELSE 'failed' END,expires_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2",
        [captureId, a.userId],
      );
      await event(tx, a, "nutrition.capture_removed", captureId);
      return { ok: true };
    });
  });
  app.post(prefix + "/:id/confirm", async (req) => {
    const a = client(req),
      captureId = id.parse((req.params as any).id),
      b = z
        .object({
          eventKey: id,
          date: z.iso.date(),
          timezone: z.string().min(1).max(100),
          name: z.string().trim().min(1).max(160),
          notes: z.string().max(2000),
          items: z.array(capturedFoodSchema).min(1).max(12),
          confirmed: z.literal(true),
          labelUnit: z.enum(["g", "ml"]).optional(),
        })
        .strict()
        .parse(req.body);
    const totals = captureTotals(b.items);
    if (totals.kcal !== null && totals.kcal > 10000)
      throw fail(
        400,
        "MEAL_TOTAL",
        "The combined meal estimate must be no more than 10,000 kcal.",
      );
    return db.tenant(internal(a), async (tx) => {
      await lock(tx, a);
      const fingerprint = hash({ ...b, captureId });
      const [old] = await tx.query(
        "SELECT * FROM records WHERE kind='nutrition_log' AND owner_user_id=$1 AND data->>'eventKey'=$2",
        [a.userId, b.eventKey],
      );
      const p = await permission(tx, a);
      if (old) {
        if (old.data.fingerprint !== fingerprint)
          throw fail(
            409,
            "IDEMPOTENCY_CONFLICT",
            "This meal confirmation differs from the saved entry.",
          );
        return old;
      }
      const row = await current(tx, a, captureId);
      if (row.kind === "photo") await permission(tx, a, true);
      if (row.status !== "draft")
        throw fail(
          409,
          "CAPTURE_NOT_READY",
          "Only a prepared draft can be confirmed. This meal may already have been recorded.",
        );
      if (
        b.timezone !== p.profile.data.profile.timezone ||
        b.date > localDate(b.timezone)
      )
        throw fail(
          400,
          "LOG_DATE",
          "Use your food-profile timezone and a date that is not in the future.",
        );
      if (
        row.kind === "barcode" &&
        (!b.labelUnit ||
          b.items.length !== 1 ||
          b.items[0].unit !== b.labelUnit ||
          b.items[0].amount === null)
      )
        throw fail(
          400,
          "SERVING_REQUIRED",
          "Confirm the label's gram or millilitre basis and the amount you consumed.",
        );
      const { confirmed: _confirmed, labelUnit, items, ...entry } = b;
      const log = await putRecord(
        tx,
        a,
        "nutrition_log",
        {
          ...entry,
          kcal: totals.kcal,
          deleted: false,
          fingerprint,
          items,
          nutrients: totals,
          estimated: true,
          mealSnapshot: null,
          source:
            row.kind === "photo"
              ? "photo_estimate_with_user_confirmation"
              : "barcode_with_user_confirmation",
          provenance: {
            captureId,
            kind: row.kind,
            capturedAt: row.created_at,
            confirmedAt: new Date().toISOString(),
            groundedFacts: row.data.groundedFacts ?? null,
            originalEstimate: row.data.originalEstimate ?? null,
            original:
              row.kind === "photo"
                ? {
                    estimate: row.data.estimate,
                    model: row.data.model,
                    promptVersion: row.data.promptVersion,
                  }
                : row.data.product,
            ...(labelUnit ? { labelUnit } : {}),
          },
          allowedUses: p.model.granted
            ? ["render", "model_prompt"]
            : ["render"],
        },
        { ownerId: a.userId, status: "recorded" },
      );
      await tx.query(
        "UPDATE meal_captures SET status='confirmed',log_id=$2,media=NULL,media_type=NULL,updated_at=now() WHERE id=$1",
        [row.id, log.id],
      );
      await event(tx, a, "nutrition.meal_logged", log.id, { source: row.kind });
      return log;
    });
  });
}
