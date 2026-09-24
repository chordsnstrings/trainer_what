"use client";
import { useEffect, useState } from "react";
import { money } from "@trainer/domain";
export function FinanceOperations({ tenants }: { tenants: any[] }) {
  const [tenant, setTenant] = useState(tenants[0]?.id ?? ""),
    [data, setData] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
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
              <h3>{money(data.summary.accounts.stripe_receivable ?? 0)}</h3>
            </div>
            <div>
              <small>Reconciled bank funds</small>
              <h3>{money(data.summary.accounts.bank_cash ?? 0)}</h3>
            </div>
            <div>
              <small>Trainer payable</small>
              <h3>{money(data.summary.earnedMinor)}</h3>
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
          <details>
            <summary>
              Reconcile unknown AI usage ({data.unresolvedUsage?.length ?? 0})
            </summary>
            <p className="muted">
              Check the provider request or invoice before recording its actual
              USD cost. Confirmed zero cost also requires evidence. Requests
              from the last five minutes must finish first.
            </p>
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
              Convert recorded provider cost at the reviewed exchange rate. The
              server checks the amount and posts it once against trainer
              earnings.
            </p>
            <form
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
                {s.period} · {money(Number(s.charge_minor))} ·{" "}
                {s.fee_schedule_version}
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
              .map((r: any) => (
                <form
                  key={r.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act("/beneficiaries/" + r.id + "/review", {
                      providerId: f.get("providerId"),
                      evidenceReference: f.get("evidenceReference"),
                      verified: f.get("verified") === "on",
                    });
                  }}
                >
                  <h3>
                    {r.data.name} · {r.data.maskedIban}
                  </h3>
                  <p>{r.status}</p>
                  <label className="field">
                    <span>Verified provider destination ID</span>
                    <input
                      name="providerId"
                      defaultValue={r.data.providerId}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>Identity and account ownership evidence</span>
                    <input name="evidenceReference" minLength={10} required />
                  </label>
                  <label className="check-field">
                    <input name="verified" type="checkbox" />
                    Provider verification and account ownership are confirmed
                  </label>
                  <button className="button secondary" disabled={busy}>
                    Record review and bank-change hold
                  </button>
                </form>
              ))}
          </details>
          <details>
            <summary>Reconcile payout outcomes</summary>
            {data.payouts.map((p: any) => (
              <form
                key={p.id}
                onSubmit={(e) => {
                  e.preventDefault();
                  void act(
                    "/payouts/" + p.id + "/reconcile",
                    Object.fromEntries(new FormData(e.currentTarget)),
                  );
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
                <label className="field">
                  <span>Verified outcome</span>
                  <select name="status">
                    {["processing", "paid", "failed", "returned"].map((s) => (
                      <option key={s}>{s}</option>
                    ))}
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
