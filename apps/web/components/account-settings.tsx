"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  accountRequest,
  formatDate,
  signInErrorMessage,
  type AccountError,
} from "./account-request";
import { LeaveTrainer } from "./membership-exit";

type ReturnPath =
  "/app/profile" | "/trainer/settings" | "/admin/account-security";
type Account = {
  profile: {
    name: string;
    email: string;
    emailVerified: boolean;
    hasPassword: boolean;
    mfaEnabled: boolean;
    platformRole: string;
  };
  pendingEmailChange: { newEmail: string; expiresAt: string } | null;
  identities: Array<{
    provider: string;
    email: string | null;
    linkedAt: string;
    lastUsedAt: string | null;
  }>;
  providers: Array<{
    id: string;
    name: string;
    enabled: boolean;
    linked: boolean;
  }>;
  passkeys: number;
  notices: Array<{
    id: string;
    kind: string;
    title: string;
    body: string;
    createdAt: string;
    readAt: string | null;
  }>;
  emailDelivery: { configured: boolean };
  recentSignIn: boolean;
  workspace: { tenantId: string; role: string };
};
type Tone = "success" | "error" | "info";
const text = (f: FormData, key: string) => String(f.get(key) ?? "").trim();
const optional = (f: FormData, key: string) => text(f, key) || undefined;

function Status({ message }: { message: { text: string; tone: Tone } | null }) {
  if (!message) return null;
  return (
    <p
      className={`notice ${message.tone === "info" ? "" : message.tone}`}
      role={message.tone === "error" ? "alert" : "status"}
    >
      {message.text}
    </p>
  );
}
/** Re-authentication fields shared by sensitive account changes. */
function ProofFields({
  account,
  prefix,
}: {
  account: Account;
  prefix: string;
}) {
  return (
    <>
      {account.profile.hasPassword ? (
        <label className="field">
          <span>Current password</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            id={`${prefix}-password`}
          />
        </label>
      ) : (
        !account.recentSignIn && (
          <p className="notice">
            Your account has no password. Sign out and sign in again with Apple
            or Google, then repeat this change within ten minutes. Switching
            coaching spaces does not count as signing in.
          </p>
        )
      )}
      {account.profile.mfaEnabled && (
        <label className="field">
          <span>Authenticator code</span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            id={`${prefix}-code`}
          />
        </label>
      )}
    </>
  );
}

export function AccountSettings({ returnTo }: { returnTo: ReturnPath }) {
  const [account, setAccount] = useState<Account | null>(null),
    [loadError, setLoadError] = useState(""),
    [busy, setBusy] = useState(""),
    [messages, setMessages] = useState<
      Record<string, { text: string; tone: Tone } | null>
    >({}),
    [pendingMethod, setPendingMethod] = useState<{
      provider: string;
      action: "link" | "unlink";
    } | null>(null);
  const say = (section: string, value: string, tone: Tone = "success") =>
    setMessages((m) => ({
      ...m,
      [section]: value ? { text: value, tone } : null,
    }));
  const load = useCallback(async () => {
    try {
      setAccount(await accountRequest<Account>("/account"));
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("linked"),
      error = params.get("signin_error");
    if (linked)
      say(
        "methods",
        `${linked === "apple" ? "Apple" : "Google"} sign-in is now linked to your account.`,
      );
    if (error) say("methods", signInErrorMessage(error), "error");
    if (linked || error)
      window.history.replaceState(null, "", window.location.pathname);
    const refresh = () => void load();
    window.addEventListener("account-security-updated", refresh);
    return () =>
      window.removeEventListener("account-security-updated", refresh);
  }, [load]);
  async function run(
    section: string,
    fn: () => Promise<any>,
    success: (result: any) => string,
  ) {
    setBusy(section);
    say(section, "");
    try {
      const result = await fn();
      say(section, success(result));
      await load();
      return result;
    } catch (e) {
      say(section, (e as AccountError).message, "error");
      return null;
    } finally {
      setBusy("");
    }
  }
  if (loadError)
    return (
      <section className="card">
        <h2>Account settings</h2>
        <p className="notice error" role="alert">
          {loadError}
        </p>
      </section>
    );
  if (!account)
    return (
      <section className="card" aria-busy="true">
        <h2>Account settings</h2>
        <p className="muted">Loading your account…</p>
      </section>
    );
  const methods = account.providers.filter((p) => p.enabled || p.linked);
  const unread = account.notices.filter((n) => !n.readAt).length;
  return (
    <div className="acct-stack">
      <section className="card" aria-labelledby="acct-profile">
        <h2 id="acct-profile">Your name</h2>
        <p className="muted">
          Shown to your coach, team and in messages across every workspace.
        </p>
        <Status message={messages.profile ?? null} />
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void run(
              "profile",
              () =>
                accountRequest("/account/profile", "PATCH", {
                  name: text(f, "name"),
                }),
              () => "Name saved.",
            );
          }}
        >
          <label className="field">
            <span>Display name</span>
            <input
              name="name"
              defaultValue={account.profile.name}
              minLength={2}
              maxLength={100}
              autoComplete="name"
              required
            />
          </label>
          <button className="button" disabled={busy === "profile"}>
            Save name
          </button>
        </form>
      </section>

      <section className="card" aria-labelledby="acct-email">
        <h2 id="acct-email">Sign-in email</h2>
        <p className="acct-row">
          <span className="acct-break" dir="ltr">
            {account.profile.email}
          </span>
          <span
            className={`badge ${account.profile.emailVerified ? "green" : "amber"}`}
          >
            {account.profile.emailVerified ? "Verified" : "Not verified"}
          </span>
        </p>
        <Status message={messages.email ?? null} />
        {account.pendingEmailChange && (
          <div className="notice acct-row">
            <span className="acct-break">
              Waiting for confirmation at{" "}
              <strong>{account.pendingEmailChange.newEmail}</strong> until{" "}
              {formatDate(account.pendingEmailChange.expiresAt)}. Your email
              changes only after that link is opened.
            </span>
            <button
              type="button"
              className="button secondary"
              disabled={busy === "email"}
              onClick={() =>
                void run(
                  "email",
                  () => accountRequest("/account/email/cancel", "POST", {}),
                  () => "The pending email change was cancelled.",
                )
              }
            >
              Cancel change
            </button>
          </div>
        )}
        {account.emailDelivery.configured ? (
          <form
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              void run(
                "email",
                () =>
                  accountRequest("/account/email", "POST", {
                    email: text(f, "email"),
                    password: optional(f, "password"),
                    code: optional(f, "code"),
                  }),
                (r) => r.message,
              ).then((r) => r && form.reset());
            }}
          >
            <label className="field">
              <span>New email address</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <ProofFields account={account} prefix="email" />
            <button className="button" disabled={busy === "email"}>
              Send confirmation link
            </button>
          </form>
        ) : (
          <p className="notice">
            Email delivery is not configured on this platform yet, so a new
            address cannot be confirmed. Your email stays as it is; contact
            support if you need it changed.
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="acct-password">
        <h2 id="acct-password">
          {account.profile.hasPassword ? "Change password" : "Set a password"}
        </h2>
        <p className="muted">
          {account.profile.hasPassword
            ? "Changing your password signs out every device, including this one."
            : "Your account signs in with Apple or Google. A password adds another way in."}
        </p>
        <Status message={messages.password ?? null} />
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            if (text(f, "next") !== text(f, "confirm")) {
              say("password", "The new passwords do not match.", "error");
              return;
            }
            void run(
              "password",
              () =>
                account.profile.hasPassword
                  ? accountRequest("/auth/password", "POST", {
                      current: String(f.get("password") ?? ""),
                      password: String(f.get("next") ?? ""),
                      code: optional(f, "code"),
                    })
                  : accountRequest("/account/password/set", "POST", {
                      password: String(f.get("next") ?? ""),
                      code: optional(f, "code"),
                    }),
              (r) =>
                account.profile.hasPassword
                  ? "Password changed. Sign in again with your new password."
                  : r.message,
            ).then((r) => {
              form.reset();
              if (r && account.profile.hasPassword)
                window.setTimeout(() => window.location.assign("/login"), 1500);
            });
          }}
        >
          <ProofFields account={account} prefix="password" />
          <label className="field">
            <span>New password</span>
            <input
              name="next"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
            <small className="muted">At least 12 characters.</small>
          </label>
          <label className="field">
            <span>Repeat new password</span>
            <input
              name="confirm"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
          </label>
          <button className="button" disabled={busy === "password"}>
            {account.profile.hasPassword ? "Change password" : "Save password"}
          </button>
        </form>
      </section>

      {methods.length > 0 && (
        <section className="card" aria-labelledby="acct-methods">
          <h2 id="acct-methods">Apple and Google sign-in</h2>
          <p className="muted">
            Linking adds a way to sign in. Your authenticator is still required
            when it is enabled.
          </p>
          <Status message={messages.methods ?? null} />
          <ul className="acct-list">
            {methods.map((provider) => {
              const identity = account.identities.find(
                (i) => i.provider === provider.id,
              );
              const open = pendingMethod?.provider === provider.id;
              return (
                <li key={provider.id}>
                  <div className="acct-row">
                    <span className="acct-break">
                      <strong>{provider.name}</strong>
                      <br />
                      <small className="muted">
                        {identity
                          ? `Linked${identity.email ? ` as ${identity.email}` : ""} on ${formatDate(identity.linkedAt)}`
                          : "Not linked"}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="button secondary"
                      aria-expanded={open}
                      disabled={!identity && !provider.enabled}
                      onClick={() =>
                        setPendingMethod(
                          open
                            ? null
                            : {
                                provider: provider.id,
                                action: identity ? "unlink" : "link",
                              },
                        )
                      }
                    >
                      {identity ? "Remove" : `Link ${provider.name}`}
                    </button>
                  </div>
                  {open && (
                    <form
                      className="acct-inline-form"
                      onSubmit={(e: FormEvent<HTMLFormElement>) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget),
                          proof = {
                            password: optional(f, "password"),
                            code: optional(f, "code"),
                          };
                        if (pendingMethod?.action === "link")
                          void run(
                            "methods",
                            async () => {
                              const r = await accountRequest(
                                `/auth/oidc/${provider.id}/link`,
                                "POST",
                                { ...proof, returnTo },
                              );
                              window.location.assign(r.authorizationUrl);
                              return r;
                            },
                            () => `Opening ${provider.name}…`,
                          );
                        else
                          void run(
                            "methods",
                            () =>
                              accountRequest(
                                `/account/identities/${provider.id}/unlink`,
                                "POST",
                                proof,
                              ),
                            () => `${provider.name} sign-in was removed.`,
                          ).then((r) => r && setPendingMethod(null));
                      }}
                    >
                      <ProofFields
                        account={account}
                        prefix={`method-${provider.id}`}
                      />
                      <button className="button" disabled={busy === "methods"}>
                        {pendingMethod?.action === "link"
                          ? `Continue to ${provider.name}`
                          : `Remove ${provider.name} sign-in`}
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {account.notices.length > 0 && (
        <section className="card" aria-labelledby="acct-notices">
          <div className="acct-row">
            <h2 id="acct-notices">Account notices</h2>
            {unread > 0 && (
              <button
                type="button"
                className="button secondary"
                disabled={busy === "notices"}
                onClick={() =>
                  void run(
                    "notices",
                    () => accountRequest("/account/notices/read", "POST", {}),
                    () => "",
                  )
                }
              >
                Mark all as read
              </button>
            )}
          </div>
          <Status message={messages.notices ?? null} />
          <ul className="acct-list">
            {account.notices.map((n) => (
              <li key={n.id} className={n.readAt ? "" : "acct-unread"}>
                <strong>{n.title}</strong>
                {!n.readAt && <span className="badge amber">New</span>}
                <p className="acct-break">{n.body}</p>
                <small className="muted">{formatDate(n.createdAt)}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {account.workspace.role === "subscriber" && <LeaveTrainer />}
    </div>
  );
}
