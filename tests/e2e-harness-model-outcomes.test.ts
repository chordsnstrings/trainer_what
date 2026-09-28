import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeModelOutcomes } from "./e2e/harness/model-outcomes.ts";
import type { ModelCall } from "./e2e/mocks/model.ts";

const tenant = "11111111-1111-4111-8111-111111111111";
const decision = "22222222-2222-4222-8222-222222222222";
const rule = "33333333-3333-4333-8333-333333333333";

test("model outcomes link each call to its usage row, trigger, step, events and records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "model-outcomes-"));
  try {
    const t0 = Date.parse("2026-09-28T10:00:00.000Z");
    const iso = (ms: number) => new Date(t0 + ms).toISOString();
    const calls: ModelCall[] = [
      {
        n: 1,
        kind: "coach_decision",
        task: "coaching",
        hash: "h1",
        source: "replay",
        status: 200,
        at: iso(1000),
        placeholders: { "{{uuid:1}}": rule },
      },
      {
        n: 2,
        kind: "coach_decision",
        task: "coaching",
        hash: "h2",
        source: "rules",
        status: 200,
        at: iso(5000),
        placeholders: {},
      },
      {
        n: 3,
        kind: "meal_photo",
        task: "meal_photo_estimate",
        hash: "h3",
        source: "rules",
        status: 404,
        at: iso(9000),
        placeholders: {},
      },
    ];
    const queries: string[] = [];
    const read = async (sql: string, params: unknown[] = []): Promise<any[]> => {
      queries.push(sql);
      if (sql.includes("FROM cost_events"))
        return [1, 2].map((n) => ({
          trace_id: `chatcmpl-mock-${n}`,
          tenant_id: tenant,
          tenant: "layla-strength",
          user_id: "u",
          task: "coaching",
          status: "recorded",
          input_tokens: 10 * n,
          output_tokens: n,
          created_at: new Date(t0 + (n === 1 ? 900 : 4900)),
        }));
      if (sql.includes("FROM events")) {
        const [, from, to] = params as [string, Date, Date];
        const all = [
          {
            name: "coaching.review_required",
            subject_id: decision,
            actor_id: "u",
            data: {},
            created_at: new Date(t0 + 1500),
          },
          { name: "later", subject_id: null, actor_id: "u", data: {}, created_at: new Date(t0 + 6000) },
        ];
        return all.filter((e) => e.created_at >= from && e.created_at < to);
      }
      if (sql.includes("FROM records") && sql.includes("LIMIT"))
        return (params[3] as string[]).includes(decision)
          ? [
              {
                id: decision,
                kind: "decision",
                status: "pending_review",
                owner_user_id: "u",
                version: 1,
                created_at: new Date(t0 + 1400),
                updated_at: new Date(t0 + 1400),
                data: { message: "x".repeat(30000) },
              },
            ]
          : [];
      if (sql.includes("FROM records"))
        return (params[1] as string[]).includes(rule) ? [{ id: rule, kind: "rule", status: "confirmed" }] : [];
      return [];
    };
    const path = join(dir, "outcomes.jsonl");
    const written = await writeModelOutcomes(
      path,
      calls,
      [
        {
          id: "followers:Ask:q",
          audience: "followers",
          feature: "Ask",
          title: "q",
          status: "pass",
          durationMs: 3000,
          startedAt: iso(0),
        },
      ],
      [
        {
          who: "member",
          method: "POST",
          path: "/api/v1/coaching/ask",
          status: 200,
          startedAt: iso(800),
          endedAt: iso(1600),
          body: '{"pendingReview":true}',
        },
        {
          who: "trainer",
          method: "GET",
          path: "/api/v1/exceptions",
          status: 200,
          startedAt: iso(2000),
          endedAt: iso(2100),
          body: "[]",
        },
      ],
      read,
    );
    assert.equal(written, 3);
    const [first, second, third] = readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(first.usage.tenant, "layla-strength");
    assert.equal(first.step.id, "followers:Ask:q");
    assert.equal(first.trigger[0].path, "/api/v1/coaching/ask");
    assert.deepEqual(
      first.following.map((x: any) => x.path),
      ["/api/v1/exceptions"],
    );
    // The window closes at the workspace's next reservation, so the later event belongs to call 2.
    assert.equal(first.window.closedBy, "next model call in this workspace");
    assert.deepEqual(
      first.events.map((e: any) => e.name),
      ["coaching.review_required"],
    );
    assert.equal(first.records[0].kind, "decision");
    assert.equal(first.records[0].data.truncated, true);
    assert.deepEqual(first.inputs, [{ placeholder: "{{uuid:1}}", id: rule, kind: "rule", status: "confirmed" }]);
    assert.deepEqual(
      second.events.map((e: any) => e.name),
      ["later"],
    );
    assert.equal(second.step, null);
    // A call the app never recorded usage for (here a 404 from the double) keeps its call data only.
    assert.equal(third.usage, null);
    assert.equal(third.events, undefined);
    assert.ok(queries.every((q) => /^\s*select\b/i.test(q)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
