"use client";
// Followers and growth (/trainer/growth) and the "Share your link" setup
// step: the follower calculator filled from a connected Instagram account or
// typed numbers, and tagged coaching links that the consented acquisition
// tracking (components/acquisition.tsx) attributes to their source.
import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_FOLLOWER_MODEL,
  type FollowerModelAssumptions,
} from "../../../packages/domain/src/marketing-calculators";
import { FollowerCalculator } from "./marketing/islands";

type Snapshot = {
  username: string;
  followers: number;
  engagementRatePct: number | null;
  postsSampled: number;
  fetchedAt: string;
};
type GrowthState = {
  available: boolean;
  snapshot: Snapshot | null;
  followerModel: FollowerModelAssumptions;
};
async function call(method: string, path = "") {
  const response = await fetch("/api/v1/trainer/instagram" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.message ?? "Instagram could not be reached.");
  return data;
}

const OUTCOMES: Record<string, string> = {
  connected:
    "Instagram connected. We read your follower count and recent likes and comments once; access was not kept.",
  declined: "Instagram was not connected. You can still type your numbers.",
  expired: "That connection link expired. Try connecting again.",
  failed: "Instagram could not be read right now. Try again later or type your numbers.",
  professional_required:
    "Instagram only shares follower numbers for professional (business or creator) accounts. Switch your account type in Instagram, then try again.",
  unavailable: "Connecting Instagram is not available yet.",
};

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

export function FollowerEstimate({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<GrowthState | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    void call("GET")
      .then(setState)
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    load();
    const outcome = new URLSearchParams(window.location.search).get("instagram");
    if (outcome && OUTCOMES[outcome]) setNotice(OUTCOMES[outcome]);
  }, [load]);
  const snapshot = state?.snapshot ?? null;
  return (
    <>
      <section className="card" aria-labelledby="instagram-h">
        <h2 id="instagram-h">Your Instagram numbers</h2>
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
        {snapshot ? (
          <p>
            @{snapshot.username}: {snapshot.followers.toLocaleString("en-AE")}{" "}
            followers
            {snapshot.engagementRatePct !== null &&
              `, ${snapshot.engagementRatePct}% average engagement over ${snapshot.postsSampled} recent posts`}
            . Read on{" "}
            {new Date(snapshot.fetchedAt).toLocaleDateString("en-GB", {
              timeZone: "Asia/Dubai",
            })}
            .
          </p>
        ) : (
          <p className="muted">
            {state?.available
              ? "Connect an Instagram professional account to fill in your follower count and recent engagement, or type your numbers below."
              : "Type your numbers below. Connecting Instagram will be available once the platform enables it."}
          </p>
        )}
        <div className="button-row">
          {state?.available && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const { url } = await call("POST", "/authorize");
                  window.location.assign(url);
                } catch (e) {
                  setError((e as Error).message);
                  setBusy(false);
                }
              }}
            >
              {snapshot ? "Refresh from Instagram" : "Connect Instagram"}
            </button>
          )}
          {snapshot && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await call("DELETE");
                  setNotice("Your saved Instagram numbers were removed.");
                  load();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove saved numbers
            </button>
          )}
        </div>
        <p className="fine-print muted">
          We read your follower count and the likes and comments on up to 12
          recent posts once, then discard the access. Only the numbers are
          saved, and you can remove them.
        </p>
      </section>
      {state && (
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
      )}
    </>
  );
}

/** /trainer/growth */
export function TrainerGrowth({
  slug,
  published,
}: {
  slug: string;
  published: boolean;
}) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">FOLLOWERS AND GROWTH</p>
          <h1>Turn followers into subscribers</h1>
          <p>
            An estimate of what sharing your link could bring, from published
            benchmarks and your own numbers. It is an estimate, never a
            promise.
          </p>
        </div>
      </div>
      <FollowerEstimate />
      <ShareYourLink slug={slug} published={published} />
    </>
  );
}
