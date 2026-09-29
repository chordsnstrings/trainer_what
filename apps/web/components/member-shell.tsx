"use client";
/**
 * The member app's frame, phone first (docs/features/phone-first.md):
 * - phones and tablets: a compact top bar (the coach, or the page title and
 *   an in-app back button) and a fixed bottom tab bar with five destinations;
 * - from 1024 px: a full-height side navigation with one current item and
 *   the member's own name, and the same top bar for titles and back;
 * - installed (standalone) use: safe-area insets, contained overscroll and
 *   links to other sites opened outside the app.
 * The navigation rules live in member-nav.ts; the styles in phone-first.css.
 */
import Link from "next/link";
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import {
  Bell,
  CalendarCheck,
  CalendarRange,
  Camera,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CloudOff,
  CreditCard,
  Dumbbell,
  Ellipsis,
  House,
  Images,
  LifeBuoy,
  LogOut,
  MessageCircle,
  Settings,
  ShieldCheck,
  TrendingUp,
  UserRound,
  Utensils,
  Watch,
} from "lucide-react";
import { CoachIdentity } from "./trainer-design";
import { CoachSwitcher } from "./joining";
import { useKeyboardInset } from "./phone-ui";
import { playArrival } from "./motion";
import { setAppBadge } from "./pwa";
import { InstallAppRow } from "./pwa-ui";
import { useLocale, useT } from "../lib/i18n/react";
import {
  activeDestination,
  activeTab,
  chatSeenKey,
  memberBackTarget,
  memberPageTitle,
  memberTabs,
  moreGroups,
  sideNavigation,
  unreadCoachMessages,
  type MemberIcon,
  type MemberNavOptions,
} from "./member-nav";

type IconType = ComponentType<{
  size?: number;
  "aria-hidden"?: boolean | "true";
  className?: string;
}>;
/** One distinct icon per destination. */
export const MEMBER_ICONS: Record<MemberIcon, IconType> = {
  today: House,
  program: Dumbbell,
  timeline: CalendarRange,
  chat: MessageCircle,
  nutrition: Utensils,
  meal: Camera,
  progress: TrendingUp,
  bookings: CalendarCheck,
  context: UserRound,
  intake: ClipboardList,
  connections: Watch,
  galleries: Images,
  notifications: Bell,
  support: LifeBuoy,
  membership: CreditCard,
  settings: Settings,
  privacy: ShieldCheck,
  more: Ellipsis,
};

/**
 * What the shell showed on the page before this one. The shell remounts with
 * every page (Next renders the catch-all page per path), so its
 * microanimations compare with this and play only for what changed: the
 * tab you moved to, a higher unread count, a back button that was not there.
 * Browser memory only (written in an effect).
 */
const shownBefore = { tab: "", destination: "", unread: 0, back: false };
/** What changed since the previous page, for the shell's microanimations. */
export function shellChanges(
  before: typeof shownBefore,
  now: { tab: string; destination: string | null; unread: number; back: boolean },
) {
  return {
    tab: now.tab !== before.tab,
    destination: (now.destination ?? "") !== before.destination,
    unread: now.unread > before.unread,
    back: now.back && !before.back,
  };
}

function initialOf(name: string) {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/** Device-local count of coach messages since the member last opened chat. */
function useUnreadChat(
  path: string,
  messages: Array<{ created_at: string; data?: { author?: string } }>,
  tenantId: string,
  userId: string,
) {
  const key = chatSeenKey(tenantId, userId);
  const [seen, setSeen] = useState<string | null>(null);
  const inChat = path === "/app/chat";
  useEffect(() => {
    const read = () => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    };
    const mark = () => {
      const now = new Date().toISOString();
      try {
        localStorage.setItem(key, now);
      } catch {}
      setSeen(now);
    };
    if (!inChat) {
      setSeen(read());
      return;
    }
    // Opening chat reads everything; leaving it keeps later replies unread.
    mark();
    return mark;
  }, [key, inChat]);
  return inChat ? 0 : unreadCoachMessages(messages, seen);
}

/**
 * In the installed app there is no address bar: a link to another site
 * opens in the browser instead of replacing the app.
 */
function useExternalLinksOutsideApp() {
  useEffect(() => {
    const standalone = () =>
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as { standalone?: boolean }).standalone === true;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (!standalone()) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target) return;
      let url: URL;
      try {
        url = new URL(anchor.href, location.href);
      } catch {
        return;
      }
      if (!/^https?:$/.test(url.protocol) || url.origin === location.origin)
        return;
      event.preventDefault();
      window.open(url.href, "_blank", "noopener,noreferrer");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
}

export type MemberShellProps = {
  path: string;
  tenant: { id: string; name: string; theme: unknown };
  user: { name: string; tenantId: string; userId: string };
  nav: MemberNavOptions;
  /** Recent chat messages (bootstrap first page) for the unread badge. */
  messages: Array<{ created_at: string; data?: { author?: string } }>;
  /** The open workout's name, for its top bar title. */
  workoutTitle?: string | null;
  supportEmail?: string | null;
  /** A quiet line at the end of the page (the development notice). */
  footerNote?: ReactNode;
  refreshing?: boolean;
  /** No connection: a small indicator in the top bar. */
  offline?: boolean;
  onSignOut: () => void;
  children: ReactNode;
};

export function MemberShell({
  path,
  tenant,
  user,
  nav,
  messages,
  workoutTitle,
  supportEmail,
  footerNote,
  refreshing = false,
  offline = false,
  onSignOut,
  children,
}: MemberShellProps) {
  useKeyboardInset();
  useExternalLinksOutsideApp();
  const locale = useLocale(),
    t = useT("shell"),
    common = useT("common"),
    navText = useT("nav");
  nav = { ...nav, locale };
  // A new page settles in (a short fade and rise, block by block); the frame
  // around it stays still. Skipped with reduced motion (motion.ts).
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    playArrival(main.current);
  }, [path]);
  const unread = useUnreadChat(path, messages, user.tenantId, user.userId);
  // The installed app's icon shows unread coach messages, where supported.
  useEffect(() => setAppBadge(unread), [unread]);
  const tabs = memberTabs(nav),
    tab = activeTab(path, nav),
    current = activeDestination(path),
    back = memberBackTarget(path, nav),
    title = memberPageTitle(path, { ...nav, workoutTitle });
  // Snapshot of the previous page's shell, taken when this page mounts.
  const [before] = useState(() => ({ ...shownBefore }));
  const changed = shellChanges(before, {
    tab,
    destination: current,
    unread,
    back: !!back,
  });
  useEffect(() => {
    shownBefore.tab = tab;
    shownBefore.destination = current ?? "";
    shownBefore.unread = unread;
    shownBefore.back = !!back;
  });
  const unreadLabel = unread > 0 ? t("unread", { count: unread }) : "";
  // A higher count pops the badge (keyed by the count, so it pops again).
  const badge = (id: string) =>
    id === "chat" && unread > 0 ? (
      <span
        className={"member-badge" + (changed.unread ? " is-new" : "")}
        aria-hidden="true"
        key={unread}
      >
        {unread > 9 ? "9+" : unread}
      </span>
    ) : null;
  return (
    <>
      <a className="skip-link" href="#member-main">
        {t("skipToContent")}
      </a>
      <aside className="member-sidenav">
        <Link href="/app" className="member-sidenav-coach">
          <CoachIdentity name={tenant.name} theme={tenant.theme} compact />
        </Link>
        <nav aria-label={t("mainNavigation")}>
          {sideNavigation(nav).map((group, index) => (
            <div className="member-sidenav-group" key={group.title ?? index}>
              {group.title && (
                <p className="member-sidenav-heading">{group.title}</p>
              )}
              <ul>
                {group.items.map((item) => {
                  const Icon = MEMBER_ICONS[item.icon];
                  const active = item.id === current;
                  return (
                    <li key={item.id}>
                      <Link
                        href={item.href}
                        className={
                          active
                            ? "active" +
                              (changed.destination ? " is-arriving" : "")
                            : undefined
                        }
                        aria-current={active ? "page" : undefined}
                      >
                        <Icon size={18} aria-hidden="true" />
                        <span>{item.label}</span>
                        {badge(item.id)}
                        {item.id === "chat" && unreadLabel && (
                          <span className="sr-only">{unreadLabel}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="member-sidenav-me">
          <span className="avatar" aria-hidden="true">
            {initialOf(user.name)}
          </span>
          <span>
            <strong>
              <bdi>{user.name}</bdi>
            </strong>
            <Link href="/app/profile">{navText("settings")}</Link>
          </span>
        </div>
        <button type="button" className="member-signout" onClick={onSignOut}>
          <LogOut size={16} aria-hidden="true" />
          {common("signOut")}
        </button>
      </aside>
      <div className="member-frame">
        <header
          className="member-topbar"
          data-refreshing={refreshing || undefined}
        >
          {back && (
            <Link
              href={back}
              className={
                "member-back" + (changed.back ? " is-arriving" : "")
              }
              aria-label={common("back")}
            >
              <ChevronLeft size={24} aria-hidden="true" />
            </Link>
          )}
          {title ? (
            // Keyed by the title: each new page's title slides in.
            <p className="member-topbar-title" key={title}>
              {title}
            </p>
          ) : (
            <Link href="/app" className="member-topbar-coach">
              <CoachIdentity name={tenant.name} theme={tenant.theme} compact />
            </Link>
          )}
          {offline && (
            <span className="member-offline" role="status">
              <CloudOff size={16} aria-hidden="true" />
              {t("offline")}
              <span className="sr-only">{t("offlineDetail")}</span>
            </span>
          )}
          <Link
            href="/app/profile"
            className="member-topbar-me"
            aria-label={t("profileSignedInAs", { name: user.name })}
          >
            <span className="avatar small" aria-hidden="true">
              {initialOf(user.name)}
            </span>
          </Link>
        </header>
        <main
          id="member-main"
          className="member-content"
          tabIndex={-1}
          ref={main}
        >
          {children}
          {footerNote}
        </main>
        <footer className="member-footer">
          <bdi>{tenant.name}</bdi>
          {supportEmail && (
            <a href={`mailto:${supportEmail}`}>{common("contactSupport")}</a>
          )}
          <Link href="/privacy">{common("privacyPolicy")}</Link>
        </footer>
      </div>
      <nav className="member-tabbar" aria-label={t("mainNavigation")}>
        {tabs.map((item) => {
          const Icon = MEMBER_ICONS[item.icon];
          const active = item.id === tab;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={
                "member-tab" +
                (active && changed.tab ? " is-arriving" : "")
              }
              aria-current={active ? "page" : undefined}
            >
              <span className="member-tab-icon">
                <Icon size={22} aria-hidden="true" />
                {badge(item.id)}
              </span>
              <span className="member-tab-label">{item.label}</span>
              {item.id === "chat" && unreadLabel && (
                <span className="sr-only">{unreadLabel}</span>
              )}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

/** /app/more: one tap to everything that is not a tab. */
export function MoreScreen({
  nav,
  coachName,
  tenantId,
  userId,
  onSignOut,
}: {
  nav: MemberNavOptions;
  /** Names the coach in "Install the app". */
  coachName?: string;
  tenantId: string;
  userId: string;
  onSignOut: () => void;
}) {
  const locale = useLocale(),
    navText = useT("nav"),
    common = useT("common");
  return (
    <div className="more-screen">
      <h1 className="more-title">{navText("more")}</h1>
      {moreGroups({ ...nav, locale }).map((group) => (
        <section className="more-group" key={group.title}>
          <h2>{group.title}</h2>
          <ul className="more-list">
            {group.items.map((item) => {
              const Icon = MEMBER_ICONS[item.icon];
              return (
                <li key={item.id}>
                  <Link href={item.href} className="more-link">
                    <span className="more-icon">
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="more-text">
                      <strong>{item.label}</strong>
                      {item.detail && <small>{item.detail}</small>}
                    </span>
                    <ChevronRight
                      className="more-chevron"
                      size={18}
                      aria-hidden="true"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {/* Hidden in the installed app (docs/features/pwa.md). */}
      {coachName && <InstallAppRow coachName={coachName} />}
      {/* Shown only to someone coached by more than one coach. */}
      <CoachSwitcher current={tenantId} userId={userId} />
      <section className="more-group">
        <ul className="more-list">
          <li>
            <button type="button" className="more-link" onClick={onSignOut}>
              <span className="more-icon">
                <LogOut size={20} aria-hidden="true" />
              </span>
              <span className="more-text">
                <strong>{common("signOut")}</strong>
              </span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  );
}
