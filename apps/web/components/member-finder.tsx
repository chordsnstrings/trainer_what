"use client";
import { useEffect, useState } from "react";

export type MemberOption = { id: string; name: string; email?: string };

/**
 * Client pickers list the first page of followers from the bootstrap. When a
 * workspace has more, this searches the rest on the server; a picked person is
 * added to the picker by the caller.
 */
export function MemberFinder({
  hasMore,
  onPick,
  disabled = false,
}: {
  hasMore: boolean;
  onPick: (member: MemberOption) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<MemberOption[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    const q = query.trim();
    if (!hasMore || q.length < 2) {
      setResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ role: "subscriber", limit: "10" });
      // One value per word: the web proxy's signed request proof does not
      // accept a space inside a query value.
      for (const term of q.split(/\s+/).filter(Boolean).slice(0, 5))
        params.append("q", term);
      fetch("/api/v1/workspace/pages/members?" + params, {
        credentials: "same-origin",
      })
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw new Error(body.message ?? "Search failed");
          if (active) {
            setResults(body.items);
            setError("");
          }
        })
        .catch((e) => active && setError((e as Error).message));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, hasMore]);
  if (!hasMore) return null;
  return (
    <div className="member-finder">
      <label className="field">
        <span>Find another client</span>
        <input
          type="search"
          value={query}
          disabled={disabled}
          placeholder="Search by name or email"
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error && <small role="alert">{error}</small>}
      {results.length > 0 && (
        <ul aria-label="Matching clients">
          {results.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className="text-button"
                disabled={disabled}
                onClick={() => {
                  onPick(m);
                  setQuery("");
                  setResults([]);
                }}
              >
                {m.name}
                {m.email ? ` · ${m.email}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The picker's options: bootstrap followers plus anyone found by search. */
export function withPicked<T extends { id: string }>(
  members: T[],
  picked: T[],
) {
  const known = new Set(members.map((m) => m.id));
  return [...members, ...picked.filter((m) => !known.has(m.id))];
}
