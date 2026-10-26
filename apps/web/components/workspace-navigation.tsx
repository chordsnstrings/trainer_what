"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Calendar, CheckCircle, ChevronDown, Globe, Inbox, Brain, Settings, Users, Wallet, Shield, Activity } from "lucide-react";
import { CLIENT_TOOLS, moreGroups, SETUP_HREF } from "./workspace-nav";
import type { State } from "./workspace-ui";
import type { LiveSnapshot } from "./workspace-live";
import { prefersReducedMotion } from "./motion";

type Item = [label: string, href: string];
const under = (path: string, href: string) => path === href || (href !== "/trainer" && href !== "/admin" && path.startsWith(href + "/"));
function NavLink({ item: [label, href], path, children, extra, note, ariaLabel }: {
  item: Item; path: string; children?: ReactNode; extra?: ReactNode; note?: string; ariaLabel?: string;
}) {
  const active = under(path, href.split("?")[0]);
  return <Link href={href} className={active ? "active" : ""} aria-current={path === href.split("?")[0] ? "page" : undefined} aria-label={ariaLabel}>
    {children && <span className="nav-icon">{children}{extra}</span>}
    <span className="nav-label">{label}</span>
    {note ? <span className="nav-note" aria-hidden="true">{note}</span> : null}
  </Link>;
}
function Group({ title, items, path, icon }: { title: string; items: Item[]; path: string; icon: ReactNode }) {
  if (!items.length) return null;
  const active = items.some(([, href]) => under(path, href.split("?")[0]));
  return <details className="workspace-nav-group" open={active || undefined} data-active={active || undefined} key={path + title}>
    <summary><span className="nav-icon">{icon}</span><span className="nav-label">{title}</span><ChevronDown size={15} /></summary>
    <div>{items.map(item => <NavLink key={item[1]} item={item} path={path} />)}</div>
  </details>;
}

/** Last values shown, kept across the shell's remount on every navigation,
 * so a count only animates when it really changes. */
const shown = new Map<string, number>();
/** A key that changes when `value` goes up (an arrival), never on a remount. */
function useArrival(name: string, value: number) {
  const [key, setKey] = useState(0);
  useEffect(() => {
    const before = shown.get(name);
    shown.set(name, value);
    if (before !== undefined && value > before) setKey((k) => k + 1);
  }, [name, value]);
  return key;
}

/** Where the active pill was on the previous page: it glides from there. */
let lastPill: { top: number; height: number } | null = null;

/** The ink pill under the current page and the light one that follows the
 * pointer. Both move with transforms only; positions come from the links. */
function useRailPills(nav: React.RefObject<HTMLElement | null>, enabled: boolean, path: string) {
  const pill = useRef<HTMLSpanElement>(null),
    hover = useRef<HTMLSpanElement>(null),
    current = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const el = nav.current, p = pill.current;
    if (!enabled || !el || !p) return;
    // A page inside a group puts the pill on the group's heading, which
    // shows whether or not the rail is open.
    const page = el.querySelector<HTMLElement>("a[aria-current=page]") ?? el.querySelector<HTMLElement>("a.active");
    const target = page?.parentElement === el ? page : page?.closest("details")?.querySelector<HTMLElement>("summary") ?? null;
    current.current = target;
    if (!target) { p.style.opacity = "0"; lastPill = null; return; }
    const next = { top: target.offsetTop, height: target.offsetHeight };
    const place = (at: { top: number; height: number }) => {
      p.style.transform = `translateY(${at.top}px)`;
      p.style.blockSize = `${at.height}px`;
    };
    p.style.opacity = "1";
    if (lastPill && !prefersReducedMotion() && (lastPill.top !== next.top || lastPill.height !== next.height)) {
      p.classList.remove("is-gliding");
      place(lastPill);
      void p.offsetWidth;
      p.classList.add("is-gliding");
    }
    place(next);
    lastPill = next;
  }, [nav, enabled, path]);
  const onPointerMove = (event: React.PointerEvent) => {
    const h = hover.current, el = nav.current;
    if (!enabled || !h || !el) return;
    const target = (event.target as Element).closest<HTMLElement>("a, summary");
    if (!target || !el.contains(target) || target === current.current) { h.style.opacity = "0"; return; }
    h.style.transform = `translateY(${target.offsetTop}px)`;
    h.style.blockSize = `${target.offsetHeight}px`;
    h.style.opacity = "1";
  };
  const onPointerLeave = () => { if (hover.current) hover.current.style.opacity = "0"; };
  return { pill, hover, onPointerMove, onPointerLeave };
}

export function WorkspaceNavigation({ state, path, count, setupOpen, live, safety = false, rail = false }: {
  state: State; path: string; count: number; setupOpen: boolean;
  /** The live picture (workspace-live.ts) for owners and staff. */
  live?: LiveSnapshot;
  /** A safety item is waiting: the Inbox count turns red. */
  safety?: boolean;
  /** The trainer rail: pills, live instruments. */
  rail?: boolean;
}) {
  const admin = path.startsWith("/admin") || state.platformWorkspace;
  const role = state.user.role, platformRole = state.user.platformRole;
  const all = moreGroups(role).flatMap(g => g.links);
  const links = (hrefs: string[]): Item[] => hrefs.flatMap(href => {
    const match = all.find(l => l.href === href);
    return match ? [[match.label, match.href] as Item] : [];
  });
  const nav = useRef<HTMLElement>(null);
  const pills = useRailPills(nav, rail && !admin, path);
  const instruments = rail && !admin && role !== "finance" && !!live;
  const done = live?.doneToday ?? 0, total = done + count;
  const training = live?.training.length ?? 0, writing = live?.writing ?? 0;
  const inboxArrival = useArrival("inbox", count), trainingArrival = useArrival("training", training);
  // One live loop at a time: the Brain writing, else clients training.
  const beat = writing > 0 ? "brain" : training > 0 ? "clients" : "";
  return <nav ref={nav} aria-label={admin ? "Platform navigation" : "Main navigation"} onPointerMove={pills.onPointerMove} onPointerLeave={pills.onPointerLeave}>
    {rail && !admin && <>
      <span ref={pills.hover} className="rail-hover" aria-hidden="true" />
      <span ref={pills.pill} className="rail-pill" aria-hidden="true" />
    </>}
    {admin ? <>
      <NavLink path={path} item={["Overview", "/admin"]}><Activity size={18} /></NavLink>
      {["admin", "support", "finance", "safety"].includes(platformRole) && <Group title="People" path={path} icon={<Users size={18} />} items={[["Trainer workspaces", "/admin/trainers"], ["Subscriber accounts", "/admin/subscribers"], ...(["admin", "support"].includes(platformRole) ? [["Support", "/admin/support"]] as Item[] : []), ...(["admin", "support"].includes(platformRole) ? [["Governance", "/admin/governance"]] as Item[] : [])]} />}
      <Group title="Operations" path={path} icon={<Activity size={18} />} items={[
        ["Alerts", "/admin/alerts"],
        ...(["admin", "finance"].includes(platformRole) ? [["Usage and FinOps", "/admin/finops"]] as Item[] : []),
        ...(["admin", "safety"].includes(platformRole) ? [["Brain operations", "/admin/brains"], ["Safety reviews", "/admin/safety"]] as Item[] : []),
        ...(platformRole === "support" ? [["Wearables", "/admin/wearables"], ["Custom domains", "/admin/domains"]] as Item[] : []),
        ...(platformRole === "admin" ? [["Job operations", "/admin/infrastructure"], ["Host", "/admin/infrastructure/host"], ["Observer", "/admin/infrastructure/observer"], ["Operator actions", "/admin/infrastructure/actions"]] as Item[] : []),
      ]} />
      {["admin", "finance"].includes(platformRole) && <Group title="Finance" path={path} icon={<Wallet size={18} />} items={[["Platform finance", "/admin/platform-finance"], ["Ledger and controls", "/admin/finance"], ["Affiliates", "/admin/affiliates"], ["Metrics", "/admin/metrics"]]} />}
      {platformRole === "admin" && <>
        <Group title="Connections" path={path} icon={<Globe size={18} />} items={[["Settings & API connections", "/admin/settings"], ["AI model profiles", "/admin/model-profiles"], ["Integration operations", "/admin/integration-operations"], ["Custom domains", "/admin/domains"], ["Wearables", "/admin/wearables"]]} />
        <Group title="System" path={path} icon={<Settings size={18} />} items={[["Home page assistant", "/admin/marketing-assistant"], ["Acquisition", "/admin/acquisition"], ["Early access", "/admin/early-access"], ["Documents & templates", "/admin/configuration"], ["Security & audit", "/admin/security"], ["Experiments", "/admin/experiments"]]} />
      </>}
      <NavLink path={path} item={["Account security", "/admin/account-security"]}><Shield size={18} /></NavLink>
      {!state.platformWorkspace && <Link href="/trainer" className="nav-workspace-link">Coaching workspace</Link>}
    </> : <>
      {setupOpen && <Link className="nav-setup" href={SETUP_HREF}>Finish setup<CheckCircle size={18} aria-hidden="true" /></Link>}
      <NavLink path={path} item={[role === "finance" ? "Summary" : "Today", "/trainer"]}
        note={instruments && total > 0 ? `${done} of ${total}` : undefined}
        ariaLabel={instruments && total > 0 ? `Today, ${done} of ${total} done` : undefined}
        extra={instruments && total > 0 ? <svg className="nav-ring" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" /><circle className="nav-ring-value" cx="16" cy="16" r="14" style={{ strokeDashoffset: (88 * (1 - done / total)).toFixed(1) }} /></svg> : undefined}>
        <Activity size={18} />
      </NavLink>
      {role !== "finance" && <>
        <NavLink path={path} item={["Inbox", "/trainer/inbox"]}
          extra={count > 0 && <span key={inboxArrival} className={"nav-count" + (safety ? " is-safety" : "") + (inboxArrival ? " is-arrival" : "")}>{count}</span>}>
          <Inbox size={18} />
        </NavLink>
        <NavLink path={path} item={["Clients", "/trainer/subscribers"]}
          note={instruments && training > 0 ? `${training} training` : undefined}
          ariaLabel={instruments && training > 0 ? `Clients, ${training} training with your AI now` : undefined}
          extra={instruments && training > 0 ? <span key={trainingArrival} className={"nav-beat" + (beat === "clients" ? " is-live" : "")} aria-hidden="true" /> : undefined}>
          <Users size={18} />
        </NavLink>
        <NavLink path={path} item={["My Brain", "/trainer/brain"]}
          note={instruments && writing > 0 ? "writing" : undefined}
          ariaLabel={instruments && writing > 0 ? "My Brain, writing a plan" : undefined}
          extra={instruments && writing > 0 ? <span className={"nav-dots" + (beat === "brain" ? " is-live" : "")} aria-hidden="true"><i /><i /><i /></span> : undefined}>
          <Brain size={18} />
        </NavLink>
        <NavLink path={path} item={["Bookings", "/trainer/bookings"]}><Calendar size={18} /></NavLink>
        <Group title="Client tools" path={path} icon={<Users size={18} />} items={[["Chats", "/trainer/messages"], ...CLIENT_TOOLS.map(l => [l.label, l.href] as Item), ["Support requests", "/trainer/support"]]} />
      </>}
      <Group title="Website & brand" path={path} icon={<Globe size={18} />} items={links(["/trainer/website", "/trainer/galleries", "/trainer/domains", "/trainer/design"])} />
      <Group title="Business" path={path} icon={<Wallet size={18} />} items={links(["/trainer/finance", "/trainer/analytics", "/trainer/growth", "/trainer/affiliates"])} />
      <Group title="Settings" path={path} icon={<Settings size={18} />} items={links(["/trainer/settings", "/trainer/notifications", "/trainer/team", "/trainer/integrations"])} />
      {platformRole !== "none" && <Link href="/admin" className="nav-workspace-link"><span className="nav-icon"><Shield size={18} /></span><span className="nav-label">Platform admin</span></Link>}
    </>}
  </nav>;
}
