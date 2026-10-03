"use client";
import { confirmWorkspace } from "./workspace-feedback";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Field } from "./field";
import { leaveSession } from "./offline-queue";
import { AuthPage } from "./auth-page";
import { DrawnCheck, StickyActionBar } from "./phone-ui";
import { EASE, MOTION, inlineSign, playMotion } from "./motion";
import { SocialSignIn } from "./social-sign-in";
import {
  JoiningClosedNote,
  LegalAcceptance,
  acceptanceGiven,
  legalPlan,
  useLegalStatus,
  type LegalStatus,
} from "./legal-acceptance";
import { clearPersonalCaches } from "./pwa";
import { Rich, useErrorText, useLocale, useT } from "../lib/i18n/react";
import { errorText } from "../lib/i18n/errors";
import { translator, type Locale } from "../lib/i18n/core";
import joinMessages from "../lib/i18n/messages/join";
import { formatDate } from "../lib/format";

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

/** "6 Oct 2026" (Arabic "6 أكتوبر 2026") for subscriber-facing invitation text. */
const inviteDay = (value?: string | null, locale: Locale = "en") =>
  value ? formatDate(value, { locale }) : "";

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

type JoinMode = "new" | "existing";
export type JoinFields = {
  mode: JoinMode;
  name?: string;
  email: string;
  password: string;
  code?: string;
};

/**
 * "I'm new here" or "I already have an account", as two full-width choice
 * cards (a title and one short line each), so neither label wraps on a
 * 360 px phone. The radios keep keyboard and screen reader behaviour.
 */
export function JoinAccountChoice({
  mode,
  onChange,
}: {
  mode: JoinMode;
  onChange: (mode: JoinMode) => void;
}) {
  const t = useT("join");
  const choices: Array<[JoinMode, string, string]> = [
    ["new", t("newHere"), t("newHereNote")],
    ["existing", t("haveAccount"), t("haveAccountNote")],
  ];
  return (
    <fieldset className="join-choice">
      <legend className="sr-only">{t("haveAccountQuestion")}</legend>
      {choices.map(([value, title, note]) => (
        <label
          key={value}
          className={`join-choice-card${mode === value ? " is-selected" : ""}`}
        >
          <input
            type="radio"
            name="join-account"
            value={value}
            checked={mode === value}
            onChange={() => onChange(value)}
          />
          <span>
            <strong>{title}</strong>
            <small>{note}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Plain wording for the joining errors people can act on. */
export function joinErrorMessage(
  error: { code?: string; message: string },
  mode: JoinMode,
  locale: Locale = "en",
) {
  const t = translator(joinMessages, locale);
  if (error.code === "INVALID_LOGIN")
    return mode === "new" ? t("emailInUse") : t("wrongPassword");
  if (
    error.code === "LEGAL_PENDING" ||
    error.code === "LEGAL_PUBLICATION_REQUIRED"
  )
    return t("legalPending");
  if (error.code === "TRAINER_UNAVAILABLE" || error.code === "WORKSPACE_CLOSED")
    return t("notTaking");
  return errorText(error, locale);
}

/**
 * The signed-out joining form shared by a coach's join page
 * (/join-coach/<name>) and an invitation (/join/<link>): the account choice,
 * one column of fields (labels above, 16 px text, the right keyboard and
 * autofill), the terms acceptance for published documents only, and the
 * main action in a StickyActionBar on phones (inline from 768 px). A new
 * account never sees an authenticator field; an existing one sees it only
 * when the API asks for it.
 */
export function AccountJoinForm({
  formId,
  coachName,
  newNote,
  gateOpen = true,
  closedUntil,
  submit,
  onJoined,
  social,
  legal,
}: {
  /** The platform's legal status (useLegalStatus), loaded by the page. */
  legal: LegalStatus | null;
  formId: string;
  coachName: string;
  /** One line under the choice for a new account. */
  newNote: string;
  /** An extra gate beside the legal status (an invitation's legalOpen). */
  gateOpen?: boolean;
  /** Shown while joining is closed, e.g. an invitation's expiry date. */
  closedUntil?: string;
  submit: (fields: JoinFields) => Promise<unknown>;
  onJoined: () => Promise<void> | void;
  /** Apple and Google buttons, given whether the terms are accepted. */
  social?: (accepted: boolean) => ReactNode;
}) {
  const [mode, setMode] = useState<JoinMode>("new"),
    [agreed, setAgreed] = useState(false),
    [needCode, setNeedCode] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const t = useT("join"),
    locale = useLocale();
  // Switching between "I'm new here" and "I already have an account" slides
  // the fields in from the side of the choice (docs/features/motion.md "l").
  const fields = useRef<HTMLDivElement>(null);
  const plan = legalPlan(legal);
  const open = gateOpen && plan.open;
  const accepted = acceptanceGiven(plan, agreed);
  const blocked = !open
    ? t("blockedClosed")
    : plan.loading
      ? t("checkingTerms")
      : !accepted
        ? t("blockedTick")
        : "";
  const label = busy ? t("joining") : t("joinTitle", { name: coachName });
  return (
    <>
      <form
        id={formId}
        className="join-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!open || !accepted) return;
          const f = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await submit({
              mode,
              ...(mode === "new" ? { name: String(f.get("name") ?? "") } : {}),
              email: String(f.get("email") ?? ""),
              password: String(f.get("password") ?? ""),
              ...(f.get("code") ? { code: String(f.get("code")) } : {}),
            });
            await onJoined();
          } catch (err) {
            const failure = err as { code?: string; message: string };
            if (failure.code === "MFA_REQUIRED" && mode === "existing") {
              setNeedCode(true);
              setError("");
            } else setError(joinErrorMessage(failure, mode, locale));
          } finally {
            setBusy(false);
          }
        }}
      >
        <JoinAccountChoice
          mode={mode}
          onChange={(next) => {
            setMode(next);
            setNeedCode(false);
            setError("");
            const toward = next === "existing" ? 1 : -1;
            playMotion(
              fields.current,
              [
                {
                  opacity: 0,
                  transform: `translateX(${16 * toward * inlineSign(fields.current)}px)`,
                },
                { opacity: 1, transform: "none" },
              ],
              { duration: MOTION.base, easing: EASE.out },
            );
          }}
        />
        <div className="join-fields" ref={fields}>
        <p className="muted join-form-note">
          {mode === "new" ? newNote : t("existingNote")}
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {mode === "new" && (
          <Field label={t("yourName")}>
            <input
              name="name"
              autoComplete="name"
              autoCapitalize="words"
              enterKeyHint="next"
              required
              minLength={2}
              maxLength={100}
            />
          </Field>
        )}
        <Field label={t("emailAddress")}>
          <input
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="next"
            required
          />
        </Field>
        <Field label={mode === "new" ? t("createPassword") : t("password")}>
          <input
            name="password"
            type="password"
            minLength={12}
            maxLength={128}
            autoComplete={mode === "new" ? "new-password" : "current-password"}
            enterKeyHint={needCode ? "next" : "done"}
            aria-describedby={mode === "new" ? `${formId}-password-hint` : undefined}
            required
          />
        </Field>
        {mode === "new" && (
          <small className="field-hint" id={`${formId}-password-hint`}>
            {t("atLeast12")}
          </small>
        )}
        {needCode && (
          <>
            <p className="notice" role="status">
              {t("mfaJoin")}
            </p>
            <Field label={t("authenticatorCode")}>
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                enterKeyHint="done"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
              />
            </Field>
          </>
        )}
        </div>
        {open ? (
          <LegalAcceptance plan={plan} checked={agreed} onChange={setAgreed} />
        ) : (
          <JoiningClosedNote until={closedUntil} />
        )}
        <div className="join-inline-submit">
          <button className="button" type="submit" disabled={busy || !!blocked}>
            {label}
          </button>
          {blocked && <p className="control-reason">{blocked}</p>}
        </div>
      </form>
      {social?.(open && accepted)}
      <StickyActionBar label={t("joinAction")} note={blocked || undefined}>
        <button
          className="button"
          type="submit"
          form={formId}
          disabled={busy || !!blocked}
        >
          {label}
        </button>
      </StickyActionBar>
    </>
  );
}

/**
 * Shown on /join/<link>. A signed-in account invited by its own address
 * joins with one click; a signed-out person creates an account or signs in
 * with an existing one. No second account is ever created for the same email.
 */
export function InvitationJoin({
  token,
  onAuthenticated,
  onCoach,
}: {
  token: string;
  onAuthenticated: () => Promise<void>;
  /** Tells the page whose invitation this is, for the coach's header. */
  onCoach?: (coach: { name: string; slug: string }) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [agreed, setAgreed] = useState(false);
  const t = useT("join"),
    locale = useLocale(),
    toError = useErrorText();
  const legal = useLegalStatus();
  const plan = legalPlan(legal);
  const load = useCallback(() => {
    setError("");
    api("/invitations/preview", "POST", { token }).then(setPreview, (e) =>
      setError(e.code === "INVALID_INVITE" ? t("invalidInvite") : toError(e)),
    );
  }, [token, t, toError]);
  useEffect(load, [load]);
  const coachName = preview?.coach.name,
    coachSlug = preview?.coach.slug;
  useEffect(() => {
    if (coachName && coachSlug) onCoach?.({ name: coachName, slug: coachSlug });
  }, [coachName, coachSlug, onCoach]);
  const signIn = (
    <p className="auth-return">
      <Link className="text-link" href="/login">
        {t("signInToCoaching")}
      </Link>
    </p>
  );
  if (error && !preview)
    return (
      <AuthPage title={t("cannotOpen")}>
        <p className="notice" role="alert">
          {error}
        </p>
        {signIn}
      </AuthPage>
    );
  if (!preview)
    return (
      <AuthPage title={t("yourInvitation")}>
        <p className="muted" role="status">
          {t("checking")}
        </p>
      </AuthPage>
    );
  const name = preview.coach.name;
  if (preview.status !== "pending")
    return (
      <AuthPage
        title={
          preview.status === "accepted"
            ? t("usedTitle")
            : preview.status === "expired"
              ? t("expiredTitle")
              : preview.replaced
                ? t("newerTitle")
                : t("cancelledTitle")
        }
      >
        <div data-testid="invitation-closed">
          <p className="notice" role="status">
            {t(
              preview.status === "accepted"
                ? "usedText"
                : preview.status === "expired"
                  ? "expiredText"
                  : preview.replaced
                    ? "newerText"
                    : "cancelledText",
              { name },
            )}
          </p>
          {signIn}
        </div>
      </AuthPage>
    );
  const until = inviteDay(preview.expiresAt, locale);
  const open = preview.legalOpen && plan.open;
  const accepted = acceptanceGiven(plan, agreed);
  const intro = t(preview.role === "subscriber" ? "introMember" : "introTeam", {
    name,
    email: preview.invitedEmail,
    date: until,
  });
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      return (await fn()) !== false;
    } catch (e) {
      setError(
        joinErrorMessage(e as Error & { code?: string }, "existing", locale),
      );
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
  const leaveCurrent = (leave: () => Promise<unknown>) => {
    const v = preview.viewer;
    if (!v.tenantId || !v.userId) return leave();
    return leaveSession(localStorage, v.tenantId, v.userId, {
      online: navigator.onLine,
      post: (p, b, h) => api(p, "POST", b, h),
      confirm: async (n) => (await confirmWorkspace({ title: t("signOutContinue"), detail: t("unsyncedReturn", { count: n }), confirm: t("signOutContinue") })),
      leave,
      afterLeave: clearPersonalCaches,
    });
  };
  const errorNotice = error && (
    <p className="notice error" role="alert">
      {error}
    </p>
  );
  if (preview.viewer.signedIn) {
    const v = preview.viewer;
    if (v.alreadyMember)
      return (
        <AuthPage title={t("alreadyBelong", { name })}>
          <p>{t("alreadyBelongText", { name })}</p>
          <Link className="button auth-primary" href="/app">
            {t("openApp")}
          </Link>
        </AuthPage>
      );
    if (v.emailMatches && preview.role === "subscriber") {
      const blocked = !open
        ? t("blockedClosed")
        : plan.loading
          ? t("checkingTerms")
          : !accepted
            ? t("blockedTick")
            : "";
      const label = busy ? t("joining") : t("joinTitle", { name });
      return (
        <AuthPage title={t("joinTitle", { name })} intro={intro} wide>
          <form
            id="invitation-join-form"
            className="join-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (blocked) return;
              const ok = await run(() =>
                leaveCurrent(
                  () =>
                    api("/invitations/accept-signed-in", "POST", {
                      token,
                      accepted: true,
                    }),
                ),
              );
              if (ok) window.location.assign("/app?joined=1");
            }}
          >
            {errorNotice}
            <p>
              <Rich
                t={t}
                k="signedInAs"
                params={{ name: v.name ?? "", email: v.email ?? "" }}
                tags={{
                  b: (text) => <strong>{text}</strong>,
                  email: (text) => <span className="ltr-data">{text}</span>,
                }}
              />
            </p>
            {open ? (
              <LegalAcceptance
                plan={plan}
                checked={agreed}
                onChange={setAgreed}
              />
            ) : (
              <JoiningClosedNote until={until} />
            )}
            <div className="join-inline-submit">
              <button
                className="button"
                type="submit"
                disabled={busy || !!blocked}
              >
                {label}
              </button>
              {blocked && <p className="control-reason">{blocked}</p>}
            </div>
          </form>
          <StickyActionBar label={t("joinAction")} note={blocked || undefined}>
            <button
              className="button"
              type="submit"
              form="invitation-join-form"
              disabled={busy || !!blocked}
            >
              {label}
            </button>
          </StickyActionBar>
        </AuthPage>
      );
    }
    return (
      <AuthPage title={t("joinTitle", { name })} intro={intro}>
        <p className="notice" role="status">
          {preview.role === "subscriber"
            ? t("wrongAccount", {
                current: v.email ?? "",
                invited: preview.invitedEmail,
                name,
              })
            : t("teamPassword")}
        </p>
        {errorNotice}
        <button
          className="button secondary auth-primary"
          type="button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const left = await leaveCurrent(() =>
                api("/auth/logout", "POST", {}),
              );
              if (left !== false) load();
              return left;
            })
          }
        >
          {t("signOutContinue")}
        </button>
      </AuthPage>
    );
  }
  return (
    <AuthPage title={t("joinTitle", { name })} intro={intro} wide>
      <AccountJoinForm
        legal={legal}
        formId="invitation-join-form"
        coachName={name}
        newNote={t("inviteNewNote")}
        gateOpen={preview.legalOpen}
        closedUntil={until}
        submit={(f) =>
          api("/invitations/accept", "POST", {
            token,
            email: f.email,
            password: f.password,
            accepted: true,
            ...(f.mode === "new" ? { name: f.name } : {}),
            ...(f.code ? { code: f.code } : {}),
          })
        }
        onJoined={onAuthenticated}
        social={(given) => (
          <SocialSignIn intent="invite" inviteToken={token} accepted={given} />
        )}
      />
    </AuthPage>
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
                <strong>
                  <span dir="ltr">{i.email}</span>
                </strong>
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
                      onClick={async () => {
                        if (
                          (await confirmWorkspace({ title: "Confirm action", detail: "Send a fresh invitation email? The previous link for this invitation stops working.", confirm: "Continue" }))
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
                    onClick={async () => {
                      if (
                        (await confirmWorkspace({ title: "Confirm action", detail: `Cancel the invitation for ${i.email}? The link stops working immediately.`, confirm: "Continue" }))
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
  const t = useT("join"),
    toError = useErrorText();
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
        confirm: async (n) => (await confirmWorkspace({ title: t("switchCoach"), detail: t("unsyncedSwitch", { count: n }), confirm: t("switchCoach") })),
        leave: () =>
          api("/auth/workspace", "POST", { tenantId: next.tenantId }),
        afterLeave: clearPersonalCaches,
      });
      if (left)
        window.location.assign(
          next.role === "subscriber" ? "/app" : "/trainer",
        );
      else setBusy(false);
    } catch (e) {
      setError(toError(e));
      setBusy(false);
    }
  };
  if (variant === "compact") {
    if (coaches.length < 2) return null;
    return (
      <label className="coach-switch-compact">
        <span>{t("coach")}</span>
        <select
          value={current}
          disabled={busy}
          aria-label={t("switchCoach")}
          onChange={(e) => {
            const next = choices.find((c) => c.tenantId === e.target.value);
            if (next) void switchTo(next);
          }}
        >
          {choices.map((c) => (
            <option key={c.tenantId} value={c.tenantId}>
              {c.name}
              {c.role === "subscriber" ? "" : t("team")}
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
        : { "aria-label": t("yourCoaches") })}
    >
      {joined && (
        <p className="notice success" role="status">
          <DrawnCheck draw emphasis />
          {t("joinedCoach", { name: here?.name ?? t("yourNewCoach") })}{" "}
          {coaches.length > 1 ? t("othersStillHere") : ""}
        </p>
      )}
      {listed && (
        <>
          <h2 id="coach-switcher-title">{t("yourCoaches")}</h2>
          <p className="muted">{t("eachCoach")}</p>
          <ul>
            {coaches.map((c) => (
              <li key={c.tenantId}>
                <span className="avatar small" aria-hidden="true">
                  {c.name.slice(0, 1)}
                </span>
                <strong>
                  <bdi>{c.name}</bdi>
                </strong>
                {c.tenantId === current ? (
                  <span className="badge green">{t("current")}</span>
                ) : (
                  <button
                    className="button secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => void switchTo(c)}
                  >
                    {t("switchTo", { name: c.name })}
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
