"use client";
import { CoachingMessages } from "./training-workspace";
import { formatDate } from "../lib/format";
import { FollowerInvitations } from "./joining";
import { ComplimentaryAccessManager } from "./complimentary-access";
import { ClientTwin } from "./client-twin";
import { FollowerRemoval, FormerFollowers } from "./membership-exit";
import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
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
  ["message", "Message"],
  ["plan", "Plan"],
  ["notes", "Notes"],
  ["membership", "Membership"],
] as const;
type HubTab = (typeof HUB_TABS)[number][0];

/** The tab a client address opens: /trainer/subscribers/:id[/tab]. */
export function hubTab(path: string): HubTab {
  const part = path.split("/")[4];
  return (HUB_TABS.find(([key]) => key === part)?.[0] ?? "message") as HubTab;
}

/** One client's plans and upcoming sessions (the full editor stays on the
 * Programmes page). */
function ClientPlan({ userId }: { userId: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api(`/training/overview?subscriberId=${encodeURIComponent(userId)}`).then(
      (r) => active && setData(r),
      (e) => active && setError((e as Error).message),
    );
    return () => {
      active = false;
    };
  }, [userId]);
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
          {error}
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
        <Link className="button" href="/trainer/brain/plans">
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
      <Link href="/trainer/subscribers" className="text-button">
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
            href={key === "message" ? base : `${base}/${key}`}
            className={tab === key ? "active" : ""}
            aria-current={tab === key ? "page" : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
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
  const [query, setQuery] = useState(""),
    [list, setList] = useState<MemberPage | null>(null),
    [loading, setLoading] = useState(false),
    [listError, setListError] = useState("");
  const currentQuery = useRef("");
  const fetchPage = useCallback(
    (q: string, cursor?: string | null): Promise<MemberPage> => {
      const params = new URLSearchParams({ role: "subscriber" });
      // One value per word: the web proxy's signed request proof does not
      // accept a space inside a query value.
      for (const term of q.split(/\s+/).filter(Boolean).slice(0, 5))
        params.append("q", term);
      if (cursor) params.set("cursor", cursor);
      return api(`/workspace/pages/members?${params}`);
    },
    [],
  );
  // Reloads with each bootstrap refresh (a new `pages` object) and search.
  useEffect(() => {
    const q = query.trim();
    currentQuery.current = q;
    let active = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        fetchPage(q)
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
  }, [query, fetchPage, state.pages]);
  const loadMore = async () => {
    if (!list?.cursor) return;
    const q = currentQuery.current;
    setLoading(true);
    try {
      const page = await fetchPage(q, list.cursor);
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
      <div className="two-columns wide-left">
        <Card>
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
            </p>
          )}
          {list && !query.trim() && subscriberTotal > 0 && (
            <p className="muted" role="status">
              Showing {members.length} of {subscriberTotal} clients
            </p>
          )}
          {members.length ? (
            <div className="table-wrap">
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
                      <td>
                        <Link href={`/trainer/subscribers/${m.id}`}>
                          <strong>{m.name}</strong>
                        </Link>
                        <small>
                          <span dir="ltr">{m.email}</span>
                        </small>
                      </td>
                      <td>{m.programs ?? 0} assigned</td>
                      <td>
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
          ) : !list || loading ? (
            <p role="status">Loading subscribers…</p>
          ) : query.trim() ? (
            <p className="muted">No subscriber matches this search.</p>
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
        </Card>
        <FollowerInvitations role={state.user.role} />
      </div>
      <FormerFollowers />
      <ComplimentaryAccessManager role={state.user.role} />
    </>
  );
}
