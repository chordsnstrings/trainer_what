"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SETUP_PATH } from "./setup-wizard-model";
import {
  Inbox as InboxIcon,
  Users,
  Brain,
  MoreHorizontal,
  Wallet,
  Activity,
  Palette,
  Camera,
  Link2,
  Globe,
  Settings,
  MessageCircle,
  Shield,
  Layers,
  LayoutDashboard,
  CheckCircle,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { api } from "./workspace-ui";
import { setAppBadge } from "./pwa";

/**
 * The trainer workspace's navigation (docs/features/trainer-workspace.md):
 * four sections (Inbox, Clients, My Brain, More), a bottom bar on the phone,
 * and More grouped into Business, My page and Account. Every older address
 * still opens; each belongs to one section for highlighting.
 */
export type SectionKey = "inbox" | "clients" | "brain" | "more";
export type Section = {
  key: SectionKey;
  label: string;
  href: string;
  icon: LucideIcon;
};
export type MoreLink = {
  label: string;
  href: string;
  icon: LucideIcon;
  detail: string;
};
export type MoreGroup = { title: string; links: MoreLink[] };

/** Fired on window when an inbox card is handled. */
export const INBOX_CHANGED = "trainer-inbox-changed";

/** Where the setup wizard lives: one address for every setup link. */
export const SETUP_HREF = SETUP_PATH;

const SECTIONS: Section[] = [
  { key: "inbox", label: "Inbox", href: "/trainer", icon: InboxIcon },
  { key: "clients", label: "Clients", href: "/trainer/subscribers", icon: Users },
  { key: "brain", label: "My Brain", href: "/trainer/brain", icon: Brain },
  { key: "more", label: "More", href: "/trainer/more", icon: MoreHorizontal },
];
const FINANCE_SECTIONS: Section[] = [
  { key: "inbox", label: "Summary", href: "/trainer", icon: LayoutDashboard },
  { key: "more", label: "Earnings", href: "/trainer/finance", icon: Wallet },
  { key: "clients", label: "Account", href: "/trainer/settings", icon: Settings },
];

export function trainerSections(role: string): Section[] {
  return role === "finance" ? FINANCE_SECTIONS : SECTIONS;
}

/** Links only the workspace owner manages. */
const OWNER_ONLY = new Set([
  "/trainer/finance",
  "/trainer/growth",
  "/trainer/design",
  "/trainer/galleries",
  "/trainer/website",
  "/trainer/domains",
  "/trainer/team",
  "/trainer/affiliates",
]);

const FINANCE_LINKS = new Set([
  "/trainer/finance",
  "/trainer/analytics",
  "/trainer/settings",
  "/trainer/notifications",
  "/trainer/settings#privacy",
]);

export function moreGroups(role: string): MoreGroup[] {
  const groups: MoreGroup[] = [
    {
      title: "Business",
      links: [
        {
          label: "Earnings and plans",
          href: "/trainer/finance",
          icon: Wallet,
          detail: "Your balance, payouts and the plans clients buy",
        },
        {
          label: "Business summary",
          href: "/trainer/analytics",
          icon: Activity,
          detail: "Clients, renewals and what is working",
        },
        {
          label: "Bookings",
          href: "/trainer/bookings",
          icon: Activity,
          detail: "Sessions, times and attendance",
        },
        {
          label: "Support requests",
          href: "/trainer/support",
          icon: MessageCircle,
          detail: "Questions clients sent to support",
        },
        {
          label: "Grow",
          href: "/trainer/growth",
          icon: Users,
          detail: "Followers, sharing your link and more ways to grow",
        },
        {
          label: "Affiliates",
          href: "/trainer/affiliates",
          icon: Wallet,
          detail: "Referral agreements and earnings",
        },
      ],
    },
    {
      title: "My page",
      links: [
        {
          label: "Design",
          href: "/trainer/design",
          icon: Palette,
          detail: "Colours, logo and how your page looks",
        },
        {
          label: "Website",
          href: "/trainer/website",
          icon: Globe,
          detail: "The words and sections on your page",
        },
        {
          label: "Photos",
          href: "/trainer/galleries",
          icon: Camera,
          detail: "Galleries for your page and clients",
        },
        {
          label: "Web address",
          href: "/trainer/domains",
          icon: Link2,
          detail: "Your page’s address, or your own domain",
        },
      ],
    },
    {
      title: "Account",
      links: [
        {
          label: "Security and settings",
          href: "/trainer/settings",
          icon: Shield,
          detail: "Sign-in, two-step check and your details",
        },
        {
          label: "Notifications",
          href: "/trainer/notifications",
          icon: MessageCircle,
          detail: "What we tell you about, and where",
        },
        {
          label: "Privacy and your data",
          href: "/trainer/settings#privacy",
          icon: Shield,
          detail: "Download or delete your data",
        },
        {
          label: "Team",
          href: "/trainer/team",
          icon: Users,
          detail: "Coaches and finance helpers in your workspace",
        },
        {
          label: "Connections",
          href: "/trainer/integrations",
          icon: Link2,
          detail: "Health apps and your coaching voice",
        },
      ],
    },
  ];
  if (role === "owner") return groups;
  // Finance helpers see money and their own account; coaches everything
  // but the owner's business, page and team settings.
  const keep = (href: string) =>
    role === "finance"
      ? FINANCE_LINKS.has(href)
      : !OWNER_ONLY.has(href);
  return groups
    .map((g) => ({ ...g, links: g.links.filter((l) => keep(l.href)) }))
    .filter((g) => g.links.length);
}

/** Client tools reached from the Clients section. */
export const CLIENT_TOOLS: MoreLink[] = [
  {
    label: "Programmes",
    href: "/trainer/programs",
    icon: Layers,
    detail: "Training programmes you assign",
  },
  {
    label: "Nutrition",
    href: "/trainer/nutrition",
    icon: Activity,
    detail: "Meal plans and check-ins",
  },
];

/** The section an address belongs to, for highlighting the nav. */
export function sectionFor(path: string): SectionKey {
  const under = (p: string) => path === p || path.startsWith(p + "/");
  if (
    path === "/trainer" ||
    under("/trainer/messages") ||
    under("/trainer/exceptions") ||
    under("/trainer/inbox")
  )
    return "inbox";
  if (
    under("/trainer/subscribers") ||
    under("/trainer/clients") ||
    under("/trainer/programs") ||
    under("/trainer/nutrition") ||
    under("/trainer/workouts")
  )
    return "clients";
  if (under("/trainer/brain")) return "brain";
  return "more";
}

/** The page title in the top bar for any trainer address. */
export function trainerTitle(path: string, role: string): string {
  const exact: Record<string, string> = {
    "/trainer": role === "finance" ? "Summary" : "Inbox",
    "/trainer/messages": "Chats",
    "/trainer/exceptions": "Needs you",
    "/trainer/subscribers": "Clients",
    "/trainer/brain": "My Brain",
    "/trainer/more": "More",
    "/trainer/summary": "Business summary",
  };
  if (exact[path]) return exact[path];
  if (path.startsWith("/trainer/messages/")) return "Chat";
  if (path.startsWith("/trainer/subscribers/")) return "Client";
  if (path.startsWith("/trainer/brain/")) return "My Brain";
  const link = [...moreGroups("owner").flatMap((g) => g.links), ...CLIENT_TOOLS]
    .filter((l) => path === l.href || path.startsWith(l.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (link) return link.label;
  if (path.includes("/onboarding")) return "Setup";
  return "Your workspace";
}

/**
 * Open inbox items, refreshed every minute while the page is visible. The
 * same number shows on the Inbox tab and the installed app's icon.
 */
export function useInboxCount(enabled: boolean, refreshKey?: unknown) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () =>
      api("/trainer/inbox").then(
        (r) => {
          if (!active) return;
          const n = Number(r?.counts?.total ?? 0);
          setCount(n);
          setAppBadge(n);
        },
        () => {},
      );
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60000);
    // The inbox page announces each card it clears.
    window.addEventListener(INBOX_CHANGED, load);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener(INBOX_CHANGED, load);
    };
  }, [enabled, refreshKey]);
  return count;
}

/** The phone's bottom bar; hidden on wider screens by CSS. */
export function TrainerTabBar({
  role,
  path,
  inboxCount,
}: {
  role: string;
  path: string;
  inboxCount: number;
}) {
  const active = sectionFor(path);
  return (
    <nav className="trainer-tabbar" aria-label="Sections">
      {trainerSections(role).map(({ key, label, href, icon: Icon }) => {
        const current =
          role === "finance" ? path === href : key === active;
        return (
          <Link
            key={href}
            href={href}
            className={current ? "active" : ""}
            aria-current={current ? "page" : undefined}
          >
            <span className="trainer-tab-icon">
              <Icon size={20} aria-hidden="true" />
              {key === "inbox" && role !== "finance" && inboxCount > 0 && (
                <span className="trainer-tab-count">
                  {inboxCount > 99 ? "99+" : inboxCount}
                </span>
              )}
            </span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** More: every other page, grouped. */
export function TrainerMore({
  role,
  setupOpen,
  platformAdmin = false,
}: {
  role: string;
  setupOpen: boolean;
  platformAdmin?: boolean;
}) {
  return (
    <div className="trainer-more">
      <div className="page-heading">
        <div>
          <h1>More</h1>
          <p className="muted">Your business, your page and your account.</p>
        </div>
      </div>
      {setupOpen && role === "owner" && (
        <Link href={SETUP_HREF} className="card trainer-setup-banner">
          <CheckCircle size={20} aria-hidden="true" />
          <span>
            <strong>Finish setting up</strong>
            <small>Pick up where you left off.</small>
          </span>
          <ChevronRight size={18} aria-hidden="true" />
        </Link>
      )}
      {moreGroups(role).map((group) => (
        <section key={group.title} className="trainer-more-group">
          <h2>{group.title}</h2>
          <ul className="card">
            {group.links.map(({ label, href, icon: Icon, detail }) => (
              <li key={href}>
                <Link href={href}>
                  <Icon size={18} aria-hidden="true" />
                  <span>
                    <strong>{label}</strong>
                    <small>{detail}</small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {platformAdmin && (
        <p>
          <Link className="button secondary" href="/admin">
            <Shield size={16} aria-hidden="true" /> Platform admin
          </Link>
        </p>
      )}
    </div>
  );
}
