import { registerBookingRoutes } from "./booking-schedule.ts";
import { registerNotifications, notifyUser } from "./notifications.ts";
import {
  preparePaidBooking,
  startBookingCheckout,
  refundCanceledBooking,
} from "./finance-bookings.ts";
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
  registerNotifications(app, db, identity);
  registerBookingRoutes(app, db, identity, {
    preparePaidBooking,
    startBookingCheckout,
    refundCanceledBooking,
    notify: notifyUser,
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
