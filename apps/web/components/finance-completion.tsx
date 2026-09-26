"use client";
import { useEffect, useState } from "react";
import { money } from "@trainer/domain";
async function request(url: string, body?: unknown) {
  const response = await fetch("/api/v1" + url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.message ?? "Request could not be completed");
  return data;
}
export function BillingHistory() {
  const [data, setData] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () => request("/membership/billing").then(setData);
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, []);
  async function act(url: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      await request(url, body);
      await refresh();
      setMessage("Billing updated.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Invoices and refunds</h2>
      <p className="muted">
        Download available receipts or choose an eligible charge to request a
        refund.
      </p>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {!data && !message && <p>Loading billing history…</p>}
      {data && (
        <>
          {data.transitions.length > 0 && (
            <div className="notice">
              <p>A renewal change is awaiting provider confirmation.</p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void act("/membership/renewal/reconcile", {})}
              >
                Check renewal status
              </button>
            </div>
          )}
          {!data.invoices.length && <p>No invoices yet.</p>}
          {data.invoices.map((r: any) => (
            <article className="list-row" key={r.id}>
              <div>
                <strong>{r.data.number ?? r.data.invoiceId}</strong>
                <p>
                  {new Date(r.data.issuedAt).toLocaleDateString()} ·{" "}
                  {money(r.data.amountPaid)} · {r.status}
                </p>
              </div>
              <div>
                {r.data.hostedUrl && (
                  <a
                    href={r.data.hostedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="button secondary"
                  >
                    View invoice
                  </a>
                )}{" "}
                {r.data.pdfUrl && (
                  <a href={r.data.pdfUrl} target="_blank" rel="noreferrer">
                    Download PDF
                  </a>
                )}
              </div>
            </article>
          ))}
          {data.charges.some((c: any) => c.eligible) && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act("/refund-requests", {
                  chargeId: f.get("chargeId"),
                  reason: f.get("reason"),
                });
              }}
            >
              <h3>Request a refund</h3>
              <label className="field">
                <span>Payment</span>
                <select required name="chargeId">
                  {data.charges
                    .filter((c: any) => c.eligible)
                    .map((c: any) => (
                      <option key={c.id} value={c.chargeId}>
                        {new Date(c.chargedAt).toLocaleDateString()} —{" "}
                        {money(c.remainingMinor)}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Reason</span>
                <textarea
                  name="reason"
                  minLength={5}
                  maxLength={2000}
                  required
                />
              </label>
              <button className="button" disabled={busy}>
                Send refund request
              </button>
            </form>
          )}
          {data.requests.length > 0 && (
            <>
              <h3>Your refund requests</h3>
              {data.requests.map((r: any) => (
                <article className="list-row" key={r.id}>
                  <div>
                    <strong>{money(r.data.amountMinor)}</strong>
                    <p>{r.data.reason}</p>
                    {r.data.decisionReason && <p>{r.data.decisionReason}</p>}
                  </div>
                  <span className="badge">{r.status}</span>
                </article>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}

export function TrainerFinanceTools() {
  const [data, setData] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () => request("/finance/completion").then(setData);
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, []);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      await request(path, body);
      await refresh();
      setMessage("Saved.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <FinancialStatementView />
      <section className="card">
        <h2>Offers and promotions</h2>
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
        {data && (
          <>
            <h3>First membership trial</h3>
            <p>
              Trial access is granted by Stripe's signed subscription state.
              Returning members do not receive another trial.
            </p>
            {data.products.map((p: any) => (
              <form
                className="form-grid"
                key={p.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(`/finance/products/${p.id}/trial`, {
                    revision: p.version,
                    trialDays: Number(f.get("days")),
                  });
                }}
              >
                <label className="field">
                  <span>{p.data.name}: trial days</span>
                  <input
                    key={p.version}
                    name="days"
                    type="number"
                    min="0"
                    max="30"
                    defaultValue={p.data.trialDays ?? 0}
                  />
                </label>
                <button disabled={busy} className="button secondary">
                  Save trial
                </button>
              </form>
            ))}
            <h3>New discount code</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act("/finance/promotions", {
                  code: f.get("code"),
                  productId: f.get("productId"),
                  percentOff: Number(f.get("percentOff")),
                  maxRedemptions: Number(f.get("maxRedemptions")),
                  expiresAt: new Date(String(f.get("expiresAt"))).toISOString(),
                  reason: f.get("reason"),
                });
              }}
            >
              <div className="form-grid">
                <label className="field">
                  <span>Code</span>
                  <input
                    required
                    name="code"
                    pattern="[A-Za-z0-9_-]+"
                    minLength={3}
                    maxLength={40}
                  />
                </label>
                <label className="field">
                  <span>Offer</span>
                  <select required name="productId">
                    {data.products
                      .filter((p: any) => p.status === "published")
                      .map((p: any) => (
                        <option key={p.id} value={p.id}>
                          {p.data.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>First invoice discount (%)</span>
                  <input
                    required
                    name="percentOff"
                    type="number"
                    min="1"
                    max="100"
                    defaultValue="10"
                  />
                </label>
                <label className="field">
                  <span>Maximum redemptions</span>
                  <input
                    required
                    name="maxRedemptions"
                    type="number"
                    min="1"
                    max="100000"
                    defaultValue="50"
                  />
                </label>
                <label className="field">
                  <span>Expires</span>
                  <input required name="expiresAt" type="datetime-local" />
                </label>
                <label className="field">
                  <span>Reason</span>
                  <input required name="reason" minLength={5} maxLength={500} />
                </label>
              </div>
              <button className="button" disabled={busy}>
                Publish discount
              </button>
            </form>
            {data.records
              .filter((r: any) => r.kind === "promotion")
              .map((r: any) => (
                <article key={r.id} className="list-row">
                  <div>
                    <strong>{r.data.code}</strong>
                    <p>
                      {r.data.percentOff}% · {r.status} · expires{" "}
                      {new Date(r.data.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  {["creating", "unknown"].includes(r.status) ? (
                    <button
                      disabled={busy}
                      className="button secondary"
                      onClick={() =>
                        void act(`/finance/promotions/${r.id}/reconcile`, {})
                      }
                    >
                      Check provider
                    </button>
                  ) : (
                    r.status === "published" && (
                      <button
                        disabled={busy}
                        className="button secondary"
                        onClick={() =>
                          void act(`/finance/promotions/${r.id}/archive`, {
                            revision: r.version,
                            reason: "Trainer ended this promotion",
                          })
                        }
                      >
                        End promotion
                      </button>
                    )
                  )}
                </article>
              ))}
          </>
        )}
      </section>
    </>
  );
}
function FinancialStatementView({ tenant }: { tenant?: string }) {
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)),
    [data, setData] = useState<any>(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    setData(null);
    setMessage("");
    void request(
      `${tenant ? `/admin/tenants/${tenant}` : ""}/finance/statements/${period}`,
    )
      .then(setData)
      .catch((e) => setMessage(e.message));
  }, [period, tenant]);
  const labels: any = {
    openingPayableMinor: "Opening trainer payable",
    grossMinor: "Gross collections",
    refundsMinor: "Refunds",
    commissionMinor: "Net platform commission",
    processingFeesMinor: "Payment processing fees",
    usageMinor: "AI and voice usage",
    allocatedCostsMinor: "Allocated charges",
    payoutsMinor: "Bank payouts",
    payoutReturnsMinor: "Returned bank payouts",
    otherPayableMovementMinor: "Other adjustments",
    closingPayableMinor: "Closing trainer payable",
  };
  return (
    <section className="card">
      <h2>Monthly statement</h2>
      <label className="field">
        <span>Month (Dubai time)</span>
        <input
          type="month"
          value={period}
          onChange={(e) => {
            if (e.target.value) setPeriod(e.target.value);
          }}
        />
      </label>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {data && (
        <>
          <p>
            {data.close
              ? "Reconciled monthly close is recorded."
              : "Open statement: totals change as transactions are reconciled."}
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>AED</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(labels).map(([key, label]) => (
                  <tr key={key}>
                    <td>{String(label)}</td>
                    <td>{money(data.totals[key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Provider usage</h3>
          {!data.usage.length ? (
            <p>No recorded usage this month.</p>
          ) : (
            data.usage.map((r: any, i: number) => (
              <p key={i}>
                {r.provider} / {r.model ?? "service"}: {r.calls} calls · USD{" "}
                {r.cost_usd ?? "unresolved"} · {r.unresolved} unpriced
              </p>
            ))
          )}
          <h3>Infrastructure and other costs</h3>
          {!data.allocations.length ? (
            <p>No costs allocated this month.</p>
          ) : (
            data.allocations.map((r: any) => (
              <p key={r.id}>
                {r.data.category}: {money(r.data.amountMinor)} ·{" "}
                {r.data.chargeTrainer
                  ? "charged to trainer"
                  : "absorbed by platform"}{" "}
                · {r.data.description}
              </p>
            ))
          )}
        </>
      )}
    </section>
  );
}
export function FinancePolicyConsole({ tenants }: { tenants: any[] }) {
  const [tenant, setTenant] = useState(tenants[0]?.id ?? ""),
    [data, setData] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [costIntent, setCostIntent] = useState("");
  useEffect(() => {
    setCostIntent(crypto.randomUUID());
  }, []);
  const refresh = () =>
    request(`/admin/tenants/${tenant}/finance/controls`).then(setData);
  useEffect(() => {
    setData(null);
    if (tenant) void refresh().catch((e) => setMessage(e.message));
  }, [tenant]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      await request(`/admin/tenants/${tenant}/finance${path}`, body);
      await refresh();
      setMessage("Saved with audit evidence.");
      if (path === "/cost-allocations") setCostIntent(crypto.randomUUID());
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const latest = data?.records.find((r: any) => r.kind === "finance_policy");
  return (
    <>
      <section className="card">
        <h2>Financial policies and cost allocation</h2>
        <label className="field">
          <span>Workspace</span>
          <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
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
            <p>
              Publishing creates an immutable prospective revision. Existing
              transactions retain their original fee policy.
            </p>
            <form
              key={latest?.id ?? tenant}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act("/policies", {
                  revision: latest?.id ?? null,
                  effectiveAt: new Date(
                    String(f.get("effectiveAt")),
                  ).toISOString(),
                  commissionBps: [1, 2, 3, 4].map((n) =>
                    Math.round(Number(f.get("band" + n)) * 100),
                  ),
                  bookingFeeBps: Math.round(Number(f.get("bookingFee")) * 100),
                  graceDays: Number(f.get("grace")),
                  reason: f.get("reason"),
                });
              }}
            >
              <div className="form-grid">
                {[
                  "Members 1–100",
                  "Members 101–300",
                  "Members 301–1,000",
                  "Members 1,001+",
                ].map((label, i) => (
                  <label className="field" key={label}>
                    <span>{label}: commission %</span>
                    <input
                      type="number"
                      name={"band" + (i + 1)}
                      min="0"
                      max="100"
                      step="0.01"
                      defaultValue={
                        (latest?.data.commissionBps?.[i] ??
                          [2500, 2000, 1500, 1000][i]) / 100
                      }
                      required
                    />
                  </label>
                ))}
                <label className="field">
                  <span>Paid booking fee %</span>
                  <input
                    type="number"
                    name="bookingFee"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={(latest?.data.bookingFeeBps ?? 0) / 100}
                    required
                  />
                </label>
                <label className="field">
                  <span>Failed-payment grace days</span>
                  <input
                    type="number"
                    name="grace"
                    min="0"
                    max="14"
                    defaultValue={latest?.data.graceDays ?? 3}
                    required
                  />
                </label>
                <label className="field">
                  <span>Effective from</span>
                  <input required type="datetime-local" name="effectiveAt" />
                </label>
                <label className="field">
                  <span>Reason</span>
                  <input
                    required
                    name="reason"
                    minLength={10}
                    maxLength={1000}
                  />
                </label>
              </div>
              <button className="button" disabled={busy}>
                Publish policy revision
              </button>
            </form>
            <details>
              <summary>Record a provider or infrastructure cost</summary>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act("/cost-allocations", {
                    intent: String(f.get("intent")),
                    period: f.get("period"),
                    category: f.get("category"),
                    amountMinor: Math.round(Number(f.get("amount")) * 100),
                    chargeTrainer: f.get("chargeTrainer") === "on",
                    description: f.get("description"),
                    evidenceReference: f.get("evidence"),
                  });
                }}
              >
                <input type="hidden" name="intent" value={costIntent} />
                <div className="form-grid">
                  <label className="field">
                    <span>Month</span>
                    <input required type="month" name="period" />
                  </label>
                  <label className="field">
                    <span>Category</span>
                    <select name="category">
                      <option>infrastructure</option>
                      <option>voice</option>
                      <option>provider</option>
                      <option>other</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Amount AED</span>
                    <input
                      required
                      name="amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                    />
                  </label>
                  <label className="field">
                    <span>Description</span>
                    <input
                      required
                      name="description"
                      minLength={5}
                      maxLength={500}
                    />
                  </label>
                  <label className="field">
                    <span>Evidence reference</span>
                    <input
                      required
                      name="evidence"
                      minLength={10}
                      maxLength={500}
                    />
                  </label>
                  <label>
                    <input type="checkbox" name="chargeTrainer" />
                    Charge trainer under agreed policy
                  </label>
                </div>
                <button className="button" disabled={busy}>
                  Record cost
                </button>
              </form>
            </details>
            <h3>Policy history</h3>
            {data.records
              .filter((r: any) => r.kind === "finance_policy")
              .map((r: any) => (
                <p key={r.id}>
                  {new Date(r.data.effectiveAt).toLocaleString()} ·{" "}
                  {r.data.commissionBps
                    .map((b: number) => b / 100 + "%")
                    .join(" / ")}{" "}
                  · {r.data.reason}
                </p>
              ))}
          </>
        )}
      </section>
      {tenant && <FinancialStatementView tenant={tenant} />}
    </>
  );
}

export function FinanceAutomationConsole({ tenants }: { tenants: any[] }) {
  const [tenant, setTenant] = useState(tenants[0]?.id ?? ""),
    [data, setData] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = () =>
    request(`/admin/tenants/${tenant}/finance/automation`).then(setData);
  useEffect(() => {
    setData(null);
    if (tenant) void refresh().catch((e) => setMessage(e.message));
  }, [tenant]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      await request(`/admin/tenants/${tenant}/finance/automation${path}`, body);
      await refresh();
      setMessage("Finance automation updated.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const c = data?.configuration;
  return (
    <section className="card">
      <h2>Finance automation</h2>
      <label className="field">
        <span>Workspace</span>
        <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {data && (
        <>
          <p>
            Reads and receipt replay reconcile provider facts. Monthly close
            requires settled collections and resolved obligations. A payment
            acknowledgment remains pending until bank finality evidence is
            recorded.
          </p>
          <form
            key={c?.version ?? tenant}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act("", {
                revision: c?.version ?? 0,
                enabled: f.get("enabled") === "on",
                reconcileStripe: f.get("reconcileStripe") === "on",
                closeMonthly: f.get("closeMonthly") === "on",
                preparePayouts: f.get("preparePayouts") === "on",
                executePayouts: f.get("executePayouts") === "on",
                maxPayoutMinor: Math.round(Number(f.get("maxPayout")) * 100),
                fxAedPerUsd: Number(f.get("fx")),
                fxEvidence: f.get("fxEvidence"),
                reason: f.get("reason"),
              });
            }}
          >
            <div className="form-grid">
              {[
                ["enabled", "Enable finance jobs"],
                [
                  "reconcileStripe",
                  "Read Stripe subscriptions, invoices and unresolved payments",
                ],
                [
                  "closeMonthly",
                  "Close reconciled months after seven-day review period",
                ],
                ["preparePayouts", "Prepare eligible funded payouts"],
                ["executePayouts", "Execute approved payouts within the cap"],
              ].map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    name={key}
                    defaultChecked={c?.data[key] ?? false}
                  />
                  {label}
                </label>
              ))}
              <label className="field">
                <span>Maximum automatic payout AED</span>
                <input
                  name="maxPayout"
                  type="number"
                  min="0"
                  max="10000000"
                  step="0.01"
                  defaultValue={(c?.data.maxPayoutMinor ?? 0) / 100}
                  required
                />
              </label>
              <label className="field">
                <span>Reviewed USD → AED conversion</span>
                <input
                  name="fx"
                  type="number"
                  min="0.000001"
                  max="100"
                  step="0.000001"
                  defaultValue={c?.data.fxAedPerUsd ?? ""}
                  required
                />
              </label>
              <label className="field">
                <span>Conversion evidence reference</span>
                <input
                  name="fxEvidence"
                  defaultValue={c?.data.fxEvidence ?? ""}
                  minLength={10}
                  maxLength={500}
                  required
                />
              </label>
              <label className="field">
                <span>Approval reason</span>
                <input name="reason" minLength={10} maxLength={1000} required />
              </label>
            </div>
            <button className="button" disabled={busy}>
              Save reviewed automation
            </button>
          </form>
          <button
            className="button secondary"
            disabled={busy || !c?.data.enabled}
            onClick={() => void act("/schedule", {})}
          >
            Schedule due jobs
          </button>
          <h3>Job history</h3>
          {!data.jobs.length ? (
            <p>No finance jobs scheduled.</p>
          ) : (
            data.jobs.map((j: any) => (
              <article className="list-row" key={j.id}>
                <div>
                  <strong>{j.kind.replaceAll("_", " ")}</strong>
                  <p>
                    {j.status} · {j.attempts} attempts
                    {j.last_error ? " · " + j.last_error : ""}
                  </p>
                </div>
                {["blocked", "failed"].includes(j.status) && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void act(`/jobs/${j.id}/retry`, {
                        attempts: j.attempts,
                        reason: f.get("reason"),
                      });
                    }}
                  >
                    <label className="field">
                      <span>Resolution evidence / retry reason</span>
                      <input
                        name="reason"
                        required
                        minLength={10}
                        maxLength={500}
                      />
                    </label>
                    <button className="button secondary" disabled={busy}>
                      Recheck same instruction
                    </button>
                  </form>
                )}
              </article>
            ))
          )}
        </>
      )}
    </section>
  );
}
