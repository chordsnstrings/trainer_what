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
                  detail={`${latest?.cancellations ?? 0} paid cancellation(s) in ${latest ? monthLabel(latest.month) : "—"}${latest?.unpaidCancellations ? ` · ${latest.unpaidCancellations} unpaid trial(s) canceled` : ""}`} />
                <Tile label="Trial conversion (period)" value={percent(t.trialConversionRate)}
                  detail={`${t.trialsConverted} of ${t.trialsStarted} trials`} />
                <Tile label="AI and voice cost vs revenue" value={percent(t.costToRevenue)}
                  detail={`${aed(t.providerCostAedMinor)} of ${aed(t.platformRevenueMinor)}${t.unpricedRequests ? ` · ${t.unpricedRequests} unpriced` : ""}`} />
                <Tile label="Voice add-on MRR" value={aed(data.snapshot.voiceAddOns?.mrrMinor ?? 0)}
                  detail={`${data.snapshot.voiceAddOns?.active ?? 0} active add-on(s), included in MRR`} />
                <Tile label="Upfront programmes (current)" value={aed(data.snapshot.upfrontProgrammes?.collectedMinor ?? 0)}
                  detail={`${data.snapshot.upfrontProgrammes?.active ?? 0} active · ${aed(data.snapshot.upfrontProgrammes?.monthlyEquivalentMinor ?? 0)} a month equivalent, not MRR`} />
                <Tile label="AI cost (period)" value={`USD ${Number(t.aiCostUsd ?? 0).toFixed(2)}`}
                  detail={`Voice USD ${Number(t.voiceCostUsd ?? 0).toFixed(2)}${t.estimatedCostUsd ? ` · USD ${Number(t.estimatedCostUsd).toFixed(2)} estimated` : ""}${t.unpricedEstimateUsd ? ` · about USD ${Number(t.unpricedEstimateUsd).toFixed(2)} unpriced` : ""}`} />
                <Tile label="Domains (period)" value={aed(t.domainNetSalesMinor ?? 0)}
                  detail={`Net sales · ${aed(t.domainPaymentsMinor ?? 0)} paid, ${aed(t.domainRefundsMinor ?? 0)} refunded; not in platform revenue`} />
                <Tile label="Card disputes (period)" value={aed(t.disputeLossesMinor ?? 0)}
                  detail={`Lost · ${aed(t.disputesOpenedMinor ?? 0)} held when opened`} />
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
                        <th scope="col">Platform revenue</th>
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
                          <td>
                            {m.cancellations}
                            {m.unpaidCancellations ? (
                              <small className="muted"> +{m.unpaidCancellations} unpaid</small>
                            ) : null}
                          </td>
                          <td>{percent(m.churnRate)}</td>
                          <td>{m.trialsConverted}/{m.trialsStarted}</td>
                          <td>{aed(m.providerCostAedMinor)} <small className="muted">{percent(m.costToRevenue)}</small></td>
                          <td>{aed(m.platformRevenueMinor)}</td>
                          <td>{aed(m.payoutsPaidMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="card" aria-labelledby="monthly-products">
                <h2 id="monthly-products">Products, costs and domains</h2>
                <p className="muted">
                  What members paid for each product, what lost disputes took
                  back, costs charged back to trainers or absorbed, AI and voice
                  cost in US dollars (estimated part marked) at each
                  month&apos;s rate, and trainer domain sales. Domain profit and
                  a full profit and loss come in the next phase.
                </p>
                <div className="table-wrap" role="region" aria-labelledby="monthly-products" tabIndex={0}>
                  <table className="governance-table">
                    <thead>
                      <tr>
                        <th scope="col">Month</th>
                        <th scope="col">Memberships</th>
                        <th scope="col">Programmes</th>
                        <th scope="col">Voice add-on</th>
                        <th scope="col">1:1 sessions</th>
                        <th scope="col">Disputes lost</th>
                        <th scope="col">Usage charged back</th>
                        <th scope="col">Costs charged / absorbed</th>
                        <th scope="col">AI cost (USD)</th>
                        <th scope="col">Voice cost (USD)</th>
                        <th scope="col">Unpriced</th>
                        <th scope="col">USD rate</th>
                        <th scope="col">Domains (net)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...data.series, data.totals].map((m: any) => (
                        <tr key={m.month} className={m.month === "total" ? "governance-total" : ""}>
                          <th scope="row">{monthLabel(m.month)}</th>
                          <td>{aed(m.membershipGrossMinor ?? 0)}</td>
                          <td>{aed(m.programmeGrossMinor ?? 0)}</td>
                          <td>{aed(m.voiceAddOnGrossMinor ?? 0)}</td>
                          <td>{aed(m.bookingGrossMinor ?? 0)}</td>
                          <td>{aed(m.disputeLossesMinor ?? 0)}</td>
                          <td>{aed(m.usageRecoveryMinor ?? 0)}</td>
                          <td>
                            {aed(m.allocatedRecoveryMinor ?? 0)} /{" "}
                            {aed(m.absorbedCostsMinor ?? 0)}
                          </td>
                          <td>{Number(m.aiCostUsd ?? 0).toFixed(2)}</td>
                          <td>
                            {Number(m.voiceCostUsd ?? 0).toFixed(2)}
                            {m.estimatedCostUsd ? (
                              <small className="muted"> {Number(m.estimatedCostUsd).toFixed(2)} est.</small>
                            ) : null}
                          </td>
                          <td>
                            {m.unpricedRequests}
                            {m.unpricedEstimateUsd ? (
                              <small className="muted"> ~{Number(m.unpricedEstimateUsd).toFixed(2)}</small>
                            ) : null}
                          </td>
                          <td>
                            {m.aedPerUsd ?? "—"}
                            {m.fxSource === "default" ? (
                              <small className="muted"> default</small>
                            ) : null}
                          </td>
                          <td>{aed(m.domainNetSalesMinor ?? 0)}</td>
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
                      Provider costs in US dollars are converted at each
                      month&apos;s rate: {data.fx.basis}. Default rate:{" "}
                      {data.fx.aedPerUsd} AED per USD. Set a month&apos;s
                      reviewed rate under Payments and payouts (/admin/finance).
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
