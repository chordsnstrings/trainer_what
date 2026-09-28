"use client";
import { useEffect, useState } from "react";
import { money } from "@trainer/domain";
export function FinanceOperations({ tenants }: { tenants: any[] }) {
  const [tenant, setTenant] = useState(tenants[0]?.id ?? ""),
    [data, setData] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [usagePreview, setUsagePreview] = useState<any>(null);
  async function request(path = "", body?: unknown) {
    const r = await fetch(`/api/v1/admin/tenants/${tenant}/finance${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    return d;
  }
  useEffect(() => {
    setData(null);
    if (tenant)
      void request()
        .then(setData)
        .catch((e) => setMessage(e.message));
  }, [tenant]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      await request(path, body);
      setData(await request());
      setMessage("Evidence saved.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Finance operations</h2>
      <p className="muted">
        Record reconciled provider and bank evidence. Amounts use AED minor
        units: 100 = AED 1.
      </p>
      <label className="field">
        <span>Workspace</span>
        <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
          {tenants.map((t) => (
            <option value={t.id} key={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {data && (
        <>
          <div className="stats-grid">
            <div>
              <small>Unsettled Stripe receivable</small>
              <h3>
                <span dir="ltr">
                  {money(data.summary.accounts.stripe_receivable ?? 0)}
                </span>
              </h3>
            </div>
            <div>
              <small>Reconciled bank funds</small>
              <h3>
                <span dir="ltr">
                  {money(data.summary.accounts.bank_cash ?? 0)}
                </span>
              </h3>
            </div>
            <div>
              <small>Trainer payable</small>
              <h3>
                <span dir="ltr">{money(data.summary.earnedMinor)}</span>
              </h3>
            </div>
          </div>
          <details>
            <summary>Record a Stripe bank settlement</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act("/settlements", {
                  ...Object.fromEntries(f),
                  grossMinor: Number(f.get("grossMinor")),
                  feeMinor: Number(f.get("feeMinor")),
                  netMinor: Number(f.get("netMinor")),
                });
              }}
            >
              <div className="form-grid">
                {[
                  ["stripePayoutId", "Stripe payout reference"],
                  ["bankReference", "Bank receipt reference"],
                  ["grossMinor", "Gross allocated (minor units)"],
                  ["feeMinor", "Actual processing fee (minor units)"],
                  ["netMinor", "Net received (minor units)"],
                  ["evidenceReference", "Evidence document reference"],
                ].map(([name, label]) => (
                  <label className="field" key={name}>
                    <span>{label}</span>
                    <input
                      name={name}
                      type={name.endsWith("Minor") ? "number" : "text"}
                      min={0}
                      required
                    />
                  </label>
                ))}
              </div>
              <button className="button" disabled={busy}>
                Record reconciled settlement
              </button>
            </form>
          </details>
          {data.usageByStatus?.length > 0 && (
            <p className="muted">
              Provider usage:{" "}
              {data.usageByStatus
                .map(
                  (s: any) =>
                    `${s.calls} ${s.status} (USD ${Number(s.cost_usd).toFixed(4)}${Number(s.unpriced_estimate_usd) ? `, about USD ${Number(s.unpriced_estimate_usd).toFixed(4)} unpriced` : ""})`,
                )
                .join(" · ")}
              . Estimated calls are priced at their estimate until an invoice
              reconciles them.
            </p>
          )}
          <details>
            <summary>
              Reconcile unpriced provider usage ({data.unresolvedUsage?.length ?? 0})
            </summary>
            <p className="muted">
              Check the provider request or invoice before recording its actual
              USD cost. Confirmed zero cost also requires evidence. Requests
              from the last five minutes must finish first. To stop unpriced
              calls blocking the usage charge and month close, estimate them:
              each is priced at its stored estimate (or, for an AI call whose
              answer was lost, the average cost of the same feature and model)
              and marked estimated; the invoice can still correct it.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act("/usage/estimate", {
                  evidenceReference: f.get("evidenceReference"),
                  ...(f.get("before") ? { before: f.get("before") } : {}),
                });
              }}
            >
              <div className="form-grid">
                <label className="field">
                  <span>Up to the end of month (blank: all)</span>
                  <input name="before" type="month" />
                </label>
                <label className="field">
                  <span>Reason and evidence</span>
                  <input name="evidenceReference" minLength={10} maxLength={500} required />
                </label>
              </div>
              <button className="button secondary" disabled={busy}>
                Estimate unpriced usage
              </button>
            </form>
            {data.unresolvedUsage?.map((u: any) => (
              <form
                key={u.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(
                    `/usage/${u.id}/reconcile`,
                    Object.fromEntries(new FormData(e.currentTarget)),
                  );
                }}
              >
                <h3>
                  {u.task} · {u.model}
                </h3>
                <p>
                  {new Date(u.created_at).toLocaleString()} · {u.status}
                </p>
                <div className="form-grid">
                  <label className="field">
                    <span>Verified provider cost (USD)</span>
                    <input
                      name="costUsd"
                      type="number"
                      min="0"
                      max="9999999"
                      step="0.00000001"
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Provider request reference</span>
                    <input
                      name="providerRequestId"
                      defaultValue={u.trace_id ?? ""}
                      minLength={3}
                      maxLength={200}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Provider invoice or response evidence</span>
                    <input
                      name="evidenceReference"
                      minLength={10}
                      maxLength={500}
                      required
                    />
                  </label>
                </div>
                <button className="button secondary" disabled={busy}>
                  Record reviewed cost
                </button>
              </form>
            ))}
          </details>
          <details>
            <summary>Post reviewed usage charges</summary>
            <p className="muted">
              Convert priced provider cost (recorded, reconciled or estimated)
              at the month&apos;s exchange rate. The server checks the amount
              and posts it once against trainer earnings. Preview a month to
              fill in its rate and charge.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const period = String(
                  new FormData(e.currentTarget).get("period") ?? "",
                );
                setBusy(true);
                setMessage("");
                request("/usage-preview?period=" + encodeURIComponent(period))
                  .then(setUsagePreview)
                  .catch((error) => setMessage(error.message))
                  .finally(() => setBusy(false));
              }}
            >
              <label className="field">
                <span>Month to preview</span>
                <input name="period" type="month" required />
              </label>
              <button className="button secondary" disabled={busy}>
                Preview usage charge
              </button>
            </form>
            {usagePreview && (
              <>
                <p>
                  {usagePreview.period}: {usagePreview.usage.events} call(s),{" "}
                  {usagePreview.usage.unpriced} unpriced,{" "}
                  {usagePreview.usage.estimated} estimated · USD{" "}
                  {Number(usagePreview.usage.chargeableUsd).toFixed(4)}{" "}
                  chargeable at {(usagePreview.chargeRate ?? usagePreview.rate).aedPerUsd}{" "}
                  AED per USD (
                  {(usagePreview.chargeRate ?? usagePreview.rate).source === "reviewed"
                    ? "the month's reviewed rate"
                    : (usagePreview.chargeRate ?? usagePreview.rate).source === "automation"
                      ? "the finance automation's approved rate; no reviewed rate yet"
                      : "default rate, not reviewed"}
                  ) with {usagePreview.usage.markupPercent}% markup ={" "}
                  <span dir="ltr">{money(usagePreview.usage.chargeMinor)}</span>
                  {Number(usagePreview.usage.platformBorneUsd) > 0 &&
                    ` · USD ${Number(usagePreview.usage.platformBorneUsd).toFixed(4)} of complimentary members' usage borne by the platform`}
                </p>
                {usagePreview.postedComparison && (
                  <p className="notice" role="status">
                    Already charged for {usagePreview.period}: USD{" "}
                    {Number(usagePreview.postedComparison.chargedUsd).toFixed(4)} at{" "}
                    {usagePreview.postedComparison.aedPerUsd} AED per USD ={" "}
                    <span dir="ltr">{money(usagePreview.postedComparison.chargeMinor)}</span>.
                    The month&apos;s priced usage now comes to USD{" "}
                    {Number(usagePreview.postedComparison.currentChargeableUsd).toFixed(4)}{" "}
                    at that rate ={" "}
                    <span dir="ltr">{money(usagePreview.postedComparison.currentChargeMinor)}</span>
                    {usagePreview.postedComparison.differenceMinor
                      ? <>; difference <span dir="ltr">{money(usagePreview.postedComparison.differenceMinor)}</span>, not charged (correction entries come in a later phase).</>
                      : "; no difference."}
                  </p>
                )}
              </>
            )}
            <form
              key={usagePreview?.period ?? "usage-statement"}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act("/usage-statements", {
                  ...Object.fromEntries(f),
                  fxAedPerUsd: Number(f.get("fxAedPerUsd")),
                  chargeMinor: Number(f.get("chargeMinor")),
                });
              }}
            >
              <div className="form-grid">
                {[
                  ["period", "Usage month", "month"],
                  ["fxAedPerUsd", "Reviewed AED per USD", "number"],
                  ["chargeMinor", "Trainer charge (minor units)", "number"],
                  [
                    "feeScheduleVersion",
                    "Approved fee schedule version",
                    "text",
                  ],
                  [
                    "evidenceReference",
                    "Provider invoice and rate evidence",
                    "text",
                  ],
                ].map(([name, label, type]) => (
                  <label className="field" key={name}>
                    <span>{label}</span>
                    <input
                      name={name}
                      type={type}
                      step={name === "fxAedPerUsd" ? "0.00000001" : undefined}
                      min={type === "number" ? 0 : undefined}
                      defaultValue={
                        usagePreview
                          ? name === "period"
                            ? usagePreview.period
                            : name === "fxAedPerUsd"
                              ? (usagePreview.chargeRate ?? usagePreview.rate).aedPerUsd
                              : name === "chargeMinor"
                                ? usagePreview.usage.chargeMinor
                                : undefined
                          : undefined
                      }
                      required
                    />
                  </label>
                ))}
              </div>
              <button className="button" disabled={busy}>
                Post usage statement
              </button>
            </form>
            {data.usageStatements?.map((s: any) => (
              <p key={s.id}>
                {s.period} · charged{" "}
                <span dir="ltr">{money(Number(s.charge_minor))}</span> at{" "}
                {Number(s.fx_aed_per_usd)} AED per USD ·{" "}
                {s.fee_schedule_version}
                {s.difference_minor ? (
                  <small className="muted">
                    {" "}
                    · priced usage now{" "}
                    <span dir="ltr">{money(Number(s.current_charge_minor))}</span>{" "}
                    at that rate (difference{" "}
                    <span dir="ltr">{money(Number(s.difference_minor))}</span>, not
                    charged)
                  </small>
                ) : null}
              </p>
            ))}
          </details>
          <details>
            <summary>Close a month</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  "/close",
                  Object.fromEntries(new FormData(e.currentTarget)),
                );
              }}
            >
              <label className="field">
                <span>Month</span>
                <input name="period" type="month" required />
              </label>
              <label className="field">
                <span>Reconciliation evidence</span>
                <input name="evidenceReference" minLength={10} required />
              </label>
              <button className="button" disabled={busy}>
                Run close checks
              </button>
            </form>
            {data.records
              .filter((r: any) => r.kind === "close")
              .map((r: any) => (
                <p key={r.id}>
                  {r.data.period} · {money(r.data.eligibleMinor)} eligible
                  before current holds
                </p>
              ))}
          </details>
          <details>
            <summary>Review bank destinations</summary>
            {data.records
              .filter((r: any) => r.kind === "beneficiary")
              .map((r: any) =>
                ["validating", "verified", "unknown"].includes(r.status) ? (
                  <form
                    key={r.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void act("/beneficiaries/" + r.id + "/review", {
                        ...(r.data.providerId
                          ? { providerId: r.data.providerId }
                          : {}),
                        evidenceReference: f.get("evidenceReference"),
                        verified: f.get("verified") === "on",
                      });
                    }}
                  >
                    <h3>
                      {r.data.name} · {r.data.maskedIban}
                    </h3>
                    <p>
                      {r.status} · Provider destination{" "}
                      {r.data.providerId ?? "not returned"}
                    </p>
                    <label className="field">
                      <span>Identity and account ownership evidence</span>
                      <input name="evidenceReference" minLength={10} required />
                    </label>
                    {r.status === "validating" && (
                      <label className="check-field">
                        <input name="verified" type="checkbox" />
                        Provider verification and account ownership are
                        confirmed
                      </label>
                    )}
                    <button className="button secondary" disabled={busy}>
                      {r.status === "validating"
                        ? "Record review and bank-change hold"
                        : "Reject destination"}
                    </button>
                  </form>
                ) : (
                  <p key={r.id}>
                    {r.data.name} · {r.data.maskedIban} · {r.status}
                  </p>
                ),
              )}
          </details>
          <details>
            <summary>Reconcile payout outcomes</summary>
            {data.payouts.map((p: any) => (
              <form
                key={p.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  const { providerStatus, ...body } = Object.fromEntries(
                    new FormData(e.currentTarget),
                  );
                  void act("/payouts/" + p.id + "/reconcile", {
                    ...body,
                    ...(providerStatus ? { providerStatus } : {}),
                  });
                }}
              >
                <h3>
                  {p.period} · {money(Number(p.amount_minor))}
                </h3>
                <p>
                  {p.status} · {p.provider_id ?? "No provider reference"}
                </p>
                {p.status === "ready" && (
                  <button
                    type="button"
                    className="button"
                    disabled={busy}
                    onClick={() =>
                      void act("/payouts/" + p.id + "/execute", {})
                    }
                  >
                    Submit {money(Number(p.amount_minor))} bank payment
                  </button>
                )}
                {["ready", "held"].includes(p.status) && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt(
                        "Reason for canceling this unsent instruction (at least 10 characters)",
                      );
                      if (reason)
                        void act("/payouts/" + p.id + "/cancel", { reason });
                    }}
                  >
                    Cancel unsent instruction
                  </button>
                )}
                <label className="field">
                  <span>Verified outcome</span>
                  <select name="status">
                    {["processing", "paid", "failed", "returned"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Provider-reported status (required for failed)</span>
                  <select name="providerStatus" defaultValue="">
                    <option value="">Not applicable</option>
                    <option value="failed">Failed at provider</option>
                    <option value="rejected">Rejected by provider</option>
                    <option value="not_found">
                      No instruction at provider
                    </option>
                  </select>
                </label>
                <label className="field">
                  <span>Bank reference</span>
                  <input name="bankReference" minLength={5} required />
                </label>
                <label className="field">
                  <span>Evidence document reference</span>
                  <input name="evidenceReference" minLength={10} required />
                </label>
                <button className="button secondary" disabled={busy}>
                  Record bank outcome
                </button>
              </form>
            ))}
          </details>
          <details>
            <summary>Reconciliation exceptions</summary>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  "/exceptions",
                  Object.fromEntries(new FormData(e.currentTarget)),
                );
              }}
            >
              <label className="field">
                <span>Discrepancy</span>
                <textarea name="description" minLength={10} required />
              </label>
              <label className="field">
                <span>External reference</span>
                <input name="externalReference" required />
              </label>
              <button className="button secondary" disabled={busy}>
                Open exception
              </button>
            </form>
            {data.records
              .filter((r: any) => r.kind === "reconciliation")
              .map((r: any) => (
                <div key={r.id}>
                  <p>
                    {r.data.description} · {r.status}
                  </p>
                  {r.status !== "resolved" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(
                          "/exceptions/" + r.id + "/resolve",
                          Object.fromEntries(new FormData(e.currentTarget)),
                        );
                      }}
                    >
                      <label className="field">
                        <span>Resolution evidence</span>
                        <input
                          name="evidenceReference"
                          minLength={10}
                          required
                        />
                      </label>
                      <button className="button secondary" disabled={busy}>
                        Resolve exception
                      </button>
                    </form>
                  )}
                </div>
              ))}
          </details>
        </>
      )}
    </section>
  );
}
