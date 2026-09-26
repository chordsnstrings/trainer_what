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
