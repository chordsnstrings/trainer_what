"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Field } from "./field";
import { leaveSession } from "./offline-queue";

/** Joining a trainer: invitation acceptance, the owner's invitation list, and coach switching. */
async function api(
  path: string,
  method = "GET",
  body?: unknown,
  headers?: Record<string, string>,
) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined
        ? headers
        : { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "The request failed"), {
      status: r.status,
      code: data.code,
    });
  return data;
}
const day = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

type Preview = {
  coach: { name: string; slug: string };
  role: string;
  status: "pending" | "accepted" | "expired" | "cancelled";
  replaced?: boolean;
  expiresAt: string;
  invitedEmail: string;
  legalOpen: boolean;
  viewer: {
    signedIn: boolean;
    tenantId?: string;
    userId?: string;
    name?: string;
    email?: string;
    emailMatches?: boolean;
    alreadyMember?: boolean;
  };
};

/**
 * Shown on /join/<link>. A signed-in account invited by its own address
 * joins with one click; a signed-out person creates an account or signs in
 * with an existing one. No second account is ever created for the same email.
 */
export function InvitationJoin({
  token,
  onAuthenticated,
}: {
  token: string;
  onAuthenticated: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState<"new" | "existing">("new"),
    [agreed, setAgreed] = useState(false);
  const load = useCallback(() => {
    setError("");
    api("/invitations/preview", "POST", { token }).then(setPreview, (e) =>
      setError(
        e.code === "INVALID_INVITE"
          ? "This invitation link is not valid. Ask your coach for a new invitation."
          : e.message,
      ),
    );
  }, [token]);
  useEffect(load, [load]);
  if (error && !preview)
    return (
      <div className="join-panel">
        <p className="notice error" role="alert">
          {error}
        </p>
        <p>
          <Link className="text-link" href="/login">
            Sign in to your coaching space
          </Link>
        </p>
      </div>
    );
  if (!preview)
    return (
      <p className="muted" role="status">
        Checking your invitation…
      </p>
    );
  const closed = preview.status !== "pending";
  const coachName = preview.coach.name;
  if (closed)
    return (
      <div className="join-panel" data-testid="invitation-closed">
        <p className="notice" role="status">
          {preview.status === "accepted"
            ? `This invitation to ${coachName} has already been used.`
            : preview.status === "expired"
              ? `This invitation to ${coachName} has expired. Ask your coach to send a new one.`
              : preview.replaced
                ? `This link was replaced by a newer invitation from ${coachName}. Use the most recent link.`
                : `${coachName} cancelled this invitation.`}
        </p>
        <p>
          <Link className="text-link" href="/login">
            Sign in to your coaching space
          </Link>
        </p>
      </div>
    );
  const legalNote = !preview.legalOpen && (
    <p className="notice" role="status">
      Joining opens once the platform publishes its approved terms. Your
      invitation stays valid until {day(preview.expiresAt)}.
    </p>
  );
  const accept = (
    <label className="check-field">
      <input
        type="checkbox"
        checked={agreed}
        onChange={(e) => setAgreed(e.target.checked)}
        required
      />
      <span>
        I accept the published <Link href="/terms">terms</Link>,{" "}
        <Link href="/privacy">privacy policy</Link> and{" "}
        <Link href="/ai-disclosure">digital coaching disclosure</Link>.
      </span>
    </label>
  );
  const heading = (
    <div className="join-summary">
      <p className="eyebrow">INVITATION</p>
      <h3>Join {coachName}</h3>
      <p className="muted">
        {preview.role === "subscriber"
          ? "Coaching invitation"
          : "Team invitation"}{" "}
        for {preview.invitedEmail} · valid until {day(preview.expiresAt)}
      </p>
    </div>
  );
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      return (await fn()) !== false;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  /**
   * Leaves the signed-in session the same way as the sidebar sign-out and the
   * coach switcher: this device's offline entries replay first, unsynced
   * entries need confirmation, and cached app data is cleared afterwards.
   */
  const leaveCurrent = (leave: () => Promise<unknown>, verb: string) => {
    const v = preview.viewer;
    if (!v.tenantId || !v.userId) return leave();
    return leaveSession(localStorage, v.tenantId, v.userId, {
      online: navigator.onLine,
      post: (p, b, h) => api(p, "POST", b, h),
      confirm: (n) =>
        window.confirm(
          `${n} workout or meal ${n === 1 ? "entry has" : "entries have"} not synced. ${n === 1 ? "It stays" : "They stay"} on this device and will sync when you return to your current coach. ${verb} anyway?`,
        ),
      leave,
    });
  };
  if (preview.viewer.signedIn) {
    const v = preview.viewer;
    if (v.alreadyMember)
      return (
        <div className="join-panel">
          {heading}
          <p className="notice success" role="status">
            You already belong to {coachName}. Switch to it from “Your coaches”
            in your app.
          </p>
          <Link className="button" href="/app">
            Open my app
          </Link>
        </div>
      );
    if (v.emailMatches && preview.role === "subscriber")
      return (
        <form
          className="join-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() =>
              leaveCurrent(
                () =>
                  api("/invitations/accept-signed-in", "POST", {
                    token,
                    accepted: true,
                  }),
                "Join",
              ),
            );
            if (ok) window.location.assign("/app?joined=1");
          }}
        >
          {heading}
          {legalNote}
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <p>
            You’re signed in as <strong>{v.name}</strong> ({v.email}). Join with
            this account. Your other coaches stay available and you can switch
            between them at any time.
          </p>
          {accept}
          <button
            className="button"
            type="submit"
            disabled={busy || !agreed || !preview.legalOpen}
          >
            {busy ? "Joining…" : `Join ${coachName}`}
          </button>
        </form>
      );
    return (
      <div className="join-panel">
        {heading}
        <p className="notice" role="status">
          {preview.role === "subscriber"
            ? `You’re signed in as ${v.email}, but this invitation is for ${preview.invitedEmail}. Sign out, then open this link again with the invited account, or ask your coach to invite ${v.email}.`
            : "Team invitations are accepted with your password. Sign out, then open this link again."}
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const left = await leaveCurrent(
                () => api("/auth/logout", "POST", {}),
                "Sign out",
              );
              if (left !== false) load();
              return left;
            })
          }
        >
          Sign out and continue
        </button>
      </div>
    );
  }
  return (
    <form
      className="join-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const ok = await run(() =>
          api("/invitations/accept", "POST", {
            token,
            email: f.get("email"),
            password: f.get("password"),
            accepted: true,
            ...(mode === "new" ? { name: f.get("name") } : {}),
            ...(f.get("code") ? { code: f.get("code") } : {}),
          }),
        );
        if (ok) await onAuthenticated();
      }}
    >
      {heading}
      {legalNote}
      <div className="join-mode" role="radiogroup" aria-label="Account">
        <label className={mode === "new" ? "selected" : ""}>
          <input
            type="radio"
            name="mode"
            checked={mode === "new"}
            onChange={() => setMode("new")}
          />
          I’m new here
        </label>
        <label className={mode === "existing" ? "selected" : ""}>
          <input
            type="radio"
            name="mode"
            checked={mode === "existing"}
            onChange={() => setMode("existing")}
          />
          I already have an account
        </label>
      </div>
      <p className="muted">
        {mode === "new"
          ? "Create your account with the email address your coach invited."
          : "Sign in with your existing password. No new account is created, and your other coaches stay available."}
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {mode === "new" && (
        <Field label="Your name">
          <input name="name" autoComplete="name" required minLength={2} />
        </Field>
      )}
      <Field label="Email address">
        <input name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password">
        <input
          name="password"
          type="password"
          minLength={12}
          autoComplete={mode === "new" ? "new-password" : "current-password"}
          required
        />
      </Field>
      {mode === "new" ? (
        <small className="muted">At least 12 characters.</small>
      ) : (
        <Field label="Authenticator code (if enabled)">
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
          />
        </Field>
      )}
      {accept}
      <button
        className="button"
        type="submit"
        disabled={busy || !agreed || !preview.legalOpen}
      >
        {busy ? "Opening your workspace…" : `Join ${coachName}`}
      </button>
    </form>
  );
}

const statusTone: Record<string, string> = {
  pending: "amber",
  accepted: "green",
  expired: "",
  cancelled: "",
};
const deliveryText: Record<string, string> = {
  not_requested: "Link only",
  queued: "Email queued",
  waiting_for_email_setup: "Waiting for email setup",
  sent: "Email sent",
  not_sent: "Email not sent",
  failed: "Email failed",
  unknown: "Delivery unconfirmed",
  unavailable: "Email not configured",
  rate_limited: "Email limit reached",
  verify_email_first: "Confirm your email to send",
};
/** Owner tools: invite by link or email, see status and delivery, resend or cancel. */
export function FollowerInvitations({ role }: { role: string }) {
  const [data, setData] = useState<any>(null),
    [notice, setNotice] = useState<{ tone: string; text: string } | null>(null),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [filter, setFilter] = useState("pending");
  const load = useCallback(
    () =>
      api("/invitations/followers").then(setData, (e) =>
        setNotice({ tone: "error", text: e.message }),
      ),
    [],
  );
  useEffect(() => {
    if (role === "owner") void load();
  }, [role, load]);
  if (role !== "owner")
    return (
      <section className="card">
        <h2>Invite a subscriber</h2>
        <p className="muted">
          The workspace owner invites new followers and manages invitations.
        </p>
      </section>
    );
  const act = async (fn: () => Promise<any>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const r = await fn();
      setNotice({ tone: "success", text: success });
      await load();
      return r;
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
      return null;
    } finally {
      setBusy(false);
    }
  };
  const rows = (data?.invitations ?? []).filter(
    (i: any) => filter === "all" || i.status === filter,
  );
  const canEmail = !!data?.emailConfigured && !!data?.ownerEmailVerified;
  return (
    <section className="card follower-invitations">
      <h2>Invite a subscriber</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget,
            f = new FormData(form);
          void act(
            () =>
              api("/invitations", "POST", {
                email: f.get("email"),
                role: "subscriber",
                sendEmail: f.get("sendEmail") === "on",
              }),
            "Invitation created.",
          ).then((r) => {
            if (r) {
              setResult(r);
              form.reset();
            }
          });
        }}
      >
        <Field label="Email address">
          <input type="email" name="email" required maxLength={320} />
        </Field>
        <label className="check-field">
          <input
            type="checkbox"
            name="sendEmail"
            key={canEmail ? "email" : "link"}
            defaultChecked={canEmail}
            disabled={!!data && !canEmail}
          />
          <span>
            Email the invitation link
            {data && !data.emailConfigured
              ? " (email delivery is not configured yet; copy the link instead)"
              : data && !data.ownerEmailVerified
                ? " (confirm your own email address first; copy the link instead)"
                : ""}
          </span>
        </label>
        {data && data.emailConfigured && !data.ownerEmailVerified && (
          <p className="muted">
            <Link className="text-link" href="/trainer/settings">
              Confirm your email address in Account security
            </Link>{" "}
            to send invitations by email.
          </p>
        )}
        <button className="button" type="submit" disabled={busy}>
          Create invitation
        </button>
      </form>
      {notice && (
        <p
          className={`notice ${notice.tone === "error" ? "error" : "success"}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      )}
      {result && (
        <div className="invite-result">
          {result.email?.status && result.email.status !== "not_requested" && (
            <p className="muted" role="status">
              {deliveryText[result.email.status] ?? result.email.status}
              {result.email.message ? ` · ${result.email.message}` : ""}
            </p>
          )}
          <p>
            Share this single-use link. It expires on {day(result.expiresAt)}.
          </p>
          <input value={result.url} readOnly aria-label="Invitation link" />
          <button
            className="button secondary"
            type="button"
            onClick={() => void navigator.clipboard.writeText(result.url)}
          >
            Copy link
          </button>
        </div>
      )}
      <div className="invitation-list-heading">
        <h3>Invitations</h3>
        <label className="invitation-filter">
          <span>Show</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="accepted">Accepted</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>
      {!data ? (
        <p className="muted">Loading invitations…</p>
      ) : rows.length === 0 ? (
        <p className="muted">
          No {filter === "all" ? "" : filter} invitations.
        </p>
      ) : (
        <ul className="invitation-list">
          {rows.map((i: any) => (
            <li key={i.id}>
              <div className="invitation-main">
                <strong>{i.email}</strong>
                <span className={`badge ${statusTone[i.status] ?? ""}`}>
                  {i.status}
                </span>
              </div>
              <small className="muted">
                {i.status === "pending"
                  ? `Expires ${day(i.expiresAt)}`
                  : i.status === "accepted"
                    ? `Accepted ${day(i.acceptedAt)}`
                    : i.status === "cancelled"
                      ? `${i.replaced ? "Replaced" : "Cancelled"} ${day(i.cancelledAt)}`
                      : `Expired ${day(i.expiresAt)}`}{" "}
                · {deliveryText[i.delivery.status] ?? i.delivery.status}
                {i.sends > 1 ? ` · sent ${i.sends} times` : ""}
                {i.delivery.detail ? ` · ${i.delivery.detail}` : ""}
              </small>
              {i.status === "pending" && (
                <div className="invitation-actions">
                  {canEmail && (
                    <button
                      className="text-button"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            "Send a fresh invitation email? The previous link for this invitation stops working.",
                          )
                        )
                          void act(
                            () =>
                              api(
                                `/invitations/followers/${i.id}/resend`,
                                "POST",
                                {},
                              ),
                            "A fresh invitation email is queued.",
                          ).then((r) => r && setResult(r));
                      }}
                    >
                      {i.delivery.requested ? "Resend email" : "Send by email"}
                    </button>
                  )}
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Cancel the invitation for ${i.email}? The link stops working immediately.`,
                        )
                      )
                        void act(
                          () =>
                            api(
                              `/invitations/followers/${i.id}/cancel`,
                              "POST",
                              {},
                            ),
                          "Invitation cancelled.",
                        );
                    }}
                  >
                    Cancel invitation
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && (
        <p className="fine-print muted">
          Links last {data.limits.validDays} days. Up to{" "}
          {data.limits.emailsPerAddress} invitation emails per address (from
          any coach) and {data.limits.emailsPerDay} per workspace are sent each
          day.
        </p>
      )}
    </section>
  );
}

type Choice = {
  tenantId: string;
  name: string;
  role: string;
  current: boolean;
};
/**
 * Makes coach switching obvious for followers with more than one coach.
 * `card` lists every coach on the Today page; `compact` sits in the top bar.
 */
export function CoachSwitcher({
  current,
  userId,
  variant = "card",
}: {
  current: string;
  userId: string;
  variant?: "card" | "compact";
}) {
  const [choices, setChoices] = useState<Choice[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [joined, setJoined] = useState(false);
  useEffect(() => {
    let active = true;
    api("/auth/workspaces").then(
      (r) => active && setChoices(r.workspaces),
      () => active && setChoices([]),
    );
    if (variant === "card")
      setJoined(new URLSearchParams(window.location.search).has("joined"));
    return () => {
      active = false;
    };
  }, [current, variant]);
  const coaches = choices.filter((c) => c.role === "subscriber");
  const switchTo = async (next: Choice) => {
    if (next.tenantId === current) return;
    setBusy(true);
    setError("");
    try {
      const left = await leaveSession(localStorage, current, userId, {
        online: navigator.onLine,
        post: (p, b, h) => api(p, "POST", b, h),
        confirm: (n) =>
          window.confirm(
            `${n} workout or meal ${n === 1 ? "entry has" : "entries have"} not synced. ${n === 1 ? "It stays" : "They stay"} on this device and will sync when you return to this coach. Switch anyway?`,
          ),
        leave: () =>
          api("/auth/workspace", "POST", { tenantId: next.tenantId }),
      });
      if (left)
        window.location.assign(
          next.role === "subscriber" ? "/app" : "/trainer",
        );
      else setBusy(false);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  if (variant === "compact") {
    if (coaches.length < 2) return null;
    return (
      <label className="coach-switch-compact">
        <span>Coach</span>
        <select
          value={current}
          disabled={busy}
          aria-label="Switch coach"
          onChange={(e) => {
            const next = choices.find((c) => c.tenantId === e.target.value);
            if (next) void switchTo(next);
          }}
        >
          {choices.map((c) => (
            <option key={c.tenantId} value={c.tenantId}>
              {c.name}
              {c.role === "subscriber" ? "" : " (team)"}
            </option>
          ))}
        </select>
        {error && <small role="alert">{error}</small>}
      </label>
    );
  }
  if (coaches.length < 2 && !joined) return null;
  const here = choices.find((c) => c.tenantId === current);
  const listed = coaches.length > 1;
  return (
    <section
      className="card coach-switcher"
      {...(listed
        ? { "aria-labelledby": "coach-switcher-title" }
        : { "aria-label": "Your coaches" })}
    >
      {joined && (
        <p className="notice success" role="status">
          You joined {here?.name ?? "your new coach"}.{" "}
          {coaches.length > 1
            ? "Your other coaches are still here; switch between them below."
            : ""}
        </p>
      )}
      {listed && (
        <>
          <h2 id="coach-switcher-title">Your coaches</h2>
          <p className="muted">
            Each coach has their own program, messages and membership. Switch at
            any time; nothing is shared between coaches.
          </p>
          <ul>
            {coaches.map((c) => (
              <li key={c.tenantId}>
                <span className="avatar small" aria-hidden="true">
                  {c.name.slice(0, 1)}
                </span>
                <strong>{c.name}</strong>
                {c.tenantId === current ? (
                  <span className="badge green">Current</span>
                ) : (
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => void switchTo(c)}
                  >
                    Switch to {c.name}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
