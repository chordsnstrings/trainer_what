"use client";
import { CoachingMessages } from "./training-workspace";
import { formatDate } from "../lib/format";
import { FollowerInvitations } from "./joining";
import { ComplimentaryAccessManager } from "./complimentary-access";
import dynamic from "next/dynamic";
const NutritionSubscriber = dynamic(() => import("./nutrition").then(m => m.NutritionSubscriber), { loading: () => <p role="status">Loading nutrition…</p> });
import { ClientTwin } from "./client-twin";
import { FollowerRemoval, FormerFollowers } from "./membership-exit";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useWorkspaceQuery, useWorkspaceValue } from "./workspace-continuity";
import { WorkspaceTabs } from "./workspace-ui";
import {
  type State,
  api,
  Empty,
  Badge,
  Card,
  Heading,
  type ViewProps,
  total,
} from "./workspace-ui";
const HUB_TABS = [
  ["overview", "Overview"],
  ["message", "Message"],
  ["plan", "Plan"],
  ["nutrition", "Nutrition"],
  ["notes", "Coaching context"],
  ["membership", "Membership"],
] as const;
type HubTab = (typeof HUB_TABS)[number][0];

/** The tab a client address opens: /trainer/subscribers/:id[/tab]. */
export function hubTab(path: string): HubTab {
  const part = path.split("/")[4];
  return (HUB_TABS.find(([key]) => key === part)?.[0] ?? "overview") as HubTab;
}

/** One client's plans and upcoming sessions (the full editor stays on the
 * Programmes page). */
function ClientPlan({ userId }: { userId: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setError("");
    api(`/training/overview?subscriberId=${encodeURIComponent(userId)}`).then(
      (r) => active && setData(r),
      (e) => active && setError((e as Error).message),
    );
    return () => {
      active = false;
    };
  }, [userId, retry]);
  const records: any[] = data?.records ?? [];
  const programs = records.filter(
    (r) => r.kind === "program" && r.status === "assigned" && r.owner_user_id === userId,
  );
  const upcoming = records
    .filter((r) => r.kind === "planned_session" && r.status === "planned")
    .sort((a, b) => String(a.data.date).localeCompare(String(b.data.date)))
    .slice(0, 6);
  return (
    <>
      {error && (
        <p className="notice error" role="alert">
          {error}<button className="text-button" onClick={() => setRetry(n => n + 1)}>Try again</button>
        </p>
      )}
      {!data && !error && <p className="muted">Loading plan…</p>}
      {data && !programs.length && (
        <Card>
          <Empty
            title="No plan yet"
            detail="Draft one with your Brain, or assign one of your programmes."
          />
        </Card>
      )}
      {programs.map((p) => (
        <Card key={p.id}>
          <h2 dir="auto">{p.data.title}</h2>
          <p dir="auto">{p.data.goal}</p>
          <p className="muted">
            {p.data.weeks ?? 4} weeks · {p.data.daysPerWeek} sessions a week
          </p>
        </Card>
      ))}
      {upcoming.length > 0 && (
        <Card>
          <h2>Coming up</h2>
          <ul className="plain-list">
            {upcoming.map((s) => (
              <li key={s.id}>
                <strong>{formatDate(s.data.date, { weekday: true })}</strong>{" "}
                · <bdi>{s.data.label}</bdi>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="button-row">
        <Link className="button" href={`/trainer/brain/plans?client=${encodeURIComponent(userId)}`}>
          Draft a plan with my Brain
        </Link>
        <Link className="button secondary" href="/trainer/programs">
          Programmes
        </Link>
      </div>
    </>
  );
}

/** A client's membership: what they pay for, and ending it. */
function ClientMembership({
  member,
  userId,
  name,
  owner,
}: {
  member: any;
  userId: string;
  name?: string;
  owner: boolean;
}) {
  return (
    <>
      <Card>
        <h2>Membership</h2>
        <p>
          <Badge>
            {member?.subscription_status ??
              (member?.complimentary ? "Complimentary" : "No plan")}
          </Badge>
        </p>
        {member?.email && (
          <p className="muted">
            <span dir="ltr">{member.email}</span>
          </p>
        )}
        <p className="muted">
          Payments and refunds are in{" "}
          <Link href="/trainer/finance">Earnings and plans</Link>.
        </p>
      </Card>
      {owner && <FollowerRemoval userId={userId} name={name} />}
    </>
  );
}

/** /trainer/subscribers/:id: the client hub (Message, Plan, Notes,
 * Membership). */
export function SubscriberDetail({
  state,
  userId,
  path = "",
}: {
  state: State;
  userId: string;
  path?: string;
}) {
  const [listQuery] = useWorkspaceQuery("q");
  const [listFilter] = useWorkspaceQuery("filter");
  const suffix = new URLSearchParams({ ...(listQuery ? { q: listQuery } : {}), ...(listFilter ? { filter: listFilter } : {}) }).toString();
  const returnTo = "/trainer/subscribers" + (suffix ? `?${suffix}` : "");
  const known = state.members?.find((m) => m.id === userId);
  const [member, setMember] = useState<any>(known ?? null);
  const name: string | undefined = member?.name ?? known?.name;
  const tab = hubTab(path);
  useEffect(() => {
    let active = true;
    api(
      `/workspace/pages/members?role=subscriber&userId=${encodeURIComponent(userId)}`,
    ).then(
      (r) => active && r.items[0] && setMember(r.items[0]),
      () => {},
    );
    return () => {
      active = false;
    };
  }, [userId]);
  const base = `/trainer/subscribers/${userId}`;
  return (
    <div className="client-hub">
      <Link href={returnTo} className="text-button">
        ← All clients
      </Link>
      <div className="client-hub-head">
        <span className="avatar" aria-hidden="true">
          {(name ?? "?").slice(0, 1)}
        </span>
        <div>
          <h1>{name ?? "Client"}</h1>
          <p className="muted">
            {member?.subscription_status ??
              (member?.complimentary ? "Complimentary" : "")}
          </p>
        </div>
      </div>
      <nav className="tabs client-hub-tabs" aria-label="Client sections">
        {HUB_TABS.map(([key, label]) => (
          <Link
            key={key}
            href={(key === "overview" ? base : `${base}/${key}`) + (suffix ? `?${suffix}` : "")}
            className={tab === key ? "active" : ""}
            aria-current={tab === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === "overview" && <section className="card"><h2>Coach {name?.split(" ")[0] ?? "this client"}</h2><p className="muted">Review the current plan and context, or pick up your conversation.</p><div className="client-overview-actions"><Link className="button" href={`${base}/message`}>Message</Link><Link className="button secondary" href={`${base}/plan`}>Training plan</Link><Link className="button secondary" href={`${base}/nutrition`}>Nutrition</Link></div><ClientTwin userId={userId} name={name} compact /></section>}
      {tab === "nutrition" && <NutritionSubscriber userId={userId} tenantId={state.user.tenantId} coachView />}
      {tab === "message" && (
        <CoachingMessages
          key={userId}
          state={state}
          subscriberId={userId}
          clientName={name}
        />
      )}
      {tab === "plan" && <ClientPlan userId={userId} />}
      {tab === "notes" && <ClientTwin userId={userId} name={name} />}
      {tab === "membership" && (
        <ClientMembership
          member={member}
          userId={userId}
          name={name}
          owner={state.user.role === "owner"}
        />
      )}
    </div>
  );
}
export type MemberPage = { items: any[]; hasMore: boolean; cursor: string | null };
/** Subscribers page from the server: search and "load more" reach everyone. */
export function Members({ state }: ViewProps) {
  const [query, setQuery] = useWorkspaceQuery("q");
  const [requestedFilter, setFilter] = useWorkspaceQuery("filter");
  const filter = ["needs_review", "no_plan", "membership_issue"].includes(requestedFilter) ? requestedFilter : "";
  const [view, setView] = useWorkspaceQuery("view", "clients");
  const [depth, setDepth] = useWorkspaceValue(`clients:depth:${filter}:${query}`, 1, true);
  const [list, setList] = useWorkspaceValue<MemberPage | null>(`clients:list:${filter}:${query}`, null),
    [loading, setLoading] = useState(false),
    [listError, setListError] = useState(""),
    [retry, setRetry] = useState(0);
  const currentQuery = useRef("");
  const fetchPage = useCallback(
    (q: string, cursor?: string | null): Promise<MemberPage> => {
      const params = new URLSearchParams({ role: "subscriber" });
      if (filter) params.set("filter", filter);
      // One value per word: the web proxy's signed request proof does not
      // accept a space inside a query value.
      for (const term of q.split(/\s+/).filter(Boolean).slice(0, 5))
        params.append("q", term);
      if (cursor) params.set("cursor", cursor);
      return api(`/workspace/pages/members?${params}`);
    },
    [filter],
  );
  // Reloads with each bootstrap refresh (a new `pages` object) and search.
  useEffect(() => {
    const q = query.trim();
    currentQuery.current = q;
    let active = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        (async () => {
          let page = await fetchPage(q);
          for (let n = 1; n < depth && page.hasMore && page.cursor && active; n++) {
            const more = await fetchPage(q, page.cursor);
            page = { ...more, items: [...page.items, ...more.items.filter(m => !page.items.some(p => p.id === m.id))] };
          }
          return page;
        })()
          .then(
            (page) => {
              if (!active) return;
              setList(page);
              setListError("");
            },
            (e) => active && setListError((e as Error).message),
          )
          .finally(() => active && setLoading(false));
      },
      q ? 250 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, fetchPage, state.pages, retry]);
  const loadMore = async () => {
    if (!list?.cursor) return;
    const q = currentQuery.current;
    setLoading(true);
    try {
      const page = await fetchPage(q, list.cursor);
      if (currentQuery.current === q) setDepth(depth + 1);
      if (currentQuery.current !== q) return;
      setList((prev) =>
        prev
          ? {
              items: [
                ...prev.items,
                ...page.items.filter(
                  (m) => !prev.items.some((p) => p.id === m.id),
                ),
              ],
              hasMore: page.hasMore,
              cursor: page.cursor,
            }
          : page,
      );
    } catch (e) {
      setListError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  const members = list?.items ?? [];
  const subscriberTotal = total(
    state,
    "subscribers",
    (state.members ?? []).filter((m) => m.role === "subscriber").length,
  );
  return (
    <>
      <Heading
                title="Your clients."
        detail="The right context for a more personal kind of coaching."
      />
      <WorkspaceTabs label="Client administration" items={[["clients", "Clients"], ["invitations", "Invitations"], ["access", "Complimentary access"], ["former", "Former clients"]]} value={["clients", "invitations", "access", "former"].includes(view) ? view : "clients"} onChange={setView} panelId="clients-panel" />
      <div id="clients-panel" role="tabpanel" aria-label="Client administration">
        {!["invitations", "access", "former"].includes(view) && <Card>
          <label className="field"><span>Show clients</span><select aria-label="Show clients" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All clients</option><option value="needs_review">Needs review</option><option value="no_plan">No assigned plan</option><option value="membership_issue">Membership needs attention</option></select></label>
          <input
            className="search"
            placeholder="Search by name or email"
            aria-label="Search clients"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {listError && (
            <p className="notice error" role="alert">
              {listError}
              <button type="button" className="button secondary" disabled={loading} onClick={() => setRetry(n => n + 1)}>Try again</button>
            </p>
          )}
          {list && !query.trim() && !filter && subscriberTotal > 0 && (
            <p className="muted" role="status">
              Showing {members.length} of {subscriberTotal} clients
            </p>
          )}
          {members.length ? (
            <div className="table-wrap client-list-table">
              <table>
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Plan</th>
                    <th>Membership</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td data-label="Client">
                        <Link href={`/trainer/subscribers/${m.id}${query ? `?q=${encodeURIComponent(query)}` : ""}`}>
                          <strong>{m.name}</strong>
                        </Link>
                        <small>
                          <span dir="ltr">{m.email}</span>
                        </small>
                      </td>
                      <td data-label="Plan">{m.programs ?? 0} assigned</td>
                      <td data-label="Membership">
                        <Badge>
                          {m.subscription_status ??
                            (m.complimentary ? "Complimentary" : "No plan")}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : listError ? null : !list || loading ? (
            <p role="status">Loading subscribers…</p>
          ) : query.trim() || filter ? (
            <p className="muted">No clients match this view. Change the filter or search.</p>
          ) : (
            <Empty
              title="Make room for your first subscriber"
              detail="Invite someone into your coaching space. Access starts with a paid membership offer or complimentary access you grant."
            />
          )}
          {list?.hasMore && (
            <div className="button-row load-more">
              <button
                type="button"
                className="button secondary"
                disabled={loading}
                onClick={() => void loadMore()}
              >
                {loading ? "Loading…" : "Load more subscribers"}
              </button>
            </div>
          )}
        </Card>}
        {view === "invitations" && <div className="workspace-form-page"><FollowerInvitations role={state.user.role} /></div>}
        {view === "former" && <FormerFollowers />}
        {view === "access" && <div className="workspace-form-page"><ComplimentaryAccessManager role={state.user.role} /></div>}
      </div>
    </>
  );
}
