"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";

/** Trainer web address (subdomain, slug change, domain purchase) and the operator view. */
async function api(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(data.message ?? "The request could not be completed."),
      { code: data.code, priceMinor: data.priceMinor },
    );
  return data;
}
const aed = (minor: number) =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 2,
  }).format(minor / 100);
const day = (value?: string | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : "";
const IN_PROGRESS = ["checkout", "paid", "purchasing", "owned", "dns"];
const STEPS: Array<[string, string]> = [
  ["paid", "Paid"],
  ["registered", "Registered"],
  ["dns", "DNS set up"],
  ["certificate", "Security certificate"],
  ["live", "Live"],
];

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card web-address-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function Status({ value }: { value: string }) {
  return value ? (
    <p role="status" className="notice">
      {value}
    </p>
  ) : null;
}

export type WebAddressOrder = {
  id: string;
  hostname: string;
  status: string;
  statusLabel: string;
  priceMinor: number;
  expiresAt?: string | null;
  liveAt?: string | null;
  renewalEnabled: boolean;
  renewalStatus?: string | null;
  billingStatus?: string | null;
  nextRenewalChargeAt?: string | null;
  progress: Array<{ step: string; at: string }>;
  needsReview: boolean;
};
export type WebAddressState = {
  slug: string;
  published: boolean;
  path: string;
  subdomain: {
    enabled: boolean;
    eligible: boolean;
    host: string | null;
    url: string | null;
    live: boolean;
  };
  slugChanges: { used: number; limit: number; redirectDays: number };
  redirects: Array<{ slug: string; until: string }>;
  purchases: {
    enabled: boolean;
    endings: string[];
    testEnvironment: boolean;
  };
  orders: WebAddressOrder[];
};
type Result = {
  domain: string;
  available: boolean;
  premium: boolean;
  priceMinor: number | null;
};

export function WebAddressCenter({
  manual,
  initial = null,
}: {
  manual?: ReactNode;
  /** Server-provided or test state shown before the first refresh. */
  initial?: WebAddressState | null;
}) {
  const [state, setState] = useState<WebAddressState | null>(initial),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setState(await api("/web-address"));
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, [refresh]);
  // Live progress while an order is being set up.
  const working = !!state?.orders.some((o) => IN_PROGRESS.includes(o.status));
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [working, refresh]);
  const run = async (fn: () => Promise<unknown>, done = "Saved") => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await refresh();
      setMessage(done);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  if (!state)
    return (
      <>
        <Status value={message} />
        <Panel title="Your web address">
          <p className="muted">Loading your address…</p>
        </Panel>
      </>
    );
  return (
    <div className="stack web-address">
      <Status value={message} />
      <Panel title="Your web address">
        {state.subdomain.enabled && state.subdomain.url ? (
          <p>
            <a
              className="ltr-data web-address-url"
              href={state.subdomain.url}
              rel="noreferrer"
            >
              {state.subdomain.host}
            </a>{" "}
            <span
              className={"badge " + (state.subdomain.live ? "green" : "amber")}
            >
              {state.subdomain.live ? "Live" : "Live after you publish"}
            </span>
          </p>
        ) : state.subdomain.enabled ? (
          <p>
            Your current address cannot be used as a web address. Choose a new
            address below to get one.
          </p>
        ) : null}
        <p className="muted">
          Also available at <span className="ltr-data">{state.path}</span> on
          the platform. Your website and member app sign-in work on every
          address.
        </p>
        {state.redirects.length > 0 && (
          <p className="muted">
            Previous addresses still redirect:{" "}
            {state.redirects.map((r) => (
              <span key={r.slug} className="ltr-data web-address-chip">
                {r.slug} (until {day(r.until)})
              </span>
            ))}
          </p>
        )}
        <form
          className="web-address-row"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const slug = String(form.get("slug") ?? "")
              .trim()
              .toLowerCase();
            void run(
              () =>
                api("/web-address/slug", "POST", {
                  slug,
                  currentSlug: state.slug,
                }),
              "Address changed. The previous one redirects for " +
                state.slugChanges.redirectDays +
                " days.",
            );
          }}
        >
          <label>
            Change address
            <input
              name="slug"
              required
              minLength={3}
              maxLength={40}
              pattern="[a-z][a-z0-9\-]{2,39}"
              defaultValue={state.slug}
              dir="ltr"
              autoComplete="off"
            />
          </label>
          <button disabled={busy}>Change</button>
        </form>
        <p className="muted small-label">
          {state.slugChanges.used} of {state.slugChanges.limit} changes used in
          the last year. Changing needs a recent authenticator check.
        </p>
      </Panel>
      {state.purchases.enabled ? (
        <DomainSearch
          busy={busy}
          testEnvironment={state.purchases.testEnvironment}
          endings={state.purchases.endings}
          onError={setMessage}
        />
      ) : (
        <Panel title="Your own domain">
          <p className="muted">
            Buying a domain here is not available yet. You can still connect a
            domain you already own below.
          </p>
        </Panel>
      )}
      {state.orders.map((order) => (
        <OrderCard key={order.id} order={order} busy={busy} run={run} />
      ))}
      {manual}
    </div>
  );
}

function DomainSearch({
  busy,
  testEnvironment,
  endings,
  onError,
}: {
  busy: boolean;
  testEnvironment: boolean;
  endings: string[];
  onError: (message: string) => void;
}) {
  const [results, setResults] = useState<Result[]>([]),
    [searching, setSearching] = useState(false),
    [chosen, setChosen] = useState<Result | null>(null),
    [paying, setPaying] = useState(false);
  const search = async (q: string) => {
    setSearching(true);
    setChosen(null);
    onError("");
    try {
      const data = await api("/web-address/search?q=" + encodeURIComponent(q));
      setResults(data.results);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  };
  const pay = async (result: Result) => {
    setPaying(true);
    onError("");
    try {
      const data = await api("/web-address/orders", "POST", {
        domain: result.domain,
        priceMinor: result.priceMinor,
        accepted: true,
      });
      window.location.assign(data.url);
    } catch (e: any) {
      if (e?.code === "PRICE_CHANGED" && Number.isInteger(e.priceMinor)) {
        setChosen({ ...result, priceMinor: e.priceMinor });
        onError(
          "The price changed. Check the new yearly price and confirm again.",
        );
      } else onError(e instanceof Error ? e.message : "Checkout failed.");
      setPaying(false);
    }
  };
  return (
    <Panel title="Your own domain">
      <p>
        Search a name, see the yearly price and pay by card. We register the
        domain, set it up and renew it every year. Endings:{" "}
        <span className="ltr-data">
          {endings.map((e) => "." + e).join(" ")}
        </span>
      </p>
      {testEnvironment && (
        <p className="badge amber">
          Test environment: no real domain is registered.
        </p>
      )}
      <form
        className="web-address-row"
        onSubmit={(event) => {
          event.preventDefault();
          const q = String(new FormData(event.currentTarget).get("q") ?? "");
          void search(q);
        }}
      >
        <label>
          Domain name
          <input
            name="q"
            required
            maxLength={80}
            placeholder="laylastrength"
            dir="ltr"
            autoComplete="off"
          />
        </label>
        <button disabled={searching || busy}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>
      {results.length > 0 && (
        <ul className="web-address-results">
          {results.map((result) => (
            <li key={result.domain}>
              <span className="ltr-data">{result.domain}</span>
              {result.available && result.priceMinor ? (
                <>
                  <span>{aed(result.priceMinor)} per year</span>
                  <button
                    type="button"
                    className="button"
                    disabled={paying}
                    onClick={() => setChosen(result)}
                  >
                    Choose
                  </button>
                </>
              ) : (
                <span className="muted">
                  {result.premium ? "Premium name, not offered" : "Taken"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {chosen?.priceMinor ? (
        <form
          className="web-address-confirm"
          onSubmit={(event) => {
            event.preventDefault();
            void pay(chosen);
          }}
        >
          <p>
            <strong className="ltr-data">{chosen.domain}</strong> costs{" "}
            <strong>{aed(chosen.priceMinor)}</strong> now and every year until
            you turn renewal off. The price includes registration, private owner
            details (WHOIS privacy), DNS and the security certificate.
          </p>
          <label className="check-field">
            <input type="checkbox" required /> I agree to pay{" "}
            {aed(chosen.priceMinor)} per year, renewed automatically.
          </label>
          <button disabled={paying}>
            {paying ? "Opening payment…" : "Pay with card"}
          </button>
        </form>
      ) : null}
    </Panel>
  );
}

export function OrderCard({
  order,
  busy,
  run,
}: {
  order: WebAddressOrder;
  busy: boolean;
  run: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const reached = new Set(order.progress.map((p) => p.step));
  return (
    <Panel title={order.hostname}>
      <p>
        <span
          className={
            "badge " +
            (order.status === "active"
              ? "green"
              : ["failed", "expired", "cancelled"].includes(order.status)
                ? "red"
                : "amber")
          }
        >
          {order.statusLabel}
        </span>{" "}
        {aed(order.priceMinor)} per year
      </p>
      {!["cancelled", "checkout"].includes(order.status) && (
        <ol className="web-address-steps">
          {STEPS.map(([step, label]) => (
            <li key={step} data-done={reached.has(step) ? "true" : "false"}>
              {label}
            </li>
          ))}
        </ol>
      )}
      {order.needsReview && (
        <p className="muted">
          The platform team is checking this step. You do not need to do
          anything.
        </p>
      )}
      {order.status === "active" && (
        <p>
          <a
            className="ltr-data"
            href={"https://" + order.hostname}
            rel="noreferrer"
          >
            https://{order.hostname}
          </a>
        </p>
      )}
      {order.expiresAt && (
        <p className="muted">
          Registered until {day(order.expiresAt)}.
          {order.renewalEnabled
            ? order.nextRenewalChargeAt
              ? ` Next yearly charge on ${day(order.nextRenewalChargeAt)}.`
              : " Renews automatically every year."
            : " Renewal is off: the domain stops working after this date."}
        </p>
      )}
      {order.status === "checkout" && (
        <div className="button-row">
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const data = await api(
                  `/web-address/orders/${order.id}/checkout`,
                  "POST",
                  {},
                );
                window.location.assign(data.url);
              }, "Opening payment…")
            }
          >
            Continue to payment
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() =>
              void run(
                () => api(`/web-address/orders/${order.id}/cancel`, "POST", {}),
                "Checkout cancelled",
              )
            }
          >
            Cancel
          </button>
        </div>
      )}
      {["owned", "dns", "active"].includes(order.status) &&
        order.billingStatus !== "canceled" && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  api(`/web-address/orders/${order.id}/renewal`, "POST", {
                    enabled: !order.renewalEnabled,
                  }),
                order.renewalEnabled
                  ? "Renewal turned off"
                  : "Renewal turned on",
              )
            }
          >
            {order.renewalEnabled
              ? "Turn off yearly renewal"
              : "Turn renewal back on"}
          </button>
        )}
    </Panel>
  );
}

type OperatorOrder = Record<string, any> & {
  operations?: Array<Record<string, any>>;
};
type OperatorData = {
  root: string | null;
  registrar: string;
  testEnvironment: boolean;
  purchasesEnabled: boolean;
  modeProblem?: string | null;
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
    void api(`/admin/web-addresses/${order.id}/${action}`, "POST", { reason })
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
          {" · "}Registrar: {data.registrar}
          {data.testEnvironment ? " (test environment)" : ""}
          {" · "}Purchases {data.purchasesEnabled ? "on" : "off"}
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
          </p>
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
                    <th>Registrar call</th>
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
