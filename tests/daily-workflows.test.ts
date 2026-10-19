import { test } from "node:test";
import assert from "node:assert/strict";
import { saveAndRefresh, readSignal } from "../apps/web/lib/action-outcome.ts";
import {
  safeJoinReturn,
  rememberJoinReturn,
  readJoinReturn,
  joinedOfferDestination,
} from "../apps/web/lib/join-intent.ts";
import { trainingWeek } from "../apps/web/lib/training-week.ts";
import { unreadCoachMessages } from "../apps/web/components/member-nav.ts";

test("an accepted invitation or checkout survives a failed read without sending twice", async () => {
  let writes = 0,
    reads = 0;
  const receipt = { id: "accepted", url: "https://example.test/accepted" };
  const outcome = await saveAndRefresh(
    async () => {
      writes++;
      return receipt;
    },
    async () => {
      reads++;
      throw Error("offline");
    },
  );
  assert.deepEqual(outcome, { result: receipt, refreshed: false });
  assert.equal(writes, 1);
  assert.equal(reads, 1);
  let readAfterFailure = false;
  await assert.rejects(
    saveAndRefresh(
      async () => {
        throw Error("not accepted");
      },
      async () => {
        readAfterFailure = true;
      },
    ),
    /not accepted/,
  );
  assert.equal(readAfterFailure, false);
  for (const method of ["POST", "PUT", "DELETE", "PATCH"])
    assert.equal(readSignal(method), undefined);
});

test("joining intent permits only internal joining routes and never carries prices or redirects", () => {
  for (const value of [
    "https://evil.test/join-coach/coach",
    "//evil.test/join-coach/coach",
    "/\\evil.test",
    "/app",
    "javascript:alert(1)",
    "/join-coach/coach/../../admin",
    "/join-coach/coach\n",
  ])
    assert.equal(safeJoinReturn(value), null, value);
  assert.equal(
    safeJoinReturn(
      "/join-coach/alex?offer=offer_123&lang=ar&price=1&returnTo=https://evil.test",
    ),
    "/join-coach/alex?offer=offer_123&lang=ar",
  );
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  rememberJoinReturn("/join-coach/alex?offer=one", storage, 100);
  assert.equal(readJoinReturn(storage, 200), "/join-coach/alex?offer=one");
  assert.equal(readJoinReturn(storage, 3600101), null);
  assert.equal(
    joinedOfferDestination(readJoinReturn(storage, 200), "other-coach"),
    null,
  );
  assert.equal(
    joinedOfferDestination(readJoinReturn(storage, 200), "alex"),
    "/app/membership?offer=one",
  );
});

test("weekly reflection distinguishes scheduled, missed, canceled and completed sessions", () => {
  const rows = [
    {
      kind: "planned_session",
      status: "completed",
      data: { date: "2026-10-19" },
    },
    { kind: "planned_session", status: "missed", data: { date: "2026-10-20" } },
    {
      kind: "planned_session",
      status: "planned",
      data: { date: "2026-10-23" },
    },
    {
      kind: "planned_session",
      status: "canceled",
      data: { date: "2026-10-24" },
    },
    {
      kind: "workout",
      status: "completed",
      data: { completedAt: "2026-10-19T12:00:00Z" },
    },
    {
      kind: "workout",
      status: "active",
      data: { completedAt: "2026-10-20T12:00:00Z" },
    },
    {
      kind: "workout",
      status: "completed",
      data: { completedAt: "2026-10-18T12:00:00Z" },
    },
  ];
  assert.deepEqual(trainingWeek(rows, "2026-10-21"), {
    completed: 1,
    planned: 3,
    next: "2026-10-23",
  });
  assert.deepEqual(trainingWeek([], "2026-10-21"), {
    completed: 0,
    planned: 0,
    next: null,
  });
});

test("approved assisted messages count as unread; internal drafts and system notices do not", () => {
  const rows = [
    "digital_reviewed",
    "trainer_reviewed",
    "system",
    "digital_draft",
  ].map((author) => ({ created_at: "2026-10-19T10:00:00Z", data: { author } }));
  assert.equal(unreadCoachMessages(rows, null), 2);
  assert.equal(unreadCoachMessages(rows, "2026-10-19T10:01:00Z"), 0);
});
