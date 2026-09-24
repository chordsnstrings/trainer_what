import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Actor, type Database, event, putRecord } from "@trainer/db";

const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const id = z.string().uuid();
export function operationsRoutes(
  app: FastifyInstance,
  db: Database,
  identity: (r: FastifyRequest) => Actor,
) {
  const trainer = (r: FastifyRequest) => {
    const a = identity(r);
    if (!["owner", "staff"].includes(a.role))
      throw fail(403, "TRAINER_REQUIRED", "Trainer access is required");
    return a;
  };
  app.get("/api/v1/bookings", async (req) => {
    const a = identity(req);
    return db.tenant({ ...a, role: "staff" }, async (tx) => {
      const slots = await tx.query(
        "SELECT s.*,count(b.id) FILTER(WHERE b.status='confirmed')::int AS booked FROM booking_slots s LEFT JOIN bookings b ON b.slot_id=s.id AND b.tenant_id=s.tenant_id WHERE s.ends_at>now()-interval '30 days' GROUP BY s.id ORDER BY s.starts_at",
      );
      const bookings = await tx.query(
        "SELECT b.*,u.name FROM bookings b JOIN users u ON u.id=b.user_id WHERE ($1<>'subscriber' OR b.user_id=$2)",
        [a.role, a.userId],
      );
      return { slots, bookings, timezone: "Asia/Dubai", cancellationHours: 24 };
    });
  });
  app.post("/api/v1/bookings/slots", async (req) => {
    const a = trainer(req);
    const b = z
      .object({
        title: z.string().min(3).max(100),
        location: z.string().min(3).max(300),
        startsAt: z.iso.datetime(),
        endsAt: z.iso.datetime(),
        capacity: z.number().int().min(1).max(50),
      })
      .strict()
      .parse(req.body);
    const start = new Date(b.startsAt),
      end = new Date(b.endsAt);
    if (
      start.getTime() <= Date.now() ||
      end <= start ||
      end.getTime() - start.getTime() > 4 * 3600000
    )
      throw fail(
        400,
        "SLOT_TIME",
        "Choose a future session lasting at most four hours",
      );
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":booking:" + a.userId,
      ]);
      const overlapping = await tx.query(
        "SELECT id FROM booking_slots WHERE trainer_id=$1 AND status='open' AND starts_at<$3 AND ends_at>$2",
        [a.userId, b.startsAt, b.endsAt],
      );
      if (overlapping.length)
        throw fail(409, "SLOT_OVERLAP", "This time overlaps another session");
      const [slot] = await tx.query(
        "INSERT INTO booking_slots(id,tenant_id,trainer_id,starts_at,ends_at,capacity,title,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        [
          randomUUID(),
          a.tenantId,
          a.userId,
          b.startsAt,
          b.endsAt,
          b.capacity,
          b.title,
          b.location,
        ],
      );
      await event(tx, a, "booking.slot_created", slot.id);
      return slot;
    });
  });
  app.post("/api/v1/bookings/slots/:id/reserve", async (req) => {
    const a = identity(req);
    if (a.role !== "subscriber")
      throw fail(
        403,
        "SUBSCRIBER_REQUIRED",
        "Sign in as a subscriber to reserve a session",
      );
    return db.tenant({ ...a, role: "staff" }, async (tx) => {
      const [sub] = await tx.query(
        "SELECT id FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing') AND (period_end IS NULL OR period_end>now())",
        [a.userId],
      );
      if (!sub)
        throw fail(
          402,
          "MEMBERSHIP_REQUIRED",
          "An active membership is required",
        );
      const [slot] = await tx.query(
        "SELECT * FROM booking_slots WHERE id=$1 AND status='open' AND starts_at>now() FOR UPDATE",
        [id.parse((req.params as any).id)],
      );
      if (!slot)
        throw fail(404, "SLOT_UNAVAILABLE", "This session is unavailable");
      const [prior] = await tx.query(
        "SELECT * FROM bookings WHERE slot_id=$1 AND user_id=$2",
        [slot.id, a.userId],
      );
      if (prior?.status === "confirmed") return prior;
      const [count] = await tx.query(
        "SELECT count(*)::int AS n FROM bookings WHERE slot_id=$1 AND status='confirmed'",
        [slot.id],
      );
      if (count.n >= slot.capacity)
        throw fail(409, "SLOT_FULL", "This session is full");
      const [booking] = await tx.query(
        "INSERT INTO bookings(id,tenant_id,slot_id,user_id) VALUES($1,$2,$3,$4) ON CONFLICT(slot_id,user_id) DO UPDATE SET status='confirmed' RETURNING *",
        [randomUUID(), a.tenantId, slot.id, a.userId],
      );
      await event(tx, a, "booking.reserved", booking.id);
      return booking;
    });
  });
  app.post("/api/v1/bookings/:id/cancel", async (req) => {
    const a = identity(req);
    return db.tenant(a, async (tx) => {
      const [b] = await tx.query(
        "SELECT b.*,s.starts_at FROM bookings b JOIN booking_slots s ON s.id=b.slot_id WHERE b.id=$1 FOR UPDATE OF b",
        [id.parse((req.params as any).id)],
      );
      if (!b) throw fail(404, "NOT_FOUND", "Booking unavailable");
      if (b.status === "canceled") return b;
      if (
        a.role === "subscriber" &&
        new Date(b.starts_at).getTime() - Date.now() < 24 * 3600000
      )
        throw fail(
          409,
          "CANCELLATION_WINDOW",
          "Contact your trainer to cancel within 24 hours",
        );
      await tx.query("UPDATE bookings SET status='canceled' WHERE id=$1", [
        b.id,
      ]);
      await event(tx, a, "booking.canceled", b.id);
      return { ok: true };
    });
  });
  app.post("/api/v1/bookings/:id/outcome", async (req) => {
    const a = trainer(req);
    const b = z
      .object({ status: z.enum(["attended", "no_show"]) })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "UPDATE bookings SET status=$2 WHERE id=$1 AND status='confirmed' AND slot_id IN (SELECT id FROM booking_slots WHERE ends_at<now()) RETURNING id",
        [id.parse((req.params as any).id), b.status],
      );
      if (!r)
        throw fail(
          409,
          "SESSION_NOT_FINISHED",
          "Only a completed session can receive an attendance result",
        );
      await event(tx, a, "booking.outcome", r.id, b);
      return r;
    });
  });
  app.post("/api/v1/support", async (req) => {
    const a = identity(req);
    const b = z
      .object({
        subject: z.string().min(3).max(150),
        message: z.string().min(5).max(4000),
        category: z.enum([
          "account",
          "billing",
          "coaching",
          "technical",
          "privacy",
        ]),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const r = await putRecord(
        tx,
        a,
        "support",
        {
          subject: b.subject,
          category: b.category,
          messages: [
            {
              text: b.message,
              authorId: a.userId,
              at: new Date().toISOString(),
            },
          ],
        },
        { status: "open" },
      );
      await event(tx, a, "support.opened", r.id, { category: b.category });
      return r;
    });
  });
  app.post("/api/v1/support/:id/reply", async (req) => {
    const a = identity(req);
    const b = z
      .object({
        message: z.string().min(1).max(4000),
        resolve: z.boolean().default(false),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT * FROM records WHERE id=$1 AND kind='support' FOR UPDATE",
        [id.parse((req.params as any).id)],
      );
      if (!r) throw fail(404, "NOT_FOUND", "Conversation unavailable");
      if (r.data.messages.length >= 100)
        throw fail(409, "THREAD_LIMIT", "Start a new support conversation");
      r.data.messages.push({
        text: b.message,
        authorId: a.userId,
        at: new Date().toISOString(),
      });
      await tx.query(
        "UPDATE records SET data=$2,status=$3,updated_at=now() WHERE id=$1",
        [r.id, JSON.stringify(r.data), b.resolve ? "resolved" : "open"],
      );
      await event(tx, a, "support.replied", r.id, { resolved: b.resolve });
      return { ok: true };
    });
  });
  app.delete("/api/v1/wearables/:id", async (req) => {
    const a = identity(req);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "DELETE FROM records WHERE id=$1 AND kind='wearable' AND owner_user_id=$2 RETURNING id",
        [id.parse((req.params as any).id), a.userId],
      );
      if (!r) throw fail(404, "NOT_FOUND", "Import unavailable");
      await event(tx, a, "wearable.deleted", r.id);
      return { ok: true };
    });
  });
  app.post("/api/v1/onboarding/progress", async (req) => {
    const a = trainer(req);
    const b = z
      .object({
        step: z.enum([
          "identity",
          "brand",
          "interview",
          "sources",
          "rules",
          "scenarios",
          "preview",
          "offer",
          "bank",
          "legal",
          "integrations",
          "domains",
          "voice",
          "team",
          "launch",
        ]),
        note: z.string().max(2000),
      })
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT * FROM records WHERE kind='onboarding' FOR UPDATE",
      );
      if (!r) throw fail(404, "NOT_FOUND", "Onboarding record unavailable");
      const checkpoints = {
        ...r.data.checkpoints,
        [b.step]: { note: b.note, at: new Date().toISOString() },
      };
      await tx.query(
        "UPDATE records SET data=data||$2::jsonb,updated_at=now() WHERE id=$1",
        [r.id, JSON.stringify({ checkpoints })],
      );
      return { ok: true };
    });
  });
}
