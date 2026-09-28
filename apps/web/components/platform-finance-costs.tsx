"use client";
import { useCallback, useEffect, useState } from "react";
import { Field } from "./field";
import { GovernanceError, governanceApi, usd, when } from "./governance-shared";

// Platform costs on the Platform finance screen (docs/features/
// platform-finance.md, phase C): the platform's own cost ledger with
// receipts, recurring costs, provider invoice imports, AI Coach Service Fee
// adjustments for months already charged and Stripe's fees per payment.

type Failure = { message: string; code?: string } | null;
const inCurrency = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(minor / 100);
const CATEGORY: Record<string, string> = {
  server: "Servers",
  email: "Email plan",
  provider_plan: "Provider plan",
  provider_invoice: "Provider invoice charges",
  registrar_topup: "Registrar top-up (prepayment)",
  payout_fee: "Payout bank fee",
  app_store: "App store accounts",
  domain: "Platform domain",
  other: "Other",
};
const newIntent = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-" + String(Date.now()).padStart(12, "0").slice(-12);

export function PlatformCostsView({
  range,
  onChanged,
}: {
  range: { from: string; to: string };
  onChanged: () => Promise<void> | void;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState<Failure>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [intent, setIntent] = useState(newIntent);
  const load = useCallback(async () => {
    setData(await governanceApi(`/admin/platform-finance/costs?from=${range.from}&to=${range.to}`));
  }, [range.from, range.to]);
  useEffect(() => {
    load().catch(setError);
  }, [load]);
  const act = async (label: string, fn: () => Promise<any>, after?: (r: any) => string) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      const result = await fn();
      await load();
      await onChanged();
      setNotice(label + (after ? " " + after(result) : ""));
      return result;
    } catch (e) {
      setError(e as Failure);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h2>Platform costs</h2>
      <p className="muted">
        Costs that belong to no trainer, with their receipt. Entries are never
        changed: a mistake is corrected by a reversal. Registrar top-ups fund
        the registrar&apos;s balance and are not counted as costs; the
        registrar&apos;s charge for each domain is.
      </p>
      <GovernanceError error={error} />
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {!data ? (
        !error && <p>Loading platform costs…</p>
      ) : (
        <>
          <div className="table-scroll" role="region" aria-label="Platform cost entries" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Category</th>
                  <th scope="col">Description</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Receipt</th>
                  <th scope="col">Source</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.length === 0 && (
                  <tr>
                    <td colSpan={7}>No platform costs in this period.</td>
                  </tr>
                )}
                {data.entries.map((c: any) => (
                  <tr key={c.id}>
                    <td>{c.month}</td>
                    <td>{CATEGORY[c.category] ?? c.category}</td>
                    <td>
                      {c.description}
                      {c.vendor ? ` (${c.vendor})` : ""}
                      {c.estimated ? " · estimate" : ""}
                    </td>
                    <td>
                      <span dir="ltr">{inCurrency(c.amountMinor, c.currency)}</span>
                    </td>
                    <td>{c.receiptReference}</td>
                    <td>{c.source.replaceAll("_", " ")}</td>
                    <td>
                      {c.source === "estimate" || c.reversed || c.reversesId ? (
                        c.reversed ? "Reversed" : "—"
                      ) : (
                        <button
                          type="button"
                          className="button secondary"
                          disabled={busy}
                          onClick={() => {
                            const reason = window.prompt("Why is this entry wrong? (at least 10 characters)");
                            if (reason && reason.trim().length >= 10)
                              void act("Entry reversed.", () =>
                                governanceApi(`/admin/platform-finance/costs/${c.id}/reverse`, "POST", { reason }),
                              );
                          }}
                        >
                          Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Record a platform cost</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act("Cost recorded.", () =>
                  governanceApi("/admin/platform-finance/costs", "POST", {
                    intent,
                    month: f.get("month"),
                    category: f.get("category"),
                    description: f.get("description"),
                    ...(String(f.get("vendor") ?? "").trim() ? { vendor: f.get("vendor") } : {}),
                    amount: String(f.get("amount")),
                    currency: f.get("currency"),
                    receiptReference: f.get("receipt"),
                    estimated: f.get("estimated") === "on",
                  }),
                ).then((r) => {
                  if (r) setIntent(newIntent());
                });
              }}
            >
              <div className="form-grid">
                <Field label="Month the cost is for">
                  <input name="month" type="month" required defaultValue={range.to} />
                </Field>
                <Field label="Category">
                  <select name="category" required>
                    {Object.entries(CATEGORY)
                      .filter(([k]) => k !== "payout_fee")
                      .map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Description">
                  <input name="description" required minLength={3} maxLength={500} />
                </Field>
                <Field label="Vendor (optional)">
                  <input name="vendor" maxLength={100} />
                </Field>
                <Field label="Amount">
                  <input name="amount" required inputMode="decimal" pattern="\d{1,9}(\.\d{1,2})?" />
                </Field>
                <Field label="Currency">
                  <select name="currency" defaultValue="USD">
                    <option>USD</option>
                    <option>AED</option>
                  </select>
                </Field>
                <Field label="Receipt or invoice reference">
                  <input name="receipt" required minLength={3} maxLength={300} />
                </Field>
                <label>
                  <input type="checkbox" name="estimated" /> An estimate until the invoice arrives
                </label>
              </div>
              <button className="button" disabled={busy}>
                Record cost
              </button>
            </form>
          </details>
          <h3>Recurring costs</h3>
          {data.recurring.length === 0 ? (
            <p>No recurring costs.</p>
          ) : (
            <ul>
              {data.recurring.map((r: any) => (
                <li key={r.id}>
                  {CATEGORY[r.category] ?? r.category}: {r.description} ·{" "}
                  <span dir="ltr">{inCurrency(Number(r.amount_minor), r.currency)}</span> a month from{" "}
                  {r.starts_month}
                  {r.ends_month ? ` to ${r.ends_month}` : " (ongoing)"}{" "}
                  {!r.ends_month && (
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        const endsMonth = window.prompt("Last month (YYYY-MM)", range.to);
                        if (endsMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(endsMonth))
                          void act("Recurring cost ended.", () =>
                            governanceApi(`/admin/platform-finance/recurring/${r.id}/end`, "POST", {
                              revision: r.revision,
                              endsMonth,
                            }),
                          );
                      }}
                    >
                      Set last month
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary>Add a recurring monthly cost</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act("Recurring cost added; this month's entry follows within the hour.", () =>
                  governanceApi("/admin/platform-finance/recurring", "POST", {
                    category: f.get("category"),
                    description: f.get("description"),
                    ...(String(f.get("vendor") ?? "").trim() ? { vendor: f.get("vendor") } : {}),
                    amount: String(f.get("amount")),
                    currency: f.get("currency"),
                    receiptReference: f.get("receipt"),
                    startsMonth: f.get("startsMonth"),
                  }),
                );
              }}
            >
              <div className="form-grid">
                <Field label="Category">
                  <select name="category">
                    {["server", "email", "provider_plan", "app_store", "domain", "other"].map((k) => (
                      <option key={k} value={k}>
                        {CATEGORY[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Description">
                  <input name="description" required minLength={3} maxLength={500} />
                </Field>
                <Field label="Vendor (optional)">
                  <input name="vendor" maxLength={100} />
                </Field>
                <Field label="Monthly amount">
                  <input name="amount" required inputMode="decimal" pattern="\d{1,9}(\.\d{1,2})?" />
                </Field>
                <Field label="Currency">
                  <select name="currency" defaultValue="USD">
                    <option>USD</option>
                    <option>AED</option>
                  </select>
                </Field>
                <Field label="Contract or plan reference">
                  <input name="receipt" required minLength={3} maxLength={300} />
                </Field>
                <Field label="First month">
                  <input name="startsMonth" type="month" required defaultValue={range.to} />
                </Field>
              </div>
              <button className="button" disabled={busy}>
                Add recurring cost
              </button>
            </form>
          </details>
          <h3>Provider invoices</h3>
          <p className="muted">
            Import a provider&apos;s invoice as CSV (columns cost_usd, and optionally
            request_id, kind usage or plan, description) or JSON ({"{"}&quot;lines&quot;:
            [...]{"}"}). Lines with a request id price that call; the usage total
            prices the month&apos;s estimated calls; plan fees and charges not
            attributed to calls become platform costs. Months already charged get
            an AI Coach Service Fee adjustment; posted statements never change.
          </p>
          {data.invoices.length > 0 && (
            <ul>
              {data.invoices.map((i: any) => (
                <li key={i.id}>
                  {i.provider} {i.month} · {i.reference}: {usd(i.totalUsd)} ({i.lineCount} lines,{" "}
                  {usd(i.planUsd)} plan) · imported {when(i.createdAt)}
                  {Array.isArray(i.result?.corrections?.posted) && i.result.corrections.posted.length > 0 &&
                    ` · ${i.result.corrections.posted.length} adjustment(s)`}
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary>Import a provider invoice</summary>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                const file = f.get("file") as File | null;
                if (!file || !file.size) return setError({ message: "Choose the invoice file" });
                if (file.size > 1000000) return setError({ message: "The file is larger than 1 MB" });
                const content = await file.text();
                await act(
                  "Invoice imported.",
                  () =>
                    governanceApi("/admin/platform-finance/invoices", "POST", {
                      provider: f.get("provider"),
                      month: f.get("month"),
                      reference: f.get("reference"),
                      format: file.name.toLowerCase().endsWith(".json") ? "json" : "csv",
                      content,
                      evidenceReference: f.get("evidence"),
                      acknowledgeFactor: f.get("acknowledge") === "on",
                    }),
                  (r) =>
                    `${r.reconciledRequests} call(s) matched, ${r.corrections?.posted?.length ?? 0} adjustment(s) posted.`,
                );
              }}
            >
              <div className="form-grid">
                <Field label="Provider (as recorded on calls, e.g. openai)">
                  <input name="provider" required pattern="[a-z0-9][a-z0-9._\-]{0,59}" />
                </Field>
                <Field label="Invoice month">
                  <input name="month" type="month" required />
                </Field>
                <Field label="Invoice reference">
                  <input name="reference" required minLength={3} maxLength={200} />
                </Field>
                <Field label="Evidence (where the invoice is kept)">
                  <input name="evidence" required minLength={10} maxLength={500} />
                </Field>
                <Field label="Invoice file (.csv or .json, up to 1 MB)">
                  <input name="file" type="file" accept=".csv,.json,text/csv,application/json" required />
                </Field>
                <label>
                  <input type="checkbox" name="acknowledge" /> I checked the total even if it is far from the estimates
                </label>
              </div>
              <button className="button" disabled={busy}>
                Import invoice
              </button>
            </form>
          </details>
          <details>
            <summary>Post AI Coach Service Fee adjustments for a charged month</summary>
            <p className="muted">
              For each trainer already charged for the month: what their priced
              usage comes to now, at the rate and markup that month was charged
              at, less what was charged. The difference is posted once as an
              adjustment (a charge or a credit); the statement is kept.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(
                  "Adjustments checked.",
                  () =>
                    governanceApi("/admin/platform-finance/usage-corrections", "POST", {
                      period: f.get("period"),
                      reference: f.get("reference"),
                    }),
                  (r) => `${r.posted.length} posted, ${r.skipped.length} unchanged.`,
                );
              }}
            >
              <div className="form-grid">
                <Field label="Month">
                  <input name="period" type="month" required />
                </Field>
                <Field label="Reference (the correction's evidence)">
                  <input name="reference" required minLength={3} maxLength={200} />
                </Field>
              </div>
              <button className="button secondary" disabled={busy}>
                Post adjustments
              </button>
            </form>
          </details>
          <h3>Stripe fees per payment</h3>
          <p>
            {data.stripeFees.count} fee record(s) in this period:{" "}
            {Object.entries(data.stripeFees.byCurrency ?? {})
              .map(([c, v]) => inCurrency(Number(v), c))
              .join(" + ") || "none"}
            . Last sweep: {data.runs.stripe_fees ? `${data.runs.stripe_fees.status} ${when(data.runs.stripe_fees.finished_at ?? data.runs.stripe_fees.started_at)}` : "never"}.{" "}
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void act("Stripe fees read.", () =>
                  governanceApi("/admin/platform-finance/stripe-fees/sweep", "POST", {}),
                  (r) => `${r.recorded} new, ${r.pending} still to read.`,
                )
              }
            >
              Read Stripe fees now
            </button>
          </p>
          <DigitalOceanBillingView onChanged={async () => { await load(); await onChanged(); }} />
        </>
      )}
    </>
  );
}

/**
 * DigitalOcean billing (phase D): the configured project's invoice items and
 * this month's estimate from its resources; "Import now" runs the daily
 * import at once. Read-only at DigitalOcean.
 */
export function DigitalOceanBillingView({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState<Failure>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    setData(await governanceApi("/admin/platform-finance/digitalocean"));
  }, []);
  useEffect(() => {
    load().catch(setError);
  }, [load]);
  return (
    <>
      <h3>DigitalOcean billing</h3>
      <GovernanceError error={error} />
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {data && (
        <>
          <p>
            {data.configured
              ? `Project "${data.project}": only its invoice items and resources are imported, once a day${data.enabled ? "" : " (daily import is off)"}.`
              : "Not configured: save a read-only DigitalOcean token under Settings → DigitalOcean billing."}{" "}
            Last import:{" "}
            {data.lastRun
              ? `${data.lastRun.status} ${when(data.lastRun.finished_at ?? data.lastRun.started_at)}${data.lastRun.error ? " (" + data.lastRun.error + ")" : ""}`
              : "never"}
            .{" "}
            <button
              type="button"
              className="button secondary"
              disabled={busy || !data.configured}
              onClick={async () => {
                setBusy(true);
                setError(null);
                setNotice("");
                try {
                  const r = await governanceApi("/admin/platform-finance/digitalocean/import", "POST", {});
                  await load();
                  await onChanged();
                  setNotice(
                    `Imported ${r.invoicesImported.length} new invoice(s)` +
                      (r.estimate ? `; ${r.estimate.month} estimate ${usd(r.estimate.projectedUsd)}.` : "."),
                  );
                } catch (e) {
                  setError(e as Failure);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Import now
            </button>
          </p>
          {data.estimates.length > 0 && (
            <ul>
              {data.estimates.map((e: any) => (
                <li key={e.month}>
                  {e.month}: about {usd(e.amount_usd)} for the month ({usd(e.to_date_usd)} so far), estimated{" "}
                  {when(e.computed_at)} from {e.resources.length} resource(s)
                  {data.invoices.some((i: any) => i.month === e.month) ? " · replaced by the invoice" : ""}
                </li>
              ))}
            </ul>
          )}
          {data.invoices.length > 0 && (
            <ul>
              {data.invoices.map((i: any) => (
                <li key={i.invoice_uuid}>
                  Invoice {i.month}: {i.project_items} item(s) of the project, {usd(i.project_usd)} (the whole team{" "}
                  {usd(i.team_usd)}, not counted)
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}

/** Records the company bank's fee for one payout (a platform cost). */
export function PayoutFeeForm({
  payout,
  onDone,
}: {
  payout: { id: string; tenantId: string; period: string };
  onDone: () => Promise<void> | void;
}) {
  const [error, setError] = useState<Failure>(null),
    [busy, setBusy] = useState(false);
  return (
    <form
      className="button-row"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError(null);
        try {
          await governanceApi("/admin/platform-finance/payout-fees", "POST", {
            tenantId: payout.tenantId,
            payoutId: payout.id,
            amount: String(f.get("amount")),
            currency: f.get("currency"),
            receiptReference: f.get("receipt"),
          });
          await onDone();
        } catch (e) {
          setError(e as Failure);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input name="amount" aria-label={`Bank fee for the ${payout.period} payout`} required inputMode="decimal" pattern="\d{1,9}(\.\d{1,2})?" size={8} />
      <select name="currency" aria-label="Fee currency" defaultValue="AED">
        <option>AED</option>
        <option>USD</option>
      </select>
      <input name="receipt" aria-label="Bank statement reference" required minLength={3} maxLength={300} size={14} />
      <button className="button secondary" disabled={busy}>
        Record fee
      </button>
      <GovernanceError error={error} />
    </form>
  );
}
