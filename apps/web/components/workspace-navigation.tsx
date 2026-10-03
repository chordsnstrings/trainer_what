"use client";
import Link from "next/link";
import { Calendar, ChevronDown, Globe, Inbox, Brain, Settings, Users, Wallet, Shield, Activity } from "lucide-react";
import { CLIENT_TOOLS, moreGroups, SETUP_HREF } from "./workspace-nav";
import type { State } from "./workspace-ui";

type Item = [label: string, href: string];
const under = (path: string, href: string) => path === href || (href !== "/trainer" && href !== "/admin" && path.startsWith(href + "/"));
function NavLink({ item: [label, href], path, children }: { item: Item; path: string; children?: React.ReactNode }) {
  const active = under(path, href.split("?")[0]);
  return <Link href={href} className={active ? "active" : ""} aria-current={path === href.split("?")[0] ? "page" : undefined}>{children}{label}</Link>;
}
function Group({ title, items, path, icon }: { title: string; items: Item[]; path: string; icon: React.ReactNode }) {
  if (!items.length) return null;
  const active = items.some(([, href]) => under(path, href.split("?")[0]));
  return <details className="workspace-nav-group" open={active || undefined} key={path + title}>
    <summary>{icon}<span>{title}</span><ChevronDown size={15} /></summary>
    <div>{items.map(item => <NavLink key={item[1]} item={item} path={path} />)}</div>
  </details>;
}

export function WorkspaceNavigation({ state, path, count, setupOpen }: { state: State; path: string; count: number; setupOpen: boolean }) {
  const admin = path.startsWith("/admin") || state.platformWorkspace;
  const role = state.user.role, platformRole = state.user.platformRole;
  const all = moreGroups(role).flatMap(g => g.links);
  const links = (hrefs: string[]): Item[] => hrefs.flatMap(href => {
    const match = all.find(l => l.href === href);
    return match ? [[match.label, match.href] as Item] : [];
  });
  return <nav aria-label={admin ? "Platform navigation" : "Main navigation"}>
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
      {setupOpen && <Link className="nav-setup" href={SETUP_HREF}>Finish setup</Link>}
      <NavLink path={path} item={[role === "finance" ? "Summary" : "Inbox", "/trainer"]}><Inbox size={18} />{count > 0 && <span className="nav-count">{count}</span>}</NavLink>
      {role !== "finance" && <>
        <NavLink path={path} item={["Clients", "/trainer/subscribers"]}><Users size={18} /></NavLink>
        <NavLink path={path} item={["My Brain", "/trainer/brain"]}><Brain size={18} /></NavLink>
        <NavLink path={path} item={["Bookings", "/trainer/bookings"]}><Calendar size={18} /></NavLink>
        <Group title="Client tools" path={path} icon={<Users size={18} />} items={[["Chats", "/trainer/messages"], ...CLIENT_TOOLS.map(l => [l.label, l.href] as Item), ["Support requests", "/trainer/support"]]} />
      </>}
      <Group title="Website & brand" path={path} icon={<Globe size={18} />} items={links(["/trainer/website", "/trainer/galleries", "/trainer/domains", "/trainer/design"])} />
      <Group title="Business" path={path} icon={<Wallet size={18} />} items={links(["/trainer/finance", "/trainer/analytics", "/trainer/growth", "/trainer/affiliates"])} />
      <Group title="Settings" path={path} icon={<Settings size={18} />} items={links(["/trainer/settings", "/trainer/notifications", "/trainer/team", "/trainer/integrations"])} />
      {platformRole !== "none" && <Link href="/admin" className="nav-workspace-link"><Shield size={18} />Platform admin</Link>}
    </>}
  </nav>;
}
