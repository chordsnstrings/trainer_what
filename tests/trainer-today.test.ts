// Today, "One queue" (docs/features/trainer-workspace.md, "Today"): the
// queue's order, the live picture derived from records and events, the
// "Jump to" menu's ranking and page direction, and the rules the trainer
// workspace's motion stylesheets keep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildQueue,
  decisionsWaiting,
  entryTitle,
  focusOf,
  type RuleSuggestion,
  type SetupSummary,
} from "../apps/web/components/trainer-queue.ts";
import {
  deriveFeed,
  deriveTraining,
  doneToday,
  nameMap,
  plannedSets,
  plansBeingWritten,
  TRAINING_WINDOW_MS,
  WRITING_WINDOW_MS,
} from "../apps/web/components/workspace-live.ts";
import { directionBetween, placeIndex, rankPlaces } from "../apps/web/components/workspace-places.ts";
import type { InboxItem } from "../apps/web/components/workspace-inbox.tsx";

const item = (id: string, type: InboxItem["type"], urgency: number, createdAt: string): InboxItem => ({
  id,
  type,
  urgency,
  recordId: id,
  version: 1,
  clientId: "c1",
  clientName: "Lina Haddad",
  title: `Item ${id}`,
  preview: "",
  draft: null,
  createdAt,
  actions: [],
  href: "/trainer/inbox",
});
const rule = (id: string, createdAt: string): RuleSuggestion => ({
  id,
  version: 1,
  source: "edits",
  target: "rule",
  rule: { title: "Shorter rests for beginners" },
  why: "You changed it four times",
  example: null,
  evidence: [],
  createdAt,
});
const setup = (done: number, total: number): SetupSummary => ({
  steps: [
    { key: "profile", label: "Your profile", minutes: 2, status: done > 0 ? "done" : "todo" },
    { key: "price", label: "Your price", minutes: 1, status: done > 1 ? "done" : "todo" },
  ],
  progress: { done, total, percent: Math.round((done / total) * 100), minutesLeft: 3 },
  resumeStep: done < total ? "price" : null,
});

test("the queue puts safety first, then setup, then urgency and whoever waited longest", () => {
  const queue = buildQueue(
    [
      item("plan", "plan_draft", 3, "2026-10-26T08:00:00Z"),
      item("reply-new", "reply_draft", 1, "2026-10-26T09:00:00Z"),
      item("reply-old", "reply_draft", 1, "2026-10-26T07:00:00Z"),
      item("safety", "safety", 0, "2026-10-26T09:30:00Z"),
    ],
    [rule("r1", "2026-10-26T06:00:00Z")],
    setup(1, 2),
  );
  assert.deepEqual(
    queue.map((e) => e.key),
    ["safety", "setup", "reply-old", "reply-new", "rule:r1", "plan"],
  );
  // Setup is not a decision; everything else is.
  assert.equal(decisionsWaiting(queue), 5);
  assert.equal(entryTitle(queue[1]), "Finish setup: Your price");
  assert.equal(entryTitle(queue.find((e) => e.kind === "rule")!), "Make this a rule?");
});

test("finished setup leaves the queue, and Later today moves items to the end in the order moved", () => {
  const inbox = [
    item("a", "reply_draft", 1, "2026-10-26T07:00:00Z"),
    item("b", "question", 2, "2026-10-26T07:00:00Z"),
    item("c", "plan_draft", 3, "2026-10-26T07:00:00Z"),
  ];
  const queue = buildQueue(inbox, [], setup(2, 2), ["b", "a", "gone"]);
  assert.deepEqual(queue.map((e) => e.key), ["c", "b", "a"]);
  assert.equal(focusOf(queue, null)?.key, "c");
  assert.equal(focusOf(queue, "a")?.key, "a");
  // A pick that no longer exists falls back to the first item.
  assert.equal(focusOf(queue, "gone")?.key, "c");
  assert.equal(focusOf([], null), null);
});

const NOW = Date.parse("2026-10-26T10:00:00Z");
const members = [
  { id: "u1", name: "Lina Haddad" },
  { id: "u2", name: "Omar Saleh" },
];
const workout = (id: string, owner: string, startedAt: string, sets: number[], status = "active") => ({
  id,
  kind: "workout",
  status,
  owner_user_id: owner,
  created_at: startedAt,
  data: { startedAt, program: { name: "Lower body", exercises: sets.map((s) => ({ sets: s })) } },
});

test("clients training now come from active workouts started in the last three hours", () => {
  assert.equal(plannedSets({ program: { exercises: [{ sets: 3 }, { sets: "4" }, { sets: -2 }, {}] } }), 7);
  const rows = [
    workout("w1", "u1", "2026-10-26T09:30:00Z", [3, 3]),
    workout("w2", "u2", new Date(NOW - TRAINING_WINDOW_MS - 60_000).toISOString(), [3]),
    workout("w3", "u2", "2026-10-26T09:50:00Z", [2], "completed"),
    workout("w4", "u9", "2026-10-26T09:55:00Z", [1]),
  ] as any[];
  const sets = [
    { id: "s1", workout_id: "w1", user_id: "u1", created_at: "" },
    { id: "s2", workout_id: "w1", user_id: "u1", created_at: "" },
    { id: "s3", workout_id: "w4", user_id: "u9", created_at: "" },
    { id: "s4", workout_id: "w4", user_id: "u9", created_at: "" },
  ];
  const training = deriveTraining(rows, sets, nameMap(members), NOW);
  // Newest first; the old and the completed workouts are not "now".
  assert.deepEqual(training.map((t) => t.workoutId), ["w4", "w1"]);
  assert.equal(training[1].name, "Lina Haddad");
  assert.equal(training[1].setsDone, 2);
  assert.equal(training[1].setsTotal, 6);
  // An unknown member is never named; logged sets never pass the plan.
  assert.equal(training[0].name, "A client");
  assert.equal(training[0].setsDone, 1);
});

test("plans being written, decisions done today and the Brain's feed come from events", () => {
  const event = (id: string, name: string, at: string, actor: string | null = "u1", subject: string | null = null) => ({
    id,
    name,
    actor_id: actor,
    subject_id: subject,
    created_at: at,
  });
  const events = [
    event("e1", "brain.plan_generation_started", "2026-10-26T09:50:00Z", "u1", "p1"),
    event("e2", "brain.plan_generation_started", "2026-10-26T09:40:00Z", "u2", "p2"),
    event("e3", "brain.plan_review_required", "2026-10-26T09:45:00Z", "u2", "p2"),
    event("e4", "brain.plan_generation_started", new Date(NOW - WRITING_WINDOW_MS - 1000).toISOString(), "u1", "p3"),
    event("e5", "exception.resolved", "2026-10-26T09:00:00Z", "coach"),
    event("e6", "brain.suggestion_confirmed", "2026-10-26T08:00:00Z", "coach"),
    event("e7", "exception.resolved", "2026-10-26T09:10:00Z", "other-coach"),
    event("e8", "support.replied", "2026-10-20T09:00:00Z", "coach"),
    event("e9", "coaching.automatic_delivered", "2026-10-26T09:55:00Z", "u2"),
    event("e10", "workout.completed", "2026-10-26T09:58:00Z", "u1"),
  ];
  assert.equal(plansBeingWritten(events, NOW), 1);
  // Midnight is local: compare with a time zone free count.
  const since = new Date(NOW);
  since.setHours(0, 0, 0, 0);
  const expected = events.filter(
    (e) => e.actor_id === "coach" && ["exception.resolved", "brain.suggestion_confirmed", "support.replied"].includes(e.name) && Date.parse(e.created_at) >= since.getTime(),
  ).length;
  assert.equal(doneToday(events, "coach", NOW), expected);
  const feed = deriveFeed(events, nameMap(members), "coach", 3);
  assert.deepEqual(
    feed.map((f) => [f.by, f.text]),
    [
      ["client", "Lina finished a workout"],
      ["brain", "Answered Omar"],
      ["brain", "Started writing a plan for Lina"],
    ],
  );
  // The coach's own confirmation reads as theirs.
  const mine = deriveFeed(events, nameMap(members), "coach", 20).find((f) => f.id === "e6");
  assert.equal(mine?.by, "you");
});

test("Jump to ranks places by label and knows which way a page sits in the menu", () => {
  const places = [
    { label: "Today", href: "/trainer", group: "" },
    { label: "Inbox", href: "/trainer/inbox", group: "" },
    { label: "Clients", href: "/trainer/subscribers", group: "" },
    { label: "Chats", href: "/trainer/messages", group: "Client tools" },
    { label: "Earnings and plans", href: "/trainer/finance", group: "Business" },
    { label: "Business summary", href: "/trainer/analytics", group: "Business" },
    { label: "Inbox", href: "/trainer/inbox", group: "" },
  ];
  assert.equal(rankPlaces(places, "").length, 6);
  assert.deepEqual(rankPlaces(places, "bus").map((p) => p.href), ["/trainer/analytics", "/trainer/finance"]);
  assert.deepEqual(rankPlaces(places, "client tools").map((p) => p.href), ["/trainer/messages"]);
  assert.deepEqual(rankPlaces(places, "zzz"), []);
  const hrefs = places.map((p) => p.href);
  assert.equal(placeIndex(hrefs, "/trainer/subscribers/123"), 2);
  assert.equal(placeIndex(hrefs, "/trainer/unknown"), -1);
  assert.equal(directionBetween(hrefs, "/trainer", "/trainer/finance"), "forward");
  assert.equal(directionBetween(hrefs, "/trainer/finance", "/trainer/inbox"), "back");
  assert.equal(directionBetween(hrefs, "/trainer/subscribers", "/trainer/subscribers/9"), "none");
});

// The trainer workspace's motion keeps the rules in docs/features/motion.md:
// every animation and transition sits inside the no-preference block (so
// reduced motion stops it), loops only for live states, and "Pause live
// motion" stops every loop.
const SHEETS = ["trainer-rail.css", "trainer-today.css", "workspace-transitions.css"];
function blocks(css: string) {
  // Top-level at-rule blocks with their bodies, comments blanked.
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const out: { head: string; body: string }[] = [];
  let depth = 0,
    start = 0,
    head = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) {
        head = text.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0) {
        out.push({ head, body: text.slice(start, i) });
        start = i + 1;
      }
    }
  }
  return out;
}
test("the trainer workspace's motion stops under reduced motion and loops only for live states", async () => {
  for (const name of SHEETS) {
    const css = await readFile(new URL(`../apps/web/app/${name}`, import.meta.url), "utf8");
    for (const { head, body } of blocks(css)) {
      if (head.startsWith("@keyframes")) continue;
      const moving = /(?:^|[;{\s])(?:animation|transition)\s*:\s*(?!none\b)[^;]+/g;
      const inMotionBlock = /prefers-reduced-motion:\s*no-preference/.test(head);
      if (!inMotionBlock)
        assert.doesNotMatch(body, moving, `${name}: "${head.slice(0, 80)}" moves outside the no-preference block`);
      for (const loop of body.match(/animation:[^;]*infinite[^;]*/g) ?? [])
        assert.match(loop, /motion-(breathe|typing)|rail-line|motion-shimmer/, `${name}: an ambient loop that is not a live state: ${loop}`);
    }
    if (/infinite/.test(css)) assert.match(css, /\.motion-paused/, `${name}: loops without a pause`);
  }
});
