import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { createDatabase, type Database } from "@trainer/db";
import {
  registerBookingRoutes,
  localTimeToInstant,
  bookingCalendar,
} from "../apps/api/src/booking-schedule.ts";
let db: Database;
const app = Fastify();
const a = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
const subscriber = { ...a, userId: randomUUID(), role: "subscriber" };
const second = { ...a, userId: randomUUID(), role: "subscriber" };
const staff = { ...a, userId: randomUUID(), role: "staff" };
const foreign = { tenantId: randomUUID(), userId: randomUUID(), role: "owner" };
let checkoutCount = 0,
  refundCount = 0;
before(async () => {
  db = await createDatabase({ memory: true });
  await db.system(async (tx) => {
    for (const who of [a, subscriber, second, staff, foreign])
      await tx.query(
        "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Booking fixture','unused')",
        [who.userId, who.userId + "@example.test"],
      );
    for (const who of [a, foreign])
      await tx.query(
        "INSERT INTO tenants(id,slug,name) VALUES($1,$1::uuid::text,'Booking fixture')",
        [who.tenantId],
      );
    for (const who of [a, subscriber, second, staff, foreign])
      await tx.query(
        "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
        [who.tenantId, who.userId, who.role],
      );
  });
  await db.tenant(a, async (tx) => {
    for (const who of [subscriber, second])
      await tx.query(
        "INSERT INTO subscriptions(id,tenant_id,user_id,status) VALUES($1,$2,$3,'active')",
        [randomUUID(), a.tenantId, who.userId],
      );
  });
  app.setErrorHandler((e: any, _r, reply) =>
    reply
      .code(e.statusCode ?? (e.name === "ZodError" ? 400 : 500))
      .send({ code: e.code, message: e.message }),
  );
  registerBookingRoutes(
    app,
    db,
    (req) =>
      ({ subscriber, second, staff, foreign })[
        String(req.headers["x-actor"])
      ] ?? a,
    {
      preparePaidBooking: async (_tx, _a, slot, booking) => {
        assert.ok(Number(slot.price_minor) > 0);
        assert.equal(booking.status, "payment_pending");
      },
      startBookingCheckout: async () => {
        checkoutCount++;
        return { checkoutUrl: "https://checkout.fixture.test/session" };
      },
      refundCanceledBooking: async () => {
        refundCount++;
        return { status: "refund_review" };
      },
    },
  );
});
after(async () => {
  await app.close();
  await db.close();
});
const req = (url: string, method: any = "GET", payload?: any, who = "owner") =>
  app.inject({
    url: "/api/v1/bookings" + url,
    method,
    payload,
    headers: { "x-actor": who },
  });
const time = (days: number, hours = 0) =>
  new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();
async function slot(days: number, extra: any = {}) {
  const r = await req("/slots", "POST", {
    title: "Training fixture",
    location: "Studio fixture",
    startsAt: time(days),
    endsAt: time(days, 1),
    capacity: 1,
    ...extra,
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
test("timezone conversion preserves wall time and rejects both DST edge cases", () => {
  assert.equal(
    localTimeToInstant("2027-03-07T10:00", "America/New_York"),
    "2027-03-07T15:00:00.000Z",
  );
  assert.equal(
    localTimeToInstant("2027-03-14T10:00", "America/New_York"),
    "2027-03-14T14:00:00.000Z",
  );
  assert.throws(
    () => localTimeToInstant("2027-03-14T02:30", "America/New_York"),
    /does not exist/,
  );
  assert.throws(
    () => localTimeToInstant("2027-11-07T01:30", "America/New_York"),
    /occurs twice/,
  );
  assert.throws(
    () => localTimeToInstant("2027-02-31T10:00", "Asia/Dubai"),
    /Invalid calendar/,
  );
});
test("weekly sessions preserve local starts and cannot overlap", async () => {
  const year = new Date().getUTCFullYear() + 1;
  const firstSunday =
    1 + ((7 - new Date(Date.UTC(year, 2, 1)).getUTCDay()) % 7);
  const local = `${year}-03-${String(firstSunday).padStart(2, "0")}T10:00`;
  const r = await req("/slots", "POST", {
    title: "Weekly fixture",
    location: "Studio fixture",
    localStart: local,
    timezone: "America/New_York",
    durationMinutes: 60,
    capacity: 2,
    recurrence: { count: 2, intervalWeeks: 1 },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().slots.length, 2);
  assert.equal(
    new Date(r.json().slots[1].starts_at).getTime() -
      new Date(r.json().slots[0].starts_at).getTime(),
    7 * 86400000 - 3600000,
  );
  const duplicate = await req("/slots", "POST", {
    title: "Overlap fixture",
    location: "Studio fixture",
    startsAt: r.json().starts_at,
    endsAt: r.json().ends_at,
    capacity: 1,
  });
  assert.equal(duplicate.statusCode, 409, duplicate.body);
});
test("capacity is serialized and selected subscriber never sees another reservation", async () => {
  const s = await slot(10);
  const results = await Promise.all([
    req(`/slots/${s.id}/reserve`, "POST", {}, "subscriber"),
    req(`/slots/${s.id}/reserve`, "POST", {}, "second"),
  ]);
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
  const winner = results[0].statusCode === 200 ? "subscriber" : "second",
    loser = winner === "subscriber" ? "second" : "subscriber";
  const list = await req("", "GET", undefined, loser);
  assert.equal(list.json().bookings.length, 0);
  assert.equal(list.json().slots.find((x: any) => x.id === s.id).booked, 1);
  const booking = results.find((r) => r.statusCode === 200)!.json();
  assert.equal(
    (await req(`/${booking.id}/cancel`, "POST", {}, loser)).statusCode,
    404,
  );
  assert.equal(
    (
      await req(
        `/${booking.id}/cancel`,
        "POST",
        { revision: booking.version },
        winner,
      )
    ).statusCode,
    200,
  );
  assert.equal(
    (await req(`/slots/${s.id}/reserve`, "POST", {}, loser)).statusCode,
    200,
  );
  assert.equal(
    (await req(`/slots/${s.id}/reserve`, "POST", {}, "foreign")).statusCode,
    403,
  );
});
test("booking policy applies to new slots and cancellation cutoff survives later changes", async () => {
  const old = await slot(2);
  const p = await req("/policy", "POST", {
    revision: 0,
    timezone: "Asia/Dubai",
    cancellationHours: 72,
    noShowPolicy: "forfeit",
  });
  assert.equal(p.statusCode, 200, p.body);
  assert.equal(
    (
      await req("/policy", "POST", {
        revision: 0,
        timezone: "Asia/Dubai",
        cancellationHours: 1,
        noShowPolicy: "forfeit",
      })
    ).statusCode,
    409,
  );
  const fresh = await slot(2, { startsAt: time(2, 2), endsAt: time(2, 3) });
  assert.equal(old.cancellation_hours, 24);
  assert.equal(fresh.cancellation_hours, 72);
  const b = await req(`/slots/${fresh.id}/reserve`, "POST", {}, "subscriber");
  assert.equal(b.statusCode, 200, b.body);
  assert.equal(
    (await req(`/${b.json().id}/cancel`, "POST", {}, "subscriber")).statusCode,
    409,
  );
  assert.equal(
    (
      await req(`/${b.json().id}/cancel`, "POST", {
        reason: "Coach approved cancellation",
      })
    ).statusCode,
    200,
  );
});
test("slot edits use CAS and prevent staff modifying another coach or reducing occupied seats", async () => {
  const s = await slot(20, { capacity: 2 });
  for (const who of ["subscriber", "second"])
    assert.equal(
      (await req(`/slots/${s.id}/reserve`, "POST", {}, who)).statusCode,
      200,
    );
  const body = {
    revision: s.version,
    title: s.title,
    location: s.location,
    startsAt: s.starts_at,
    endsAt: s.ends_at,
    capacity: 1,
    reason: "Capacity edit fixture",
  };
  assert.equal(
    (await req(`/slots/${s.id}/update`, "POST", body)).statusCode,
    409,
  );
  body.capacity = 2;
  assert.equal(
    (await req(`/slots/${s.id}/update`, "POST", body, "staff")).statusCode,
    403,
  );
  assert.equal(
    (await req(`/slots/${s.id}/update`, "POST", body)).statusCode,
    200,
  );
  assert.equal(
    (await req(`/slots/${s.id}/update`, "POST", body)).statusCode,
    409,
  );
  assert.equal(
    (await req(`/slots/${s.id}/update`, "POST", body, "foreign")).statusCode,
    404,
  );
});
test("paid reservations are held but not confirmed before checkout and canceled intent goes to refund hook", async () => {
  const s = await slot(25, { priceMinor: 12500 });
  const r = await req(`/slots/${s.id}/reserve`, "POST", {}, "subscriber");
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().status, "payment_pending");
  assert.equal(r.json().payment_status, "pending");
  assert.equal(r.json().checkoutUrl, "https://checkout.fixture.test/session");
  assert.equal(checkoutCount, 1);
  assert.equal(
    (await req(`/slots/${s.id}/reserve`, "POST", {}, "second")).statusCode,
    409,
  );
  const canceled = await req(
    `/${r.json().id}/cancel`,
    "POST",
    { revision: r.json().version },
    "subscriber",
  );
  assert.equal(canceled.statusCode, 200, canceled.body);
  assert.equal(refundCount, 1);
  assert.equal(canceled.json().refund.status, "refund_review");
});
test("calendar exports only own bookings and escapes injected ICS content", async () => {
  const calendar = bookingCalendar([
    {
      id: "fixture",
      starts_at: time(3),
      ends_at: time(3, 1),
      title: "Name\nBEGIN:VEVENT",
      location: "Room, 1; floor",
      status: "confirmed",
    },
  ]);
  assert.ok(calendar.includes("SUMMARY:Name\\nBEGIN:VEVENT"));
  assert.ok(calendar.includes("LOCATION:Room\\, 1\\; floor"));
  assert.equal(calendar.split("\r\nBEGIN:VEVENT").length - 1, 1);
  const r = await req("/calendar.ics", "GET", undefined, "subscriber");
  assert.equal(r.statusCode, 200, r.body);
  assert.match(String(r.headers["content-type"]), /text\/calendar/);
  assert.match(String(r.headers["cache-control"]), /no-store/);
  assert.equal(
    (await req("/calendar.ics", "GET", undefined, "foreign")).body.includes(
      "Weekly fixture",
    ),
    false,
  );
});
