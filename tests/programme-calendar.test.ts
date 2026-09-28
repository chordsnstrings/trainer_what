import { test } from "node:test";
import assert from "node:assert/strict";
import { productSchema } from "@trainer/contracts";
import {
  DEFAULT_PROGRAMME_DAYS,
  adherence,
  endOfProgramme,
  programmePosition,
  programmeTimeline,
} from "../packages/domain/src/programme.ts";

const at = (iso: string) => new Date(iso);

test("offer validation: trainer-set length 7..365 or rolling, billing, upfront needs a length, voice add-on price", () => {
  const base = { name: "Strength", description: "Coaching", priceMinor: 30000 };
  const monthly = productSchema.parse(base);
  assert.equal(monthly.billing, "monthly");
  assert.equal(monthly.programmeDays, null);
  assert.equal(monthly.voiceAddOnMinor, null);
  assert.equal(productSchema.parse({ ...base, programmeDays: 7 }).programmeDays, 7);
  assert.equal(productSchema.parse({ ...base, programmeDays: 365 }).programmeDays, 365);
  for (const programmeDays of [6, 366, 0, 28.5, "28"])
    assert.equal(
      productSchema.safeParse({ ...base, programmeDays }).success,
      false,
      String(programmeDays),
    );
  const upfront = productSchema.safeParse({ ...base, billing: "upfront" });
  assert.equal(upfront.success, false, "an upfront programme needs a length");
  assert.deepEqual(
    upfront.error?.issues.map((i) => i.path.join(".")),
    ["programmeDays"],
  );
  assert.equal(
    productSchema.parse({ ...base, billing: "upfront", programmeDays: 84 }).billing,
    "upfront",
  );
  assert.equal(productSchema.safeParse({ ...base, billing: "yearly" }).success, false);
  assert.equal(productSchema.safeParse({ ...base, voiceAddOnMinor: 99 }).success, false);
  assert.equal(productSchema.safeParse({ ...base, voiceAddOnMinor: 100001 }).success, false);
  assert.equal(productSchema.parse({ ...base, voiceAddOnMinor: 4900 }).voiceAddOnMinor, 4900);
  // Voice is no longer an offer of its own.
  assert.equal(productSchema.safeParse({ ...base, premiumVoice: true }).success, false);
});

test("Day N of M uses the member's calendar day, across time zones", () => {
  // Paid at 21:30 UTC on 27 September: already 28 September in Dubai, still
  // 27 September in New York.
  const startsAt = "2026-09-27T21:30:00Z";
  const input = { billing: "upfront" as const, programmeDays: 28, startsAt, endsAt: "2026-10-25T21:30:00Z" };
  const dubai = (now: string) =>
    programmePosition({ ...input, timeZone: "Asia/Dubai", now: at(now) });
  const newYork = (now: string) =>
    programmePosition({ ...input, timeZone: "America/New_York", now: at(now) });
  assert.equal(dubai("2026-09-28T01:00:00Z").day, 1);
  assert.equal(dubai("2026-09-28T01:00:00Z").startDate, "2026-09-28");
  assert.equal(newYork("2026-09-28T01:00:00Z").day, 1);
  assert.equal(newYork("2026-09-28T01:00:00Z").startDate, "2026-09-27");
  // 05:00 UTC: 09:00 in Dubai (still day 1), 01:00 in New York (day 2).
  assert.equal(dubai("2026-09-28T05:00:00Z").day, 1);
  assert.equal(newYork("2026-09-28T05:00:00Z").day, 2);
  // 20:30 UTC: 00:30 on 29 September in Dubai (day 2); New York day 2.
  assert.equal(dubai("2026-09-28T20:30:00Z").day, 2);
  assert.equal(newYork("2026-09-28T20:30:00Z").day, 2);
  const mid = dubai("2026-10-10T08:00:00Z");
  assert.deepEqual(
    { day: mid.day, of: mid.of, state: mid.state, remaining: mid.daysRemaining },
    { day: 13, of: 28, state: "active", remaining: 15 },
  );
  // The last access hours never read as day 29: the day is clamped to M and
  // completion follows the paid access end.
  const lastHours = newYork("2026-10-25T20:00:00Z");
  assert.equal(lastHours.day, 28);
  assert.equal(lastHours.state, "active");
  const ended = dubai("2026-10-25T21:30:00Z");
  assert.equal(ended.state, "complete");
  assert.equal(ended.day, 28);
  assert.equal(ended.daysRemaining, 0);
  // Before a programme starts.
  const before = dubai("2026-09-27T10:00:00Z");
  assert.equal(before.state, "not_started");
  assert.equal(before.day, 0);
});

test("daylight-saving changes never shift a programme day", () => {
  // London leaves summer time on 25 October 2026.
  const position = (now: string) =>
    programmePosition({
      billing: "monthly",
      programmeDays: 7,
      startsAt: "2026-10-22T08:00:00Z",
      timeZone: "Europe/London",
      now: at(now),
    });
  // 23:30 UTC on the 24th is 00:30 BST on the 25th: day 4.
  assert.equal(position("2026-10-24T23:30:00Z").today, "2026-10-25");
  assert.equal(position("2026-10-24T23:30:00Z").day, 4);
  // 25 October has 25 hours: 24 hours later it is still the 25th (GMT).
  assert.equal(position("2026-10-25T23:30:00Z").today, "2026-10-25");
  assert.equal(position("2026-10-25T23:30:00Z").day, 4);
  assert.equal(position("2026-10-26T00:30:00Z").day, 5);
});

test("monthly and rolling programmes run in consecutive blocks of the trainer-set or default length", () => {
  const rolling = programmePosition({
    billing: "monthly",
    programmeDays: null,
    startsAt: "2026-08-01T09:00:00Z",
    timeZone: "Asia/Dubai",
    now: at("2026-09-28T09:00:00Z"),
  });
  assert.equal(rolling.rolling, true);
  assert.equal(rolling.of, DEFAULT_PROGRAMME_DAYS);
  // 58 days elapsed: block 3, day 3.
  assert.deepEqual([rolling.block, rolling.day], [3, 3]);
  assert.equal(rolling.blockStartDate, "2026-09-26");
  assert.equal(rolling.blockEndDate, "2026-10-23");
  const set = programmePosition({
    billing: "monthly",
    programmeDays: 42,
    startsAt: "2026-08-01T09:00:00Z",
    timeZone: "Asia/Dubai",
    now: at("2026-09-28T09:00:00Z"),
  });
  assert.equal(set.rolling, false);
  assert.deepEqual([set.block, set.day, set.of], [2, 17, 42]);
  // An invalid stored length falls back to the Brain default.
  assert.equal(
    programmePosition({
      billing: "monthly",
      programmeDays: 400,
      startsAt: "2026-08-01T09:00:00Z",
      timeZone: "Asia/Dubai",
    }).of,
    DEFAULT_PROGRAMME_DAYS,
  );
});

test("timeline, streak and adherence follow planned sessions; rest and canceled days do not break a streak", () => {
  const position = programmePosition({
    billing: "upfront",
    programmeDays: 10,
    startsAt: "2026-09-20T06:00:00Z",
    endsAt: "2026-09-30T06:00:00Z",
    timeZone: "Asia/Dubai",
    now: at("2026-09-25T06:00:00Z"),
  });
  const sessions = [
    { id: "a", date: "2026-09-20", status: "completed", label: "Lower" },
    { id: "b", date: "2026-09-21", status: "planned", label: "Upper" },
    { id: "c", date: "2026-09-22", status: "completed", label: "Lower" },
    { id: "d", date: "2026-09-23", status: "canceled", label: "Upper" },
    { id: "e", date: "2026-09-24", status: "completed", label: "Full" },
    { id: "f", date: "2026-09-25", status: "planned", label: "Lower" },
    { id: "g", date: "2026-09-27", status: "planned", label: "Upper" },
  ];
  const days = programmeTimeline(position, sessions);
  assert.equal(days.length, 10);
  assert.deepEqual(
    days.map((d) => d.status),
    ["done", "missed", "done", "canceled", "done", "today", "rest", "upcoming", "rest", "rest"],
  );
  assert.equal(days[5].day, 6);
  const progress = adherence(sessions, "2026-09-25");
  // Newest first: 24 done, 23 canceled (skipped), 22 done, 21 missed.
  assert.equal(progress.streak, 2);
  assert.deepEqual([progress.completed, progress.scheduled, progress.percent], [3, 4, 75]);
  // Today's session counts once it is done.
  const done = adherence(
    sessions.map((s) => (s.id === "f" ? { ...s, status: "completed" } : s)),
    "2026-09-25",
  );
  assert.equal(done.streak, 3);
  assert.equal(adherence([], "2026-09-25").percent, null);
});

test("end of programme: monthly starts the next block, upfront ends (renewable in its final week)", () => {
  const now = at("2026-09-28T09:00:00Z");
  const monthly = programmePosition({
    billing: "monthly",
    programmeDays: 28,
    startsAt: "2026-09-10T09:00:00Z",
    timeZone: "Asia/Dubai",
    now,
  });
  assert.deepEqual(
    endOfProgramme({ billing: "monthly", position: monthly, accessActive: true, accessEndsAt: "2026-10-10T09:00:00Z", now }),
    { state: "next_block", at: "2026-10-08" },
  );
  assert.equal(
    endOfProgramme({ billing: "monthly", position: monthly, accessActive: true, cancelAtPeriodEnd: true, accessEndsAt: "2026-10-10T09:00:00Z", now }).state,
    "ends",
  );
  const early = endOfProgramme({ billing: "upfront", position: null, accessActive: true, accessEndsAt: "2026-10-20T09:00:00Z", now });
  assert.deepEqual(early, { state: "ends", at: "2026-10-20T09:00:00.000Z", canRenew: false });
  const finalWeek = endOfProgramme({ billing: "upfront", position: null, accessActive: true, accessEndsAt: "2026-10-03T09:00:00Z", now });
  assert.equal(finalWeek.state, "ends");
  assert.equal((finalWeek as any).canRenew, true);
  const ended = endOfProgramme({ billing: "upfront", position: null, accessActive: false, accessEndsAt: "2026-09-27T09:00:00Z", now });
  assert.deepEqual(ended, { state: "ended", at: "2026-09-27T09:00:00.000Z", canRenew: true });
  assert.deepEqual(endOfProgramme({ billing: null, position: null, accessActive: false }), { state: "none" });
});
