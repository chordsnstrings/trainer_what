import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDatabase, type Actor } from "@trainer/db";
import { trainingAdherence } from "../packages/domain/src/client-twin.ts";
import { addTrainingDays } from "../packages/domain/src/coaching-completion.ts";
import { currentClientTwin } from "../apps/api/src/client-twin.ts";
import { TrainingScheduleSummary } from "../apps/web/components/client-twin.tsx";

const now = new Date("2026-03-08T04:30:00Z"),
  programId = randomUUID();
function plan(date: string, status = "planned", timezone = "America/New_York") {
  return {
    id: randomUUID(),
    kind: "planned_session",
    status,
    created_at: now,
    data: {
      date,
      timezone,
      programId,
      week: 1,
      label: "Recorded session",
      workoutId: null as string | null,
    },
  };
}
function workout(
  p: ReturnType<typeof plan>,
  status: string,
  completedAt?: string,
) {
  const id = randomUUID();
  p.data.workoutId = id;
  return {
    id,
    kind: "workout",
    status,
    created_at: now,
    data: {
      plannedSessionId: p.id,
      programId,
      ...(completedAt ? { completedAt } : {}),
    },
  };
}
test("schedule uses each local calendar day and credits only verified completion links", () => {
  const future = plan("2026-03-08"),
    today = plan("2026-03-08", "planned", "Asia/Tokyo"),
    missed = plan("2026-03-06"),
    canceled = plan("2026-03-06", "canceled"),
    completed = plan("2026-03-05", "completed"),
    held = plan("2026-03-06", "started"),
    active = plan("2026-03-06", "started"),
    abandoned = plan("2026-03-06", "abandoned"),
    broken = plan("2026-03-06", "completed"),
    invalidTime = plan("2026-03-08", "completed"),
    outside = plan("2026-04-20");
  const completedWorkout = workout(
    completed,
    "completed",
    "2026-03-05T18:00:00Z",
  );
  const wrongLink = workout(broken, "completed", "2026-03-06T18:00:00Z");
  wrongLink.data.plannedSessionId = randomUUID();
  const input = {
    now,
    plannedSessions: [
      future,
      today,
      missed,
      canceled,
      completed,
      held,
      active,
      abandoned,
      broken,
      invalidTime,
      outside,
    ],
    linkedWorkouts: [
      completedWorkout,
      workout(held, "safety_hold"),
      workout(active, "active"),
      wrongLink,
      workout(invalidTime, "completed", "2026-03-09T12:00:00Z"),
      {
        id: randomUUID(),
        kind: "workout",
        status: "completed",
        created_at: now,
        data: { programId },
      },
    ],
  };
  const result = trainingAdherence(input),
    state = (id: string) => result.sessions.find((row) => row.id === id)?.state;
  assert.equal(state(future.id), "upcoming");
  assert.equal(state(today.id), "scheduled");
  assert.equal(state(missed.id), "missed");
  assert.equal(state(canceled.id), "canceled");
  assert.equal(state(completed.id), "completed");
  assert.equal(state(held.id), "held");
  assert.equal(state(active.id), "in_progress");
  assert.equal(state(abandoned.id), "abandoned");
  assert.equal(state(broken.id), "unverified");
  assert.equal(state(invalidTime.id), "unverified");
  assert.equal(state(outside.id), undefined);
  assert.equal(result.counts.completed, 1);
  assert.equal(result.counts.missed, 1);
  assert.equal(result.partial, true);
  assert.deepEqual(
    result.sessions.find((row) => row.id === completed.id)?.sourceRecordIds,
    [completed.id, completedWorkout.id],
  );
  assert.equal(
    result.window.timezones.find((row) => row.timezone === "America/New_York")
      ?.from,
    "2026-02-08",
  );
  const afterDst = trainingAdherence({
    ...input,
    now: new Date("2026-03-09T03:30:00Z"),
  });
  assert.equal(
    afterDst.sessions.find((row) => row.id === future.id)?.state,
    "scheduled",
    "A 23-hour DST day is still its local calendar date",
  );
  const html = renderToStaticMarkup(
    createElement(TrainingScheduleSummary, {
      adherence: result,
      subscriber: true,
    }),
  );
  assert.match(html, /Planned training and progress/);
  assert.match(html, /Evidence needs review/);
  assert.match(html, new RegExp(`/app/workouts/${completedWorkout.id}`));
  assert.match(html, /2026-03-08/);
  assert.match(html, /America\/New_York/);
  const trainerHtml = renderToStaticMarkup(
    createElement(TrainingScheduleSummary, { adherence: result }),
  );
  assert.match(trainerHtml, /Completed workout:/);
  assert.doesNotMatch(trainerHtml, /href="\/app\/workouts\//);
});

test("Twin includes the whole current revised block, old linked completions, and scoped rolling evidence", async () => {
  const db = await createDatabase({ memory: true });
  const owner: Actor = {
      tenantId: randomUUID(),
      userId: randomUUID(),
      role: "owner",
    },
    foreign: Actor = {
      tenantId: randomUUID(),
      userId: randomUUID(),
      role: "owner",
    },
    client: Actor = { ...owner, userId: randomUUID(), role: "subscriber" };
  const today = new Date().toISOString().slice(0, 10);
  const save = async (
    actor: Actor,
    id: string,
    kind: string,
    status: string,
    data: unknown,
    daysAgo = 0,
  ) =>
    db.tenant(actor, (tx) =>
      tx.query(
        "INSERT INTO records(id,tenant_id,owner_user_id,kind,status,data,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)",
        [
          id,
          actor.tenantId,
          client.userId,
          kind,
          status,
          JSON.stringify(data),
          new Date(Date.now() - daysAgo * 86400000),
        ],
      ),
    );
  try {
    await db.system(async (tx) => {
      for (const actor of [owner, foreign, client])
        await tx.query(
          "INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,'Adherence fixture','unused')",
          [actor.userId, actor.userId + "@example.test"],
        );
      for (const actor of [owner, foreign])
        await tx.query(
          "INSERT INTO tenants(id,slug,name) VALUES($1,$2,'Adherence fixture')",
          [actor.tenantId, actor.tenantId],
        );
      for (const actor of [owner, foreign, client])
        await tx.query(
          "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)",
          [actor.tenantId, actor.userId, actor.role],
        );
    });
    const original = randomUUID(),
      current = randomUUID();
    await save(
      owner,
      original,
      "program",
      "archived",
      { title: "Original block", weeks: 6, daysPerWeek: 1 },
      70,
    );
    await save(
      owner,
      current,
      "program",
      "assigned",
      {
        title: "Current revised block",
        weeks: 6,
        daysPerWeek: 1,
        previousProgramId: original,
      },
      10,
    );
    const oldCompletions: string[] = [];
    for (const [i, offset] of [-50, -43, -36, -3, 2, 9].entries()) {
      const id = randomUUID(),
        wid = i < 2 ? randomUUID() : null,
        pid = i < 3 ? original : current;
      const date = addTrainingDays(today, offset);
      await save(
        owner,
        id,
        "planned_session",
        i < 2 ? "completed" : "planned",
        {
          date,
          timezone: "Asia/Dubai",
          programId: pid,
          week: i + 1,
          label: "Block session",
          workoutId: wid,
        },
        65,
      );
      if (wid) {
        oldCompletions.push(wid);
        await save(
          owner,
          wid,
          "workout",
          "completed",
          {
            programId: pid,
            plannedSessionId: id,
            completedAt: date + "T12:00:00Z",
          },
          Math.abs(offset),
        );
      }
    }
    const foreignWorkout = randomUUID(),
      unverified = randomUUID();
    await save(owner, unverified, "planned_session", "completed", {
      date: addTrainingDays(today, -2),
      timezone: "Asia/Dubai",
      programId: randomUUID(),
      workoutId: foreignWorkout,
      label: "Unverified legacy session",
    });
    await save(foreign, foreignWorkout, "workout", "completed", {
      plannedSessionId: unverified,
      programId: current,
      marker: "FOREIGN_PRIVATE",
      completedAt: today + "T00:00:00Z",
    });
    const twin = await db.tenant(client, (tx) =>
      currentClientTwin(tx, client, client.userId),
    );
    const adherence = twin.data.coaching.adherence,
      block = adherence.currentBlock;
    assert.equal(block.programId, current);
    assert.equal(block.complete, true);
    assert.equal(block.expectedSessions, 6);
    assert.equal(block.plannedSessions, 6);
    assert.deepEqual(block.sourceRecordIds, [current, original]);
    assert.equal(block.from, addTrainingDays(today, -50));
    assert.equal(block.through, addTrainingDays(today, 9));
    assert.equal(block.counts.completed, 2);
    assert.equal(block.counts.missed, 2);
    assert.equal(block.counts.upcoming, 2);
    assert.deepEqual(
      new Set(
        block.sessions.flatMap((row: any) =>
          row.completion ? [row.completion.workoutId] : [],
        ),
      ),
      new Set(oldCompletions),
    );
    assert.equal(adherence.counts.completed, 0);
    assert.equal(adherence.counts.missed, 1);
    assert.equal(adherence.counts.unverified, 1);
    assert.equal(
      adherence.sessions.find((row: any) => row.id === unverified).workoutId,
      null,
    );
    assert.equal(JSON.stringify(twin.data).includes("FOREIGN_PRIVATE"), false);
    assert.deepEqual(twin.data.coaching.allowedUses, ["render"]);
    const legacy = randomUUID();
    await save(owner, legacy, "program", "assigned", {
      title: "Legacy block without schedule metadata",
    });
    const incomplete = await db.tenant(client, (tx) =>
      currentClientTwin(tx, client, client.userId),
    );
    assert.equal(
      incomplete.data.coaching.adherence.currentBlock.programId,
      legacy,
    );
    assert.equal(
      incomplete.data.coaching.adherence.currentBlock.complete,
      false,
    );
    assert.equal(
      incomplete.data.coaching.adherence.currentBlock.expectedSessions,
      null,
    );
  } finally {
    await db.close();
  }
});
