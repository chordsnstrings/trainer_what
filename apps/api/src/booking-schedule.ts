import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  type Actor,
  type Database,
  type Tx,
  event,
  putRecord,
} from "@trainer/db";
const fail = (statusCode: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode, code });
const id = z.string().uuid();
const timezone = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA time zone");
const policySchema = z.object({
  timezone: timezone.default("Asia/Dubai"),
  cancellationHours: z.number().int().min(0).max(168),
  noShowPolicy: z.enum(["forfeit", "coach_review"]),
});
export type BookingHooks = {
  preparePaidBooking?: (
    tx: Tx,
    a: Actor,
    slot: any,
    booking: any,
  ) => Promise<any>;
  startBookingCheckout?: (
    db: Database,
    a: Actor,
    bookingId: string,
  ) => Promise<any>;
  refundCanceledBooking?: (
    db: Database,
    a: Actor,
    bookingId: string,
  ) => Promise<any>;
  notify?: (
    tx: Tx,
    a: Actor,
    input: {
      userId: string;
      category: "booking";
      dedupeKey: string;
      title: string;
      body: string;
      href?: string;
    },
  ) => Promise<any>;
};
function localParts(date: Date, zone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
}
function localNumber(parts: Record<string, string>) {
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
}
/** Rejects nonexistent/ambiguous DST wall times instead of silently moving appointments. */
export function localTimeToInstant(local: string, zone: string): string {
  timezone.parse(zone);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw fail(400, "LOCAL_TIME", "Choose a complete local date and time.");
  const nominal = new Date(local + ":00Z");
  if (
    !Number.isFinite(nominal.getTime()) ||
    nominal.toISOString().slice(0, 16) !== local
  )
    throw fail(400, "LOCAL_TIME", "Invalid calendar date.");
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = new Date(nominal.getTime() + hours * 3600000);
    offsets.add(localNumber(localParts(sample, zone)) - sample.getTime());
  }
  const candidates = [...offsets]
    .map((offset) => new Date(nominal.getTime() - offset))
    .filter(
      (date) => localNumber(localParts(date, zone)) === nominal.getTime(),
    );
  if (candidates.length !== 1)
    throw fail(
      400,
      "DST_LOCAL_TIME",
      candidates.length
        ? "This local time occurs twice because clocks change. Choose an unambiguous time."
        : "This local time does not exist because clocks change. Choose another time.",
    );
  return candidates[0].toISOString();
}
function localAt(iso: string, zone: string) {
  const p = localParts(new Date(iso), zone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function weeklyLocal(local: string, weeks: number) {
  const d = new Date(local + ":00Z");
  d.setUTCDate(d.getUTCDate() + 7 * weeks);
  return d.toISOString().slice(0, 16);
}
function validTimes(startsAt: string, endsAt: string) {
  const start = new Date(startsAt).getTime(),
    end = new Date(endsAt).getTime();
  if (
    start <= Date.now() ||
    end <= start ||
    end - start > 4 * 3600000 ||
    start > Date.now() + 2 * 366 * 86400000
  )
    throw fail(
      400,
      "SLOT_TIME",
      "Choose a future session, within two years, lasting at most four hours.",
    );
}
async function policy(tx: Tx) {
  const [r] = await tx.query(
    "SELECT id,version,data FROM records WHERE kind='booking_policy' ORDER BY updated_at DESC LIMIT 1",
  );
  return {
    ...(r?.data ?? {
      timezone: "Asia/Dubai",
      cancellationHours: 24,
      noShowPolicy: "coach_review",
    }),
    revision: r?.version ?? 0,
  };
}
async function overlap(
  tx: Tx,
  trainerId: string,
  startsAt: string,
  endsAt: string,
  exclude?: string,
) {
  const r = await tx.query(
    "SELECT id FROM booking_slots WHERE trainer_id=$1 AND status='open' AND starts_at<$3 AND ends_at>$2 AND ($4::uuid IS NULL OR id<>$4)",
    [trainerId, startsAt, endsAt, exclude ?? null],
  );
  if (r.length)
    throw fail(409, "SLOT_OVERLAP", "This time overlaps another session.");
}
async function notification(
  hooks: BookingHooks,
  tx: Tx,
  a: Actor,
  booking: any,
  title: string,
  body: string,
  key: string,
) {
  if (hooks.notify)
    await hooks.notify(tx, a, {
      userId: booking.user_id,
      category: "booking",
      dedupeKey: `booking:${booking.id}:${key}`,
      title,
      body,
      href: "/app/bookings",
    });
}
const escapeIcs = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
const icsDate = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
function foldIcs(line: string) {
  const out: string[] = [];
  let current = "";
  for (const c of line) {
    if (Buffer.byteLength(current + c) > 73) {
      out.push(current);
      current = " ";
    }
    current += c;
  }
  out.push(current);
  return out.join("\r\n");
}
export function bookingCalendar(rows: any[]) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Trainer Brain//Booking Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const r of rows)
    lines.push(
      "BEGIN:VEVENT",
      `UID:${r.id}@trainer-bookings`,
      `DTSTAMP:${icsDate(new Date().toISOString())}`,
      `DTSTART:${icsDate(r.starts_at)}`,
      `DTEND:${icsDate(r.ends_at)}`,
      `SUMMARY:${escapeIcs(r.title)}`,
      `LOCATION:${escapeIcs(r.location)}`,
      `SEQUENCE:${Number(r.version ?? 1)}`,
      `STATUS:${r.status === "canceled" ? "CANCELLED" : "CONFIRMED"}`,
      "END:VEVENT",
    );
  lines.push("END:VCALENDAR");
  return lines.map(foldIcs).join("\r\n") + "\r\n";
}
export function registerBookingRoutes(
  app: FastifyInstance,
  db: Database,
  identity: (req: FastifyRequest) => Actor,
  hooks: BookingHooks = {},
) {
  const allowed = (req: FastifyRequest) => {
    const a = identity(req);
    if (!["owner", "staff", "subscriber"].includes(a.role))
      throw fail(
        403,
        "BOOKING_SCOPE",
        "Coaching or subscriber access is required.",
      );
    return a;
  };
  const trainer = (req: FastifyRequest) => {
    const a = allowed(req);
    if (a.role === "subscriber")
      throw fail(403, "TRAINER_REQUIRED", "Trainer access is required.");
    return a;
  };
  const manage = (a: Actor, slot: any) => {
    if (a.role !== "owner" && slot.trainer_id !== a.userId)
      throw fail(
        403,
        "SLOT_OWNER",
        "Only this session's coach or workspace owner can change it.",
      );
  };
  app.get("/api/v1/bookings", async (req) => {
    const a = allowed(req);
    return db.tenant({ ...a, role: "staff" }, async (tx) => {
      const slots = await tx.query(
        "SELECT s.*,count(b.id) FILTER(WHERE b.status='confirmed' OR (b.status='payment_pending' AND b.hold_expires_at>now()))::int AS booked FROM booking_slots s LEFT JOIN bookings b ON b.slot_id=s.id AND b.tenant_id=s.tenant_id WHERE s.ends_at>now()-interval '30 days' GROUP BY s.id ORDER BY s.starts_at LIMIT 500",
      );
      const bookings = await tx.query(
        "SELECT b.*,u.name FROM bookings b JOIN users u ON u.id=b.user_id WHERE ($1<>'subscriber' OR b.user_id=$2) ORDER BY b.created_at DESC LIMIT 1000",
        [a.role, a.userId],
      );
      const p = await policy(tx);
      return {
        slots,
        bookings,
        policy: p,
        timezone: p.timezone,
        cancellationHours: p.cancellationHours,
      };
    });
  });
  app.post("/api/v1/bookings/policy", async (req) => {
    const a = trainer(req);
    if (a.role !== "owner")
      throw fail(403, "OWNER_REQUIRED", "Workspace owner access is required.");
    const b = policySchema
      .extend({ revision: z.number().int().min(0) })
      .strict()
      .parse(req.body);
    return db.tenant(a, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":booking-policy",
      ]);
      const [r] = await tx.query(
        "SELECT * FROM records WHERE kind='booking_policy' FOR UPDATE",
      );
      if ((r?.version ?? 0) !== b.revision)
        throw fail(
          409,
          "REVISION_CONFLICT",
          "Booking policy changed. Reload first.",
        );
      const { revision, ...data } = b;
      if (r)
        await tx.query(
          "UPDATE records SET data=$2,version=version+1,updated_at=now() WHERE id=$1",
          [r.id, JSON.stringify(data)],
        );
      else await putRecord(tx, a, "booking_policy", data, { status: "active" });
      await event(tx, a, "booking.policy_updated", r?.id, { ...data });
      return policy(tx);
    });
  });
  app.post("/api/v1/bookings/slots", async (req) => {
    const a = trainer(req),
      b = z
        .object({
          title: z.string().trim().min(3).max(100),
          location: z.string().trim().min(3).max(300),
          startsAt: z.iso.datetime().optional(),
          endsAt: z.iso.datetime().optional(),
          localStart: z.string().optional(),
          durationMinutes: z.number().int().min(15).max(240).optional(),
          timezone: timezone.optional(),
          capacity: z.number().int().min(1).max(50),
          priceMinor: z.number().int().min(0).max(10000000).default(0),
          recurrence: z
            .object({
              count: z.number().int().min(1).max(26),
              intervalWeeks: z.number().int().min(1).max(4).default(1),
            })
            .optional(),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const p = await policy(tx),
        zone = b.timezone ?? p.timezone;
      const first = b.localStart
        ? localTimeToInstant(b.localStart, zone)
        : b.startsAt;
      if (!first || (!b.endsAt && !b.durationMinutes))
        throw fail(400, "SLOT_TIME", "Provide a start and duration or end.");
      const duration = b.durationMinutes
        ? b.durationMinutes * 60000
        : new Date(b.endsAt!).getTime() - new Date(first).getTime();
      const count = b.recurrence?.count ?? 1,
        seriesId = count > 1 ? randomUUID() : null;
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":booking:" + a.userId,
      ]);
      const slots = [];
      for (let i = 0; i < count; i++) {
        const startsAt = i
          ? localTimeToInstant(
              weeklyLocal(
                localAt(first, zone),
                i * (b.recurrence?.intervalWeeks ?? 1),
              ),
              zone,
            )
          : first;
        const endsAt = new Date(
          new Date(startsAt).getTime() + duration,
        ).toISOString();
        validTimes(startsAt, endsAt);
        await overlap(tx, a.userId, startsAt, endsAt);
        const [slot] = await tx.query(
          "INSERT INTO booking_slots(id,tenant_id,trainer_id,starts_at,ends_at,capacity,title,location,timezone,series_id,cancellation_hours,no_show_policy,price_minor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *",
          [
            randomUUID(),
            a.tenantId,
            a.userId,
            startsAt,
            endsAt,
            b.capacity,
            b.title,
            b.location,
            zone,
            seriesId,
            p.cancellationHours,
            p.noShowPolicy,
            b.priceMinor,
          ],
        );
        slots.push(slot);
        await event(tx, a, "booking.slot_created", slot.id, {
          seriesId,
          startsAt,
          priceMinor: b.priceMinor,
        });
      }
      return { ...slots[0], slots };
    });
  });
  app.post("/api/v1/bookings/slots/:id/update", async (req) => {
    const a = trainer(req),
      slotId = id.parse((req.params as any).id),
      b = z
        .object({
          revision: z.number().int().min(1),
          title: z.string().trim().min(3).max(100),
          location: z.string().trim().min(3).max(300),
          startsAt: z.iso.datetime(),
          endsAt: z.iso.datetime(),
          capacity: z.number().int().min(1).max(50),
          reason: z.string().trim().min(5).max(1000),
        })
        .strict()
        .parse(req.body);
    validTimes(b.startsAt, b.endsAt);
    return db.tenant(a, async (tx) => {
      const [initial] = await tx.query(
        "SELECT * FROM booking_slots WHERE id=$1",
        [slotId],
      );
      if (!initial) throw fail(404, "SLOT_UNAVAILABLE", "Session unavailable.");
      manage(a, initial);
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":booking:" + initial.trainer_id,
      ]);
      const [slot] = await tx.query(
        "SELECT * FROM booking_slots WHERE id=$1 FOR UPDATE",
        [slotId],
      );
      if (slot.version !== b.revision || slot.status !== "open")
        throw fail(409, "REVISION_CONFLICT", "Session changed. Reload first.");
      if (new Date(slot.starts_at).getTime() <= Date.now())
        throw fail(
          409,
          "SESSION_STARTED",
          "A session that has started cannot be rescheduled.",
        );
      const booked = await tx.query(
        "SELECT * FROM bookings WHERE slot_id=$1 AND (status='confirmed' OR (status='payment_pending' AND hold_expires_at>now()))",
        [slotId],
      );
      if (booked.length > b.capacity)
        throw fail(
          409,
          "CAPACITY_RESERVED",
          "Capacity cannot be lower than current reservations.",
        );
      await overlap(tx, slot.trainer_id, b.startsAt, b.endsAt, slotId);
      const [r] = await tx.query(
        "UPDATE booking_slots SET title=$2,location=$3,starts_at=$4,ends_at=$5,capacity=$6,version=version+1 WHERE id=$1 RETURNING *",
        [slotId, b.title, b.location, b.startsAt, b.endsAt, b.capacity],
      );
      await event(tx, a, "booking.slot_changed", slotId, {
        reason: b.reason,
        version: r.version,
        startsAt: b.startsAt,
      });
      for (const booking of booked)
        await notification(
          hooks,
          tx,
          a,
          booking,
          "Session updated",
          `${b.title} has changed. Check the date, time and location in your bookings.`,
          "changed:" + r.version,
        );
      return r;
    });
  });
  app.post("/api/v1/bookings/slots/:id/reserve", async (req) => {
    const a = allowed(req);
    if (a.role !== "subscriber")
      throw fail(
        403,
        "SUBSCRIBER_REQUIRED",
        "Sign in as a subscriber to reserve.",
      );
    const slotId = id.parse((req.params as any).id);
    const result = await db.tenant({ ...a, role: "staff" }, async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        a.tenantId + ":booking-subscriber:" + a.userId,
      ]);
      const [sub] = await tx.query(
        "SELECT id FROM subscriptions WHERE user_id=$1 AND status IN ('active','trialing') AND (period_end IS NULL OR period_end>now())",
        [a.userId],
      );
      if (!sub)
        throw fail(
          402,
          "MEMBERSHIP_REQUIRED",
          "An active membership is required.",
        );
      const [slot] = await tx.query(
        "SELECT * FROM booking_slots WHERE id=$1 AND status='open' AND starts_at>now() FOR UPDATE",
        [slotId],
      );
      if (!slot) throw fail(404, "SLOT_UNAVAILABLE", "Session unavailable.");
      if (
        Number(slot.price_minor) > 0 &&
        (!hooks.preparePaidBooking || !hooks.startBookingCheckout)
      )
        throw fail(
          503,
          "PAYMENTS_UNAVAILABLE",
          "Booking payment setup is unavailable.",
        );
      const [prior] = await tx.query(
        "SELECT * FROM bookings WHERE slot_id=$1 AND user_id=$2 FOR UPDATE",
        [slotId, a.userId],
      );
      if (prior?.status === "confirmed") return { booking: prior, paid: false };
      if (prior?.status === "payment_pending")
        return { booking: prior, paid: true };
      if (
        prior &&
        !["not_required", "refunded", "failed"].includes(prior.payment_status)
      )
        throw fail(
          409,
          "PAYMENT_RECONCILIATION",
          "Complete the existing payment or refund review before booking again.",
        );
      const [count] = await tx.query(
        "SELECT count(*)::int AS n FROM bookings WHERE slot_id=$1 AND (status='confirmed' OR (status='payment_pending' AND hold_expires_at>now()))",
        [slotId],
      );
      if (count.n >= slot.capacity)
        throw fail(409, "SLOT_FULL", "This session is full.");
      const conflicts = await tx.query(
        "SELECT b.id FROM bookings b JOIN booking_slots s ON s.id=b.slot_id AND s.tenant_id=b.tenant_id WHERE b.user_id=$1 AND b.slot_id<>$2 AND (b.status='confirmed' OR (b.status='payment_pending' AND b.hold_expires_at>now())) AND s.starts_at<$4 AND s.ends_at>$3",
        [a.userId, slotId, slot.starts_at, slot.ends_at],
      );
      if (conflicts.length)
        throw fail(
          409,
          "MEMBER_OVERLAP",
          "You already have a reservation at this time.",
        );
      const paid = Number(slot.price_minor) > 0;
      const [booking] = await tx.query(
        "INSERT INTO bookings(id,tenant_id,slot_id,user_id,status,payment_status,hold_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(slot_id,user_id) DO UPDATE SET status=excluded.status,payment_status=excluded.payment_status,hold_expires_at=excluded.hold_expires_at,cancel_reason=NULL,version=bookings.version+1,updated_at=now() RETURNING *",
        [
          randomUUID(),
          a.tenantId,
          slotId,
          a.userId,
          paid ? "payment_pending" : "confirmed",
          paid ? "pending" : "not_required",
          paid ? new Date(Date.now() + 35 * 60000).toISOString() : null,
        ],
      );
      if (paid) await hooks.preparePaidBooking!(tx, a, slot, booking);
      await event(
        tx,
        a,
        paid ? "booking.payment_started" : "booking.reserved",
        booking.id,
      );
      if (!paid)
        await notification(
          hooks,
          tx,
          a,
          booking,
          "Session reserved",
          `${slot.title} is reserved. View your session time and cancellation policy in bookings.`,
          "reserved:" + booking.version,
        );
      return { booking, paid };
    });
    if (result.paid) {
      const checkout = await hooks.startBookingCheckout!(
        db,
        a,
        result.booking.id,
      );
      return {
        ...result.booking,
        ...checkout,
        status: result.booking.status,
        checkoutStatus: checkout.status,
      };
    }
    return result.booking;
  });
  app.post("/api/v1/bookings/:id/cancel", async (req) => {
    const a = allowed(req),
      bookingId = id.parse((req.params as any).id),
      b = z
        .object({
          revision: z.number().int().min(1).optional(),
          reason: z.string().trim().max(1000).default("Canceled by member"),
        })
        .strict()
        .parse(req.body ?? {});
    const booking = await db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT b.*,s.starts_at,s.cancellation_hours,s.trainer_id,s.title FROM bookings b JOIN booking_slots s ON s.id=b.slot_id AND s.tenant_id=b.tenant_id WHERE b.id=$1 FOR UPDATE OF b",
        [bookingId],
      );
      if (!r) throw fail(404, "NOT_FOUND", "Booking unavailable.");
      if (a.role !== "subscriber") manage(a, r);
      if (r.status === "canceled") return r;
      if (b.revision && b.revision !== r.version)
        throw fail(
          409,
          "REVISION_CONFLICT",
          "Reservation changed. Reload first.",
        );
      if (!["confirmed", "payment_pending"].includes(r.status))
        throw fail(
          409,
          "BOOKING_FINAL",
          "A completed session cannot be canceled.",
        );
      if (
        a.role === "subscriber" &&
        r.status !== "payment_pending" &&
        new Date(r.starts_at).getTime() - Date.now() <
          r.cancellation_hours * 3600000
      )
        throw fail(
          409,
          "CANCELLATION_WINDOW",
          `Contact your trainer to cancel within ${r.cancellation_hours} hours.`,
        );
      const [updated] = await tx.query(
        "UPDATE bookings SET status='canceled',cancel_reason=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [r.id, b.reason],
      );
      await event(tx, a, "booking.canceled", r.id, {
        reason: b.reason,
        priorStatus: r.status,
      });
      await notification(
        hooks,
        tx,
        a,
        updated,
        "Session canceled",
        `${r.title} has been canceled. Any payment refund is tracked separately.`,
        "canceled:" + updated.version,
      );
      return updated;
    });
    if (
      hooks.refundCanceledBooking &&
      booking.payment_status !== "not_required"
    )
      return {
        ...booking,
        refund: await hooks.refundCanceledBooking(db, a, booking.id),
      };
    return booking;
  });
  app.post("/api/v1/bookings/slots/:id/cancel", async (req) => {
    const a = trainer(req),
      slotId = id.parse((req.params as any).id),
      b = z
        .object({
          revision: z.number().int().min(1),
          reason: z.string().trim().min(5).max(1000),
        })
        .strict()
        .parse(req.body);
    const result = await db.tenant(a, async (tx) => {
      const [slot] = await tx.query(
        "SELECT * FROM booking_slots WHERE id=$1 FOR UPDATE",
        [slotId],
      );
      if (!slot) throw fail(404, "NOT_FOUND", "Session unavailable.");
      manage(a, slot);
      if (slot.status === "canceled")
        return {
          slot,
          bookings: await tx.query(
            "SELECT * FROM bookings WHERE slot_id=$1 AND status='canceled'",
            [slotId],
          ),
        };
      if (slot.version !== b.revision)
        throw fail(409, "REVISION_CONFLICT", "Session changed. Reload first.");
      if (new Date(slot.ends_at).getTime() < Date.now())
        throw fail(
          409,
          "SESSION_FINISHED",
          "Record attendance for a completed session.",
        );
      const [updated] = await tx.query(
        "UPDATE booking_slots SET status='canceled',version=version+1 WHERE id=$1 RETURNING *",
        [slotId],
      );
      const bookings = await tx.query(
        "UPDATE bookings SET status='canceled',cancel_reason=$2,version=version+1,updated_at=now() WHERE slot_id=$1 AND status IN ('confirmed','payment_pending') RETURNING *",
        [slotId, b.reason],
      );
      for (const booking of bookings)
        await notification(
          hooks,
          tx,
          a,
          booking,
          "Coach canceled session",
          `${slot.title} was canceled by your coach. Any payment refund is tracked separately.`,
          "canceled:" + booking.version,
        );
      await event(tx, a, "booking.slot_canceled", slotId, {
        reason: b.reason,
        reservations: bookings.length,
      });
      return { slot: updated, bookings };
    });
    const refunds = [];
    if (hooks.refundCanceledBooking)
      for (const booking of result.bookings.filter(
        (b) => b.payment_status !== "not_required",
      ))
        refunds.push(await hooks.refundCanceledBooking(db, a, booking.id));
    return { ...result, refunds };
  });
  app.post("/api/v1/bookings/:id/outcome", async (req) => {
    const a = trainer(req),
      bookingId = id.parse((req.params as any).id),
      b = z
        .object({
          status: z.enum(["attended", "no_show"]),
          revision: z.number().int().min(1).optional(),
        })
        .strict()
        .parse(req.body);
    return db.tenant(a, async (tx) => {
      const [r] = await tx.query(
        "SELECT b.*,s.trainer_id,s.ends_at,s.no_show_policy FROM bookings b JOIN booking_slots s ON s.id=b.slot_id AND s.tenant_id=b.tenant_id WHERE b.id=$1 FOR UPDATE OF b",
        [bookingId],
      );
      if (!r) throw fail(404, "NOT_FOUND", "Booking unavailable.");
      manage(a, r);
      if (
        r.status !== "confirmed" ||
        new Date(r.ends_at).getTime() > Date.now()
      )
        throw fail(
          409,
          "SESSION_NOT_FINISHED",
          "Only a completed confirmed session can receive attendance.",
        );
      if (b.revision && b.revision !== r.version)
        throw fail(409, "REVISION_CONFLICT", "Reservation changed.");
      const [updated] = await tx.query(
        "UPDATE bookings SET status=$2,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
        [bookingId, b.status],
      );
      await event(tx, a, "booking.outcome", bookingId, {
        status: b.status,
        noShowPolicy: r.no_show_policy,
      });
      return updated;
    });
  });
  app.get("/api/v1/bookings/calendar.ics", async (req, reply) => {
    const a = allowed(req);
    const rows = await db.tenant(a, (tx) =>
      a.role === "subscriber"
        ? tx.query(
            "SELECT b.id,s.starts_at,s.ends_at,s.title,s.location,b.status,greatest(b.version,s.version) AS version FROM bookings b JOIN booking_slots s ON s.id=b.slot_id AND s.tenant_id=b.tenant_id WHERE b.user_id=$1 AND b.status<>'payment_pending' AND s.ends_at>now()-interval '90 days' ORDER BY s.starts_at",
            [a.userId],
          )
        : tx.query(
            "SELECT id,starts_at,ends_at,title,location,status,version FROM booking_slots WHERE ends_at>now()-interval '90 days' ORDER BY starts_at",
          ),
    );
    return reply
      .header("Content-Type", "text/calendar; charset=utf-8")
      .header(
        "Content-Disposition",
        'attachment; filename="coaching-sessions.ics"',
      )
      .header("Cache-Control", "private, no-store")
      .send(bookingCalendar(rows));
  });
}
