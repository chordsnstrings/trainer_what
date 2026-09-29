"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  accountRequest,
  formatDate as formatDateEn,
  signInErrorMessage,
  type AccountError,
} from "./account-request";
import { LeaveTrainer } from "./membership-exit";
import { Skeleton } from "./phone-ui";
import { Rich, useErrorText, useLocale, useT } from "../lib/i18n/react";
import { formatDateTime } from "../lib/format";

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
  const t = useT("account");
  return (
    <>
      {account.profile.hasPassword ? (
        <label className="field">
          <span>{t("currentPassword")}</span>
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
          <p className="notice">{t("noPasswordProof")}</p>
        )
      )}
      {account.profile.mfaEnabled && (
        <label className="field">
          <span>{t("authenticatorCode")}</span>
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
  const t = useT("account"),
    locale = useLocale(),
    toError = useErrorText();
  const formatDate = (value: string | null | undefined) =>
    locale === "en" ? formatDateEn(value) : formatDateTime(value, { locale });
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
      setLoadError(toError(e));
    }
  }, [toError]);
  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const linked = params.get("linked"),
      error = params.get("signin_error");
    if (linked)
      say(
        "methods",
        t("linkedNow", { provider: linked === "apple" ? "Apple" : "Google" }),
      );
    if (error) say("methods", signInErrorMessage(error, locale), "error");
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
      say(section, toError(e as AccountError), "error");
      return null;
    } finally {
      setBusy("");
    }
  }
  if (loadError)
    return (
      <section className="card">
        <h2>{t("accountSettings")}</h2>
        <p className="notice error" role="alert">
          {loadError}
        </p>
      </section>
    );
  if (!account)
    return (
      <section className="card" aria-busy="true">
        <h2>{t("accountSettings")}</h2>
        <Skeleton label={t("loadingAccount")} lines={3} />
      </section>
    );
  const methods = account.providers.filter((p) => p.enabled || p.linked);
  const unread = account.notices.filter((n) => !n.readAt).length;
  return (
    <div className="acct-stack">
      <section className="card" aria-labelledby="acct-profile">
        <h2 id="acct-profile">{t("yourName")}</h2>
        <p className="muted">{t("nameShown")}</p>
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
              () => t("nameSaved"),
            );
          }}
        >
          <label className="field">
            <span>{t("displayName")}</span>
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
            {t("saveName")}
          </button>
        </form>
      </section>

      <section className="card" aria-labelledby="acct-email">
        <h2 id="acct-email">{t("signInEmail")}</h2>
        <p className="acct-row">
          <span className="acct-break" dir="ltr">
            {account.profile.email}
          </span>
          <span
            className={`badge ${account.profile.emailVerified ? "green" : "amber"}`}
          >
            {account.profile.emailVerified ? t("verified") : t("notVerified")}
          </span>
        </p>
        <Status message={messages.email ?? null} />
        {account.pendingEmailChange && (
          <div className="notice acct-row">
            <span className="acct-break">
              <Rich
                t={t}
                k="waitingConfirmation"
                params={{
                  email: account.pendingEmailChange.newEmail,
                  date: formatDate(account.pendingEmailChange.expiresAt),
                }}
                tags={{ b: (text) => <strong dir="ltr">{text}</strong> }}
              />
            </span>
            <button
              type="button"
              className="button secondary"
              disabled={busy === "email"}
              onClick={() =>
                void run(
                  "email",
                  () => accountRequest("/account/email/cancel", "POST", {}),
                  () => t("changeCancelled"),
                )
              }
            >
              {t("cancelChange")}
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
                (r) => (locale === "en" ? r.message : t("confirmationSent")),
              ).then((r) => r && form.reset());
            }}
          >
            <label className="field">
              <span>{t("newEmail")}</span>
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <ProofFields account={account} prefix="email" />
            <button className="button" disabled={busy === "email"}>
              {t("sendConfirmation")}
            </button>
          </form>
        ) : (
          <p className="notice">{t("emailNotConfigured")}</p>
        )}
      </section>

      <section className="card" aria-labelledby="acct-password">
        <h2 id="acct-password">
          {account.profile.hasPassword ? t("changePassword") : t("setPassword")}
        </h2>
        <p className="muted">
          {account.profile.hasPassword ? t("changeSignsOut") : t("addsWayIn")}
        </p>
        <Status message={messages.password ?? null} />
        <form
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form);
            if (text(f, "next") !== text(f, "confirm")) {
              say("password", t("noMatch"), "error");
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
                  ? t("passwordChanged")
                  : locale === "en"
                    ? r.message
                    : t("passwordSet"),
            ).then((r) => {
              form.reset();
              if (r && account.profile.hasPassword)
                window.setTimeout(() => window.location.assign("/login"), 1500);
            });
          }}
        >
          <ProofFields account={account} prefix="password" />
          <label className="field">
            <span>{t("newPassword")}</span>
            <input
              name="next"
              type="password"
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              required
            />
            <small className="muted">{t("atLeast12")}</small>
          </label>
          <label className="field">
            <span>{t("repeatPassword")}</span>
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
            {account.profile.hasPassword
              ? t("changePassword")
              : t("savePassword")}
          </button>
        </form>
      </section>

      {methods.length > 0 && (
        <section className="card" aria-labelledby="acct-methods">
          <h2 id="acct-methods">{t("appleGoogle")}</h2>
          <p className="muted">{t("linkingAdds")}</p>
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
                          ? identity.email
                            ? t("linkedAs", {
                                email: identity.email,
                                date: formatDate(identity.linkedAt),
                              })
                            : t("linkedOn", {
                                date: formatDate(identity.linkedAt),
                              })
                          : t("notLinked")}
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
                      {identity
                        ? t("remove")
                        : t("link", { provider: provider.name })}
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
                            () => t("opening", { provider: provider.name }),
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
                            () => t("removed", { provider: provider.name }),
                          ).then((r) => r && setPendingMethod(null));
                      }}
                    >
                      <ProofFields
                        account={account}
                        prefix={`method-${provider.id}`}
                      />
                      <button className="button" disabled={busy === "methods"}>
                        {pendingMethod?.action === "link"
                          ? t("continueTo", { provider: provider.name })
                          : t("removeSignIn", { provider: provider.name })}
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
            <h2 id="acct-notices">{t("notices")}</h2>
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
                {t("markAllRead")}
              </button>
            )}
          </div>
          <Status message={messages.notices ?? null} />
          <ul className="acct-list">
            {account.notices.map((n) => (
              <li key={n.id} className={n.readAt ? "" : "acct-unread"}>
                <strong dir="auto">{n.title}</strong>
                {!n.readAt && (
                  <span className="badge amber">{t("newBadge")}</span>
                )}
                <p className="acct-break" dir="auto">
                  {n.body}
                </p>
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
