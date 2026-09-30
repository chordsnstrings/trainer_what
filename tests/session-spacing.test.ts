// Automatic session moves keep the trainer's session-spacing and order rules
// (owner decision N11/E7, 30 September 2026). Trainer rules are free text and
// the coaching facts carry session dates only, so with such a rule a move is
// automatic only when the app can tell nothing is broken; otherwise the
// request goes to the trainer. Pure functions: no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coachActionSchema,
  coachingFactsSchema,
  eligibleCoachAction,
  moveKeepsSessionSpacing,
  sessionSpacingDays,
} from "../packages/domain/src/coaching-completion.ts";
import {
  trialActions,
  trialFacts,
  trialMembers,
} from "./chat-trial-fixtures.ts";

const rule = (category: string, directive: string, title = "Trainer rule") => ({
  id: "0cfed0eb-78d8-4746-b1c1-58583884ecd6",
  data: {
    title,
    category,
    condition: "When sessions are planned or moved",
    directive,
    reason: "Recovery between sessions",
    allowedUses: ["model_prompt"],
  },
});
const intervals = rule(
  "schedule",
  "Never run interval sessions on consecutive days; keep a rest day between them.",
);
const facts = (overrides: Record<string, unknown> = {}) =>
  coachingFactsSchema.parse({
    ...trialFacts(trialMembers.find((m) => m.key === "T3S01")!),
    ...overrides,
  });

test("the trial case: T3S01's run with intervals would land the day before the next interval run (E7)", () => {
  // Trial T3S01 chat 2: "Can I move tomorrow's run? I have a dentist
  // appointment." Three runs a week (28 and 30 September, 2 October), every
  // one with Run Intervals; the trainer's one-day move takes 30 September to
  // 1 October, back to back with 2 October. The fixtures keep rule titles
  // only, so the spacing rule's wording is written for this test.
  const move = trialActions.T3.find((a) => a.key === "reschedule")!;
  const request = trialMembers.find((m) => m.key === "T3S01")!.chats[1];
  const f = facts();
  assert.deepEqual(f.occupiedDates, ["2026-09-28", "2026-09-30", "2026-10-02"]);
  // Still a candidate for the trainer (free day, weekly count) ...
  assert.equal(eligibleCoachAction(coachActionSchema.parse(move.data), request, f), true);
  // ... but not automatic under the spacing rule.
  assert.equal(moveKeepsSessionSpacing(f, move.data.daysOffset, [intervals]), false);
  // Without a spacing or order rule the move stays automatic, as before.
  assert.equal(moveKeepsSessionSpacing(f, 1, []), true);
  assert.equal(moveKeepsSessionSpacing(f, 1), true);
});

test("a move that borders no other session and keeps the order stays automatic under a spacing rule", () => {
  const once = facts({ occupiedDates: ["2026-09-30"] });
  assert.equal(moveKeepsSessionSpacing(once, 1, [intervals]), true);
  const twice = facts({ occupiedDates: ["2026-09-30", "2026-10-03"] });
  assert.equal(moveKeepsSessionSpacing(twice, 1, [intervals]), true);
  // Two days later borders 3 October.
  assert.equal(moveKeepsSessionSpacing(twice, 2, [intervals]), false);
  // A missed session in the past never counts.
  const missed = facts({ occupiedDates: ["2026-09-27", "2026-09-30"] });
  assert.equal(moveKeepsSessionSpacing(missed, 1, [intervals]), true);
});

test("a move past another planned session changes the order and goes to the trainer", () => {
  const order = rule("schedule", "Keep the session order: strength before the long run.");
  const f = facts({ occupiedDates: ["2026-09-30", "2026-10-01", "2026-10-06"] });
  // 30 September + 3 = 3 October passes 1 October.
  assert.equal(moveKeepsSessionSpacing(f, 3, [order]), false);
  assert.equal(moveKeepsSessionSpacing(f, 3, []), true);
});

test("hours and days in a spacing rule are rounded up; a duration the app cannot read sends the move to the trainer", () => {
  assert.equal(sessionSpacingDays([intervals]), 2);
  assert.equal(sessionSpacingDays([rule("recovery", "Leave 48 hours between hard sessions.")]), 3);
  assert.equal(sessionSpacingDays([rule("schedule", "Two rest days between heavy leg days.")]), 3);
  assert.equal(sessionSpacingDays([rule("safety", "No hard sessions back-to-back.")]), 2);
  // A number that is not a duration: the app cannot tell.
  assert.equal(sessionSpacingDays([rule("schedule", "At most 3 sessions a week, never on consecutive days.")]), null);
  // Arabic durations are not read; Arabic spacing without one is.
  assert.equal(sessionSpacingDays([rule("schedule", "لا انترفال يومين متتاليين")]), null);
  assert.equal(sessionSpacingDays([rule("schedule", "ممنوع حصص الانترفال ورا بعض")]), 2);
  const f = facts({ occupiedDates: ["2026-09-30", "2026-10-03"] });
  // 1 October is two days from 3 October: fine for "not consecutive", not for 48 hours.
  assert.equal(moveKeepsSessionSpacing(f, 1, [intervals]), true);
  assert.equal(moveKeepsSessionSpacing(f, 1, [rule("recovery", "Leave 48 hours between hard sessions.")]), false);
  assert.equal(
    moveKeepsSessionSpacing(f, 1, [rule("schedule", "At most 3 sessions a week, never on consecutive days.")]),
    false,
  );
});

test("only schedule, recovery and safety rules about spacing or order count", () => {
  // A progression rule that says "in a row" is about load, not spacing.
  const progression = rule("progression", "Add 2.5 kg after two sessions in a row with all reps.");
  assert.equal(sessionSpacingDays([progression]), 0);
  assert.equal(sessionSpacingDays([rule("schedule", "Move a session by one day when the new day is free.")]), 0);
  assert.equal(sessionSpacingDays([rule("recovery", "Sleep well in order to recover.")]), 0);
  assert.equal(moveKeepsSessionSpacing(facts(), 1, [progression]), true);
  // Rules may come as stored rows ({ data }) or as plain rule objects.
  assert.equal(sessionSpacingDays([intervals.data]), 2);
});
