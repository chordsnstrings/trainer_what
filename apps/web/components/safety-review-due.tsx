"use client";
import { useEffect, useState } from "react";

const when = (value: string) => {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "" : time.toLocaleString();
};
const policyLabel = (version: unknown) =>
  version ? `Safety policy v${version}` : "Built-in safety floor";

type Deadlines = { deadlines: Record<string, string> };
// One request serves every open review on the page; a review opened after
// the last load triggers one refresh.
let loaded: { at: number; promise: Promise<Deadlines> } | null = null;
function reviewDeadlines(force = false) {
  if (!loaded || force || Date.now() - loaded.at > 60_000)
    loaded = {
      at: Date.now(),
      promise: fetch("/api/v1/safety/review-deadlines", {
        credentials: "same-origin",
        cache: "no-store",
      })
        .then((r) => (r.ok ? r.json() : { deadlines: {} }))
        .catch(() => ({ deadlines: {} })),
    };
  return loaded.promise;
}

/**
 * Trainer attention list: the deadline that actually escalates this review
 * (the earlier of the pinned deadline and the current policy's), the policy
 * version pinned when it opened, and any follow-up questions it collected.
 */
export function SafetyReviewDue({ record }: { record: any }) {
  const data = record?.data;
  const [effective, setEffective] = useState<string | null>(null);
  const tracked =
    record?.id && !data?.overdueAt && (data?.reviewDueAt || data?.category);
  useEffect(() => {
    if (!tracked) return;
    let current = true;
    void reviewDeadlines().then(async (value) => {
      let due = value.deadlines[record.id];
      if (!due && loaded && Date.now() - loaded.at > 5_000)
        due = (await reviewDeadlines(true)).deadlines[record.id];
      if (current && due) setEffective(due);
    });
    return () => {
      current = false;
    };
  }, [record?.id, tracked]);
  if (!data?.reviewDueAt && !data?.overdueAt) return null;
  const followUps: any[] = Array.isArray(data.followUps) ? data.followUps : [];
  const earlier =
    effective &&
    data.reviewDueAt &&
    Date.parse(effective) < Date.parse(data.reviewDueAt) - 60_000;
  return (
    <>
      <p className="muted" style={{ marginBlock: 8 }}>
        {data.overdueAt ? (
          <>
            <span className="badge amber">Overdue</span> Review was due{" "}
            {when(data.escalation?.dueAt ?? data.reviewDueAt)}. The platform
            safety team can see this review.
          </>
        ) : (
          <>
            Review due by {when(effective ?? data.reviewDueAt)}
            {earlier ? " (a stricter safety policy now applies)" : ""}.
          </>
        )}{" "}
        {policyLabel(data.safetyPolicy?.version)}
        {data.screening?.floorCategories?.length
          ? ` · red flags: ${data.screening.floorCategories.join(", ").replaceAll("_", " ")}`
          : ""}
        {data.screening?.reviewCategories?.length
          ? ` · topics: ${data.screening.reviewCategories.join(", ").replaceAll("_", " ")}`
          : ""}
      </p>
      {followUps.length > 0 && (
        <details style={{ marginBlock: 8 }}>
          <summary>
            {Number(data.questionCount) > followUps.length + 1
              ? `${Number(data.questionCount) - 1} more questions from this client (latest ${followUps.length} shown)`
              : `${followUps.length} more question${followUps.length === 1 ? "" : "s"} from this client`}
          </summary>
          <ul style={{ paddingInlineStart: "1.25rem", marginBlock: 8 }}>
            {followUps.map((q, i) => (
              <li key={i} style={{ overflowWrap: "anywhere" }}>
                {q.text} <small className="muted">{when(q.askedAt)}</small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

/** Operator safety queue summary line. */
export function SafetyQueueDue({ row }: { row: any }) {
  if (!row.review_due_at && !row.overdue_at) return null;
  return (
    <span>
      {" · "}
      {row.overdue_at
        ? `overdue since ${when(row.overdue_at)}`
        : `due ${when(row.review_due_at)}`}
      {" · "}
      {policyLabel(row.policy_version)}
    </span>
  );
}
