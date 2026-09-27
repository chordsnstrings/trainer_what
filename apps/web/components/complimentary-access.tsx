"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

/** Trainer-granted complimentary access: owner tools, member view and operator view. */
async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(data.message ?? "The request failed"), {
      status: r.status,
      code: data.code,
    });
  return data;
}
const day = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";
const tierName = (tier: string) =>
  tier === "workout_nutrition" ? "Workout + nutrition" : "Workout";
const until = (g: any) =>
  g.endsAt ? `until ${day(g.endsAt)}` : "until revoked";
function MfaHint({ error }: { error: any }) {
  if (error?.code !== "MFA_STEP_UP") return null;
  return (
    <Link className="text-link" href="/trainer/settings">
      Verify your authenticator in Account security
    </Link>
  );
}

/** Owner grants and revokes; coaching staff can see who has complimentary access. */
export function ComplimentaryAccessManager({ role }: { role: string }) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState<any>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [period, setPeriod] = useState<"days" | "open">("days"),
    [showClosed, setShowClosed] = useState(false);
  const load = useCallback(
    () => api("/complimentary-access").then(setData, setError),
    [],
  );
  useEffect(() => {
    if (["owner", "staff"].includes(role)) void load();
  }, [role, load]);
  if (!["owner", "staff"].includes(role)) return null;
  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await fn();
      setNotice(success);
      await load();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const grants = (data?.grants ?? []).filter(
    (g: any) => showClosed || g.status === "active",
  );
  const activeFor = (userId: string) =>
    data?.grants.find((g: any) => g.userId === userId && g.status === "active");
  const nutritionOpen =
    data?.nutritionTier.approved && data?.nutritionTier.setupEnabled;
  return (
    <section className="card complimentary-access" aria-labelledby="comp-title">
      <h2 id="comp-title">Complimentary access</h2>
      <p className="muted">
        Give a follower access without payment for a fixed period or until you
        end it. No charge, invoice or commission is created; AI and voice usage
        is still counted to your workspace.
      </p>
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error.message} <MfaHint error={error} />
        </p>
      )}
      {data?.canManage && (
        <form
          className="comp-form"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              f = new FormData(form),
              userId = String(f.get("userId"));
            const existing = activeFor(userId);
            if (
              existing &&
              !window.confirm(
                "This follower already has complimentary access. Replace it with these terms?",
              )
            )
              return;
            void act(
              () =>
                api("/complimentary-access", "POST", {
                  userId,
                  tier: f.get("tier"),
                  days: period === "open" ? null : Number(f.get("days")),
                  reason: f.get("reason"),
                  ...(existing ? { replaceId: existing.id } : {}),
                }),
              "Complimentary access granted.",
            ).then((ok) => ok && form.reset());
          }}
        >
          <label className="field">
            <span>Follower</span>
            <select name="userId" required defaultValue="">
              <option value="" disabled>
                Choose a follower
              </option>
              {data.followers.map((f: any) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.email}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Tier</span>
            <select name="tier" defaultValue="workout">
              <option value="workout">Workout</option>
              <option value="workout_nutrition" disabled={!nutritionOpen}>
                Workout + nutrition
                {nutritionOpen ? "" : " (nutrition not available yet)"}
              </option>
            </select>
          </label>
          <fieldset className="comp-period">
            <legend>Period</legend>
            <label>
              <input
                type="radio"
                name="period"
                checked={period === "days"}
                onChange={() => setPeriod("days")}
              />
              Fixed number of days
            </label>
            {data.limits.openEnded && (
              <label>
                <input
                  type="radio"
                  name="period"
                  checked={period === "open"}
                  onChange={() => setPeriod("open")}
                />
                Until I revoke it
              </label>
            )}
          </fieldset>
          {period === "days" && (
            <label className="field">
              <span>Days (up to {data.limits.maxDays})</span>
              <input
                name="days"
                type="number"
                min={1}
                max={data.limits.maxDays}
                defaultValue={30}
                required
              />
            </label>
          )}
          <label className="field">
            <span>Reason (kept for your records)</span>
            <input name="reason" required minLength={5} maxLength={1000} />
          </label>
          <p className="fine-print muted">
            {data.limits.active} of {data.limits.maxActive} complimentary places
            in use. Granting requires a recent authenticator check.
          </p>
          <button className="button" type="submit" disabled={busy}>
            Grant access
          </button>
        </form>
      )}
      <div className="invitation-list-heading">
        <h3>Current grants</h3>
        <label className="check-field">
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
          <span>Show ended grants</span>
        </label>
      </div>
      {!data ? (
        <p className="muted">Loading…</p>
      ) : grants.length === 0 ? (
        <p className="muted">No complimentary access right now.</p>
      ) : (
        <ul className="invitation-list">
          {grants.map((g: any) => (
            <li key={g.id}>
              <div className="invitation-main">
                <strong>{g.name ?? "Former follower"}</strong>
                <span
                  className={`badge ${g.status === "active" ? "green" : ""}`}
                >
                  {g.status === "active"
                    ? "Active"
                    : g.closeReason === "platform_revoked"
                      ? "Ended by platform"
                      : g.status}
                </span>
              </div>
              <small className="muted">
                {tierName(g.tier)} ·{" "}
                {g.status === "active"
                  ? until(g)
                  : `ended ${day(g.closedAt ?? g.endsAt)}`}{" "}
                · {g.reason}
              </small>
              {g.status === "active" && data.canManage && (
                <div className="invitation-actions">
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const reason = window.prompt(
                        `Why are you ending ${g.name ?? "this follower"}'s complimentary access? (at least 5 characters)`,
                      );
                      if (reason && reason.trim().length >= 5)
                        void act(
                          () =>
                            api(
                              `/complimentary-access/${g.id}/revoke`,
                              "POST",
                              {
                                version: g.version,
                                reason: reason.trim(),
                              },
                            ),
                          "Complimentary access ended.",
                        );
                    }}
                  >
                    End access
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The follower's plan screen: complimentary access, if any. */
export function MemberAccessCard() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    api("/membership/access").then(setData, () => setData(null));
  }, []);
  const grant = data?.complimentary;
  if (!grant) return null;
  return (
    <section
      className="card member-access"
      aria-labelledby="member-access-title"
    >
      <p className="eyebrow">COMPLIMENTARY ACCESS</p>
      <h2 id="member-access-title">Your coach has given you access</h2>
      <p>
        <span className="badge green">{tierName(grant.tier)}</span>{" "}
        {grant.endsAt
          ? `Included until ${day(grant.endsAt)}.`
          : "Included until your coach ends it."}
      </p>
      {grant.includesNutrition && !grant.nutritionAvailable && (
        <p className="muted">
          Nutrition coaching opens when it is available on this platform.
        </p>
      )}
      <p className="muted">
        No payment is needed for this access. You can still choose a paid plan
        below at any time.
      </p>
    </section>
  );
}

/** Superadmin and operator view across workspaces; administrators may end a grant. */
export function AdminComplimentaryAccess({
  platformRole,
}: {
  platformRole: string;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [status, setStatus] = useState<"active" | "all">("active"),
    [page, setPage] = useState(0),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    () =>
      api(`/admin/complimentary-access?status=${status}&page=${page}`).then(
        setData,
        (e) => setError(e.message),
      ),
    [status, page],
  );
  useEffect(() => {
    if (["admin", "finance", "support"].includes(platformRole)) void load();
  }, [platformRole, load]);
  if (!["admin", "finance", "support"].includes(platformRole)) return null;
  return (
    <section
      className="card complimentary-access"
      aria-labelledby="admin-comp-title"
    >
      <div className="invitation-list-heading">
        <h2 id="admin-comp-title">Complimentary access</h2>
        <label className="invitation-filter">
          <span>Show</span>
          <select
            value={status}
            onChange={(e) => {
              setPage(0);
              setStatus(e.target.value as "active" | "all");
            }}
          >
            <option value="active">Active</option>
            <option value="all">All</option>
          </select>
        </label>
      </div>
      <p className="muted">
        Trainer-granted access without payment. It creates no revenue or
        commission; AI usage stays attributed to the trainer.
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : data.grants.length === 0 ? (
        <p className="muted">No complimentary access on this page.</p>
      ) : (
        <ul className="invitation-list">
          {data.grants.map((g: any) => (
            <li key={g.id}>
              <div className="invitation-main">
                <strong>
                  {g.name ?? "Former follower"} · {g.workspace}
                </strong>
                <span
                  className={`badge ${g.status === "active" ? "green" : ""}`}
                >
                  {g.status}
                </span>
              </div>
              <small className="muted">
                {tierName(g.tier)} · granted {day(g.createdAt)} by{" "}
                {g.grantedByName ?? "the owner"} ·{" "}
                {g.status === "active"
                  ? until(g)
                  : `ended ${day(g.closedAt ?? g.endsAt)}`}{" "}
                · {g.reason}
              </small>
              {g.status === "active" && data.canRevoke && (
                <div className="invitation-actions">
                  <button
                    className="text-button"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const reason = window.prompt(
                        "Reason for ending this complimentary access (recorded in the operator audit):",
                      );
                      if (!reason || reason.trim().length < 5) return;
                      setBusy(true);
                      setError("");
                      try {
                        await api(
                          `/admin/tenants/${g.tenantId}/complimentary-access/${g.id}/revoke`,
                          "POST",
                          { version: g.version, reason: reason.trim() },
                        );
                        await load();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    End access
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && (page > 0 || data.hasMore) && (
        <div className="button-row">
          <button
            className="button secondary"
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous workspaces
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={!data.hasMore}
            onClick={() => setPage((p) => p + 1)}
          >
            Next workspaces
          </button>
        </div>
      )}
    </section>
  );
}
