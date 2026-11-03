"use client";
// Followers and growth (/trainer/growth) and the "Share your link" setup
// step: the follower calculator filled from a connected Instagram account or
// typed numbers, and tagged coaching links that the consented acquisition
// tracking (components/acquisition.tsx) attributes to their source. On
// /trainer/growth only, and only while Connect Facebook is available to the
// workspace (approved, or listed for testing before Meta's review), the
// Facebook Page card sits next to Instagram's and its estimate follows
// Instagram's; Page numbers saved earlier stay removable after that. Both
// connections read once and keep only the numbers.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  DEFAULT_FOLLOWER_MODEL,
  type FollowerModelAssumptions,
} from "../../../packages/domain/src/marketing-calculators";
import { FacebookCalculator } from "./marketing/facebook-calculator";
import { FollowerCalculator } from "./marketing/islands";

type Snapshot = {
  username: string;
  followers: number;
  engagementRatePct: number | null;
  postsSampled: number;
  fetchedAt: string;
};
/** The numbers Connect Facebook keeps (no token, Page ID or user ID). */
type FacebookSnapshot = {
  pageName: string;
  followers: number;
  pageLikes: number | null;
  engagementRatePct: number | null;
  postsSampled: number;
  /** Pages shared in the sign-in; the numbers are the largest usable one's. */
  pagesShared: number;
  fetchedAt: string;
};
/** GET /api/v1/trainer/instagram and /facebook. */
type ConnectionState<S> = {
  available: boolean;
  /** Listed for testing before Meta's review (only app roles can finish). */
  testing?: boolean;
  snapshot: S | null;
  followerModel: FollowerModelAssumptions;
};
type GrowthState = ConnectionState<Snapshot>;
type FacebookState = ConnectionState<FacebookSnapshot>;
type Provider = "instagram" | "facebook";
const NAME: Record<Provider, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
};
async function call(provider: Provider, method: string, path = "") {
  const response = await fetch(`/api/v1/trainer/${provider}` + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.message ?? `${NAME[provider]} could not be reached.`);
  return data;
}

export const INSTAGRAM_OUTCOMES: Record<string, string> = {
  connected:
    "Instagram connected. We read your follower count and recent likes and comments once; access was not kept.",
  declined: "Instagram was not connected. You can still type your numbers.",
  expired: "That connection link expired. Try connecting again.",
  failed: "Instagram could not be read right now. Try again later or type your numbers.",
  professional_required:
    "Instagram only shares follower numbers for professional (business or creator) accounts. Switch your account type in Instagram, then try again.",
  unavailable: "Connecting Instagram is not available yet.",
};
/** /trainer/growth?facebook=<outcome>, one per callback outcome (apps/api/src/facebook.ts). */
export const FACEBOOK_OUTCOMES: Record<string, string> = {
  connected:
    "Facebook connected. We read your Page’s follower count and recent reactions, comments and shares once; access was not kept.",
  declined: "Facebook was not connected. You can still type your numbers.",
  expired: "That connection expired before your Page could be read. Try connecting again.",
  failed: "Facebook could not be read right now. Try again later or type your numbers.",
  unavailable: "Connecting Facebook is not available yet.",
  permissions_required:
    "Facebook didn’t give permission to read your Page’s numbers. Connect again and keep every permission on.",
  no_page:
    "No Facebook Page was shared. Connect again and choose your Page, or type your numbers.",
  page_access_required:
    "Your access to that Page doesn’t let us read its numbers. Ask someone with full control of the Page to give you full control, then connect again.",
  busy: "Facebook is busy right now. Try again in a few minutes, or type your numbers.",
};
export const TESTING_NOTE =
  "Testing before Meta review: only people with a role on the Meta app can finish connecting.";

/** Facebook adds "#_=_" to its redirect: the address without it, or null. */
export function withoutFacebookFragment(href: string): string | null {
  return href.endsWith("#_=_") ? href.slice(0, -"#_=_".length) : null;
}

/** One connection's state, its ?<provider>= outcome notice and its actions. */
function useConnection<S>(provider: Provider, outcomes: Record<string, string>) {
  const [state, setState] = useState<ConnectionState<S> | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void call(provider, "GET")
      .then(setState)
      .catch((e) => setError((e as Error).message));
  }, [provider]);
  useEffect(() => {
    load();
    const outcome = new URLSearchParams(window.location.search).get(provider);
    if (outcome && outcomes[outcome]) setNotice(outcomes[outcome]);
  }, [load, provider, outcomes]);
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const { url } = await call(provider, "POST", "/authorize");
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await call(provider, "DELETE");
      setNotice(`Your saved ${NAME[provider]} numbers were removed.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { state, error, notice, busy, connect, remove };
}
type CardProps<State> = {
  state: State;
  notice: string;
  error: string;
  busy: boolean;
  connect: () => void;
  remove: () => void;
};

/** A connection card: the numbers read, connect or refresh, remove, fine print. */
function ConnectCard({
  id,
  title,
  testing,
  notice,
  error,
  busy,
  connectLabel,
  onConnect,
  onRemove,
  finePrint,
  children,
}: {
  id: string;
  title: string;
  testing: boolean;
  notice: string;
  error: string;
  busy: boolean;
  /** Absent while connecting is unavailable. */
  connectLabel?: string;
  onConnect: () => void;
  /** Absent while nothing is saved. */
  onRemove?: () => void;
  finePrint: string;
  children: ReactNode;
}) {
  return (
    <section className="card" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {children}
      {testing && <p className="notice">{TESTING_NOTE}</p>}
      <div className="button-row">
        {connectLabel && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={onConnect}
          >
            {connectLabel}
          </button>
        )}
        {onRemove && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onRemove}
          >
            Remove saved numbers
          </button>
        )}
      </div>
      <p className="fine-print muted">{finePrint}</p>
    </section>
  );
}
const readOn = (fetchedAt: string) =>
  new Date(fetchedAt).toLocaleDateString("en-GB", { timeZone: "Asia/Dubai" });

/** "Your Instagram numbers" (also in the "Share your link" setup step). */
export function InstagramCard({
  state,
  notice,
  error,
  busy,
  connect,
  remove,
}: CardProps<GrowthState | null>) {
  const snapshot = state?.snapshot ?? null;
  return (
    <ConnectCard
      id="instagram-h"
      title="Your Instagram numbers"
      testing={!!state?.testing}
      notice={notice}
      error={error}
      busy={busy}
      connectLabel={
        state?.available
          ? snapshot
            ? "Refresh from Instagram"
            : "Connect Instagram"
          : undefined
      }
      onConnect={connect}
      onRemove={snapshot ? remove : undefined}
      finePrint="We read your follower count and the likes and comments on up to 12 recent posts once, then discard the access. Only the numbers are saved, and you can remove them."
    >
      {snapshot ? (
        <p>
          @{snapshot.username}: {snapshot.followers.toLocaleString("en-AE")}{" "}
          followers
          {snapshot.engagementRatePct !== null &&
            `, ${snapshot.engagementRatePct}% average engagement over ${snapshot.postsSampled} recent posts`}
          . Read on {readOn(snapshot.fetchedAt)}.
        </p>
      ) : (
        <p className="muted">
          {state?.available
            ? "Connect an Instagram professional account to fill in your follower count and recent engagement, or type your numbers below."
            : "Type your numbers below. Connecting Instagram will be available once the platform enables it."}
        </p>
      )}
    </ConnectCard>
  );
}

/** "From your Page …", naming the Page when several were shared. */
const fromPage = (snapshot: FacebookSnapshot) =>
  `From your Page ${snapshot.pageName}` +
  (snapshot.pagesShared > 1
    ? ` (the Page with the most followers of the ${snapshot.pagesShared} you shared)`
    : "");

/**
 * "Your Facebook Page numbers": rendered while connecting is available, and
 * afterwards while numbers saved earlier remain, so they can still be removed
 * (no connect or refresh button then).
 */
export function FacebookPageCard({
  state,
  notice,
  error,
  busy,
  connect,
  remove,
}: CardProps<FacebookState>) {
  const snapshot = state.snapshot;
  return (
    <ConnectCard
      id="facebook-h"
      title="Your Facebook Page numbers"
      testing={!!state.testing}
      notice={notice}
      error={error}
      busy={busy}
      connectLabel={
        state.available
          ? snapshot
            ? "Refresh from Facebook"
            : "Connect Facebook"
          : undefined
      }
      onConnect={connect}
      onRemove={snapshot ? remove : undefined}
      finePrint="We read your Page’s follower count and the reactions, comments and shares on up to 12 recent posts once, then discard the access. Only the numbers are saved, and you can remove them."
    >
      {snapshot ? (
        <p>
          {fromPage(snapshot)}: {snapshot.followers.toLocaleString("en-AE")}{" "}
          followers
          {snapshot.engagementRatePct !== null &&
            `, ${snapshot.engagementRatePct}% average engagement over ${snapshot.postsSampled} recent ${snapshot.postsSampled === 1 ? "post" : "posts"}`}
          . Read on {readOn(snapshot.fetchedAt)}.
        </p>
      ) : (
        <p className="muted">
          Connect the Facebook Page you share your coaching on to fill in its
          follower count and recent engagement, or type your numbers below.
        </p>
      )}
    </ConnectCard>
  );
}

/** Tagged links: source, medium and campaign codes only, never personal data. */
export function taggedLinks(origin: string, slug: string) {
  const base = `${origin.replace(/\/$/, "")}/coach/${encodeURIComponent(slug)}`;
  const tag = (campaign: string) =>
    `${base}?utm_source=instagram&utm_medium=social&utm_campaign=${campaign}`;
  return { plain: base, bio: tag("bio"), story: tag("story") };
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mk-copy-row">
      <div>
        <strong>{label}</strong>
        <code className="ltr-data">{value}</code>
      </div>
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function ShareYourLink({
  slug,
  published,
}: {
  slug: string;
  published: boolean;
}) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  if (!origin) return null;
  const links = taggedLinks(origin, slug);
  return (
    <section className="card" aria-labelledby="share-link-h">
      <h2 id="share-link-h">Share your link</h2>
      {!published && (
        <p className="notice">
          Your page opens to followers after you publish. You can copy the
          links now.
        </p>
      )}
      <p>
        Followers who never see your offer can’t subscribe. Use a different
        link in your bio and in Stories, so your analytics show which one
        brings visitors (for visitors who allow optional analytics).
      </p>
      <CopyRow label="Instagram bio" value={links.bio} />
      <CopyRow label="Instagram Stories link sticker" value={links.story} />
      <ul className="mk-list-plain">
        <li>Share a link Story at least twice a week, not once.</li>
        <li>Use several frames: say who it is for, what they get each day, and the price.</li>
        <li>Mix link Stories with ordinary Stories; link stickers can get fewer replies.</li>
      </ul>
    </section>
  );
}

/** The follower calculator, prefilled from the saved Instagram numbers. */
function InstagramEstimate({
  state,
  compact = false,
}: {
  state: GrowthState | null;
  compact?: boolean;
}) {
  if (!state) return null;
  const snapshot = state.snapshot;
  return (
    <FollowerCalculator
      key={snapshot?.fetchedAt ?? "typed"}
      model={state.followerModel ?? DEFAULT_FOLLOWER_MODEL}
      compact={compact}
      headingLevel={2}
      initial={
        snapshot
          ? {
              followers: snapshot.followers,
              engagementRatePct: snapshot.engagementRatePct,
            }
          : undefined
      }
      measured={snapshot ? `From @${snapshot.username}` : undefined}
    />
  );
}

/** The "Share your link" setup step's estimate: Instagram only. */
export function FollowerEstimate({ compact = false }: { compact?: boolean }) {
  const connection = useConnection<Snapshot>("instagram", INSTAGRAM_OUTCOMES);
  return (
    <>
      <InstagramCard {...connection} />
      <InstagramEstimate state={connection.state} compact={compact} />
    </>
  );
}

/**
 * What the Facebook section shows: the card once GET /api/v1/trainer/facebook
 * says this workspace may connect; the saved numbers alone (to remove them)
 * once it may no longer connect but numbers saved earlier remain (taken off
 * the test list, approval withdrawn, connection paused); otherwise nothing,
 * apart from the notice for a ?facebook= outcome it returned with (once
 * refused or unreadable, not while loading).
 */
export function facebookSection(
  state: { available: boolean; snapshot?: unknown } | null,
  notice: string,
  error: string,
): "card" | "saved" | "notice" | null {
  if (state?.available) return "card";
  if (state?.snapshot) return "saved";
  return notice && (state || error) ? "notice" : null;
}

/**
 * The Facebook Page estimate, prefilled from the saved Page numbers. While
 * testing before Meta's review, /methodology has no Facebook section yet, so
 * the estimate does not link to it.
 */
function FacebookPageEstimate({ state }: { state: FacebookState }) {
  const snapshot = state.snapshot;
  return (
    <FacebookCalculator
      key={snapshot?.fetchedAt ?? "typed"}
      followerModel={state.followerModel ?? DEFAULT_FOLLOWER_MODEL}
      initial={
        snapshot
          ? {
              followers: snapshot.followers,
              engagementRatePct: snapshot.engagementRatePct,
            }
          : undefined
      }
      measured={snapshot ? `From your Page ${snapshot.pageName}` : undefined}
      methodology={!state.testing}
    />
  );
}

/**
 * /trainer/growth's estimates, Connect Facebook next to Connect Instagram: the
 * Instagram card, then the Facebook card (or its saved numbers alone, or its
 * notice), then the Instagram calculator and, only while connecting Facebook
 * is available, the Facebook one.
 */
export function GrowthEstimatesView({
  instagram,
  facebook,
}: {
  instagram: CardProps<GrowthState | null>;
  facebook: CardProps<FacebookState | null>;
}) {
  const show = facebookSection(facebook.state, facebook.notice, facebook.error);
  return (
    <>
      <InstagramCard {...instagram} />
      {show === "notice" ? (
        <p className="notice" role="status">
          {facebook.notice}
        </p>
      ) : (
        show &&
        facebook.state && <FacebookPageCard {...facebook} state={facebook.state} />
      )}
      <InstagramEstimate state={instagram.state} />
      {show === "card" && facebook.state && (
        <FacebookPageEstimate state={facebook.state} />
      )}
    </>
  );
}

/** Both connections' state, outcome notices and actions for the estimates. */
function GrowthEstimates() {
  const instagram = useConnection<Snapshot>("instagram", INSTAGRAM_OUTCOMES);
  const facebook = useConnection<FacebookSnapshot>("facebook", FACEBOOK_OUTCOMES);
  useEffect(() => {
    const clean = withoutFacebookFragment(window.location.href);
    if (clean !== null) window.history.replaceState(null, "", clean);
  }, []);
  return <GrowthEstimatesView instagram={instagram} facebook={facebook} />;
}

/** /trainer/growth */
export function TrainerGrowth({
  slug,
  published,
}: {
  slug: string;
  published: boolean;
}) {
  // Back from Instagram or Facebook: open the estimate so its notice shows.
  const [returning, setReturning] = useState(false);
  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    setReturning(search.has("instagram") || search.has("facebook"));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">FOLLOWERS AND GROWTH</p>
          <h1>Turn followers into subscribers</h1>
          <p>
            An estimate of what sharing your link could bring, from published
            benchmarks, our stated assumptions and your own numbers. The
            headline is a strong case for an engaged, growing audience; the
            cautious and typical results are under How we estimate. It is an
            estimate, never a promise.
          </p>
        </div>
      </div>
      <ShareYourLink slug={slug} published={published} />
      <details className="card" open={returning}><summary>Explore a growth estimate</summary><p className="muted">Modeled outcomes, not measured conversions.</p><GrowthEstimates /></details>
    </>
  );
}
