"use client";
import { useCallback, useEffect, useState } from "react";
import { api, day, formatMoney, Status } from "./web-address";

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
/**
 * A quoted price: USD for orders from 28 September 2026 (first year and
 * renewal separately), AED for orders quoted before (one yearly price).
 */
function money(quote: Record<string, any>, which: "first" | "renewal") {
  const currency = quote.currency === "USD" ? "USD" : "AED";
  const minor = Number(
    (which === "first" ? quote.firstYearPriceMinor : quote.renewalPriceMinor) ??
      quote.priceMinor ??
      0,
  );
  return formatMoney(minor, currency);
}
/** One ending trainers can buy, as the price cache holds it (operators only). */
type EndingRow = {
  tld: string;
  suggested: boolean;
  state: "offered" | "over_cap" | "not_offered" | "unknown";
  fetchedAt: string | null;
  reason?: string;
  registerUsd?: string;
  renewUsd?: string;
  firstYearPriceMinor?: number;
  renewalPriceMinor?: number;
  firstYearMarginMinor?: number;
  renewalMarginMinor?: number;
};
type PriceData = {
  registrar: string;
  testEnvironment: boolean;
  endings: EndingRow[];
  refreshed?: Array<{ tld: string; refreshed: boolean; error?: string }>;
};
const ENDING_STATE: Record<EndingRow["state"], string> = {
  offered: "Offered",
  over_cap: "Hidden: over the price cap",
  not_offered: "Not sold by the registrar's API",
  unknown: "Not priced yet",
};
const usd = (minor?: number) =>
  typeof minor === "number" ? formatMoney(minor, "USD") : "";
/**
 * Registrar prices per ending, the trainer's two prices under the current
 * rule and the margin left before Stripe's fees, with a refresh that asks the
 * registrar again (within the interactive call budget).
 */
export function RegistrarPrices({
  initial = null,
}: {
  initial?: PriceData | null;
}) {
  const [data, setData] = useState<PriceData | null>(initial),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (initial) return;
    void api("/admin/web-addresses/prices")
      .then(setData)
      .catch((e) => setMessage(e.message));
  }, [initial]);
  return (
    <div className="web-address-prices">
      <h3>Registrar prices per ending</h3>
      <Status value={message} />
      <p className="muted small-label">
        Margin is the trainer&apos;s price less the registrar&apos;s cost,
        before Stripe&apos;s fees and any currency conversion. Endings with a
        thin margin may lose money once those are taken.
      </p>
      {data && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ending</th>
                <th>State</th>
                <th>Registrar cost (USD, first year / renewal)</th>
                <th>Trainer pays</th>
                <th>Margin before Stripe fees</th>
                <th>Priced</th>
              </tr>
            </thead>
            <tbody>
              {data.endings.map((row) => (
                <tr key={row.tld}>
                  <td className="ltr-data">
                    .{row.tld}
                    {row.suggested ? "" : " (typed only)"}
                  </td>
                  <td>
                    {ENDING_STATE[row.state]}
                    {row.reason ? `: ${row.reason}` : ""}
                  </td>
                  <td>
                    {row.registerUsd
                      ? `${row.registerUsd} / ${row.renewUsd}`
                      : ""}
                  </td>
                  <td>
                    {row.firstYearPriceMinor !== undefined
                      ? `${usd(row.firstYearPriceMinor)} / ${usd(row.renewalPriceMinor)}`
                      : ""}
                  </td>
                  <td>
                    {row.firstYearMarginMinor !== undefined
                      ? `${usd(row.firstYearMarginMinor)} / ${usd(row.renewalMarginMinor)}`
                      : ""}
                  </td>
                  <td>{row.fetchedAt ? day(row.fetchedAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form
        className="web-address-row"
        onSubmit={(event) => {
          event.preventDefault();
          const reason = String(
            new FormData(event.currentTarget).get("reason") ?? "",
          );
          setBusy(true);
          setMessage("");
          void api("/admin/web-addresses/prices/refresh", "POST", { reason })
            .then((result: PriceData) => {
              setData(result);
              const failed = (result.refreshed ?? []).filter(
                (r) => !r.refreshed,
              );
              setMessage(
                failed.length
                  ? `Not refreshed: ${failed.map((r) => `.${r.tld} (${r.error ?? "no answer"})`).join(", ")}`
                  : "Prices refreshed",
              );
            })
            .catch((e) => setMessage(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Reason (recorded)
          <input name="reason" required minLength={10} maxLength={500} />
        </label>
        <button disabled={busy}>Refresh prices now</button>
      </form>
    </div>
  );
}
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
  prices = null,
}: {
  initial?: OperatorData | null;
  /** Test state for the registrar price table (fetched otherwise). */
  prices?: PriceData | null;
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
      <RegistrarPrices initial={prices} />
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
          {order.quote && (
            <p className="muted">
              Trainer pays {money(order.quote, "first")} the first year and{" "}
              {money(order.quote, "renewal")} a year after
              {order.quote.registerUsd
                ? ` · registrar cost USD ${order.quote.registerUsd} / ${order.quote.renewUsd}`
                : ""}
              {order.quote.premium ? " · premium name" : ""}
            </p>
          )}
          {order.evidence?.zoneHeldElsewhere && (
            <p className="muted">
              Another DigitalOcean account holds this domain&apos;s zone, so
              it was never delegated there.
            </p>
          )}
          {order.evidence?.zoneWrittenAt &&
            !order.evidence?.zoneReleasedAt &&
            !order.evidence?.zoneHandedOverAt &&
            (order.status === "expired" ||
              order.dns_provider === "registrar") && (
              <p className="muted">
                Its DigitalOcean zone is kept (without its A records once
                lapsed) until nothing delegates the name to DigitalOcean any
                more, then deleted automatically.
              </p>
            )}
          {(order.attention || order.needsReconciliation) && (
            <p className="badge red">
              {order.attention ?? "A registrar attempt awaits reconciliation."}
            </p>
          )}
          {order.costAlert && (
            <p className="badge amber">{order.costAlert}</p>
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
                {order.dns_provider !== "registrar" &&
                  // 101domain's own DNS cannot be set up through its API.
                  order.registrar !== "101domain" && (
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
