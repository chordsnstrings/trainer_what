"use client";
/**
 * The public pages the workspace renders outside the apps: sign-in, recovery
 * and email-link pages, joining a coach (/join-coach/<name>, /join/<link>),
 * the published legal documents and trainer sign-up. Subscriber-facing
 * pages are phone first (docs/features/phone-first.md, "Public, joining and
 * sign-in pages"): one column, the coach's name and brand at the top when
 * there is a coach, the main action in thumb reach and a subscriber footer,
 * never the trainer-marketing footer or story.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Field } from "./field";
import { AuthPage } from "./auth-page";
import { PublicHeader } from "./public-header";
import { SubscriberFooter } from "./subscriber-footer";
import { MarketingFooter } from "./marketing/frame";
import { TrainerTheme } from "./trainer-design";
import { AccountJoinForm, InvitationJoin } from "./joining";
import { SocialSignIn, SocialSignInVerify } from "./social-sign-in";
import { PasskeyLoginButton } from "./passkeys";
import { MagicAccess } from "./account-completion";
import { AccountRecovery } from "./account-security";
import { EmailChangeConfirm, RecoveryLinkReset } from "./account-links";
import { PublishedLegal } from "./published-legal";
import {
  LegalAcceptance,
  acceptanceGiven,
  legalPlan,
  useLegalStatus,
} from "./legal-acceptance";
import { useSubscriberThemeColor } from "./appearance";
import type { ColorSchemeChoice } from "../color-scheme";

async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    headers:
      body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "Request failed"), {
      status: r.status,
      code: data.code,
    });
  return data;
}

export type PublicPlatform = {
  name: string;
  initials: string;
  registrationOpen: boolean;
};
type Trainer = { name: string; slug: string; theme: unknown };

function PlainShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
  theme?: unknown;
  colorScheme?: ColorSchemeChoice;
}) {
  return <div className={className}>{children}</div>;
}

/**
 * Left by the member app when a member leaves their coach
 * (components/membership-exit.tsx), read once by the sign-in page it opens
 * (/login?left=1), so leaving ends on a confirmation, not a bare sign-in.
 */
export const LEFT_COACH_KEY = "account:left-coach";
export type LeftCoach = { coach: string; renewalCancelled: boolean; at: number };
export function readLeftCoach(
  storage: Pick<Storage, "getItem" | "removeItem">,
  now = Date.now(),
): LeftCoach | null {
  try {
    const raw = storage.getItem(LEFT_COACH_KEY);
    storage.removeItem(LEFT_COACH_KEY);
    const value = raw ? (JSON.parse(raw) as LeftCoach) : null;
    // Only the page this leave opened: an old note is never shown later.
    return value &&
      typeof value.coach === "string" &&
      now - Number(value.at) < 10 * 60_000
      ? value
      : null;
  } catch {
    return null;
  }
}

export function Public({
  path,
  platform,
  coachSlug,
  colorScheme,
  onAuthenticated,
}: {
  path: string;
  platform: PublicPlatform;
  /** The trainer whose own domain or subdomain serves this page, if any. */
  coachSlug: string | null;
  /** Coach-branded pages follow the member's appearance choice. */
  colorScheme: ColorSchemeChoice;
  onAuthenticated: () => Promise<void>;
}) {
  const [store, setStore] = useState<{ trainer: Trainer } | null>(null),
    [invited, setInvited] = useState<{ name: string; slug: string } | null>(
      null,
    );
  const enroll = path.startsWith("/join-coach/"),
    join = path.startsWith("/join/"),
    signup = path === "/signup";
  // A page on a trainer's own address (sign in, recovery, joining), a
  // coach's join page and an invitation carry that trainer's identity.
  const enrollSlug = enroll ? path.split("/")[2] || null : null;
  const siteSlug = coachSlug ?? enrollSlug ?? invited?.slug ?? null;
  useEffect(() => {
    setStore(null);
    if (!siteSlug) return;
    let active = true;
    // Published coaches only; an invitation from an unpublished workspace
    // keeps the coach's name without the brand.
    api("/public/trainers/" + encodeURIComponent(siteSlug))
      .then((value) => active && setStore(value))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [siteSlug]);
  const onCoach = useCallback(
    (coach: { name: string; slug: string }) => setInvited(coach),
    [],
  );
  const trainer: Trainer | null =
    store?.trainer ??
    (invited ? { name: invited.name, slug: invited.slug, theme: {} } : null);
  // Joining pages are the coach's from the first paint, before its details
  // load, so a first-time joiner never sees the trainer-marketing header.
  const coach = !!siteSlug || join;
  const Shell = coach ? TrainerTheme : PlainShell;
  const coachName = trainer?.name ?? null;
  // The platform's own pages stay light (docs/features/brand.md); a coach's
  // sign-in and joining pages follow the member's choice, browser colour
  // included.
  useSubscriberThemeColor(store?.trainer?.theme, colorScheme, coach);
  return (
    <Shell
      className={coach ? "public" : "public platform-ui"}
      theme={store?.trainer?.theme}
      colorScheme={coach ? colorScheme : undefined}
    >
      <PublicHeader
        path={path}
        platform={platform}
        coach={
          coach
            ? {
                slug: siteSlug ?? "",
                host: !!coachSlug,
                trainer,
                website: !!coachSlug || !!store,
              }
            : null
        }
      />
      {path === "/sign-in/verify" ? (
        <SocialSignInVerify />
      ) : path.startsWith("/verify-email-change/") ? (
        <EmailChangeConfirm token={path.split("/").pop() ?? ""} />
      ) : path.startsWith("/account-recovery/") ? (
        <RecoveryLinkReset token={path.split("/").pop() ?? ""} />
      ) : path === "/magic-link" ||
        path.startsWith("/magic-link/") ||
        path === "/recover-authenticator" ? (
        <MagicAccess path={path} />
      ) : path.startsWith("/reset-password/") ||
        path.startsWith("/verify-email/") ||
        path === "/forgot-password" ? (
        <AccountRecovery path={path} />
      ) : path === "/login" ? (
        <SignInPage
          platform={platform}
          coach={
            coachSlug
              ? { slug: coachSlug, name: coachName }
              : null
          }
          onAuthenticated={onAuthenticated}
        />
      ) : enroll && enrollSlug ? (
        <JoinCoachPage
          slug={enrollSlug}
          name={coachName}
          onAuthenticated={onAuthenticated}
        />
      ) : join ? (
        <InvitationJoin
          token={path.split("/").pop() ?? ""}
          onAuthenticated={onAuthenticated}
          onCoach={onCoach}
        />
      ) : signup ? (
        <TrainerSignUp onAuthenticated={onAuthenticated} />
      ) : ["/terms", "/privacy", "/ai-disclosure"].includes(path) ? (
        <PublishedLegal
          documentKey={path.slice(1) as "terms" | "privacy" | "ai-disclosure"}
          platformName={platform.name}
        />
      ) : null}
      {signup ? (
        // Trainer sign-up is part of the trainer marketing funnel.
        <MarketingFooter appName={platform.name} initials={platform.initials} />
      ) : (
        <SubscriberFooter
          name={coach && coachName ? coachName : platform.name}
          coach={coach}
          directory={!coachSlug}
          signIn={path !== "/login"}
        />
      )}
    </Shell>
  );
}

/** Why a correct sign-in opened no workspace: a state with next steps. */
function MembershipEnded({
  code,
  message,
  coach,
}: {
  code: string;
  message: string;
  coach: { slug: string; name: string | null } | null;
}) {
  return (
    <section className="auth-state" role="status" aria-labelledby="ended-title">
      <h2 id="ended-title">
        {code === "MEMBERSHIP_ENDED"
          ? "Your coaching membership has ended"
          : "You have no active coaching membership"}
      </h2>
      <p>
        {code === "MEMBERSHIP_ENDED"
          ? message
          : "Your account is open, but it is not linked to a coach right now."}
      </p>
      <p className="auth-state-next">What you can do next:</p>
      <div className="auth-state-actions">
        {coach ? (
          <Link className="button" href={`/join-coach/${coach.slug}`}>
            Rejoin {coach.name ?? "this coach"}
          </Link>
        ) : (
          <Link className="button" href="/coaches">
            Find a coach
          </Link>
        )}
      </div>
      <p className="muted">
        Have an invitation from a coach? Open the link in their email to join
        with this account.
      </p>
    </section>
  );
}

/** The confirmation after leaving a coach (see LEFT_COACH_KEY). */
function LeftCoachNotice({
  left,
  host,
}: {
  left: LeftCoach | "unknown";
  host: boolean;
}) {
  const name = left === "unknown" ? "your coach" : left.coach;
  return (
    <section
      className="auth-state is-success"
      role="status"
      aria-labelledby="left-title"
    >
      <h2 id="left-title">You left {name}</h2>
      <p>
        {left !== "unknown" && left.renewalCancelled
          ? "Your membership renewal is cancelled, so no further payments are taken. "
          : ""}
        Your account is still open: you can join another coach with the same
        email address at any time.
      </p>
      <div className="auth-state-actions">
        {host ? (
          <a className="button secondary" href="/">
            Back to the website
          </a>
        ) : (
          <Link className="button secondary" href="/coaches">
            Find a coach
          </Link>
        )}
      </div>
    </section>
  );
}

/**
 * Sign in: email and password with the right keyboards and autofill, the
 * authenticator code only once the account asks for it, one primary button,
 * and the other ways in as matching secondary actions.
 */
function SignInPage({
  platform,
  coach,
  onAuthenticated,
}: {
  platform: PublicPlatform;
  /** Set on a trainer's own address. */
  coach: { slug: string; name: string | null } | null;
  onAuthenticated: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [ended, setEnded] = useState<{ code: string; message: string } | null>(
      null,
    ),
    [needCode, setNeedCode] = useState(false),
    [busy, setBusy] = useState(false),
    [left, setLeft] = useState<LeftCoach | "unknown" | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("left") !== "1") return;
    let note: LeftCoach | null = null;
    try {
      note = readLeftCoach(window.sessionStorage);
    } catch {}
    setLeft(note ?? "unknown");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  return (
    <AuthPage
      title="Sign in"
      intro={
        left
          ? "Sign in any time with the same email address."
          : coach?.name
            ? `Welcome back. Sign in to your coaching with ${coach.name}.`
            : "Welcome back. Sign in with the email address you use for coaching."
      }
    >
      {left && <LeftCoachNotice left={left} host={!!coach} />}
      {ended && (
        <MembershipEnded code={ended.code} message={ended.message} coach={coach} />
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <form
        className="auth-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setEnded(null);
          setLeft(null);
          const f = new FormData(e.currentTarget);
          try {
            await api("/auth/login", "POST", {
              email: f.get("email"),
              password: f.get("password"),
              ...(f.get("code") ? { code: f.get("code") } : {}),
            });
            await onAuthenticated();
          } catch (err) {
            const failure = err as Error & { code?: string };
            if (failure.code === "MFA_REQUIRED") setNeedCode(true);
            else if (
              failure.code === "MEMBERSHIP_ENDED" ||
              failure.code === "NO_MEMBERSHIP"
            )
              setEnded({ code: failure.code, message: failure.message });
            else setError(failure.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Email address">
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
        <Field label="Password">
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            enterKeyHint={needCode ? "next" : "go"}
            required
          />
        </Field>
        <p className="auth-inline-link">
          <Link className="text-link" href="/forgot-password">
            Forgot your password?
          </Link>
        </p>
        {needCode && (
          <>
            <p className="notice" role="status">
              Your account uses an authenticator app. Enter its current 6-digit
              code to finish signing in.
            </p>
            <Field label="Authenticator code">
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                enterKeyHint="go"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                autoFocus
              />
            </Field>
          </>
        )}
        <button className="button auth-primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </form>
      <SocialSignIn intent="sign_in" />
      <div className="auth-alternatives" aria-label="Other ways to sign in" role="group">
        <PasskeyLoginButton />
        <Link className="button secondary" href="/magic-link">
          Email me a sign-in link
        </Link>
        <Link className="text-link" href="/recover-authenticator">
          Lost your authenticator app? Use a recovery code
        </Link>
      </div>
      <div className="auth-new">
        {coach ? (
          <p>
            New here?{" "}
            <Link className="text-link" href={`/join-coach/${coach.slug}`}>
              Join {coach.name ?? "coaching"}
            </Link>
          </p>
        ) : (
          <>
            <p>
              Looking for a coach?{" "}
              <Link className="text-link" href="/coaches">
                Find a coach
              </Link>
            </p>
            {platform.registrationOpen && (
              <p>
                Are you a coach?{" "}
                <Link className="text-link" href="/signup">
                  Create your coaching space
                </Link>
              </p>
            )}
          </>
        )}
      </div>
    </AuthPage>
  );
}

/**
 * A coach's public join page: a short phone flow headed by the coach, with
 * the account choice, the terms for published documents only, and "Join
 * <coach>" in thumb reach. No trainer story, no "Welcome back".
 */
function JoinCoachPage({
  slug,
  name,
  onAuthenticated,
}: {
  slug: string;
  name: string | null;
  onAuthenticated: () => Promise<void>;
}) {
  const legal = useLegalStatus();
  const coachName = name ?? "your coach";
  return (
    <AuthPage
      wide
      title={name ? `Join ${name}` : "Join your coach"}
      intro={`Create your account to start coaching with ${coachName}. You choose your plan in the app after joining.`}
    >
      <AccountJoinForm
        legal={legal}
        formId="join-coach-form"
        coachName={coachName}
        newNote="Use an email address you can open: it signs you in and receives your coaching updates."
        submit={(f) =>
          api("/auth/enroll", "POST", {
            ...(f.mode === "new" ? { name: f.name } : {}),
            email: f.email,
            password: f.password,
            coachSlug: slug,
            accepted: true,
            ...(f.code ? { code: f.code } : {}),
          })
        }
        onJoined={onAuthenticated}
        social={(given) => (
          <SocialSignIn intent="join" coachSlug={slug} accepted={given} />
        )}
      />
      <p className="auth-new">
        Already coaching with {coachName}?{" "}
        <Link className="text-link" href="/login">
          Sign in
        </Link>
      </p>
    </AuthPage>
  );
}

/** Trainer sign-up (/signup): the trainer marketing funnel, unchanged in tone. */
function TrainerSignUp({
  onAuthenticated,
}: {
  onAuthenticated: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [slugHint, setSlugHint] = useState(""),
    [agreed, setAgreed] = useState(false);
  const plan = legalPlan(useLegalStatus());
  useEffect(() => {
    // A name typed in the address preview arrives as ?slug=.
    const hint = new URLSearchParams(window.location.search).get("slug") ?? "";
    if (/^[a-z][a-z0-9-]{2,39}$/.test(hint)) setSlugHint(hint);
  }, []);
  return (
    <main className="auth-layout" id="main">
      <div className="auth-story">
        <p className="eyebrow">YOUR KNOWLEDGE. YOUR NEXT CHAPTER.</p>
        <h1>{"You’ve built the experience.\nNow build the business."}</h1>
        <p>Your judgment is the part that matters. Give it a place to grow.</p>
        <div className="auth-lines">
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
      <section className="card">
        <h2>Create your coaching space</h2>
        <p className="muted">Start with your identity. Your Brain comes next.</p>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!acceptanceGiven(plan, agreed)) return;
            setBusy(true);
            setError("");
            const f = new FormData(e.currentTarget);
            try {
              await api("/auth/register", "POST", {
                name: f.get("name"),
                email: f.get("email"),
                password: f.get("password"),
                slug: f.get("slug"),
                accepted: true,
              });
              await onAuthenticated();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Your name">
            <input name="name" autoComplete="name" required minLength={2} />
          </Field>
          <Field label="Email address">
            <input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Your coaching address">
            <div className="input-affix">
              <span>/coach/</span>
              <input
                key={slugHint}
                name="slug"
                pattern="[a-z][a-z0-9-]{2,39}"
                placeholder="your-name"
                defaultValue={slugHint}
                required
              />
            </div>
          </Field>
          <Field label="Password">
            <input
              name="password"
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
            />
            <small>At least 12 characters.</small>
          </Field>
          <LegalAcceptance plan={plan} checked={agreed} onChange={setAgreed} />
          <button
            className="button"
            type="submit"
            disabled={busy || !acceptanceGiven(plan, agreed)}
          >
            {busy ? "Opening your workspace…" : "Create my workspace"}
            <ArrowRight size={16} />
          </button>
        </form>
        <div className="divider" />
        <p className="muted">
          Already have a coaching space? <Link href="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
