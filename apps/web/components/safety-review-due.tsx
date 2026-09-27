"use client";

const when = (value: string) => {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "" : time.toLocaleString();
};
const policyLabel = (version: unknown) =>
  version ? `Safety policy v${version}` : "Built-in safety floor";

/** Trainer attention list: the review deadline and policy pinned on an exception. */
export function SafetyReviewDue({ data }: { data: any }) {
  if (!data?.reviewDueAt && !data?.overdueAt) return null;
  return (
    <p className="muted" style={{ marginBlock: 8 }}>
      {data.overdueAt ? (
        <>
          <span className="badge amber">Overdue</span> Review was due{" "}
          {when(data.escalation?.dueAt ?? data.reviewDueAt)}. The platform
          safety team can see this review.
        </>
      ) : (
        <>Review due by {when(data.reviewDueAt)}.</>
      )}{" "}
      {policyLabel(data.safetyPolicy?.version)}
      {data.screening?.reviewCategories?.length
        ? ` · topics: ${data.screening.reviewCategories.join(", ").replaceAll("_", " ")}`
        : ""}
    </p>
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
