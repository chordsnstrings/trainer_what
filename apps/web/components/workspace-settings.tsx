"use client";
import { NotificationPreferences } from "./notifications";
import { PushNotifications } from "./push-notifications";
import { WorkoutNotificationPolicy } from "./lifecycle-policy";
import { WorkspaceLifecycle, PersonalPrivacyStatus } from "./privacy-lifecycle";
import { AccountSecurity } from "./account-security";
import { AccountExtras } from "./account-completion";
import { AccountSettings } from "./account-settings";
import { AnalyticsSetting } from "./acquisition";
import { LeaveTrainer } from "./membership-exit";
import { useT } from "../lib/i18n/react";
import { DisplayPreferences } from "./appearance";
import { MemberIntake } from "./member-intake";
import { InstallAppRow } from "./pwa-ui";
import Link from "next/link";
import { ArrowUpRight, Download } from "lucide-react";
import {
  type More,
  api,
  Button,
  Badge,
  Card,
  Heading,
  type ViewProps,
} from "./workspace-ui";
import { questions } from "./workspace-brain";
export function Integrations({ state, action, busy, path }: ViewProps) {
  return (
    <>
      <Heading
        eyebrow="A CONNECTED COACHING PRACTICE"
        title="Useful connections. Clear permissions."
        detail="See what is available and what still needs provider setup. Your data stays tied to its allowed purpose."
      />
      <div className="integration-grid">
        {state.integrations.map((i) => (
          <Card key={i.id}>
            <div className="card-heading">
              <span className="integration-letter">{i.name[0]}</span>
              <Badge tone={i.configured && i.approved ? "green" : "amber"}>
                {i.configured && i.approved
                  ? "Available"
                  : i.configured
                    ? "Approval required"
                    : "Not connected"}
              </Badge>
            </div>
            <h2>{i.name}</h2>
            <p className="muted">{i.purpose}</p>
            {i.id === "lean" && (
              <Link className="text-link" href="/trainer/payouts">
                Manage bank destination <ArrowUpRight size={14} />
              </Link>
            )}
            {i.id === "apple" && (
              <p className="small-label">IMPORT · NO ADVERTISING USE</p>
            )}
          </Card>
        ))}
      </div>
      <Card>
        <h2>Import Apple Health observations</h2>
        <p className="muted">
          Select an Apple Health export.xml file. Supported numeric records are
          imported with their source, unit and measurement time. They remain
          excluded from model inputs and marketing.
        </p>
        <input
          type="file"
          accept=".xml"
          aria-label="Apple Health export XML"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 15 * 1024 * 1024) {
              window.alert("Use an export under 15 MB for this import.");
              return;
            }
            const xml = new DOMParser().parseFromString(
              await file.text(),
              "text/xml",
            );
            const observations = Array.from(xml.querySelectorAll("Record"))
              .map((node) => ({
                type: node.getAttribute("type") ?? "",
                value: Number(node.getAttribute("value")),
                unit: node.getAttribute("unit") ?? "",
                measuredAt: node.getAttribute("startDate") ?? "",
              }))
              .filter(
                (x) =>
                  Number.isFinite(x.value) &&
                  x.measuredAt &&
                  Number.isFinite(Date.parse(x.measuredAt)),
              )
              .map((x) => ({
                ...x,
                measuredAt: new Date(x.measuredAt).toISOString(),
              }));
            if (observations.length > 2000) {
              window.alert(
                "This import supports up to 2,000 numeric observations. Select a smaller date range; no partial import has been made.",
              );
              return;
            }
            await action(
              () =>
                api("/wearables/import", "POST", {
                  source: "apple_health",
                  observations,
                  consent: true,
                }),
              `${observations.length} observations imported`,
            );
          }}
        />
      </Card>
    </>
  );
}
export function SettingsView({
  state,
  records,
  action,
  busy,
  path,
  onSaved,
}: ViewProps) {
  const sub = state.user.role === "subscriber";
  // A member's coaching profile questions are their own step-by-step page
  // (member-intake.tsx); account security stays in Profile and settings.
  if (sub && path === "/app/intake")
    return (
      <MemberIntake intake={records("intake")[0]?.data} onSaved={onSaved} />
    );
  if (sub) return <MemberSettings state={state} action={action} busy={busy} />;
  return <TrainerSettingsView state={state} action={action} busy={busy} />;
}
/**
 * Profile and settings for a member, phone first: the coaching profile link,
 * the installed app, account details, display preferences (appearance and
 * motion), notifications, sign-in security folded into one section, privacy
 * (analytics included) and leaving the coach (a bottom sheet in
 * AccountSettings).
 */
export function MemberSettings({
  state,
  action,
  busy,
}: Pick<ViewProps, "state" | "action" | "busy">) {
  const t = useT("profile");
  const intakeDone = state.records.some((r) => r.kind === "intake");
  return (
    <div className="member-settings" data-stagger>
      <header className="page-heading">
        <h1>{t("settingsTitle")}</h1>
        <p className="muted">{t("settingsIntro")}</p>
      </header>
      <section className="card" aria-labelledby="settings-coaching">
        <h2 id="settings-coaching">{t("coachingProfile")}</h2>
        <p className="muted">
          {intakeDone ? t("profileDoneText") : t("profileStartText")}
        </p>
        <Link className="button secondary" href="/app/intake">
          {intakeDone ? t("reviewProfile") : t("startProfile")}
        </Link>
      </section>
      <InstallAppRow coachName={state.tenant.name} variant="card" />
      <AccountSettings returnTo="/app/profile" leave={false} />
      <DisplayPreferences />
      <NotificationPreferences />
      {/* Secondary detail folds away (phone first: a shorter page). */}
      <details className="card settings-group" id="phone-alerts">
        <summary>
          <span>
            <strong>{t("alertsTitle")}</strong>
            <small>{t("alertsDetail")}</small>
          </span>
        </summary>
        <PushNotifications />
      </details>
      <details className="card settings-group" id="security">
        <summary>
          <span>
            <strong>{t("securityTitle")}</strong>
            <small>{t("securityDetail")}</small>
          </span>
        </summary>
        <AccountSecurity />
        <AccountExtras />
      </details>
      <PersonalPrivacyStatus />
      {/* Profile > Privacy (/app/profile#privacy), linked from More. */}
      <Card id="privacy">
        <h2>{t("yourData")}</h2>
        <p className="muted">{t("yourDataText")}</p>
        <div className="button-row">
          <a className="button secondary" href="/api/v1/privacy/export">
            <Download size={16} />
            {t("downloadData")}
          </a>
          <Button
            secondary
            disabled={busy}
            onClick={() =>
              void action(
                () => api("/privacy/delete-request", "POST", {}),
                t("deletionReceived"),
              )
            }
          >
            {t("askDelete")}
          </Button>
        </div>
        <div className="divider" />
        <p className="muted">{t("digitalText")}</p>
        <Button
          secondary
          disabled={busy}
          onClick={() =>
            void action(
              () =>
                api("/privacy/consent", "POST", {
                  type: "coaching",
                  granted: false,
                }),
              t("digitalStopped"),
            )
          }
        >
          {t("stopDigital")}
        </Button>
        <div className="divider" />
        <AnalyticsSetting />
      </Card>
      {/* The one destructive action, last and on its own. */}
      <section className="member-danger-zone" aria-label={t("dangerZone")}>
        <LeaveTrainer />
      </section>
    </div>
  );
}
export function TrainerSettingsView({
  state,
  action,
  busy,
}: Pick<ViewProps, "state" | "action" | "busy">) {
  const t = useT("profile");
  return (
    <>
      <Heading
        eyebrow="YOUR SPACE, YOUR CHOICES"
        title="Your workspace settings."
        detail="Keep your information useful, your permissions clear and your data under your control."
      />
      <AccountSecurity />
      <AccountExtras />
      <AccountSettings returnTo="/trainer/settings" />
      <PersonalPrivacyStatus />
      {["owner", "staff"].includes(state.user.role) && (
        <WorkspaceLifecycle role={state.user.role} />
      )}
      <div className="two-columns">
        <NotificationPreferences />
        <PushNotifications />
        {state.user.role === "owner" && <WorkoutNotificationPolicy />}
        <Card id="privacy">
          <h2>Your data</h2>
          <p className="muted">{t("privacyText")}</p>
          <div className="button-row">
            <a className="button secondary" href="/api/v1/privacy/export">
              <Download size={16} />
              {t("exportData")}
            </a>
            <Button
              secondary
              disabled={busy}
              onClick={() =>
                void action(
                  () => api("/privacy/delete-request", "POST", {}),
                  t("deletionRecorded"),
                )
              }
            >
              {t("requestDeletion")}
            </Button>
          </div>
          <div className="divider" />
          <Button
            secondary
            disabled={busy}
            onClick={() =>
              void action(
                () =>
                  api("/privacy/consent", "POST", {
                    type: "coaching",
                    granted: false,
                  }),
                t("consentWithdrawn"),
              )
            }
          >
            {t("withdrawConsent")}
          </Button>
          <div className="divider" />
          <AnalyticsSetting />
        </Card>
      </div>
      {state.user.role === "owner" && (
        <Card>
          <h2>Team access</h2>
          <p className="muted">
            Manage coaching and finance roles, invitations, MFA status and
            workspace access in your team settings.
          </p>
          <Link href="/trainer/team" className="button secondary">
            Manage your team
          </Link>
        </Card>
      )}
    </>
  );
}
