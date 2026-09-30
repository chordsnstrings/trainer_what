"use client";
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
/** A follower's name, read from the server when outside the first page. */
export function SubscriberDetail({ state, userId }: { state: State; userId: string }) {
  const known = state.members?.find((m) => m.id === userId)?.name;
  const [name, setName] = useState<string | undefined>(known);
  useEffect(() => {
    if (known) {
      setName(known);
      return;
    }
    let active = true;
    api(
      `/workspace/pages/members?role=subscriber&userId=${encodeURIComponent(userId)}`,
    ).then(
      (r) => active && setName(r.items[0]?.name),
      () => {},
    );
    return () => {
      active = false;
    };
  }, [known, userId]);
  return (
    <>
      <ClientTwin userId={userId} name={name} />
      {state.user.role === "owner" && (
        <FollowerRemoval userId={userId} name={name} />
      )}
    </>
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
        eyebrow="THE PEOPLE BEHIND THE NUMBERS"
        title="Your subscribers."
        detail="The right context for a more personal kind of coaching."
      />
      <div className="two-columns wide-left">
        <Card>
          <input
            className="search"
            placeholder="Search by name or email"
            aria-label="Search subscribers"
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
              Showing {members.length} of {subscriberTotal} subscribers
            </p>
          )}
          {members.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Subscriber</th>
                    <th>Program</th>
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
