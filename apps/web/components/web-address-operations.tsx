"use client";
import { useCallback, useEffect, useState } from "react";
import { api, day, Status } from "./web-address";

/**
 * Operator-only view of automatic domain orders (super admin, Integration
 * operations). This is the only web component that may name the registrar
 * or show its cost: trainer and subscriber screens never do (owner decision,
 * 28 September 2026; tests/web-address-moat.test.ts).
 */
const REGISTRAR_LABELS: Record<string, string> = {
  namecheap: "Namecheap",
  "101domain": "101domain",
  generic: "Generic registrar API",
};
const DNS_LABELS: Record<string, string> = {
  digitalocean: "DigitalOcean DNS",
  registrar: "Registrar DNS",
};

type OperatorOrder = Record<string, any> & {
  operations?: Array<Record<string, any>>;
};
type OperatorData = {
  root: string | null;
  registrar: string;
  testEnvironment: boolean;
  purchasesEnabled: boolean;
  modeProblem?: string | null;
  purchaseProblem?: string | null;
  dnsProvider?: string;
  attention: number;
  orders: OperatorOrder[];
};
export function WebAddressOperations({
  initial = null,
}: {
  initial?: OperatorData | null;
}) {
  const [data, setData] = useState<OperatorData | null>(initial),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setData(await api("/admin/web-addresses"));
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, [refresh]);
  const act = (order: OperatorOrder, action: string, reason: string) => {
    setBusy(true);
    setMessage("");
    // "dns-<provider>" sets the domain's DNS up again at that DNS host.
    const [path, body] = action.startsWith("dns-")
      ? ["dns", { reason, provider: action.slice(4) }]
      : [action, { reason }];
    void api(`/admin/web-addresses/${order.id}/${path}`, "POST", body)
      .then(async (result) => {
        await refresh();
        return result;
      })
      .then((result) => setMessage(result?.message ?? "Done"))
      .catch((e) => setMessage(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <section className="card web-address-panel">
      <h2>Web addresses</h2>
      <Status value={message} />
      {data && (
        <p className="muted">
          Subdomains:{" "}
          <span className="ltr-data">
            {data.root ? "*." + data.root : "off"}
          </span>
          {" · "}Registrar: {REGISTRAR_LABELS[data.registrar] ?? data.registrar}
          {data.testEnvironment ? " (test environment)" : ""}
          {" · "}Purchases {data.purchasesEnabled ? "on" : "off"}
          {" · "}New domains:{" "}
          {DNS_LABELS[data.dnsProvider ?? "registrar"] ?? data.dnsProvider}
          {" · "}
          <strong>{data.attention}</strong> need attention
        </p>
      )}
      {data?.modeProblem && (
        <p className="badge red">
          Purchases are refused: {data.modeProblem} Match the Stripe keys and
          the registrar test environment in Settings.
        </p>
      )}
      {data?.purchaseProblem && (
        <p className="badge amber">
          Purchases are off: {data.purchaseProblem}
        </p>
      )}
      {data?.orders.length === 0 && (
        <p className="muted">No automatic domain orders yet.</p>
      )}
      {data?.orders.map((order) => (
        <form
          key={order.id}
          className="web-address-operator"
          onSubmit={(event) => {
            event.preventDefault();
            const submitter = (event.nativeEvent as SubmitEvent)
              .submitter as HTMLButtonElement | null;
            const reason = String(
              new FormData(event.currentTarget).get("reason") ?? "",
            );
            if (submitter?.value) act(order, submitter.value, reason);
          }}
        >
          <p>
            <strong className="ltr-data">{order.hostname}</strong> ·{" "}
            {order.tenant_name} · {order.status}
            {order.renewal_status ? ` · renewal ${order.renewal_status}` : ""}
            {order.billing_status ? ` · billing ${order.billing_status}` : ""}
            {order.expires_at ? ` · until ${day(order.expires_at)}` : ""}
            {order.dns_provider
              ? ` · ${DNS_LABELS[order.dns_provider] ?? order.dns_provider}`
              : ""}
            {order.serve_mode === "forward" ? " · forwards to the subdomain" : ""}
          </p>
          {order.evidence?.zoneHeldElsewhere && (
            <p className="muted">
              Another DigitalOcean account holds this domain&apos;s zone, so
              it uses the registrar&apos;s DNS instead.
            </p>
          )}
          {order.status === "expired" &&
            order.dns_provider === "digitalocean" &&
            !order.evidence?.zoneReleasedAt && (
              <p className="muted">
                Its DNS zone is kept until nothing delegates the name to
                DigitalOcean any more, then deleted automatically.
              </p>
            )}
          {(order.attention || order.needsReconciliation) && (
            <p className="badge red">
              {order.attention ?? "A registrar attempt awaits reconciliation."}
            </p>
          )}
          {order.inFlight && (
            <p className="muted">
              A registrar request is running; it is reconciled automatically if
              no answer arrives.
            </p>
          )}
          {!!order.operations?.length && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Registrar or DNS call</th>
                    <th>Status</th>
                    <th>Cost (USD)</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {order.operations.map((op) => (
                    <tr key={op.id}>
                      <td className="ltr-data">{op.intent_key}</td>
                      <td>{op.status}</td>
                      <td>{op.cost_usd ?? ""}</td>
                      <td>{day(op.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <label>
            Reason (recorded)
            <input name="reason" required minLength={10} maxLength={500} />
          </label>
          <div className="button-row">
            <button name="action" value="reconcile" disabled={busy}>
              Reconcile now
            </button>
            <button name="action" value="retry" disabled={busy}>
              Retry step
            </button>
            {["paid", "purchasing"].includes(order.status) && (
              <button name="action" value="refund" disabled={busy}>
                Refund and close
              </button>
            )}
            {!["checkout", "cancelled", "failed"].includes(order.status) && (
              <button name="action" value="record" disabled={busy}>
                Record registrar state
              </button>
            )}
            {["owned", "zone", "delegating", "dns", "active"].includes(
              order.status,
            ) && (
              <>
                <button name="action" value="dns-settings" disabled={busy}>
                  Re-run DNS setup
                </button>
                {order.dns_provider !== "registrar" && (
                  <button name="action" value="dns-registrar" disabled={busy}>
                    Use registrar DNS
                  </button>
                )}
              </>
            )}
            {order.stripe_subscription_id &&
              order.billing_status !== "canceled" && (
                <button
                  name="action"
                  value="cancel-subscription"
                  disabled={busy}
                >
                  Cancel subscription
                </button>
              )}
          </div>
        </form>
      ))}
    </section>
  );
}
