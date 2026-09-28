"use client";
import { useEffect, useState } from "react";

// Platform cost controls on /admin/finance (docs/features/platform-finance.md,
// phase A): one reviewed USD to AED rate per month, reviewed model prices per
// provider and model, and pricing a provider's month from its usage or
// invoice total. Every request needs a fresh authenticator code and is audited.

class RequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
async function call(path: string, body?: unknown) {
  const r = await fetch("/api/v1/admin/finance" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new RequestError(d.message ?? "Request failed", d.code);
  return d;
}
const DUBAI_OFFSET_MS = 4 * 3600000;
/** The previous Asia/Dubai calendar month (finance months are Dubai months). */
const lastMonth = () => {
  const d = new Date(Date.now() + DUBAI_OFFSET_MS);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
const dubaiTime = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dubai",
  }).format(new Date(value));
/** USD as exact hundred-millionths, as the server computes them. */
function usdUnits(value: string | number | null | undefined): bigint {
  const match = /^(-)?(\d+)(?:\.(\d{0,8}))?$/.exec(String(value ?? "0").trim());
  if (!match) return 0n;
  const units =
    BigInt(match[2]) * 100000000n + BigInt((match[3] ?? "").padEnd(8, "0"));
  return match[1] ? -units : units;
}
const usd4 = (units: bigint) => (Number(units) / 1e8).toFixed(4);
const FACTOR_RANGE = { low: 0.5, high: 2 };

type Notice = { text: string; error?: boolean } | null;

export function PlatformCostControls() {
  const [rates, setRates] = useState<any>(null),
    [prices, setPrices] = useState<any>(null),
    [providers, setProviders] = useState<any>(null),
    [preview, setPreview] = useState<any>(null),
    [pending, setPending] = useState<any>(null),
    [result, setResult] = useState<any>(null),
    [rateRetry, setRateRetry] = useState<any>(null),
    [notice, setNotice] = useState<Notice>(null),
    [busy, setBusy] = useState(false),
    [pricingMonth, setPricingMonth] = useState(lastMonth());
  const load = () =>
    Promise.all([call("/exchange-rates"), call("/model-prices")])
      .then(([r, p]) => {
        setRates(r);
        setPrices(p);
      })
      .catch((e) => setNotice({ text: e.message, error: true }));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    setProviders(null);
    if (!/^\d{4}-\d{2}$/.test(pricingMonth)) return;
    call("/provider-usage/providers?period=" + pricingMonth)
      .then(setProviders)
      .catch(() => setProviders({ providers: [] }));
  }, [pricingMonth]);
  async function act<T>(
    run: () => Promise<T>,
    done: (value: T) => string,
    onError?: (error: RequestError) => boolean,
  ) {
    setBusy(true);
    setNotice(null);
    try {
      const value = await run();
      setNotice({ text: done(value) });
      await load();
    } catch (e) {
      if (!onError?.(e as RequestError))
        setNotice({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }
  const recordRate = (body: Record<string, unknown>) =>
    act(
      () => call("/exchange-rates", body),
      (r: any) => {
        setRateRetry(null);
        return r.unchanged
          ? `The reviewed rate for ${body.month} is already ${Number(r.rate)}; nothing changed.`
          : `Rate recorded for ${body.month}: revision ${r.revision}.${r.usageStatementsAtOtherRate ? ` ${r.usageStatementsAtOtherRate} workspace(s) keep their charge at another rate.` : ""}`;
      },
      (error) => {
        if (error.code !== "POSTED_STATEMENTS_DIFFER") return false;
        setRateRetry({ body, message: error.message });
        return true;
      },
    );
  // The confirmation figures for a pricing run, computed exactly as the
  // server does (total less already priced, spread over the estimates).
  const confirmation = pending
    ? (() => {
        const total = usdUnits(pending.usageTotalUsd);
        const fixed = usdUnits(preview.fixedUsd);
        const estimate = usdUnits(preview.adjustableEstimateUsd);
        const target = total - fixed;
        const factor =
          estimate > 0n ? Number((target * 1000000n) / estimate) / 1000000 : null;
        return {
          total,
          fixed,
          estimate,
          target,
          factor,
          extreme:
            factor !== null &&
            (factor < FACTOR_RANGE.low || factor > FACTOR_RANGE.high),
        };
      })()
    : null;
  return (
    <section className="card">
      <h2>Platform costs</h2>
      <p className="muted">
        One reviewed exchange rate per month keeps business metrics, statements
        and new usage charges in agreement; a usage charge already posted keeps
        the rate it was posted at. Voice calls are priced at their estimate
        when made and marked estimated; price a provider&apos;s month from its
        usage or invoice total to replace the estimates.
      </p>
      {notice && (
        <p
          className={notice.error ? "notice error" : "notice success"}
          role={notice.error ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      <details>
        <summary>USD to AED rate by month</summary>
        <p className="muted">
          A month without a reviewed rate uses the default (
          {rates?.defaultAedPerUsd ?? "3.6725"} AED per USD, Settings → Platform
          finance) in metrics and previews; automatic month close keeps its own
          approved rate. Once a month has a reviewed rate, its new usage
          statements must use it. A change is a new revision; earlier revisions
          are kept.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void recordRate({
              month: f.get("month"),
              aedPerUsd: Number(f.get("aedPerUsd")),
              source: f.get("source"),
            });
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Month (Dubai)</span>
              <input name="month" type="month" defaultValue={lastMonth()} required />
            </label>
            <label className="field">
              <span>AED per USD</span>
              <input
                name="aedPerUsd"
                type="number"
                step="0.000001"
                min="1"
                max="10"
                defaultValue="3.6725"
                required
              />
            </label>
            <label className="field">
              <span>Source (bank or central bank reference)</span>
              <input name="source" minLength={5} maxLength={500} required />
            </label>
          </div>
          <button className="button" disabled={busy}>
            Record reviewed rate
          </button>
        </form>
        {rateRetry && (
          <div className="notice error" role="alert">
            <p>{rateRetry.message}</p>
            <button
              className="button"
              disabled={busy}
              onClick={() =>
                void recordRate({
                  ...rateRetry.body,
                  acknowledgePostedStatements: true,
                })
              }
            >
              Record the rate anyway
            </button>{" "}
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setRateRetry(null)}
            >
              Cancel
            </button>
          </div>
        )}
        {rates?.rates?.length ? (
          <div
            className="table-scroll"
            role="region"
            aria-labelledby="reviewed-rates"
            tabIndex={0}
          >
            <table>
              <caption id="reviewed-rates">Reviewed rates</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">AED per USD</th>
                  <th scope="col">Revision</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {rates.rates.map((r: any) => (
                  <tr key={r.id}>
                    <th scope="row">{r.month}</th>
                    <td>
                      {Number(r.aed_per_usd)}
                      {r.current ? "" : " (superseded)"}
                    </td>
                    <td>{r.revision}</td>
                    <td>{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No reviewed rates yet.</p>
        )}
      </details>
      <details>
        <summary>AI model prices</summary>
        <p className="muted">
          AI calls are priced at the latest price in effect for their provider
          and model; without one, the AI model settings&apos; price applies.
          Prices cannot be edited: add a new one with its effective date.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const effective = String(f.get("effectiveFrom") ?? "");
            void act(
              () =>
                call("/model-prices", {
                  provider: f.get("provider"),
                  model: f.get("model"),
                  inputUsdPerMillion: Number(f.get("input")),
                  outputUsdPerMillion: Number(f.get("output")),
                  priceVersion: f.get("priceVersion"),
                  source: f.get("source"),
                  // Entered in Dubai time (UTC+4 all year).
                  ...(effective
                    ? {
                        effectiveFrom: new Date(
                          effective + ":00+04:00",
                        ).toISOString(),
                      }
                    : {}),
                }),
              () => "Price added.",
            );
          }}
        >
          <div className="form-grid">
            {[
              ["provider", "Provider (for example openai)", "text"],
              ["model", "Model ID", "text"],
              ["input", "Input USD / million tokens", "number"],
              ["output", "Output USD / million tokens", "number"],
              ["priceVersion", "Price version", "text"],
              ["source", "Source (price page or contract)", "text"],
            ].map(([name, label, type]) => (
              <label className="field" key={name}>
                <span>{label}</span>
                <input
                  name={name}
                  type={type}
                  step={type === "number" ? "0.00000001" : undefined}
                  min={type === "number" ? 0 : undefined}
                  required
                />
              </label>
            ))}
            <label className="field">
              <span>Effective from, Dubai time (blank: now)</span>
              <input name="effectiveFrom" type="datetime-local" />
            </label>
          </div>
          <button className="button" disabled={busy}>
            Add price
          </button>
        </form>
        {prices?.prices?.length ? (
          <div
            className="table-scroll"
            role="region"
            aria-labelledby="model-prices"
            tabIndex={0}
          >
            <table>
              <caption id="model-prices">Reviewed model prices</caption>
              <thead>
                <tr>
                  <th scope="col">Provider / model</th>
                  <th scope="col">Input USD per million</th>
                  <th scope="col">Output USD per million</th>
                  <th scope="col">Version</th>
                  <th scope="col">From (Dubai time)</th>
                </tr>
              </thead>
              <tbody>
                {prices.prices.map((p: any) => (
                  <tr key={p.id}>
                    <th scope="row">
                      {p.provider} / {p.model}
                    </th>
                    <td>{Number(p.input_usd_per_million)}</td>
                    <td>{Number(p.output_usd_per_million)}</td>
                    <td>{p.price_version}</td>
                    <td>{dubaiTime(p.effective_from)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No reviewed model prices yet.</p>
        )}
      </details>
      <details>
        <summary>Price a provider&apos;s month from its usage or invoice total</summary>
        <p className="muted">
          Enter the provider&apos;s usage total for the month, without plan
          fees. The total less the calls already priced is spread over the
          month&apos;s estimated and unpriced calls in proportion to their
          estimates, across all workspaces; each call keeps its estimate. This
          cannot be undone. A usage statement already posted keeps its charge.
          To continue an interrupted run, preview again with the same invoice
          reference.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const reference = String(f.get("invoiceReference") ?? "").trim();
            const q = new URLSearchParams({
              period: String(f.get("period")),
              provider: String(f.get("provider")),
              ...(reference ? { invoiceReference: reference } : {}),
            });
            setBusy(true);
            setNotice(null);
            setPending(null);
            setResult(null);
            call("/provider-usage?" + q.toString())
              .then(setPreview)
              .catch((error) => setNotice({ text: error.message, error: true }))
              .finally(() => setBusy(false));
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Month (Dubai)</span>
              <input
                name="period"
                type="month"
                value={pricingMonth}
                onChange={(e) => setPricingMonth(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Provider</span>
              {providers?.providers?.length ? (
                <select name="provider" required>
                  {providers.providers.map((p: any) => (
                    <option key={p.provider} value={p.provider}>
                      {p.provider} ({p.calls} call(s), {p.workspaces} workspace(s))
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name="provider"
                  required
                  placeholder={providers ? "No calls this month" : "Loading…"}
                />
              )}
            </label>
            <label className="field">
              <span>Invoice or usage report reference</span>
              <input name="invoiceReference" minLength={3} maxLength={200} required />
            </label>
          </div>
          <button className="button secondary" disabled={busy}>
            Preview
          </button>
        </form>
        {preview && (
          <>
            <p>
              {preview.provider} · {preview.period}: {preview.adjustableRows}{" "}
              call(s) to price, estimated USD {preview.adjustableEstimateUsd};{" "}
              {preview.fixedRows} already priced (USD {preview.fixedUsd})
              {preview.pricedByReference
                ? ` · ${preview.pricedByReference} already priced under ${preview.invoiceReference} (a resumed run finishes the rest)`
                : ""}
              {preview.inFlight ? ` · ${preview.inFlight} still running` : ""}
              {preview.usageStatementsPosted
                ? ` · ${preview.usageStatementsPosted} workspace(s) already charged for this month`
                : ""}
            </p>
            {preview.withoutEstimate > 0 && (
              <p className="notice error" role="alert">
                {preview.withoutEstimate} call(s) have no estimate. The
                provider&apos;s total covers them too, so reconcile them one by
                one (Payments and payouts → Reconcile unpriced provider usage) or estimate
                them first; pricing is refused until then.
              </p>
            )}
            {preview.workspaces?.length > 0 && (
              <div
                className="table-scroll"
                role="region"
                aria-labelledby="pricing-workspaces"
                tabIndex={0}
              >
                <table>
                  <caption id="pricing-workspaces">By workspace</caption>
                  <thead>
                    <tr>
                      <th scope="col">Workspace</th>
                      <th scope="col">Calls to price</th>
                      <th scope="col">Estimate USD</th>
                      <th scope="col">Already priced USD</th>
                      <th scope="col">Without estimate</th>
                      <th scope="col">Usage charged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.workspaces.map((w: any) => (
                      <tr key={w.tenantId}>
                        <th scope="row">{w.name}</th>
                        <td>{w.rows}</td>
                        <td>{w.estimateUsd}</td>
                        <td>{w.fixedUsd}</td>
                        <td>{w.withoutEstimate}</td>
                        <td>{w.usageStatementPosted ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!pending ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  setResult(null);
                  setPending({
                    usageTotalUsd: String(f.get("usageTotalUsd")),
                    evidenceReference: String(f.get("evidenceReference")),
                  });
                }}
              >
                <div className="form-grid">
                  <label className="field">
                    <span>Provider usage total (USD)</span>
                    <input
                      name="usageTotalUsd"
                      inputMode="decimal"
                      pattern="\d{1,9}(\.\d{1,8})?"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Evidence document reference</span>
                    <input name="evidenceReference" minLength={10} maxLength={500} required />
                  </label>
                </div>
                <button
                  className="button secondary"
                  disabled={
                    busy ||
                    !preview.adjustableRows ||
                    preview.withoutEstimate > 0 ||
                    preview.inFlight > 0
                  }
                >
                  Review pricing of {preview.adjustableRows} call(s)
                </button>
              </form>
            ) : (
              confirmation && (
                <div
                  className={confirmation.extreme ? "notice error" : "notice"}
                  role={confirmation.extreme ? "alert" : "status"}
                >
                  <p>
                    <strong>Confirm pricing (cannot be undone).</strong>{" "}
                    Provider total USD {usd4(confirmation.total)} for{" "}
                    {preview.provider}, {preview.period} (reference{" "}
                    {preview.invoiceReference}); already priced USD{" "}
                    {usd4(confirmation.fixed)}; to spread USD{" "}
                    {usd4(confirmation.target)} over estimates of USD{" "}
                    {usd4(confirmation.estimate)} across{" "}
                    {preview.workspaces?.filter((w: any) => w.rows).length ?? 0}{" "}
                    workspace(s): every call is multiplied by{" "}
                    {confirmation.factor ?? "—"}.
                    {preview.usageStatementsPosted
                      ? ` ${preview.usageStatementsPosted} workspace(s) were already charged for this month; their charge does not change.`
                      : ""}
                  </p>
                  {confirmation.target < 0n && (
                    <p>
                      The total is below what is already priced; check the
                      figure. The server will refuse it.
                    </p>
                  )}
                  {confirmation.extreme && (
                    <p>
                      The total is far from the estimates (outside{" "}
                      {FACTOR_RANGE.low} to {FACTOR_RANGE.high} times). Check
                      the figure on the invoice before confirming.
                    </p>
                  )}
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () =>
                          call("/provider-usage/price", {
                            period: preview.period,
                            provider: preview.provider,
                            usageTotalUsd: pending.usageTotalUsd,
                            invoiceReference: preview.invoiceReference,
                            evidenceReference: pending.evidenceReference,
                            expectedRows: preview.adjustableRows,
                            expectedEstimateUsd: preview.adjustableEstimateUsd,
                            ...(confirmation.extreme
                              ? { acknowledgeFactor: true }
                              : {}),
                          }),
                        (r: any) => {
                          setResult(r);
                          setPending(null);
                          setPreview(null);
                          return `Priced ${r.priced} call(s) this run (USD ${r.allocatedThisRunUsd}); USD ${r.allocatedTotalUsd} of USD ${r.allocatedUsd} allocated under this reference.`;
                        },
                      )
                    }
                  >
                    {confirmation.extreme
                      ? `Confirm factor ${confirmation.factor} and price`
                      : "Confirm and price"}
                  </button>{" "}
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setPending(null)}
                  >
                    Back
                  </button>
                </div>
              )
            )}
          </>
        )}
        {result && (
          <div>
            {result.note && <p className="muted">{result.note}</p>}
            {result.chargedWorkspaces?.length > 0 && (
              <div
                className="table-scroll"
                role="region"
                aria-labelledby="pricing-charged"
                tabIndex={0}
              >
                <table>
                  <caption id="pricing-charged">
                    Workspaces already charged for {result.period}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Workspace</th>
                      <th scope="col">Charged USD</th>
                      <th scope="col">AED per USD</th>
                      <th scope="col">Charged (AED fils)</th>
                      <th scope="col">Now priced USD</th>
                      <th scope="col">Difference (AED fils, not charged)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.chargedWorkspaces.map((w: any) => (
                      <tr key={w.tenantId}>
                        <th scope="row">{w.name}</th>
                        <td>{Number(w.chargedUsd).toFixed(4)}</td>
                        <td>{w.aedPerUsd}</td>
                        <td>{w.chargeMinor}</td>
                        <td>{Number(w.currentChargeableUsd).toFixed(4)}</td>
                        <td>{w.differenceMinor}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </details>
    </section>
  );
}
