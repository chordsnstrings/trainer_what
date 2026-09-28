"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Field } from "./field";
import { PayoutFeeForm, PlatformCostsView } from "./platform-finance-costs";
import {
  GovernanceError,
  GovernanceLinks,
  aed,
  governanceApi,
  percent,
  usd,
  when,
} from "./governance-shared";

// The Super admin's Platform finance screen (/admin/platform-finance,
// docs/features/platform-finance.md): profit and loss by month, per trainer,
// feature and provider, domains, payouts, cost against income, and CSV
// exports. Platform-only data for admin and finance operators.

type Failure = { message: string; code?: string } | null;
const DUBAI_OFFSET_MS = 4 * 3600000;
const thisMonth = () =>
  new Date(Date.now() + DUBAI_OFFSET_MS).toISOString().slice(0, 7);
const shift = (month: string, by: number) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
};
const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(month + "-01T00:00:00Z"));
/** A domain amount in the currency it was charged in. */
const inCurrency = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100);
const signed = (minor: number | null) =>
  minor === null ? "—" : (minor > 0 ? "+" : "") + aed(minor);

type Period = "month" | "quarter" | "ytd" | "custom";
function rangeFor(period: Period, month: string, custom: { from: string; to: string }) {
  if (period === "month") return { from: month, to: month };
  if (period === "quarter") {
    const [y, m] = month.split("-").map(Number);
    const start = Math.floor((m - 1) / 3) * 3 + 1;
    const from = `${y}-${String(start).padStart(2, "0")}`;
    return { from, to: shift(from, 2) };
  }
  if (period === "ytd") return { from: month.slice(0, 4) + "-01", to: month };
  return custom;
}

const TABS = [
  ["pnl", "Profit and loss"],
  ["trainers", "Trainers"],
  ["features", "Features"],
  ["providers", "Providers"],
  ["domains", "Domains"],
  ["payouts", "Payouts"],
  ["flags", "Cost against income"],
  ["costs", "Platform costs"],
] as const;
type Tab = (typeof TABS)[number][0];

export function PlatformFinance({ platformRole }: { platformRole: string }) {
  const allowed = ["admin", "finance"].includes(platformRole);
  const [period, setPeriod] = useState<Period>("month"),
    [month, setMonth] = useState(thisMonth()),
    [custom, setCustom] = useState({ from: shift(thisMonth(), -5), to: thisMonth() }),
    [tab, setTab] = useState<Tab>("pnl"),
    [data, setData] = useState<any>(null),
    [error, setError] = useState<Failure>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const range = rangeFor(period, month, custom);
  const query = `from=${range.from}&to=${range.to}`;
  const load = useCallback(async () => {
    setError(null);
    setData(await governanceApi(`/admin/platform-finance?${query}`));
  }, [query]);
  useEffect(() => {
    if (allowed) load().catch(setError);
  }, [allowed, load]);
  const act = async (label: string, fn: () => Promise<any>) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const result = await fn();
      await load();
      setNotice(label + (result?.rows !== undefined ? ` (${result.rows} rows)` : ""));
    } catch (e) {
      setError(e as Failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="governance platform-finance">
      <div className="page-heading">
        <div>
          <p className="eyebrow">PLATFORM FINANCE</p>
          <h1>Profit and loss.</h1>
          <p className="muted">
            Income, costs and profit across every trainer, in AED by Asia/Dubai
            month. Income counts when it is received. Every view and export is
            audited.
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
              <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                <option value="month">Month</option>
                <option value="quarter">Quarter</option>
                <option value="ytd">Year to date</option>
                <option value="custom">Custom range</option>
              </select>
            </Field>
            {period === "custom" ? (
              <>
                <Field label="From">
                  <input
                    type="month"
                    value={custom.from}
                    onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })}
                  />
                </Field>
                <Field label="To">
                  <input
                    type="month"
                    value={custom.to}
                    onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })}
                  />
                </Field>
              </>
            ) : (
              <Field label={period === "month" ? "Month" : "Month in the period"}>
                <input
                  type="month"
                  value={month}
                  onChange={(e) => e.target.value && setMonth(e.target.value)}
                />
              </Field>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void act("Summary rebuilt", () =>
                  governanceApi("/admin/platform-finance/rebuild", "POST", range),
                )
              }
            >
              {busy ? "Working…" : "Rebuild summary"}
            </button>
          </div>
          <GovernanceError error={error} />
          {notice && (
            <p className="notice success" role="status">
              {notice}
            </p>
          )}
          {!data ? (
            !error && <p>Loading platform finance…</p>
          ) : (
            <>
              <p className="muted">
                {monthLabel(data.range.from)}
                {data.range.to !== data.range.from && ` to ${monthLabel(data.range.to)}`}
                . Summary built {when(data.summary.computedAt)}.{" "}
                {data.basis}
              </p>
              {data.summary.missingMonths.length > 0 && (
                <div className="notice" role="status">
                  The summary has not been built for{" "}
                  {data.summary.missingMonths.map(monthLabel).join(", ")} yet, so
                  those months show no figures. Rebuild the summary to include
                  them.
                </div>
              )}
              <div className="stats-grid governance-stats">
                <Tile label="Income" value={aed(data.total.incomeMinor)}
                  detail="Commission, AI Coach Service Fee, domains and costs charged" />
                <Tile label="Costs" value={aed(data.total.costsMinor)}
                  detail={`Of which ${aed(data.total.estimatedCostMinor)} estimated`} />
                <Tile label="Profit" value={aed(data.total.profitMinor)}
                  detail={`Margin ${percent(data.total.margin)}`} />
                <Tile label="Cost against income" value={String(data.flags.filter((f: any) => f.severity === "warning").length)}
                  detail={`${data.flags.length} flag(s); no budget limits apply`} />
              </div>
              <div role="tablist" aria-label="Platform finance views" className="button-row">
                {TABS.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`pf-tab-${id}`}
                    aria-selected={tab === id}
                    aria-controls={`pf-panel-${id}`}
                    className={tab === id ? "button" : "button secondary"}
                    onClick={() => setTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <section
                className="card"
                role="tabpanel"
                id={`pf-panel-${tab}`}
                aria-labelledby={`pf-tab-${tab}`}
              >
                <div className="button-row">
                  <a
                    className="button secondary"
                    href={`/api/v1/admin/platform-finance/export/${tab === "costs" ? "costs" : tab}.csv?${query}`}
                    download
                  >
                    Download this view (CSV)
                  </a>
                  <a className="button secondary" href={`/api/v1/admin/platform-finance/export/ledger.csv?${query}`} download>
                    Full ledger (CSV)
                  </a>
                  <a className="button secondary" href={`/api/v1/admin/platform-finance/export/costs.csv?${query}`} download>
                    All costs (CSV)
                  </a>
                </div>
                {tab === "pnl" && <PnlView data={data} />}
                {tab === "trainers" && <TrainersView rows={data.trainers} />}
                {tab === "features" && <FeaturesView rows={data.features} />}
                {tab === "providers" && <ProvidersView rows={data.providers} />}
                {tab === "domains" && (
                  <DomainsView
                    domains={data.domains}
                    busy={busy}
                    onCheck={() =>
                      void act("Registrar balance read", () =>
                        governanceApi("/admin/platform-finance/registrar-balance", "POST", {}),
                      )
                    }
                  />
                )}
                {tab === "payouts" && <PayoutsView rows={data.payouts} onChanged={load} />}
                {tab === "flags" && <FlagsView rows={data.flags} />}
                {tab === "costs" && <PlatformCostsView range={range} onChanged={load} />}
              </section>
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
      <strong>
        <span dir="ltr">{value}</span>
      </strong>
      <span className="muted">{detail}</span>
    </section>
  );
}
function Table({ label, head, children }: { label: string; head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
const Money = ({ minor }: { minor: number | null | undefined }) => (
  <span dir="ltr">{aed(minor)}</span>
);

function PnlView({ data }: { data: any }) {
  const months: any[] = data.months;
  const lines = (side: "income" | "costs") => data.total[side] as any[];
  return (
    <>
      <h2>Profit and loss</h2>
      <Table label="Profit and loss by month" head={["Line", ...months.map((m) => monthLabel(m.month)), "Period total"]}>
        {(["income", "costs"] as const).map((side) => (
          <PnlSide key={side} side={side} months={months} lines={lines(side)} total={data.total} />
        ))}
        <tr>
          <th scope="row">Profit</th>
          {months.map((m) => (
            <td key={m.month}>
              <strong><Money minor={m.profitMinor} /></strong>
            </td>
          ))}
          <td>
            <strong><Money minor={data.total.profitMinor} /></strong>
          </td>
        </tr>
        <tr>
          <th scope="row">Margin</th>
          {months.map((m) => (
            <td key={m.month}>{percent(m.margin)}</td>
          ))}
          <td>{percent(data.total.margin)}</td>
        </tr>
      </Table>
      <h3>Monthly summary and change on the month before</h3>
      <Table label="Monthly summary" head={["Month", "Income", "Costs", "Profit", "Profit change", "AED per USD", "Estimated cost", "Unpriced calls"]}>
        {months.map((m) => (
          <tr key={m.month}>
            <th scope="row">{monthLabel(m.month)}</th>
            <td><Money minor={m.incomeMinor} /></td>
            <td><Money minor={m.costsMinor} /></td>
            <td><Money minor={m.profitMinor} /></td>
            <td><span dir="ltr">{signed(m.change.profitMinor)}</span></td>
            <td>
              {m.rate.aedPerUsd} {m.rate.source === "reviewed" ? "(reviewed)" : "(default)"}
            </td>
            <td><Money minor={m.estimatedCostMinor} /></td>
            <td>{m.unpricedCalls}</td>
          </tr>
        ))}
      </Table>
      {months.some((m) => m.notes.length) && (
        <>
          <h3>Notes</h3>
          <ul>
            {months.flatMap((m) =>
              m.notes.map((n: string, i: number) => (
                <li key={m.month + i}>
                  {monthLabel(m.month)}: {n}
                </li>
              )),
            )}
          </ul>
        </>
      )}
    </>
  );
}
function PnlSide({ side, months, lines, total }: { side: "income" | "costs"; months: any[]; lines: any[]; total: any }) {
  return (
    <>
      <tr>
        <th scope="rowgroup" colSpan={months.length + 2}>
          {side === "income" ? "Income" : "Costs"}
        </th>
      </tr>
      {lines.map((l) => (
        <tr key={l.key}>
          <th scope="row">{l.label}</th>
          {months.map((m) => (
            <td key={m.month}>
              <Money minor={m[side].find((x: any) => x.key === l.key)?.aedMinor ?? 0} />
            </td>
          ))}
          <td><Money minor={l.aedMinor} /></td>
        </tr>
      ))}
      <tr>
        <th scope="row">{side === "income" ? "Total income" : "Total costs"}</th>
        {months.map((m) => (
          <td key={m.month}>
            <strong><Money minor={side === "income" ? m.incomeMinor : m.costsMinor} /></strong>
          </td>
        ))}
        <td>
          <strong><Money minor={side === "income" ? total.incomeMinor : total.costsMinor} /></strong>
        </td>
      </tr>
    </>
  );
}
function TrainersView({ rows }: { rows: any[] }) {
  if (!rows.length) return <p>No trainer activity in this period.</p>;
  return (
    <>
      <h2>Contribution per trainer</h2>
      <p className="muted">
        Platform income from each trainer (net commission, AI Coach Service
        Fee, costs charged and domain payments) against what serving them cost
        (AI and voice, registrar, refunds and disputes). Lowest contribution
        first.
      </p>
      <Table label="Contribution per trainer" head={["Trainer", "Gross", "Platform income", "AI Coach Service Fee", "AI and voice cost", "Domain profit", "Contribution", "Margin", "Cost per paying member", "Stripe fees", "Flags"]}>
        {rows.map((t) => (
          <tr key={t.tenantId}>
            <th scope="row">{t.name}</th>
            <td><Money minor={t.grossMinor} /></td>
            <td><Money minor={t.platformIncomeMinor} /></td>
            <td><Money minor={t.aiCoachServiceFeeMinor} /></td>
            <td><Money minor={t.providerCostMinor} /></td>
            <td><Money minor={t.domainProfitMinor} /></td>
            <td><strong><Money minor={t.contributionMinor} /></strong></td>
            <td>{percent(t.margin)}</td>
            <td><Money minor={t.costPerPayingMemberMinor} /></td>
            <td><Money minor={t.stripeFeesMinor} /></td>
            <td>{t.flags.map((f: string) => f.replaceAll("_", " ")).join(", ") || "—"}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
function FeaturesView({ rows }: { rows: any[] }) {
  if (!rows.length) return <p>No AI or voice usage in this period.</p>;
  return (
    <>
      <h2>Cost by feature and product</h2>
      <Table label="Cost by feature and product" head={["Feature", "Product", "Calls", "Cost", "Estimated", "Unpriced calls", "AED"]}>
        {rows.map((f) => (
          <tr key={f.task + f.product}>
            <th scope="row">{f.task}</th>
            <td>{f.product || "—"}</td>
            <td>{f.calls}</td>
            <td>{usd(f.usd)}</td>
            <td>{usd(f.estimatedUsd)}</td>
            <td>{f.unpriced}</td>
            <td><Money minor={f.aedMinor} /></td>
          </tr>
        ))}
      </Table>
    </>
  );
}
function ProvidersView({ rows }: { rows: any[] }) {
  if (!rows.length) return <p>No provider cost in this period.</p>;
  return (
    <>
      <h2>Cost by provider</h2>
      <p className="muted">
        Estimated is priced at the estimate when the call was made; reconciled
        is priced from the provider&apos;s invoice.
      </p>
      <Table label="Cost by provider" head={["Provider", "Calls", "Cost", "Estimated", "Reconciled", "Unpriced", "Invoiced usage", "Plan fees", "AED"]}>
        {rows.map((p) => (
          <tr key={p.provider}>
            <th scope="row">{p.provider}</th>
            <td>{p.calls}</td>
            <td>{usd(p.usd)}</td>
            <td>{usd(p.estimatedUsd)}</td>
            <td>{usd(p.reconciledUsd)}</td>
            <td>
              {p.unpriced} {p.unpriced > 0 && <>(about {usd(p.unpricedEstimateUsd)})</>}
            </td>
            <td>{p.invoicedUsd === null ? "—" : usd(p.invoicedUsd)}</td>
            <td>{p.planUsd === null || p.planUsd === undefined ? "—" : usd(p.planUsd)}</td>
            <td><Money minor={p.aedMinor} /></td>
          </tr>
        ))}
      </Table>
    </>
  );
}
function DomainsView({ domains, busy, onCheck }: { domains: any; busy: boolean; onCheck: () => void }) {
  const totals = Object.entries(domains.totals ?? {}) as Array<[string, any]>;
  const reg = domains.registrar;
  return (
    <>
      <h2>Domain profit</h2>
      {!totals.length ? (
        <p>No domain payments or registrar charges in this period.</p>
      ) : (
        <Table label="Domain totals per currency" head={["Currency", "Paid by trainers", "Refunded", "Registrar cost", "Dispute losses", "Profit"]}>
          {totals.map(([currency, d]) => (
            <tr key={currency}>
              <th scope="row">{currency}</th>
              <td><span dir="ltr">{inCurrency(d.paymentsMinor, currency)}</span></td>
              <td><span dir="ltr">{inCurrency(d.refundsMinor, currency)}</span></td>
              <td><span dir="ltr">{inCurrency(d.registrarCostMinor, currency)}</span></td>
              <td><span dir="ltr">{inCurrency(d.disputeLossMinor, currency)}</span></td>
              <td>
                <strong>
                  <span dir="ltr">
                    {inCurrency(d.paymentsMinor - d.refundsMinor - d.registrarCostMinor - d.disputeLossMinor, currency)}
                  </span>
                </strong>
              </td>
            </tr>
          ))}
        </Table>
      )}
      {domains.orders.length > 0 && (
        <>
          <h3>Per order (lowest profit first)</h3>
          <Table label="Domain profit per order" head={["Domain", "Trainer", "Paid", "Refunded", "Registrar cost", "Profit"]}>
            {domains.orders.map((o: any) => (
              <tr key={o.orderId + o.currency}>
                <th scope="row">
                  {o.hostname || o.orderId}
                  {o.belowCost && <> (below cost)</>}
                </th>
                <td>{o.workspace}</td>
                <td><span dir="ltr">{inCurrency(o.paidMinor, o.currency)}</span></td>
                <td><span dir="ltr">{inCurrency(o.refundedMinor, o.currency)}</span></td>
                <td><span dir="ltr">{inCurrency(o.registrarCostMinor, o.currency)}</span></td>
                <td><span dir="ltr">{inCurrency(o.profitMinor, o.currency)}</span></td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <h3>Registrar balance</h3>
      <p>
        Registrar charges, all time:{" "}
        {Object.entries(reg.chargedMinor ?? {}).length
          ? Object.entries(reg.chargedMinor).map(([c, v]) => inCurrency(Number(v), c)).join(" + ")
          : "none"}
        {Object.entries(reg.topUpsMinor ?? {}).length > 0 && (
          <>
            {" "}· top-ups recorded:{" "}
            {Object.entries(reg.topUpsMinor).map(([c, v]) => inCurrency(Number(v), c)).join(" + ")}
          </>
        )}
        {reg.bookBalanceMinor && (
          <>
            {" "}· book balance:{" "}
            {Object.entries(reg.bookBalanceMinor).map(([c, v]) => inCurrency(Number(v), c)).join(" + ")}
          </>
        )}
      </p>
      <p>
        {reg.lastReading
          ? reg.lastReading.status === "succeeded"
            ? `The registrar reported ${reg.lastReading.currency} ${reg.lastReading.available} available on ${when(reg.lastReading.at)}.`
            : `The last balance check failed on ${when(reg.lastReading.at)}: ${reg.lastReading.error ?? "no answer"}.`
          : "The registrar balance has not been read yet."}{" "}
        <button type="button" className="button secondary" disabled={busy} onClick={onCheck}>
          Check registrar balance
        </button>
      </p>
    </>
  );
}
function PayoutsView({ rows, onChanged }: { rows: any[]; onChanged: () => Promise<void> }) {
  if (!rows.length) return <p>No payouts for these months.</p>;
  return (
    <>
      <h2>Payouts across trainers</h2>
      <Table label="Payouts across trainers" head={["Trainer", "Month", "Status", "Revision", "Amount", "Bank fee"]}>
        {rows.map((p) => (
          <tr key={p.id}>
            <th scope="row">{p.workspace}</th>
            <td>{p.period}</td>
            <td>{p.status}</td>
            <td>{p.revision}</td>
            <td><Money minor={p.amountMinor} /></td>
            <td>
              {p.bankFeeMinor === null || p.bankFeeMinor === undefined ? (
                ["submitted", "processing", "paid", "returned", "failed", "unknown"].includes(p.status) ? (
                  <PayoutFeeForm payout={p} onDone={onChanged} />
                ) : (
                  "—"
                )
              ) : (
                <span dir="ltr">{inCurrency(p.bankFeeMinor, p.bankFeeCurrency ?? "AED")}</span>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
function FlagsView({ rows }: { rows: any[] }) {
  return (
    <>
      <h2>Cost against income</h2>
      <p className="muted">
        No budget limits apply: the platform pays for usage only when it is
        paid. These are costs with no matching income, negative contribution,
        usage not yet charged and domains below cost.
      </p>
      {!rows.length ? (
        <p>Nothing to flag in this period.</p>
      ) : (
        <ul>
          {rows.map((f, i) => (
            <li key={i}>
              <strong>{f.severity === "warning" ? "Warning" : "Note"}:</strong>{" "}
              {f.detail}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
