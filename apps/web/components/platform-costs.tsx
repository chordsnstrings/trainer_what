"use client";
import { useEffect, useState } from "react";

// Platform cost controls on /admin/finance (docs/features/platform-finance.md,
// phase A): one reviewed USD to AED rate per month, reviewed model prices per
// provider and model, and pricing a provider's month from its usage or
// invoice total. Every request needs a fresh authenticator code and is audited.

async function call(path: string, body?: unknown) {
  const r = await fetch("/api/v1/admin/finance" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.message ?? "Request failed");
  return d;
}
const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

export function PlatformCostControls() {
  const [rates, setRates] = useState<any>(null),
    [prices, setPrices] = useState<any>(null),
    [preview, setPreview] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    Promise.all([call("/exchange-rates"), call("/model-prices")])
      .then(([r, p]) => {
        setRates(r);
        setPrices(p);
      })
      .catch((e) => setMessage(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function act(run: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage("");
    try {
      await run();
      setMessage(done);
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Platform costs</h2>
      <p className="muted">
        One reviewed exchange rate per month keeps business metrics, statements
        and usage charges in agreement. Voice calls are priced at their estimate
        when made and marked estimated; price a provider&apos;s month from its
        usage or invoice total to replace the estimates.
      </p>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <details>
        <summary>USD to AED rate by month</summary>
        <p className="muted">
          A month without a reviewed rate uses the default (
          {rates?.defaultAedPerUsd ?? "3.6725"}, Settings → Platform finance).
          Once a month has a reviewed rate, its usage statements must use it.
          A change is a new revision; earlier revisions are kept.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act(
              () =>
                call("/exchange-rates", {
                  month: f.get("month"),
                  aedPerUsd: Number(f.get("aedPerUsd")),
                  source: f.get("source"),
                }),
              "Rate recorded.",
            );
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Month</span>
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
        {rates?.rates?.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Rate</th>
                  <th>Revision</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rates.rates.map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.month}</td>
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
                  ...(effective
                    ? { effectiveFrom: new Date(effective).toISOString() }
                    : {}),
                }),
              "Price added.",
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
              <span>Effective from (blank: now)</span>
              <input name="effectiveFrom" type="datetime-local" />
            </label>
          </div>
          <button className="button" disabled={busy}>
            Add price
          </button>
        </form>
        {prices?.prices?.map((p: any) => (
          <p key={p.id}>
            {p.provider} / {p.model}: in {Number(p.input_usd_per_million)} · out{" "}
            {Number(p.output_usd_per_million)} USD per million · {p.price_version}{" "}
            · from {new Date(p.effective_from).toLocaleString()}
          </p>
        ))}
      </details>
      <details>
        <summary>Price a provider&apos;s month from its usage or invoice total</summary>
        <p className="muted">
          Enter the provider&apos;s usage total for the month, without plan
          fees. The total less the calls already priced is spread over the
          month&apos;s estimated and unpriced calls in proportion to their
          estimates, across all workspaces; each call keeps its estimate. A
          usage statement already posted keeps its charge.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const q = new URLSearchParams({
              period: String(f.get("period")),
              provider: String(f.get("provider")),
            });
            setBusy(true);
            setMessage("");
            call("/provider-usage?" + q.toString())
              .then(setPreview)
              .catch((error) => setMessage(error.message))
              .finally(() => setBusy(false));
          }}
        >
          <div className="form-grid">
            <label className="field">
              <span>Month</span>
              <input name="period" type="month" defaultValue={lastMonth()} required />
            </label>
            <label className="field">
              <span>Provider (for example cartesia)</span>
              <input name="provider" required />
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
              {preview.withoutEstimate
                ? ` · ${preview.withoutEstimate} without an estimate (reconcile one by one)`
                : ""}
              {preview.inFlight ? ` · ${preview.inFlight} still running` : ""}
              {preview.usageStatementsPosted
                ? ` · ${preview.usageStatementsPosted} workspace(s) already charged for this month`
                : ""}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act(
                  () =>
                    call("/provider-usage/price", {
                      period: preview.period,
                      provider: preview.provider,
                      usageTotalUsd: String(f.get("usageTotalUsd")),
                      invoiceReference: f.get("invoiceReference"),
                      evidenceReference: f.get("evidenceReference"),
                      expectedRows: preview.adjustableRows,
                      expectedEstimateUsd: preview.adjustableEstimateUsd,
                    }).then((r: any) => {
                      setPreview(null);
                      return r;
                    }),
                  "Provider usage priced.",
                );
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
                  <span>Invoice or usage report reference</span>
                  <input name="invoiceReference" minLength={3} maxLength={200} required />
                </label>
                <label className="field">
                  <span>Evidence document reference</span>
                  <input name="evidenceReference" minLength={10} maxLength={500} required />
                </label>
              </div>
              <button className="button" disabled={busy || !preview.adjustableRows}>
                Price {preview.adjustableRows} call(s)
              </button>
            </form>
          </>
        )}
      </details>
    </section>
  );
}
