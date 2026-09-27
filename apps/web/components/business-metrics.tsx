"use client";
import { useCallback, useEffect, useState } from "react";
import { Field } from "./field";
import {
  GovernanceError,
  GovernanceLinks,
  aed,
  governanceApi,
  percent,
  when,
} from "./governance-shared";

type Failure = { message: string; code?: string } | null;
const monthLabel = (month: string) =>
  month === "total"
    ? "Window total"
    : new Intl.DateTimeFormat("en-GB", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(month + "-01T00:00:00Z"));

/** Executive business metrics for Super admin and finance (/admin/metrics). */
export function BusinessMetrics({ platformRole }: { platformRole: string }) {
  const [months, setMonths] = useState(12),
    [data, setData] = useState<any>(null),
    [error, setError] = useState<Failure>(null);
  const allowed = ["admin", "finance"].includes(platformRole);
  const load = useCallback(async () => {
    setError(null);
    setData(await governanceApi("/admin/metrics?months=" + months));
  }, [months]);
  useEffect(() => {
    if (allowed) load().catch(setError);
  }, [allowed, load]);
  const latest = data?.series?.at(-1);
  const t = data?.totals;
  return (
    <div className="governance">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PLATFORM FINANCE</p>
          <h1>Business metrics.</h1>
          <p className="muted">
            Computed read-only from the ledger, memberships and provider cost
            records in AED, by Asia/Dubai calendar month. Every view is audited.
          </p>
        </div>
      </div>
      <GovernanceLinks platformRole={platformRole} />
      {!allowed ? (
        <div className="notice error" role="alert">
          Super admin or platform finance access is required for this screen.
        </div>
      ) : (
        <>
          <div className="governance-filters">
            <Field label="Period">
              <select
                value={months}
                onChange={(e) => setMonths(Number(e.target.value))}
              >
                {[3, 6, 12, 24, 36].map((n) => (
                  <option key={n} value={n}>
                    Last {n} months
                  </option>
                ))}
              </select>
            </Field>
            <a
              className="button secondary"
              href={`/api/v1/admin/metrics.csv?months=${months}`}
              download
            >
              Download CSV
            </a>
          </div>
          <GovernanceError error={error} />
          {!data ? (
            !error && <p>Loading metrics…</p>
          ) : (
            <>
              <p className="muted">As of {when(data.asOf)}.</p>
              <div className="stats-grid governance-stats">
                <Tile label="Active trainers" value={String(data.snapshot.trainers.active)}
                  detail={`${data.snapshot.trainers.published} published · ${data.snapshot.trainers.suspended} suspended`} />
                <Tile label="Followers" value={String(data.snapshot.followers)}
                  detail={`${data.snapshot.memberships.active} active memberships`} />
                <Tile label="Monthly recurring revenue" value={aed(data.snapshot.mrrMinor)}
                  detail={`${data.snapshot.memberships.pendingCancellations} ending at period end`} />
                <Tile label="Gross takings (period)" value={aed(t.grossMinor)}
                  detail={`Refunds ${percent(t.refundRate)}`} />
                <Tile label="Platform commission (period)" value={aed(t.commissionMinor)}
                  detail={`Take rate ${percent(t.takeRate)}`} />
                <Tile label="Churn (latest month)" value={percent(latest?.churnRate)}
                  detail={`${latest?.cancellations ?? 0} cancellation(s) in ${latest ? monthLabel(latest.month) : "—"}`} />
                <Tile label="Trial conversion (period)" value={percent(t.trialConversionRate)}
                  detail={`${t.trialsConverted} of ${t.trialsStarted} trials`} />
                <Tile label="AI and voice cost vs revenue" value={percent(t.costToRevenue)}
                  detail={`${aed(t.providerCostAedMinor)} of ${aed(t.platformRevenueMinor)}${t.unpricedRequests ? ` · ${t.unpricedRequests} unpriced` : ""}`} />
              </div>
              <section className="card" aria-labelledby="membership-tiers">
                <h2 id="membership-tiers">Active memberships by tier</h2>
                <div className="table-wrap" role="region" aria-labelledby="membership-tiers" tabIndex={0}>
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Tier</th>
                        <th scope="col">Active</th>
                        <th scope="col">Trialing</th>
                        <th scope="col">Past due</th>
                        <th scope="col">Monthly recurring</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["workout", "Workout"],
                        ["workout_nutrition", "Workout + nutrition"],
                      ].map(([key, label]) => {
                        const tier = data.snapshot.memberships.byTier[key];
                        return (
                          <tr key={key}>
                            <th scope="row">{label}</th>
                            <td>{tier.active}</td>
                            <td>{tier.trialing}</td>
                            <td>{tier.pastDue}</td>
                            <td>{aed(tier.mrrMinor)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="card" aria-labelledby="monthly-metrics">
                <h2 id="monthly-metrics">Monthly series</h2>
                <div className="table-wrap" role="region" aria-labelledby="monthly-metrics" tabIndex={0}>
                  <table className="governance-table">
                    <thead>
                      <tr>
                        <th scope="col">Month</th>
                        <th scope="col">Gross takings</th>
                        <th scope="col">Refunds</th>
                        <th scope="col">Commission</th>
                        <th scope="col">Take rate</th>
                        <th scope="col">Paying</th>
                        <th scope="col">New</th>
                        <th scope="col">Canceled</th>
                        <th scope="col">Churn</th>
                        <th scope="col">Trials converted</th>
                        <th scope="col">AI + voice cost</th>
                        <th scope="col">Payouts paid</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.series, data.totals].map((m: any) => (
                        <tr key={m.month} className={m.month === "total" ? "governance-total" : ""}>
                          <th scope="row">{monthLabel(m.month)}</th>
                          <td>{aed(m.grossMinor)}</td>
                          <td>{aed(m.refundsMinor)} <small className="muted">{percent(m.refundRate)}</small></td>
                          <td>{aed(m.commissionMinor)}</td>
                          <td>{percent(m.takeRate)}</td>
                          <td>{m.payingMembers ?? "—"}</td>
                          <td>{m.newPayingMembers}</td>
                          <td>{m.cancellations}</td>
                          <td>{percent(m.churnRate)}</td>
                          <td>{m.trialsConverted}/{m.trialsStarted}</td>
                          <td>{aed(m.providerCostAedMinor)} <small className="muted">{percent(m.costToRevenue)}</small></td>
                          <td>{aed(m.payoutsPaidMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="card" aria-labelledby="payout-status">
                <h2 id="payout-status">Payout instructions by status</h2>
                {Object.keys(data.snapshot.payouts).length === 0 ? (
                  <p className="muted">No payout instructions yet.</p>
                ) : (
                  <ul className="governance-history">
                    {Object.entries(data.snapshot.payouts).map(([status, p]: [string, any]) => (
                      <li key={status}>
                        {status}: {p.count} · {aed(p.amountMinor)}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <details className="card">
                <summary>How each figure is defined</summary>
                <dl className="governance-definitions">
                  {Object.entries(data.definitions).map(([key, text]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{String(text)}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Currency conversion</dt>
                    <dd>
                      Provider costs in US dollars are converted at {data.fx.aedPerUsd} AED
                      ({data.fx.basis}).
                    </dd>
                  </div>
                </dl>
              </details>
            </>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="card stat">
      <span className="small-label">{label}</span>
      <strong>{value}</strong>
      <span className="muted">{detail}</span>
    </section>
  );
}
