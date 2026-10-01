"use client";
// "Getting better": how the coach's Brain improves week by week (GET
// /api/v1/brain/progress, docs/features/brain-learning.md). Coach-only; never
// shown to members or on public pages.
import { useEffect, useState } from "react";

type Week = {
  week: string;
  plans: { reviewed: number; generated: number };
  replies: { reviewed: number; drafts: number };
  approvedWithoutEdits: number | null;
  handOffRate: { plans: number | null; replies: number | null };
  medianEditSize: { planChanges: number | null; replyWordsChanged: number | null };
  heldOutPassRate: number | null;
};
type Progress = {
  weeks: Week[];
  checks: Array<{ area: string; id: string; createdAt: string; passed: number; total: number; passRate: number | null }>;
  learning: { liveSnapshot: { examples: number; since: string } | null; waiting: number };
};
const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
const AREAS: Record<string, string> = {
  replies: "Brain replies",
  actions: "Routine replies",
  plans: "Plans",
  nutrition: "Nutrition",
};

export function BrainProgress() {
  const [data, setData] = useState<Progress | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/v1/brain/progress", { credentials: "same-origin" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.message ?? "Request failed");
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading how your Brain is doing…</p>;
  return (
    <section className="card" aria-labelledby="brain-progress-title">
      <h2 id="brain-progress-title">Getting better</h2>
      <p className="muted">
        Only you and your team see this. It is never shown to clients or used on public pages.
      </p>
      <p>
        {data.learning.liveSnapshot
          ? `Your Brain uses ${data.learning.liveSnapshot.examples} checked plan reviews.`
          : "Your Brain has no checked plan reviews in use yet."}{" "}
        {data.learning.waiting > 0 &&
          `${data.learning.waiting} newer review${data.learning.waiting === 1 ? "" : "s"} will be checked this week before they are used.`}
      </p>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">The last 8 weeks</caption>
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col">Approved without edits</th>
              <th scope="col">Plans sent to you</th>
              <th scope="col">Replies handed to you</th>
              <th scope="col">Typical plan edit (fields)</th>
              <th scope="col">Typical reply edit (words)</th>
              <th scope="col">Held-out checks passed</th>
            </tr>
          </thead>
          <tbody>
            {data.weeks.map((w) => (
              <tr key={w.week}>
                <th scope="row">{w.week}</th>
                <td>{pct(w.approvedWithoutEdits)}</td>
                <td>{pct(w.handOffRate.plans)}</td>
                <td>{pct(w.handOffRate.replies)}</td>
                <td>{w.medianEditSize.planChanges ?? "–"}</td>
                <td>{pct(w.medianEditSize.replyWordsChanged)}</td>
                <td>{pct(w.heldOutPassRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.checks.length > 0 && (
        <>
          <h3>Checks by version</h3>
          <ul>
            {data.checks.slice(0, 8).map((c) => (
              <li key={c.id}>
                {AREAS[c.area] ?? c.area}: {c.passed} of {c.total} passed ({new Date(c.createdAt).toLocaleDateString()})
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
