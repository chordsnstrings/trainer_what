"use client";
import { Inbox, Chats, ChatThread } from "./workspace-inbox";
import {
  CLIENT_TOOLS,
  SETUP_HREF,
  TrainerMore,
  TrainerTabBar,
  moreGroups,
  sectionFor,
  trainerSections,
  trainerTitle,
  useInboxCount,
} from "./workspace-nav";
import { TeamControls } from "./team-controls";
import { CoachSwitcher } from "./joining";
import { AdminComplimentaryAccess } from "./complimentary-access";
import { Affiliates } from "./affiliates";
import { InfrastructureActions } from "./infrastructure-actions";
import { NotificationInbox } from "./notifications";
import {
  IntegrationCenter,
  GuidedSession,
  IntegrationOperations,
} from "./integration-center";
import { VoiceSessionRunner } from "./voice-session";
import { CoachingStudio } from "./coaching-studio";
import { BrainPlans } from "./brain-plans";
import { AdminOperations, TrainerAnalytics } from "./admin-operations";
import { RetentionPanel } from "./retention";
import {
  TrainingPrograms,
  CoachingMessages,
  TrainingProgress,
} from "./training-workspace";
import { SetupRedirect, SetupWizard } from "./setup-wizard";
import {
  SETUP_PATH,
  isSetupPath,
  legacySetupRedirect,
} from "./setup-wizard-model";
import { NutritionCoach, NutritionSubscriber } from "./nutrition";
import { InfrastructureObserver } from "./infrastructure-observer";
import { HostOperations } from "./host-operations";
import { Public } from "./public-pages";
import { PlatformLogo } from "./brand-logo";
import { TrainerGrowth } from "./trainer-growth";
import { Bookings } from "./bookings";
import { Support } from "./support";
import { AccountSecurity } from "./account-security";
import { AccountExtras } from "./account-completion";
import { AccountSettings } from "./account-settings";
import { OperatorRecovery } from "./operator-recovery";
import { GalleryStudio, WebsiteStudio, CoachWebsite } from "./coach-site";
import { MemberAppManifest } from "./member-app-install";
import { MemberShell, MoreScreen } from "./member-shell";
import { Toast } from "./phone-ui";
import { MemberLanguage } from "./document-direction";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import { MemberAppearance, useColorScheme } from "./appearance";
import { type ColorSchemeChoice } from "../color-scheme";
import { DirectoryListingSettings } from "./directory-listing";
import { PlatformSettings } from "./platform-settings";
import { ModelProfiles } from "./model-profiles";
import { MarketingAssistantAdmin } from "./marketing-assistant-admin";
import { ProviderSandboxBanner } from "./provider-sandbox-banner";
import { MealCapture } from "./meal-capture";
import { ProgrammeTimeline } from "./programme-today";
import { MemberToday } from "./member-today";
import { MemberProgram } from "./member-program";
import { MemberCoachingContext } from "./member-context";
import { MemberChat } from "./member-chat";
import { MemberMembership } from "./member-membership";
import { MemberNotFound, WorkspaceUnavailable } from "./member-states";
import { isMemberRoute } from "./member-nav";
import { TrainerTheme, CoachIdentity } from "./trainer-design";
import {
  BRAND_COPY,
  DEFAULT_PLATFORM_NAME,
  appInitials,
  isMarketingPath,
  resolveBrandDesign,
  usesBrandIdentity,
} from "@trainer/contracts";
import { adminRoute } from "./app-routes";
import { WorkspaceGovernance } from "./workspace-governance";
import { BusinessMetrics } from "./business-metrics";
import { PlatformFinance } from "./platform-finance";
import { PlatformAlerts } from "./platform-alerts";
import { WorkspaceSuspended } from "./workspace-suspended";
import {
  appendPage,
  appendRelated,
  canLoadMore,
  mergePages,
  nextPagePath,
  pageInfo,
  pageKey,
  type ExtraPages,
} from "./workspace-paging";
import { OFFLINE_STATE_KEY, clearPersonalCaches, installKeys } from "./pwa";
import {
  AppUpdateToast,
  OfflineScreen,
  PushPrompt,
  useAppServiceWorker,
} from "./pwa-ui";
import { clearLocalData, leaveSession } from "./offline-queue";
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  Layers,
  MessageCircle,
  Activity,
  Wallet,
  Settings,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  Shield,
  Brain,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Link2,
  Camera,
} from "lucide-react";
import {
  type State,
  type More,
  LoadMore,
  api,
  Heading,
} from "./workspace-ui";
import { Overview, OnboardingView, Brand } from "./workspace-home";
import { BrainView } from "./workspace-brain";
import { SubscriberDetail, Members } from "./workspace-clients";
import { Workout } from "./workspace-training";
import { Exceptions } from "./workspace-messages";
import { Finance } from "./workspace-finance";
import { SettingsView } from "./workspace-settings";
import { Analytics, AdminNotFound, Admin } from "./workspace-admin";
const subNav = [
  ["Today", "/app", LayoutDashboard],
  ["Programme", "/app/program", Layers],
  ["Programme timeline", "/app/timeline", Layers],
  ["Nutrition", "/app/nutrition", Activity],
  ["Log a meal", "/app/nutrition/log", Camera],
  ["Coach chat", "/app/chat", MessageCircle],
  ["Notifications", "/app/notifications", MessageCircle],
  ["Bookings", "/app/bookings", Activity],
  ["Support", "/app/support", MessageCircle],
  ["Progress", "/app/progress", Activity],
  ["Coaching context", "/app/twin", Brain],
  ["Membership", "/app/membership", Wallet],
  ["Connections", "/app/wearables", Link2],
  ["Coach galleries", "/app/galleries", Camera],
  ["My profile", "/app/profile", Settings],
] as const;
type WorkspaceChoice = {
  tenantId: string;
  name: string;
  role: string;
  current: boolean;
};
const roleNames: Record<string, string> = {
  owner: "Owner",
  staff: "Coach",
  finance: "Finance",
  subscriber: "Member",
};
/** Lists this account's workspaces and switches the signed-in session. */
function WorkspaceSwitcher({
  current,
  userId,
}: {
  current: string;
  userId: string;
}) {
  const [choices, setChoices] = useState<WorkspaceChoice[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api("/auth/workspaces").then(
      (r) => active && setChoices(r.workspaces),
      () => active && setChoices([]),
    );
    return () => {
      active = false;
    };
  }, [current]);
  if (choices.length < 2) return null;
  return (
    <label className="workspace-switcher">
      <span>
        {choices.find((c) => c.current)?.role === "subscriber"
          ? "Switch coach"
          : "Switch workspace"}
      </span>
      <select
        value={current}
        disabled={busy}
        onChange={async (e) => {
          const next = choices.find((c) => c.tenantId === e.target.value);
          if (!next || next.tenantId === current) return;
          setBusy(true);
          setError("");
          try {
            // Replay before the switch replaces this session. Unsynced entries
            // stay scoped to this workspace and member; only caches are cleared.
            const left = await leaveSession(localStorage, current, userId, {
              online: navigator.onLine,
              post: (p, b, h) => api(p, "POST", b, h),
              confirm: (n) =>
                window.confirm(
                  `${n} workout or meal ${n === 1 ? "entry has" : "entries have"} not synced. ${n === 1 ? "It stays" : "They stay"} on this device and will sync when you return to this workspace. Switch anyway?`,
                ),
              leave: () =>
                api("/auth/workspace", "POST", { tenantId: next.tenantId }),
              afterLeave: clearPersonalCaches,
            });
            if (!left) {
              setBusy(false);
              return;
            }
            window.location.assign(
              next.role === "subscriber" ? "/app" : "/trainer",
            );
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        {choices.map((c) => (
          <option key={c.tenantId} value={c.tenantId}>
            {c.name} · {roleNames[c.role] ?? c.role}
          </option>
        ))}
      </select>
      {error && <small role="alert">{error}</small>}
    </label>
  );
}
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
/** Platform identity the server passes down for the public pages. */
export type WorkspacePlatform = {
  name: string;
  initials: string;
  registrationOpen: boolean;
};
const defaultPlatform: WorkspacePlatform = {
  name: DEFAULT_PLATFORM_NAME,
  initials: appInitials(DEFAULT_PLATFORM_NAME),
  registrationOpen: true,
};
/**
 * A member's last workspace state, kept in this tab's memory. Next renders
 * this page afresh for every path, so without it each tap on a tab would
 * blank the member app behind the full-screen loader while the bootstrap
 * reloads. The next member page instead opens at once on this state (the
 * top bar shows the refresh) and updates when the bootstrap answers.
 * Members only (the trainer workspace is unchanged); set only by `load`,
 * which runs in the browser; cleared on sign-out, 401 and suspension.
 */
let memberStateCache: State | null = null;
export default function Workspace({
  platform = defaultPlatform,
  coachSlug = null,
  colorScheme,
}: {
  platform?: WorkspacePlatform;
  /** Set on a trainer's own domain or subdomain (x-trainer-site-slug). */
  coachSlug?: string | null;
  /** The member's appearance mirrored on this device (the server's cookie). */
  colorScheme?: ColorSchemeChoice;
}) {
  const path = usePathname(),
    router = useRouter();
  // Subscriber surfaces follow the member's Light, Dark or System choice
  // (components/appearance.tsx); the trainer workspace keeps the device's.
  const scheme = useColorScheme(colorScheme);
  // Subscriber text follows the document language (lib/i18n/react.tsx).
  const locale = useLocale(),
    shellT = useT("shell"),
    common = useT("common"),
    toError = useErrorText();
  // The member app's first-load, unavailable and suspended screens come
  // before the coach's brand is known: they follow the choice with the
  // neutral dark palette (app/appearance.css).
  const memberScreen = (screen: ReactNode) =>
    path === "/app" || path.startsWith("/app/") ? (
      <div className="member-neutral" data-color-scheme={scheme}>
        {screen}
      </div>
    ) : (
      screen
    );
  const [state, setState] = useState<State | null>(() =>
      path.startsWith("/app") && memberStateCache?.user.role === "subscriber"
        ? memberStateCache
        : null,
    ),
    [error, setError] = useState(""),
    [bootstrapError, setBootstrapError] = useState(""),
    [success, setSuccess] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [online, setOnline] = useState(true),
    [suspended, setSuspended] = useState(false),
    // No connection and nothing saved on this phone to show instead.
    [offlineScreen, setOfflineScreen] = useState<number | null | false>(
      false,
    ),
    // Pages loaded beyond the bootstrap's first page. Cleared whenever the
    // bootstrap reloads, so a changed row is never shown from an old page.
    [extra, setExtra] = useState<ExtraPages>({}),
    [moreLoading, setMoreLoading] = useState("");
  const generation = useRef(0);
  // The state on screen, for a failed refresh to keep (see `load`).
  const shownState = useRef(state);
  shownState.current = state;
  // This release's service worker; members choose when a new one reloads.
  const serviceWorker = useAppServiceWorker(path.startsWith("/app"));
  // Open inbox items for the Inbox tab and the app icon (coaches only);
  // refreshed with every workspace reload.
  const inboxCount = useInboxCount(
    !!state &&
      ["owner", "staff"].includes(state.user.role) &&
      path.startsWith("/trainer"),
    state,
  );
  const shown = useMemo(
    () => (state ? mergePages(state, extra) : null),
    [state, extra],
  );
  const publicPath =
    isMarketingPath(path) ||
    ["/login", "/signup"].includes(path) ||
    path === "/forgot-password" ||
    path === "/magic-link" ||
    path.startsWith("/magic-link/") ||
    path === "/recover-authenticator" ||
    path === "/sign-in/verify" ||
    path.startsWith("/verify-email-change/") ||
    path.startsWith("/account-recovery/") ||
    path.startsWith("/reset-password/") ||
    path.startsWith("/verify-email/") ||
    path.startsWith("/join-coach/") ||
    path.startsWith("/join/") ||
    path.startsWith("/coach/");
  const load = useCallback(async () => {
    try {
      const next = await api("/bootstrap");
      memberStateCache = next.user.role === "subscriber" ? next : null;
      generation.current++;
      setExtra({});
      setState(next);
      setSuspended(false);
      setBootstrapError("");
      setOfflineScreen(false);
      if (next.user.role === "subscriber")
        localStorage.setItem(
          OFFLINE_STATE_KEY,
          JSON.stringify({
            expires: Date.now() + 12 * 3600000,
            // When this phone last had the member's data (offline screen).
            savedAt: Date.now(),
            state: {
              ...next,
              records: next.records.filter((r: any) =>
                ["workout", "program"].includes(r.kind),
              ),
              consents: [],
              integrations: [],
              subscriptions: [],
            },
          }),
        );
    } catch (e) {
      if ((e as any).code === "WORKSPACE_SUSPENDED") {
        // A platform suspension: show its status instead of the workspace.
        memberStateCache = null;
        setState(null);
        setBootstrapError("");
        setSuspended(true);
        return;
      }
      if ((e as any).status === 401) {
        // Unsynced set logs and diary entries stay scoped to their member and
        // replay after that person signs in again; caches are removed.
        clearLocalData(localStorage, { keepQueues: true });
        void clearPersonalCaches();
        memberStateCache = null;
        setState(null);
        setBootstrapError("");
        if (!publicPath) router.replace("/login");
        return;
      }
      const cached = localStorage.getItem(OFFLINE_STATE_KEY);
      // No connection: a failed fetch, not an answer from the server.
      const noConnection = !navigator.onLine || e instanceof TypeError;
      if (
        !navigator.onLine &&
        path.startsWith("/app") &&
        shownState.current?.user.role === "subscriber"
      ) {
        // Offline, a member keeps what is on screen; the top bar says
        // "Offline". (Online, a failed refresh says so below.)
        setBootstrapError("");
        setOfflineScreen(false);
        return;
      }
      if (noConnection && cached) {
        try {
          const offline = JSON.parse(cached);
          if (offline.expires > Date.now()) {
            setState(offline.state);
            setBootstrapError("");
            setOfflineScreen(false);
            return;
          }
        } catch {
          localStorage.removeItem(OFFLINE_STATE_KEY);
        }
      }
      if (noConnection && !publicPath && path.startsWith("/app")) {
        // Offline is not a server error: say so, and what still works.
        let savedAt: number | null = null;
        try {
          savedAt = cached ? (JSON.parse(cached).savedAt ?? null) : null;
        } catch {}
        setBootstrapError("");
        setOfflineScreen(savedAt);
        return;
      }
      if (!publicPath) {
        // A key; shown in the member's language below.
        setBootstrapError((e as any).status === 429 ? "429" : "failed");
      }
    } finally {
      setLoading(false);
    }
  }, [publicPath, router, path]);
  useEffect(() => {
    setError("");
    setBootstrapError("");
    setSuccess("");
    setMobile(false);
    if (!publicPath) {
      setLoading(true);
      void load();
    } else setLoading(false);
  }, [path, publicPath, load]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const bootstrapText =
    bootstrapError === "429"
      ? common("tooManyRequests")
      : bootstrapError
        ? shellT("refreshFailed")
        : "";
  const action = async (fn: () => Promise<any>, message?: string) => {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await fn();
      setSuccess(message ?? common("saved"));
      await load();
      return result;
    } catch (e) {
      setError(toError(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  if (publicPath)
    return (
      <Public
        path={path}
        platform={platform}
        coachSlug={coachSlug}
        colorScheme={scheme}
        onAuthenticated={async () => {
          await load();
          const s = await api("/bootstrap").catch(async (e) => {
            if ((e as any).code !== "WORKSPACE_SUSPENDED") throw e;
            // Signed in to a suspended workspace: open its status screen.
            const status = await api("/workspace/status");
            router.push(status.role === "subscriber" ? "/app" : "/trainer");
            return null;
          });
          if (!s) return;
          router.push(
            s.user.role === "subscriber"
              ? "/app"
              : path === "/signup"
                ? SETUP_PATH
                : "/trainer",
          );
        }}
      />
    );
  if (suspended)
    return memberScreen(
      <WorkspaceSuspended
        onSignOut={async () => {
          await api("/auth/logout", "POST", {});
          clearLocalData(localStorage, { keepQueues: true });
          await clearPersonalCaches();
          router.push("/login");
        }}
      />
    );
  if (!loading && !state && offlineScreen !== false)
    return memberScreen(
      <OfflineScreen
        savedAt={offlineScreen}
        onRetry={() => {
          setLoading(true);
          void load();
        }}
      />
    );
  if (!loading && !state && bootstrapError)
    return memberScreen(
      <WorkspaceUnavailable
        message={bootstrapText}
        busy={loading}
        onRetry={() => {
          setLoading(true);
          void load();
        }}
        onSignOut={async () => {
          await api("/auth/logout", "POST", {}).catch(() => {});
          clearLocalData(localStorage, { keepQueues: true });
          memberStateCache = null;
          router.push("/login");
        }}
      />
    );
  // A member keeps the app frame while a page refreshes (the top bar shows
  // the refresh); the full-screen loader is only for the first load.
  if (!state || (loading && state.user.role !== "subscriber"))
    return memberScreen(
      <main className="loading-screen">
        {/* Neutral: a member app may carry its trainer's brand, which is
            not known until the workspace has loaded. */}
        <div className="loading-indicator" aria-hidden="true" />
        <p>{shellT("loadingWorkspace")}</p>
      </main>
    );
  const subscriber = state.user.role === "subscriber";
  // The member app's pages (the member shell has its own tab bar).
  const items = subNav;
  const view = shown ?? state;
  const records = (kind: string) => view.records.filter((x) => x.kind === kind);
  const more: More = {
    has: (collection, kind) =>
      canLoadMore(pageInfo(state.pages, extra, collection, kind)),
    loading: moreLoading,
    load: async (collection, kind) => {
      const info = pageInfo(state.pages, extra, collection, kind),
        key = pageKey(collection, kind),
        started = generation.current;
      if (!info || !canLoadMore(info)) return;
      setMoreLoading(key);
      try {
        const page = await api(nextPagePath(collection, info, kind));
        if (started === generation.current)
          setExtra((current) =>
            appendRelated(appendPage(current, key, page), page.related),
          );
      } catch (e) {
        setError(toError(e));
      } finally {
        setMoreLoading("");
      }
    },
  };
  const firstName = state.user.name.split(" ")[0];
  const topTitle = path.startsWith("/admin")
    ? "Platform operations"
    : subscriber
      ? (items.find((x) => x[1] === path)?.[0] ?? "Your workspace")
      : trainerTitle(path, state.user.role);
  // The setup wizard (/setup) stays one tap away until the page is live.
  const setupOpen = state.user.role === "owner" && !state.tenant.published;
  // The phone's bottom bar shows in the trainer workspace, not /admin.
  const trainerNav = !subscriber && path.startsWith("/trainer");
  const activeSection = sectionFor(path);
  const props = {
    state: view,
    records,
    action,
    busy,
    path,
    onSaved: load,
    more,
  };
  // Subscribers see their trainer's Design Studio brand in the phone-first
  // member shell (member-shell.tsx); trainers, their team and operators work
  // in the platform's own identity (light and dark).
  const platformName = state.platform?.name || DEFAULT_PLATFORM_NAME;
  const signOut = async () => {
    const { tenantId, userId } = state.user;
    const left = await leaveSession(localStorage, tenantId, userId, {
      online: navigator.onLine,
      post: (p, b, h) => api(p, "POST", b, h),
      confirm: (unsynced) =>
        window.confirm(shellT("signOutUnsynced", { count: unsynced })),
      leave: () => api("/auth/logout", "POST", {}),
      afterLeave: clearPersonalCaches,
    });
    if (left) {
      memberStateCache = null;
      router.push("/login");
    }
  };
  const memberNav = {
    programLabel: resolveBrandDesign(state.tenant.theme).programLabel,
    nutrition: !!(state as any).memberApp?.nutrition,
    locale,
  };
  const notices = (
    <>
          <ProviderSandboxBanner mode={state.providerSandbox} />
          {!subscriber && state.environment === "development" && (
            <div className="dev-banner">
              Development environment · payment connections are gated · demo
              records, when seeded, are synthetic
            </div>
          )}
          {!online && !subscriber && (
            <div className="notice">
              You’re offline. Workout logs are kept on this device until they
              can sync.
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <AlertCircle size={17} />
              {error}
              <button
                onClick={() => setError("")}
                aria-label={common("dismissError")}
              >
                <X size={15} />
              </button>
            </div>
          )}
          {bootstrapError && (
            <div className="notice error" role="alert">
              <AlertCircle size={17} />
              <span>
                {bootstrapText} {shellT("lastLoadedShown")}
              </span>
              <button
                type="button"
                disabled={loading}
                onClick={() => void load()}
              >
                {common("retry")} <RefreshCw size={14} />
              </button>
            </div>
          )}
          {/* Members get a toast above the bottom bars instead (MemberShell). */}
          {success && !subscriber && (
            <div className="notice success" role="status">
              <Check size={17} />
              {success}
            </div>
          )}
    </>
  );
  const page =
    subscriber && path.startsWith("/app") && !isMemberRoute(path) ? (
      <MemberNotFound />
    ) : path === "/app/more" && subscriber ? (
      <MoreScreen
        nav={memberNav}
        coachName={state.tenant.name}
        tenantId={state.user.tenantId}
        userId={state.user.userId}
        onSignOut={() => void signOut()}
      />
    ) : path === "/trainer/notifications" ||
          path === "/app/notifications" ? (
            <NotificationInbox />
          ) : path === "/admin/account-security" ? (
            state.user.platformRole === "admin" ? (
              <>
                <Heading
                  eyebrow="SUPERADMIN"
                  title="Account security."
                  detail="Verify your identity before changing platform settings."
                />
                <Link href="/admin/settings" className="ps-back-link">
                  Return to settings & connections
                </Link>
                <AccountSecurity />
                <AccountExtras />
                <AccountSettings returnTo="/admin/account-security" />
                <OperatorRecovery />
              </>
            ) : (
              <PlatformSettings
                path={path}
                platformRole={state.user.platformRole}
              />
            )
          ) : path === "/admin/integration-operations" ? (
            state.user.platformRole === "admin" ? (
              <IntegrationOperations />
            ) : (
              <PlatformSettings
                path={path}
                platformRole={state.user.platformRole}
              />
            )
          ) : path === "/admin/affiliates" ? (
            <Affiliates />
          ) : path === "/trainer/growth" ? (
            state.user.role === "owner" ? (
              <TrainerGrowth
                slug={state.tenant.slug}
                published={!!state.tenant.published}
              />
            ) : (
              <div className="notice">
                Followers and growth is available to the workspace owner.
              </div>
            )
          ) : path === "/trainer/affiliates" ? (
            <Affiliates trainer />
          ) : path === "/admin/infrastructure/observer" ? (
            <InfrastructureObserver />
          ) : path === "/admin/infrastructure/actions" ? (
            <InfrastructureActions />
          ) : path === "/admin/alerts" ? (
            <PlatformAlerts platformRole={state.user.platformRole} />
          ) : path === "/admin/metrics" ? (
            <BusinessMetrics platformRole={state.user.platformRole} />
          ) : path === "/admin/platform-finance" ? (
            <PlatformFinance platformRole={state.user.platformRole} />
          ) : path === "/admin/marketing-assistant" ? (
            state.user.platformRole === "admin" ? (
              <MarketingAssistantAdmin />
            ) : (
              <PlatformSettings
                path={path}
                platformRole={state.user.platformRole}
              />
            )
          ) : path === "/admin/model-profiles" ? (
            state.user.platformRole === "admin" ? (
              <ModelProfiles />
            ) : (
              <PlatformSettings
                path={path}
                platformRole={state.user.platformRole}
              />
            )
          ) : path === "/admin/governance" ? (
            <WorkspaceGovernance platformRole={state.user.platformRole} />
          ) : path === "/admin/infrastructure/host" ? (
            <HostOperations />
          ) : path.startsWith("/admin/settings") ||
            path.startsWith("/admin/integrations") ? (
            <PlatformSettings
              path={path}
              platformRole={state.user.platformRole}
              onSettingsChanged={load}
            />
          ) : adminRoute(path) === "operations" ? (
            <>
              {path === "/admin/acquisition" &&
                ["admin", "finance"].includes(state.user.platformRole) && (
                  <p>
                    <Link className="button secondary" href="/admin/affiliates">
                      Affiliate agreements and earnings
                    </Link>
                  </p>
                )}
              {path === "/admin/infrastructure" &&
                state.user.platformRole === "admin" && (
                  <p>
                    <Link
                      className="button secondary"
                      href="/admin/infrastructure/observer"
                    >
                      Infrastructure status and recommendations
                    </Link>
                  </p>
                )}
              <AdminOperations
                path={path}
                platformRole={state.user.platformRole}
              />
              {path === "/admin/support" &&
                ["admin", "support"].includes(state.user.platformRole) && (
                  <OperatorRecovery />
                )}
              {path === "/admin/subscribers" && (
                <AdminComplimentaryAccess
                  platformRole={state.user.platformRole}
                />
              )}
            </>
          ) : path.startsWith("/admin") ? (
            adminRoute(path) === "overview" ? (
              <Admin {...props} />
            ) : adminRoute(path) === "finance" ? (
              <Admin {...props} finance />
            ) : (
              <AdminNotFound />
            )
          ) : isSetupPath(path) ? (
            state.user.role === "owner" ? (
              <SetupWizard path={path} tenant={state.tenant} onSaved={load} />
            ) : (
              <div className="notice">
                Only the coach who owns this page can set it up.
              </div>
            )
          ) : legacySetupRedirect(path) ? (
            <SetupRedirect to={legacySetupRedirect(path)!} />
          ) : path === "/trainer" &&
            ["owner", "staff"].includes(state.user.role) ? (
            <Inbox state={view} />
          ) : path === "/trainer/summary" ? (
            <Overview {...props} />
          ) : path === "/trainer/more" ? (
            <TrainerMore
              role={state.user.role}
              setupOpen={setupOpen}
              platformAdmin={state.user.platformRole !== "none"}
            />
          ) : path === "/trainer/messages" ? (
            <Chats />
          ) : /^\/trainer\/messages\/[^/]+$/.test(path) ? (
            <ChatThread state={view} clientId={path.split("/")[3]} />
          ) : path.includes("/onboarding") ? (
            <OnboardingView {...props} />
          ) : path.startsWith("/trainer/nutrition/clients/") ? (
            <NutritionSubscriber
              userId={path.split("/")[4]}
              tenantId={state.user.tenantId}
              coachView
            />
          ) : path.startsWith("/trainer/nutrition") ? (
            <NutritionCoach
              key={path}
              initialSection={path.split("/")[3] ?? "overview"}
              role={state.user.role}
            />
          ) : path === "/app/nutrition/log" ? (
            subscriber ? (
              <MealCapture />
            ) : (
              <div className="notice">
                Meal logging is available in a subscriber’s coaching space.
              </div>
            )
          ) : path.startsWith("/app/nutrition") ? (
            <NutritionSubscriber
              userId={state.user.userId}
              tenantId={state.user.tenantId}
              environment={state.environment}
            />
          ) : path === "/trainer/galleries" ||
            path === "/trainer/website" ||
            path.startsWith("/trainer/website/preview") ? (
            state.user.role === "owner" ? (
              path === "/trainer/galleries" ? (
                <GalleryStudio />
              ) : path === "/trainer/website" ? (
                <>
                  <WebsiteStudio tenant={state.tenant} />
                  <DirectoryListingSettings />
                </>
              ) : (
                <CoachWebsite
                  preview
                  path={path.slice("/trainer/website/preview".length)}
                />
              )
            ) : (
              <div className="notice">
                Only the trainer owner can manage their galleries and website.
              </div>
            )
          ) : path === "/app/galleries" ? (
            subscriber ? (
              <GalleryStudio client />
            ) : (
              <div className="notice">
                Open your trainer galleries to manage client photos.
              </div>
            )
          ) : path.includes("/brand") || path === "/trainer/design" ? (
            <Brand {...props} />
          ) : path.includes("/bookings") ? (
            <Bookings role={state.user.role} />
          ) : path.includes("/support") ? (
            <>
              <Support
                records={records("support")}
                action={action}
                busy={busy}
                userId={state.user.userId}
                member={subscriber}
              />
              <LoadMore
                more={more}
                collection="records"
                kind="support"
                label={shellT("loadOlderSupport")}
              />
            </>
          ) : /^\/trainer\/brain\/(teaching|actions|checks|autonomy)$/.test(
              path,
            ) ? (
            <CoachingStudio key={path} path={path} />
          ) : path === "/trainer/brain/plans" ? (
            <BrainPlans role={state.user.role} />
          ) : path.includes("/brain") ? (
            <BrainView {...props} />
          ) : /^\/trainer\/subscribers\/[^/]+(\/(plan|notes|membership))?$/.test(
              path,
            ) ? (
            <SubscriberDetail
              key={path.split("/")[3]}
              state={state}
              userId={path.split("/")[3]}
              path={path}
            />
          ) : path.includes("/subscribers") ? (
            <Members {...props} />
          ) : path === "/app/twin" ? (
            <MemberCoachingContext userId={state.user.userId} />
          ) : path.startsWith("/app/guided/") ? (
            <GuidedSession workoutId={path.split("/")[3]} />
          ) : path.startsWith("/app/voice-session/") ? (
            <VoiceSessionRunner
              {...(path.split("/")[3] === "planned"
                ? { plannedSessionId: path.split("/")[4] }
                : { workoutId: path.split("/")[3] })}
              tenantId={state.user.tenantId}
              userId={state.user.userId}
            />
          ) : path.includes("/program") ? (
            subscriber ? (
              <MemberProgram
                state={view}
                programLabel={memberNav.programLabel}
              />
            ) : (
              <TrainingPrograms state={state} />
            )
          ) : path.includes("/workouts") ? (
            <Workout {...props} />
          ) : path.includes("/messages") || path.includes("/chat") ? (
            subscriber ? (
              <>
                {/* A coach's reply is the moment to offer notifications. */}
                {records("message").some((m) =>
                  ["trainer", "digital_qualified", "digital_reviewed"].includes(
                    m.data?.author,
                  ),
                ) && (
                  <PushPrompt
                    coachName={state.tenant.name}
                    askedKey={
                      installKeys(state.user.tenantId, state.user.userId)
                        .pushAsked
                    }
                  />
                )}
                <MemberChat state={view} />
              </>
            ) : (
              <CoachingMessages state={state} />
            )
          ) : path.includes("/exceptions") ? (
            <Exceptions {...props} />
          ) : subscriber && path === "/app/membership" ? (
            <MemberMembership
              state={view}
              offers={records("product")}
              onChanged={load}
            />
          ) : path.includes("/finance") ||
            path.includes("/payout") ||
            path.includes("/membership") ||
            path.includes("/products") ? (
            <Finance {...props} />
          ) : path.includes("/integrations") ||
            path.includes("/wearables") ||
            path.includes("/voice") ||
            path.includes("/domains") ? (
            <IntegrationCenter
              path={path}
              role={state.user.role}
              integrations={state.integrations}
            />
          ) : path === "/trainer/team" ? (
            <TeamControls role={state.user.role} />
          ) : path.includes("/settings") ||
            path.includes("/profile") ||
            path.includes("/intake") ? (
            <SettingsView {...props} />
          ) : path === "/trainer/analytics" &&
            ["owner", "finance"].includes(state.user.role) ? (
            <>
              <TrainerAnalytics />
              {state.user.role === "owner" && <RetentionPanel />}
            </>
          ) : path === "/app/timeline" ? (
            <ProgrammeTimeline programLabel={memberNav.programLabel} />
          ) : path === "/app/progress" ? (
            <TrainingProgress state={state} />
          ) : path.includes("/analytics") || path.includes("/progress") ? (
            <Analytics {...props} />
          ) : subscriber ? (
            <MemberToday
              state={view}
              programLabel={memberNav.programLabel}
              nutrition={memberNav.nutrition}
            />
          ) : (
            <Overview {...props} />
          );
  if (subscriber)
    return (
      <TrainerTheme
        className="workspace member-shell"
        theme={state.tenant.theme}
        colorScheme={scheme}
      >
        <AppUpdateToast
          path={path}
          waiting={serviceWorker.waiting}
          release={serviceWorker.release}
          onReload={serviceWorker.reload}
        />
        <MemberLanguage member={`${state.user.tenantId}:${state.user.userId}`} />
        <MemberAppearance
          member={`${state.user.tenantId}:${state.user.userId}`}
          theme={state.tenant.theme}
          choice={scheme}
        />
        <MemberAppManifest tenantId={state.tenant.id} role={state.user.role} />
        <MemberShell
          path={path}
          tenant={state.tenant}
          user={state.user}
          nav={memberNav}
          messages={records("message")}
          workoutTitle={
            path.startsWith("/app/workouts/")
              ? records("workout").find((w) => w.id === path.split("/")[3])
                  ?.data?.program?.title
              : null
          }
          supportEmail={state.platform?.supportEmail}
          refreshing={loading}
          offline={!online}
          toast={
            success ? (
              <Toast key={success} onDone={() => setSuccess("")}>
                {success}
              </Toast>
            ) : null
          }
          onSignOut={() => void signOut()}
          footerNote={
            // Development builds only (the API reports "production" under
            // strict security); never between a chat thread and its composer.
            state.environment === "development" &&
            !path.startsWith("/app/chat") ? (
              <p className="member-dev-note">{shellT("devNote")}</p>
            ) : null
          }
        >
          {notices}
          {page}
        </MemberShell>
      </TrainerTheme>
    );
  return (
    <PlainShell className="workspace platform-ui">
      <MemberLanguage member={`${state.user.tenantId}:${state.user.userId}`} />
      {!path.startsWith("/admin") && (
        <MemberAppManifest tenantId={state.tenant.id} role={state.user.role} />
      )}
      <aside className={"sidebar " + (mobile ? "is-open" : "")}>
        <Link href={subscriber ? "/app" : "/trainer"} className="wordmark">
          {subscriber ? (
            <CoachIdentity
              name={state.tenant.name}
              theme={state.tenant.theme}
              compact
            />
          ) : (
            <PlatformLogo name={platformName} />
          )}
        </Link>
        <button
          className="mobile-close icon-button"
          onClick={() => setMobile(false)}
          aria-label="Close navigation"
        >
          <X />
        </button>
        <div className="workspace-label">
          <span className="avatar">{state.tenant.name.slice(0, 1)}</span>
          <div>
            <strong>{state.tenant.name}</strong>
            <span>
              {subscriber ? "Your coaching space" : "Your coaching business"}
            </span>
          </div>
        </div>
        <WorkspaceSwitcher
          current={state.user.tenantId}
          userId={state.user.userId}
        />
        <nav aria-label="Main navigation">
          {!subscriber && (
            <>
              {setupOpen && (
                <Link
                  href={SETUP_HREF}
                  className="nav-setup"
                >
                  <CheckCircle size={18} />
                  Finish setup
                </Link>
              )}
              {trainerSections(state.user.role).map(
                ({ key, label, href, icon: Icon }) => {
                  const current =
                    state.user.role === "finance"
                      ? path === href
                      : key === activeSection && key !== "more";
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={current ? "active" : ""}
                      aria-current={current ? "page" : undefined}
                    >
                      <Icon size={18} />
                      {label}
                      {key === "inbox" &&
                        state.user.role !== "finance" &&
                        inboxCount > 0 && (
                          <span className="nav-count">{inboxCount}</span>
                        )}
                    </Link>
                  );
                },
              )}
              {state.user.role !== "finance" &&
                CLIENT_TOOLS.map(({ label, href }) => (
                  <Link
                    key={href}
                    href={href}
                    className={
                      "nav-sub " +
                      (path === href || path.startsWith(href + "/")
                        ? "active"
                        : "")
                    }
                  >
                    {label}
                  </Link>
                ))}
              {moreGroups(state.user.role).map((group) => (
                <div key={group.title} className="nav-group">
                  <span className="nav-group-title">{group.title}</span>
                  {group.links.map(({ label, href }) => (
                    <Link
                      key={href}
                      href={href}
                      className={
                        "nav-sub " +
                        (path === href.split("#")[0] && !href.includes("#")
                          ? "active"
                          : "")
                      }
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              ))}
            </>
          )}
          {state.user.platformRole !== "none" && (
            <Link href="/admin" className={path === "/admin" ? "active" : ""}>
              <Shield size={18} />
              Platform admin
            </Link>
          )}
          {state.user.platformRole === "admin" && (
            <Link
              href="/admin/settings"
              className={`platform-settings-link ${path.startsWith("/admin/settings") || path.startsWith("/admin/integrations") ? "active" : ""}`}
            >
              <Settings size={16} />
              Settings & API connections
            </Link>
          )}
          {state.user.platformRole === "admin" && (
            <Link
              href="/admin/model-profiles"
              className={`platform-settings-link ${path === "/admin/model-profiles" ? "active" : ""}`}
            >
              <Settings size={16} />
              AI model profiles
            </Link>
          )}
          {state.user.platformRole === "admin" && (
            <Link
              href="/admin/marketing-assistant"
              className={`platform-settings-link ${path === "/admin/marketing-assistant" ? "active" : ""}`}
            >
              <Settings size={16} />
              Home page assistant
            </Link>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="small-label">BUILT AROUND YOU</div>
          <p>
            Your methods.
            <br />
            Your brand. Your business.
          </p>
          <button className="text-button" onClick={() => void signOut()}>
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu icon-button"
              onClick={() => setMobile(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </button>
            <span className="muted">Workspace</span>
            <ChevronRight size={14} />
            <strong>{topTitle}</strong>
          </div>
          <div className="topbar-right">
            {subscriber && (
              <CoachSwitcher
                current={state.user.tenantId}
                userId={state.user.userId}
                variant="compact"
              />
            )}
            <span className="connection-dot" />
            <span>
              {state.tenant.published ? "Published" : "Private workspace"}
            </span>
            <span className="avatar small">{firstName[0]}</span>
          </div>
        </header>
        <div className="content">
          {notices}
          {page}
        </div>
        {trainerNav && (
          <TrainerTabBar
            role={state.user.role}
            path={path}
            inboxCount={inboxCount}
          />
        )}
        <footer className="workspace-footer">
          <span>
            {subscriber ? state.tenant.name : platformName} ·{" "}
            {!subscriber && usesBrandIdentity(platformName)
              ? BRAND_COPY.line
              : "Your coaching, amplified."}
          </span>
          {state.platform?.supportEmail && (
            <a href={`mailto:${state.platform.supportEmail}`}>
              Contact support
            </a>
          )}
          <Link href="/privacy">Privacy & your data</Link>
        </footer>
      </main>
    </PlainShell>
  );
}
