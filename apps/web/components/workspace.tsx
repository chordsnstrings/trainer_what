"use client";
import dynamic from "next/dynamic";
import { isTrainerPreview, subscriberPath, previewDestinationAllowed } from "../lib/trainer-preview-routing";
import { TrainerPreviewBar, PreviewUnavailable, endTrainerPreview, previewChanged } from "./trainer-preview";
import { Inbox, Chats, ChatThread } from "./workspace-inbox";
import {
  TrainerMore,
  TrainerTabBar,
  trainerTitle,
  useInboxCount,
} from "./workspace-nav";
import { TeamControls } from "./team-controls";
import { CoachSwitcher } from "./joining";
import { AdminComplimentaryAccess } from "./complimentary-access";
import { Affiliates } from "./affiliates";
const InfrastructureActions = dynamic(() => import("./infrastructure-actions").then(m => m.InfrastructureActions), { loading: () => <p role="status">Loading…</p> });
import { NotificationInbox } from "./notifications";
import {
  IntegrationCenter,
  IntegrationOperations,
} from "./integration-center";
import { VoiceSessionRunner } from "./voice-session";
const CoachingStudio = dynamic(() => import("./coaching-studio").then(m => m.CoachingStudio), { loading: () => <p role="status">Loading…</p> });
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
  SuperadminAuthenticatorBanner,
  SUPERADMIN_HOME,
  coachSetupOpen,
  signInLanding,
} from "./superadmin-access";
import {
  isSetupPath,
  legacySetupRedirect,
} from "./setup-wizard-model";
const NutritionCoach = dynamic(() => import("./nutrition").then(m => m.NutritionCoach));
const NutritionSubscriber = dynamic(() => import("./nutrition").then(m => m.NutritionSubscriber));
const InfrastructureObserver = dynamic(() => import("./infrastructure-observer").then(m => m.InfrastructureObserver), { loading: () => <p role="status">Loading…</p> });
const HostOperations = dynamic(() => import("./backend-host-view").then(m => m.HostOperations), { loading: () => <p role="status">Loading…</p> });
import { Public } from "./public-pages";
import { PlatformLogo } from "./brand-logo";
const TrainerGrowth = dynamic(() => import("./trainer-growth").then(m => m.TrainerGrowth), { loading: () => <p role="status">Loading…</p> });
import { Bookings } from "./bookings";
import { Support } from "./support";
import { AccountSecurity } from "./account-security";
import { AccountExtras } from "./account-completion";
import { AccountSettings } from "./account-settings";
import { OperatorRecovery } from "./operator-recovery";
import { GalleryStudio, WebsiteStudio, WebsiteInquiries, CoachWebsite } from "./coach-site";
import { MemberAppManifest } from "./member-app-install";
import { MemberShell, MoreScreen } from "./member-shell";
import { Toast } from "./phone-ui";
import { MemberLanguage } from "./document-direction";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import { MemberAppearance, useColorScheme } from "./appearance";
import { type ColorSchemeChoice } from "../color-scheme";
import { DirectoryListingSettings } from "./directory-listing";
const PlatformSettings = dynamic(() => import("./platform-settings").then(m => m.PlatformSettings), { loading: () => <p role="status">Loading…</p> });
const WorkoutMusicAdmin = dynamic(() => import("./workout-music-admin").then(m => m.WorkoutMusicAdmin), { loading: () => <p role="status">Loading…</p> });
const ModelProfiles = dynamic(() => import("./model-profiles").then(m => m.ModelProfiles), { loading: () => <p role="status">Loading…</p> });
const MarketingAssistantAdmin = dynamic(() => import("./marketing-assistant-admin").then(m => m.MarketingAssistantAdmin), { loading: () => <p role="status">Loading…</p> });
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
const WorkspaceGovernance = dynamic(() => import("./backend-governance-views").then(m => m.WorkspaceGovernance), { loading: () => <p role="status">Loading…</p> });
const BusinessMetrics = dynamic(() => import("./backend-governance-views").then(m => m.BusinessMetrics), { loading: () => <p role="status">Loading…</p> });
const PlatformFinance = dynamic(() => import("./backend-governance-views").then(m => m.PlatformFinance), { loading: () => <p role="status">Loading…</p> });
const PlatformAlerts = dynamic(() => import("./backend-governance-views").then(m => m.PlatformAlerts), { loading: () => <p role="status">Loading…</p> });
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
import { usePathname } from "next/navigation";
import { useRouter } from "./preview-navigation";
import Link from "./preview-navigation";
import { WorkspaceNavigation } from "./workspace-navigation";
import { WorkspaceScope, WorkspaceContinuity, clearWorkspaceViews, flushWorkspaceEdits } from "./workspace-continuity";
import { WorkspaceFeedback, confirmWorkspace } from "./workspace-feedback";
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
          if (!(await flushWorkspaceEdits())) return;
          setBusy(true);
          setError("");
          try {
            // Replay before the switch replaces this session. Unsynced entries
            // stay scoped to this workspace and member; only caches are cleared.
            const left = await leaveSession(localStorage, current, userId, {
              online: navigator.onLine,
              post: (p, b, h) => api(p, "POST", b, h),
              confirm: (n) =>
                confirmWorkspace({ title: "Switch workspace?", confirm: "Switch workspace", detail:
                  `${n} workout or meal ${n === 1 ? "entry has" : "entries have"} not synced. ${n === 1 ? "It stays" : "They stay"} on this device and will sync when you return to this workspace. Switch anyway?`,
                }),
              leave: () =>
                api("/auth/workspace", "POST", { tenantId: next.tenantId }),
              afterLeave: clearWorkspaceSession,
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
/** Tab-local confirmed state. Members reuse their page; backend routes reuse
 * only chrome while bootstrap revalidates the session. Never stored on disk.
 * Authentication, workspace changes, suspension and 401 clear these caches. */
let memberStateCache: State | null = null;
// Only chrome is reused until the server confirms the new route/session.
let backendStateCache: State | null = null;
let sessionEpoch = 0;
async function clearWorkspaceSession() {
  memberStateCache = backendStateCache = null; sessionEpoch++;
  await clearPersonalCaches();
}
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
  const actualPath = usePathname(), preview = isTrainerPreview(actualPath), path = subscriberPath(actualPath),
    router = useRouter();
  // Subscriber surfaces follow the member's Light, Dark or System choice
  // (components/appearance.tsx); the backend uses an explicit white palette.
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
        : /^\/(trainer|setup|admin)(\/|$)/.test(path) ? backendStateCache : null,
    ),
    [error, setError] = useState(""),
    [bootstrapError, setBootstrapError] = useState(""),
    [success, setSuccess] = useState(""),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [mobile, setMobile] = useState(false),
    [compactNav, setCompactNav] = useState(false),
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
  const serviceWorker = useAppServiceWorker(!preview && path.startsWith("/app"));
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
    const epoch = sessionEpoch;
    try {
      const next = await api("/bootstrap");
      if (epoch !== sessionEpoch) return;
      backendStateCache = next.user.role !== "subscriber" ? next : null;
      memberStateCache = next.user.role === "subscriber" ? next : null;
      generation.current++;
      setExtra({});
      setState(next);
      if (next.trainerPreview) previewChanged();
      setSuspended(false);
      setBootstrapError("");
      setOfflineScreen(false);
      if (next.user.role === "subscriber" && !preview)
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
      if (epoch !== sessionEpoch) return;
      if ((e as any).code === "WORKSPACE_SUSPENDED") {
        // A platform suspension: show its status instead of the workspace.
        memberStateCache = backendStateCache = null;
        clearWorkspaceViews();
        setState(null);
        setBootstrapError("");
        setSuspended(true);
        return;
      }
      if ((e as any).status === 401) {
        // Unsynced set logs and diary entries stay scoped to their member and
        // replay after that person signs in again; caches are removed.
        clearLocalData(localStorage, { keepQueues: true });
        void clearWorkspaceSession();
        memberStateCache = backendStateCache = null;
        clearWorkspaceViews();
        setState(null);
        setBootstrapError("");
        if (!publicPath) router.replace("/login");
        return;
      }
      if (preview) { setState(null); setBootstrapError((e as Error).message || "Your test session could not be opened."); return; }
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
      if (epoch === sessionEpoch) setLoading(false);
    }
  }, [publicPath, router, path, preview]);
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
  useEffect(() => {
    const cleared = () => { memberStateCache = backendStateCache = null; sessionEpoch++; };
    window.addEventListener("workspace-session-cleared", cleared);
    return () => window.removeEventListener("workspace-session-cleared", cleared);
  }, []);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== "workspace-session-version") return;
      memberStateCache = backendStateCache = null; sessionEpoch++;
      clearWorkspaceViews(); setState(null);
      if (!publicPath) void load();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [publicPath, load]);
  useEffect(() => {
    if (publicPath) { memberStateCache = backendStateCache = null; clearWorkspaceViews(); }
  }, [publicPath]);
  useEffect(() => {
    const media = matchMedia("(max-width: 900px)");
    const update = () => setCompactNav(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobile) return;
    const previous = document.activeElement as HTMLElement | null;
    const nav = document.querySelector<HTMLElement>(".workspace .sidebar");
    const controls = () => Array.from(nav?.querySelectorAll<HTMLElement>("a[href],button,select,summary") ?? []).filter(el => el.getClientRects().length);
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMobile(false); return; }
      if (event.key !== "Tab") return;
      const elements = controls(), first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [mobile]);
  // Enrolling an authenticator clears the Superadmin setup banner.
  useEffect(() => {
    const refresh = () => void load();
    window.addEventListener("account-security-updated", refresh);
    return () =>
      window.removeEventListener("account-security-updated", refresh);
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
          await clearWorkspaceSession();
          await load();
          const s = await api("/bootstrap").catch(async (e) => {
            if ((e as any).code !== "WORKSPACE_SUSPENDED") throw e;
            // Signed in to a suspended workspace: open its status screen.
            const status = await api("/workspace/status");
            router.push(status.role === "subscriber" ? "/app" : "/trainer");
            return null;
          });
          if (!s) return;
          router.push(signInLanding(s, path));
        }}
      />
    );
  if (preview && !loading && !state) return <PreviewUnavailable message={bootstrapError || "Your test session ended. Open Try my AI again from My Brain."} />;
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
  if (!state)
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
      : isSetupPath(path) ? "Setup" : trainerTitle(path, state.user.role);
  // The setup wizard (/setup) stays one tap away until the page is live;
  // a platform administration workspace has no page to set up.
  const setupOpen = coachSetupOpen(state);
  // The phone's bottom bar shows in the trainer workspace, not /admin.
  const trainerNav = !subscriber && path.startsWith("/trainer");
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
  // in the platform's white workspace.
  const platformName = state.platform?.name || DEFAULT_PLATFORM_NAME;
  const signOut = async () => {
    if (preview) { await endTrainerPreview(); return; }
    if (!(await flushWorkspaceEdits())) return;
    const { tenantId, userId } = state.user;
    const left = await leaveSession(localStorage, tenantId, userId, {
      online: navigator.onLine,
      post: (p, b, h) => api(p, "POST", b, h),
      confirm: (unsynced) =>
        confirmWorkspace({ title: "Sign out?", detail: shellT("signOutUnsynced", { count: unsynced }), confirm: "Sign out" }),
      leave: () => api("/auth/logout", "POST", {}),
      afterLeave: clearWorkspaceSession,
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
          <SuperadminAuthenticatorBanner state={state} path={path} />
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
          ) : path === "/admin/music" ? (
            <WorkoutMusicAdmin />
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
                authenticatorRequired={state.authenticatorRequired !== false}
              />
              {path === "/admin/support" &&
                ["admin", "support"].includes(state.user.platformRole) && (
                  <OperatorRecovery
                    authenticatorRequired={
                      state.authenticatorRequired !== false
                    }
                  />
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
            state.platformWorkspace ? (
              <div className="notice">
                The platform administration workspace has no coaching page to
                set up. <Link href={SUPERADMIN_HOME}>Open Super admin</Link>
              </div>
            ) : state.user.role === "owner" ? (
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
            path === "/trainer/website/settings" ||
            path.startsWith("/trainer/website/preview") ? (
            state.user.role === "owner" ? (
              path === "/trainer/galleries" ? (
                <GalleryStudio />
              ) : path === "/trainer/website" ? (
                <WebsiteStudio tenant={state.tenant} />
              ) : path === "/trainer/website/settings" ? (
                <div className="site-workspace">
                  <div className="page-heading">
                    <h1>Website settings</h1>
                    <Link className="button secondary" href="/trainer/website">Open website editor</Link>
                  </div>
                  <DirectoryListingSettings />
                  <WebsiteInquiries />
                </div>
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
            <VoiceSessionRunner workoutId={path.split("/")[3]} tenantId={state.user.tenantId} userId={state.user.userId} />
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
                {!preview && records("message").some((m) =>
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
            <TeamControls
              role={state.user.role}
              authenticatorRequired={state.authenticatorRequired !== false}
            />
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
      <WorkspaceScope.Provider key={`${state.user.tenantId}:${state.user.userId}:${state.user.role}`} value={`${state.user.tenantId}:${state.user.userId}:${state.user.role}`}>
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
        {!preview && <MemberAppManifest tenantId={state.tenant.id} role={state.user.role} />}
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
          {preview && <TrainerPreviewBar />}
          {notices}
          {preview && !previewDestinationAllowed(path) ? <section className="card"><h1>Your private subscriber experience</h1><p>Try chat, workouts, nutrition and your coaching profile using the navigation below.</p><Link className="button secondary" href="/app">Go to Today</Link></section> : page}
        </MemberShell>
      </TrainerTheme>
      </WorkspaceScope.Provider>
    );
  return (
    <WorkspaceScope.Provider key={`${state.user.tenantId}:${state.user.userId}:${state.user.role}:${state.user.platformRole}`} value={`${state.user.tenantId}:${state.user.userId}:${state.user.role}:${state.user.platformRole}`}>
    <PlainShell className={`workspace platform-ui${isSetupPath(path) ? " is-setup" : ""}${path.startsWith("/admin") || state.platformWorkspace ? " is-admin" : ""}`}>
      <WorkspaceContinuity scope={`${state.user.tenantId}:${state.user.userId}`} />
      <WorkspaceFeedback />
      <a href="#workspace-content" className="workspace-skip">Skip to content</a>
      <MemberLanguage member={`${state.user.tenantId}:${state.user.userId}`} />
      {!path.startsWith("/admin") && <MemberAppManifest tenantId={state.tenant.id} role={state.user.role} />}
      <aside className={"sidebar " + (mobile ? "is-open" : "")} inert={compactNav && !mobile} aria-label="Workspace navigation">
        <Link href={path.startsWith("/admin") || state.platformWorkspace ? "/admin" : "/trainer"} className="wordmark">
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
              {path.startsWith("/admin") || state.platformWorkspace ? "Platform administration" : "Coaching workspace"}
            </span>
          </div>
        </div>
        <WorkspaceSwitcher
          current={state.user.tenantId}
          userId={state.user.userId}
        />
        <WorkspaceNavigation state={state} path={path} count={inboxCount} setupOpen={setupOpen} />
        <div className="sidebar-bottom">
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
            <span className="muted">{path.startsWith("/admin") || state.platformWorkspace ? "Platform" : "Workspace"}</span>
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
              {loading ? "Refreshing…" : path.startsWith("/admin") || state.platformWorkspace ? "Administration" : state.tenant.published ? "Website live" : "Private workspace"}
            </span>
            <span className="avatar small">{firstName[0]}</span>
          </div>
        </header>
        <div className="content" id="workspace-content" tabIndex={-1}>
          {notices}
          {loading ? <div className="workspace-loading" role="status"><span className="loading-indicator" aria-hidden="true" />Loading…</div> : page}
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
    </WorkspaceScope.Provider>
  );
}
