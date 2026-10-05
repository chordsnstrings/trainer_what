"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  renewalIncrease,
  renewalPriceNote,
} from "../../../packages/domain/src/web-address.ts";

/**
 * Trainer web address (subdomain, slug change, domain search and purchase).
 * Trainer screens show only the first-year and yearly renewal price, in US
 * dollars, side by side, with a note whenever the renewal costs more than
 * the first year (owner decisions, 28 September 2026; orders placed before
 * then keep their AED price); they never name the registrar or show its cost
 * (the operator view is web-address-operations.tsx).
 */
export async function api(path: string, method = "GET", body?: unknown) {
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
      {
        code: data.code,
        firstYearPriceMinor: data.firstYearPriceMinor,
        renewalPriceMinor: data.renewalPriceMinor,
      },
    );
  return data;
}
/** "USD 19.99" from 1999 US cents (or "AED 84.00" for an order priced in AED). */
export const formatMoney = (minor: number, currency: string = "USD") =>
  new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).format(minor / 100);
export const day = (value?: string | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : "";
const IN_PROGRESS = [
  "checkout",
  "paid",
  "purchasing",
  "owned",
  "zone",
  "delegating",
  "dns",
];
export type ServeMode = "site" | "forward";
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
export function Status({ value }: { value: string }) {
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
  /** Charged for the first year and at every yearly renewal, in cents. */
  firstYearPriceMinor: number;
  renewalPriceMinor: number;
  /** USD; AED for an order placed before 28 September 2026. */
  currency?: string;
  expiresAt?: string | null;
  liveAt?: string | null;
  renewalEnabled: boolean;
  renewalPending?: boolean;
  billingAvailable?: boolean;
  renewalOffer?: {
    id: string;
    state: string;
    amountMinor: number;
    currency: string;
    expiresAt: string;
    effectiveAt: string;
    purchasable: boolean;
  } | null;
  health?: { state: string; checkedAt: string | null; message: string } | null;
  renewalStatus?: string | null;
  billingStatus?: string | null;
  nextRenewalChargeAt?: string | null;
  progress: Array<{ step: string; at: string }>;
  needsReview: boolean;
  /** Show the website on the domain, or forward visitors to the subdomain. */
  serveMode?: ServeMode;
};
export type WebAddressState = {
  authenticatorRequired?: boolean;
  connection?: { enabled: boolean; cname: string | null; ipv4: string | null };
  slug: string;
  published: boolean;
  path: string;
  subdomain: {
    enabled: boolean;
    eligible: boolean;
    host: string | null;
    url: string | null;
    live: boolean;
    health?: {
      state: string;
      checkedAt: string | null;
      message: string;
    } | null;
  };
  slugChanges: { used: number; limit: number; redirectDays: number };
  redirects: Array<{ slug: string; until: string }>;
  purchases: {
    enabled: boolean;
    endings: string[];
    testEnvironment: boolean;
    /** Names over this first-year or renewal price (US cents) are never shown. */
    priceCapMinor?: number | null;
  };
  orders: WebAddressOrder[];
};
/** One name that can be bought, with its two USD prices. */
type Result = {
  domain: string;
  premium: boolean;
  firstYearPriceMinor: number;
  renewalPriceMinor: number;
};
type NameStatus = "available" | "taken" | "not_offered" | "unknown";
/** GET /web-address/search: the name asked about, then the names on offer. */
export type SearchAnswer = {
  requested: { domain: string; status: NameStatus };
  results: Result[];
  incomplete: boolean;
  priceCapMinor?: number;
};
/** The badge and the sentence for the name a trainer searched. */
const REQUESTED_STATUS: Record<
  NameStatus,
  { badge: string; tone: string; sentence: string }
> = {
  available: { badge: "Available", tone: "green", sentence: "is available" },
  taken: { badge: "Taken", tone: "red", sentence: "is taken" },
  not_offered: {
    badge: "Not available",
    tone: "amber",
    sentence: "cannot be bought here",
  },
  unknown: {
    badge: "Not checked",
    tone: "amber",
    sentence: "could not be checked right now",
  },
};
/**
 * What a trainer agrees to: one name at its two prices. A tick given for one
 * name or price never counts for another (another result, or new prices
 * after PRICE_CHANGED).
 */
export const agreementKey = (result: {
  domain: string;
  firstYearPriceMinor: number;
  renewalPriceMinor: number;
}) =>
  `${result.domain}:${result.firstYearPriceMinor}:${result.renewalPriceMinor}`;
/** One sentence for screen readers after a search. */
export function searchSummary(answer: SearchAnswer) {
  const status = REQUESTED_STATUS[answer.requested.status];
  const count = answer.results.length;
  return (
    `${answer.requested.domain} ${status.sentence}. ` +
    (count
      ? `${count} name${count === 1 ? "" : "s"} available.`
      : answer.incomplete
        ? "Some endings could not be checked; search again in a minute."
        : "No other name available for this search.")
  );
}

export function WebAddressCenter({
  manual,
  initial = null,
}: {
  manual?:
    ReactNode | ((connection: WebAddressState["connection"]) => ReactNode);
  /** Server-provided or test state shown before the first refresh. */
  initial?: WebAddressState | null;
}) {
  const [state, setState] = useState<WebAddressState | null>(initial),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [readError, setReadError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setState(await api("/web-address"));
      setReadError("");
    } catch (e) {
      setReadError(
        e instanceof Error
          ? e.message
          : "Address status could not be refreshed.",
      );
      throw e;
    }
  }, []);
  useEffect(() => {
    void refresh().catch((e) => setMessage(e.message));
  }, [refresh]);
  // Live progress while an order is being set up.
  const working = !!state?.orders.some(
    (o) => IN_PROGRESS.includes(o.status) || o.renewalPending,
  );
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(
      () => void refresh().catch((e) => setReadError(e.message)),
      5000,
    );
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
          {readError ? (
            <>
              <p role="alert">{readError}</p>
              <button
                type="button"
                onClick={() => void refresh().catch(() => {})}
              >
                Retry
              </button>
            </>
          ) : (
            <p className="muted">Loading your address…</p>
          )}
        </Panel>
      </>
    );
  // A bought domain can forward to the platform address when there is one.
  const forwardTarget =
    state.subdomain.enabled && state.subdomain.eligible
      ? state.subdomain.host
      : null;
  return (
    <div className="stack web-address">
      {readError && (
        <p role="alert">
          {readError}{" "}
          <button type="button" onClick={() => void refresh().catch(() => {})}>
            Retry refresh
          </button>
        </p>
      )}
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
              {state.subdomain.live
                ? "Live"
                : state.published
                  ? "Website check needed"
                  : "Live after you publish"}
            </span>
          </p>
        ) : state.subdomain.enabled ? (
          <p>
            Your current address cannot be used as a web address. Choose a new
            address below to get one.
          </p>
        ) : null}
        {state.published && state.subdomain.url && (
          <div className="button-row">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(
                  () => api("/web-address/health", "POST", {}),
                  "Address check complete.",
                )
              }
            >
              Check website
            </button>
            {state.subdomain.health && (
              <p className="muted">
                {state.subdomain.health.message}
                {state.subdomain.health.checkedAt
                  ? ` Checked ${new Date(state.subdomain.health.checkedAt).toLocaleString()}.`
                  : ""}
              </p>
            )}
          </div>
        )}
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
            if (slug === state.slug) return;
            if (
              !window.confirm(
                `Change your address to ${slug}? This uses one of your ${state.slugChanges.limit} yearly changes. Old links redirect for ${state.slugChanges.redirectDays} days, then the old address can be reused. Members may need to sign in again and reinstall the app.`,
              )
            )
              return;
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
          the last year.{" "}
          {state.authenticatorRequired
            ? "Changing needs a recent authenticator check."
            : "Confirm the new address before changing."}
        </p>
      </Panel>
      {state.purchases.enabled ? (
        <DomainSearch
          busy={busy}
          testEnvironment={state.purchases.testEnvironment}
          endings={state.purchases.endings}
          priceCapMinor={state.purchases.priceCapMinor ?? null}
          subdomainHost={forwardTarget}
          onError={setMessage}
        />
      ) : (
        <Panel title="Your own domain">
          <p className="muted">
            Buying a domain here is not available yet.{" "}
            {state.connection?.enabled
              ? "You can connect a domain you already own below."
              : "Your platform address remains available."}
          </p>
        </Panel>
      )}
      {state.orders.map((order) => (
        <OrderCard
          key={order.id}
          order={order}
          busy={busy}
          run={run}
          subdomainHost={forwardTarget}
        />
      ))}
      {typeof manual === "function" ? manual(state.connection) : manual}
    </div>
  );
}

/**
 * The two ways a bought domain can work: the website itself on the domain
 * (default), or a permanent redirect to the platform address. www always
 * goes to the domain.
 */
export function ServeModeChoice({
  value,
  subdomainHost,
  name,
  disabled,
  onChange,
}: {
  value: ServeMode;
  subdomainHost: string | null;
  name: string;
  disabled?: boolean;
  onChange: (mode: ServeMode) => void;
}) {
  if (!subdomainHost) return null;
  return (
    <fieldset className="web-address-serve" disabled={disabled}>
      <legend>How the domain works</legend>
      <label className="check-field">
        <input
          type="radio"
          name={name}
          value="site"
          checked={value === "site"}
          onChange={() => onChange("site")}
        />{" "}
        {/* One text element: .check-field is a flex row, and loose text
            around the host would become separate narrow columns. */}
        <span>Show my site on this domain</span>
      </label>
      <label className="check-field">
        <input
          type="radio"
          name={name}
          value="forward"
          checked={value === "forward"}
          onChange={() => onChange("forward")}
        />{" "}
        <span>
          Forward to my <span className="ltr-data">{subdomainHost}</span>{" "}
          address
        </span>
      </label>
      <p className="muted small-label">
        Forwarding keeps the page path, so links to any page still work.
        Addresses starting with www always go to the domain itself.
      </p>
    </fieldset>
  );
}

/**
 * Domain search (owner decision, 28 September 2026): the trainer's name is
 * checked on every suggested ending at once; the name asked about shows as
 * taken when it is, and every name that can be bought is listed with its
 * first-year and yearly renewal price in US dollars (names over the price
 * limit are never shown).
 */
export function DomainSearch({
  busy,
  testEnvironment,
  endings,
  priceCapMinor = null,
  subdomainHost,
  onError,
  initialAnswer = null,
  initialChosen = null,
  initialAgreedTo = null,
}: {
  busy: boolean;
  testEnvironment: boolean;
  endings: string[];
  priceCapMinor?: number | null;
  subdomainHost: string | null;
  onError: (message: string) => void;
  /** Test or server state shown before a search. */
  initialAnswer?: SearchAnswer | null;
  initialChosen?: Result | null;
  /** The agreement key already ticked (tests). */
  initialAgreedTo?: string | null;
}) {
  const [answer, setAnswer] = useState<SearchAnswer | null>(initialAnswer),
    [searching, setSearching] = useState(false),
    [chosen, setChosen] = useState<Result | null>(initialChosen),
    // The name and prices the trainer ticked the agreement for.
    [agreedTo, setAgreedTo] = useState<string | null>(initialAgreedTo),
    [paying, setPaying] = useState(false),
    [serveMode, setServeMode] = useState<ServeMode>("site");
  const confirmRef = useRef<HTMLFormElement | null>(null);
  // Choosing a name shows its confirmation below the list: move there, so
  // on a phone the choice visibly does something.
  useEffect(() => {
    if (!chosen || !confirmRef.current) return;
    confirmRef.current.scrollIntoView?.({ block: "nearest" });
    confirmRef.current.focus({ preventScroll: true });
  }, [chosen]);
  const search = async (q: string) => {
    setSearching(true);
    setChosen(null);
    setAgreedTo(null);
    onError("");
    try {
      setAnswer(await api("/web-address/search?q=" + encodeURIComponent(q)));
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
        firstYearPriceMinor: result.firstYearPriceMinor,
        renewalPriceMinor: result.renewalPriceMinor,
        currency: "USD",
        accepted: true,
        ...(subdomainHost ? { serveMode } : {}),
      });
      window.location.assign(data.url);
    } catch (e: any) {
      if (
        e?.code === "PRICE_CHANGED" &&
        Number.isInteger(e.firstYearPriceMinor) &&
        Number.isInteger(e.renewalPriceMinor)
      ) {
        setChosen({
          ...result,
          firstYearPriceMinor: e.firstYearPriceMinor,
          renewalPriceMinor: e.renewalPriceMinor,
        });
        onError("The price changed. Check the new prices and confirm again.");
      } else onError(e instanceof Error ? e.message : "Checkout failed.");
      setPaying(false);
    }
  };
  const requested = answer?.requested;
  const requestedStatus = requested ? REQUESTED_STATUS[requested.status] : null;
  const agreed = !!chosen && agreedTo === agreementKey(chosen);
  return (
    <Panel title="Your own domain">
      <p>
        Search a name: we check it on these endings and list the ones you can
        have, with the first-year price and the yearly renewal price in US
        dollars, paid by card. Both are the full price you pay. Some endings
        cost much more to renew than for the first year: compare both before
        choosing. Some endings may not be available for every name. We register
        the domain, set it up and renew it every year. Endings checked:{" "}
        <span className="ltr-data">
          {endings.map((e) => "." + e).join(" ")}
        </span>
      </p>
      {priceCapMinor ? (
        <p className="muted small-label">
          Only names up to {formatMoney(priceCapMinor)} a year are shown.
        </p>
      ) : null}
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
      {/* Always present, so screen readers announce every new answer. */}
      <p className="web-address-live" role="status" aria-live="polite">
        {searching ? "Searching…" : answer ? searchSummary(answer) : ""}
      </p>
      {requested && requestedStatus && requested.status !== "available" && (
        <p className="web-address-requested">
          <span className="ltr-data">{requested.domain}</span>{" "}
          <span className={"badge " + requestedStatus.tone}>
            {requestedStatus.badge}
          </span>{" "}
          <span className="muted">This name {requestedStatus.sentence}.</span>
        </p>
      )}
      {answer && answer.results.length > 0 && (
        <>
          <h3 className="small-label">
            {requested?.status === "available"
              ? "Available"
              : "Available on other endings"}
          </h3>
          <ul className="web-address-results">
            {answer.results.map((result) => (
              <li key={result.domain}>
                <span className="ltr-data">{result.domain}</span>
                {result.premium && (
                  <span className="badge amber">Premium name</span>
                )}
                <Prices
                  firstYear={result.firstYearPriceMinor}
                  renewal={result.renewalPriceMinor}
                />
                <button
                  type="button"
                  className="button"
                  disabled={paying}
                  aria-label={"Choose " + result.domain}
                  onClick={() => setChosen(result)}
                >
                  Choose
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {answer && answer.results.length === 0 && !answer.incomplete && (
        <p className="muted">
          No available name for this search
          {priceCapMinor ? ` up to ${formatMoney(priceCapMinor)} a year` : ""}.
          Try another name.
        </p>
      )}
      {answer?.incomplete && (
        <p className="muted small-label">
          Some endings could not be checked right now. Search again in a minute
          to see them.
        </p>
      )}
      {chosen ? (
        <form
          // A new name or new prices is a new agreement (nothing carries over).
          key={agreementKey(chosen)}
          ref={confirmRef}
          tabIndex={-1}
          aria-label={"Confirm " + chosen.domain}
          className="web-address-confirm"
          onSubmit={(event) => {
            event.preventDefault();
            if (agreed) void pay(chosen);
          }}
        >
          <p>
            <strong className="ltr-data">{chosen.domain}</strong>: first year{" "}
            <strong>{formatMoney(chosen.firstYearPriceMinor)}</strong>, charged
            now, then <strong>{formatMoney(chosen.renewalPriceMinor)}</strong>{" "}
            every year until you turn renewal off. The price includes
            registration, private owner details (WHOIS privacy), DNS, the
            security certificate and our service. The platform registers and
            holds the domain for your website.
          </p>
          <RenewalNote
            firstYear={chosen.firstYearPriceMinor}
            renewal={chosen.renewalPriceMinor}
          />
          <ServeModeChoice
            value={serveMode}
            subdomainHost={subdomainHost}
            name="serve-mode-new"
            disabled={paying}
            onChange={setServeMode}
          />
          <label className="check-field">
            <input
              type="checkbox"
              required
              checked={agreed}
              onChange={(event) =>
                setAgreedTo(event.target.checked ? agreementKey(chosen) : null)
              }
            />{" "}
            I agree to pay {formatMoney(chosen.firstYearPriceMinor)} now and{" "}
            {formatMoney(chosen.renewalPriceMinor)} every year after, renewed
            automatically.
          </label>
          <button disabled={paying || !agreed}>
            {paying ? "Opening payment…" : "Pay with card"}
          </button>
        </form>
      ) : null}
    </Panel>
  );
}

/**
 * The only prices a trainer sees, side by side: the first year and the
 * yearly renewal from the second year, both the full price paid, with the
 * renewal note when the renewal costs more.
 */
export function Prices({
  firstYear,
  renewal,
  currency = "USD",
}: {
  firstYear: number;
  renewal: number;
  currency?: string;
}) {
  return (
    <span className="web-address-prices-pair">
      <span className="web-address-price">
        <span className="small-label">First year</span>{" "}
        <strong>{formatMoney(firstYear, currency)}</strong>
      </span>{" "}
      <span className="web-address-price">
        <span className="small-label">Renewal, every year after</span>{" "}
        <strong>{formatMoney(renewal, currency)}</strong>
      </span>
      <RenewalNote
        firstYear={firstYear}
        renewal={renewal}
        currency={currency}
      />
    </span>
  );
}
/**
 * "Note: the renewal is USD 5.00 more a year than the first year." whenever
 * the renewal costs more than the first year (owner decision, 28 September
 * 2026: trainers must know before paying), highlighted when it is much
 * higher (at least twice the first year or USD 20 more); or nothing.
 */
export function RenewalNote({
  firstYear,
  renewal,
  currency = "USD",
}: {
  firstYear: number;
  renewal: number;
  currency?: string;
}) {
  const note = renewalPriceNote(firstYear, renewal, currency);
  if (!note) return null;
  return (
    <span
      className={
        "web-address-renewal-note" +
        (renewalIncrease(firstYear, renewal)?.much ? " much" : "")
      }
    >
      {note}
    </span>
  );
}

export function OrderCard({
  order,
  busy,
  run,
  subdomainHost = null,
}: {
  order: WebAddressOrder;
  busy: boolean;
  run: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
  /** The workspace subdomain a domain can forward to, when there is one. */
  subdomainHost?: string | null;
}) {
  const reached = new Set(order.progress.map((p) => p.step));
  const mode: ServeMode = order.serveMode === "forward" ? "forward" : "site";
  const choosable = !["checkout", "cancelled", "failed", "expired"].includes(
    order.status,
  );
  return (
    <Panel title={order.hostname}>
      <p>
        <span
          className={
            "badge " +
            (order.statusLabel === "Live"
              ? "green"
              : ["failed", "expired", "cancelled"].includes(order.status)
                ? "red"
                : "amber")
          }
        >
          {order.statusLabel}
        </span>{" "}
        <Prices
          firstYear={order.firstYearPriceMinor}
          renewal={order.renewalPriceMinor}
          currency={order.currency ?? "USD"}
        />
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
      {order.health && order.health.state !== "healthy" && (
        <p role="status">{order.health.message}</p>
      )}
      {order.renewalOffer?.state === "offered" && (
        <div className="notice">
          <p>
            New yearly renewal:{" "}
            <strong>
              {formatMoney(
                order.renewalOffer.amountMinor,
                order.renewalOffer.currency,
              )}
            </strong>{" "}
            on {day(order.renewalOffer.effectiveAt)}. Approve by{" "}
            {day(order.renewalOffer.expiresAt)}. Otherwise, automatic renewal
            switches off. Your current paid term stays unchanged.
          </p>
          {order.renewalOffer.purchasable ? (
            <button
              type="button"
              disabled={busy || order.renewalPending}
              onClick={() => {
                const offer = order.renewalOffer!;
                if (
                  !window.confirm(
                    `Approve ${formatMoney(offer.amountMinor, offer.currency)} per year from ${day(offer.effectiveAt)}? This also enables automatic renewal.`,
                  )
                )
                  return;
                void run(
                  () =>
                    api(
                      `/web-address/orders/${order.id}/renewal-price`,
                      "POST",
                      {
                        offerId: offer.id,
                        amountMinor: offer.amountMinor,
                        currency: offer.currency,
                        accepted: true,
                      },
                    ),
                  "Price approval submitted. Waiting for billing confirmation.",
                );
              }}
            >
              Approve this yearly price
            </button>
          ) : (
            <a href="/trainer/support">Discuss renewal options</a>
          )}
        </div>
      )}
      {order.renewalPending && (
        <p role="status">
          Confirming your billing change. The last confirmed setting remains
          shown below.
        </p>
      )}
      {order.billingAvailable && (
        <div className="button-row">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await api(
                  `/web-address/orders/${order.id}/billing`,
                  "POST",
                  {},
                );
                window.location.assign(result.url);
              }, "Opening payment settings…")
            }
          >
            Update payment method
          </button>
          {["past_due", "unpaid", "incomplete"].includes(
            order.billingStatus ?? "",
          ) && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api(
                    `/web-address/orders/${order.id}/billing`,
                    "POST",
                    { action: "invoice" },
                  );
                  window.location.assign(result.url);
                }, "Opening renewal payment…")
              }
            >
              Pay outstanding renewal
            </button>
          )}
          <a className="button secondary" href="/trainer/support">
            Get billing help
          </a>
        </div>
      )}
      {order.needsReview && (
        <p className="muted">
          The platform team is checking this step. You do not need to do
          anything unless a payment or price approval is requested below.
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
          {mode === "forward" && subdomainHost && (
            <span className="muted">
              {" "}
              forwards to <span className="ltr-data">{subdomainHost}</span>
            </span>
          )}
        </p>
      )}
      {choosable && (
        <ServeModeChoice
          value={mode}
          subdomainHost={subdomainHost}
          name={"serve-mode-" + order.id}
          disabled={busy}
          onChange={(next) => {
            if (next === mode) return;
            void run(
              () =>
                api(`/web-address/orders/${order.id}/serve-mode`, "POST", {
                  mode: next,
                }),
              next === "forward"
                ? "Your domain now forwards to your platform address."
                : "Your domain now shows your site.",
            );
          }}
        />
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
      {["owned", "zone", "delegating", "dns", "active"].includes(
        order.status,
      ) &&
        !["canceled", "incomplete_expired"].includes(
          order.billingStatus ?? "",
        ) && (
          <button
            type="button"
            className="text-button"
            disabled={busy || order.renewalPending}
            onClick={() =>
              void run(
                () =>
                  api(`/web-address/orders/${order.id}/renewal`, "POST", {
                    enabled: !order.renewalEnabled,
                  }),
                "Renewal change requested. Confirmation appears above.",
              )
            }
          >
            {order.renewalEnabled
              ? "Turn off yearly renewal"
              : "Turn renewal back on"}
          </button>
        )}
      {order.status === "active" &&
        !["canceled", "incomplete_expired"].includes(
          order.billingStatus ?? "",
        ) && (
          <button
            type="button"
            className="text-button"
            disabled={busy || order.renewalPending}
            onClick={() => {
              if (
                !window.confirm(
                  "End this domain's billing subscription now? Your paid registration remains until expiry. Re-enabling renewal will require support. This allows workspace closure once other balances are settled.",
                )
              )
                return;
              void run(
                () =>
                  api(`/web-address/orders/${order.id}/end-billing`, "POST", {
                    confirmed: true,
                  }),
                "Billing cancellation requested.",
              );
            }}
          >
            End domain billing
          </button>
        )}
      {["canceled", "incomplete_expired"].includes(
        order.billingStatus ?? "",
      ) && (
        <p>
          Billing has ended.{" "}
          <a href="/trainer/support">
            Contact support to arrange renewal before expiry.
          </a>
        </p>
      )}
    </Panel>
  );
}
