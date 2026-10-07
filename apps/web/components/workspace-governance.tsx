"use client";
import { useCallback, useEffect, useState } from "react";
import { Field } from "./field";
import {
  GovernanceError,
  GovernanceLinks,
  governanceApi,
  when,
} from "./governance-shared";

type Failure = { message: string; code?: string } | null;
const stateLabel: Record<string, string> = {
  active: "Active",
  suspended: "Suspended",
  closed: "Closed",
};

/** Super admin workspace suspension and account locks (/admin/governance). */
export function WorkspaceGovernance({ platformRole }: { platformRole: string }) {
  const admin = platformRole === "admin";
  return (
    <div className="governance">
      <div className="page-heading">
        <div>
          <p className="eyebrow">GOVERNANCE</p>
          <h1>Workspaces and accounts.</h1>
          <p className="muted">
            Suspend a trainer workspace or lock an account with a written
            reason. Each action needs a fresh authenticator code and is
            audited.
          </p>
        </div>
      </div>
      <GovernanceLinks platformRole={platformRole} />
      {["admin", "support"].includes(platformRole) ? (
        <>
          <WorkspaceSuspensions />
          {admin && <AccountLocks />}
        </>
      ) : (
        <div className="notice error" role="alert">
          Super admin or platform support access is required for this screen.
        </div>
      )}
    </div>
  );
}

function WorkspaceSuspensions() {
  const [data, setData] = useState<any>(null),
    [query, setQuery] = useState(""),
    [state, setState] = useState(""),
    [page, setPage] = useState(0),
    [error, setError] = useState<Failure>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    const params = new URLSearchParams({ q: query, state, page: String(page) });
    setData(await governanceApi("/admin/governance/workspaces?" + params));
  }, [query, state, page]);
  useEffect(() => {
    load().catch(setError);
  }, [load]);
  const act = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await governanceApi(path, "POST", body);
      setOpen(null);
      setMessage(done);
      await load();
    } catch (e) {
      setError(e as Failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="workspace-governance">
      <div className="card-heading">
        <h2 id="workspace-governance">Trainer workspaces</h2>
        {data && (
          <p className="muted">
            {data.counts.active} active · {data.counts.suspended} suspended ·{" "}
            {data.counts.closed} closed
          </p>
        )}
      </div>
      <form
        className="governance-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          load().catch(setError);
        }}
      >
        <Field label="Search by name or address">
          <input
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <Field label="State">
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
        <button className="button secondary" type="submit">
          Search
        </button>
      </form>
      <GovernanceError error={error} />
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {!data ? (
        !error && <p>Loading workspaces…</p>
      ) : data.workspaces.length === 0 ? (
        <p className="muted">No workspaces match.</p>
      ) : (
        <ul className="governance-list">
          {data.workspaces.map((w: any) => (
            <li key={w.id} className="governance-item">
              <div className="governance-item-head">
                <div>
                  <strong>{w.name}</strong>
                  <small className="muted">
                    {w.slug} ·{" "}
                    {w.owner ? (
                      <>
                        <bdi>{w.owner.name}</bdi> (
                        <span dir="ltr">{w.owner.email}</span>)
                      </>
                    ) : (
                      "No owner"
                    )}{" "}
                    ·{" "}
                    {w.followers} follower{w.followers === 1 ? "" : "s"}
                  </small>
                </div>
                <span
                  className={
                    "badge " + (w.lifecycle_state === "active" ? "green" : "amber")
                  }
                >
                  {stateLabel[w.lifecycle_state] ?? w.lifecycle_state}
                </span>
              </div>
              {w.suspension && (
                <p className="muted">
                  Suspended {when(w.suspension.suspendedAt)}: {w.suspension.reason}
                  {w.suspension.heldPayouts
                    ? ` · ${w.suspension.heldPayouts} payout(s) held`
                    : ""}
                  {w.suspension.notice
                    ? ` · Team notice: “${w.suspension.notice}”`
                    : ""}
                </p>
              )}
              {data.canAct && !w.platform_workspace && w.lifecycle_state !== "closed" && (
                open === w.id ? (
                  <form
                    className="governance-action"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      if (w.lifecycle_state === "active")
                        void act(
                          `/admin/governance/workspaces/${w.id}/suspend`,
                          {
                            reason: f.get("reason"),
                            ...(f.get("notice") ? { notice: f.get("notice") } : {}),
                          },
                          `${w.name} is suspended. Payouts are held and the owner was notified.`,
                        );
                      else
                        void act(
                          `/admin/governance/workspaces/${w.id}/reinstate`,
                          {
                            suspensionId: w.suspension.id,
                            revision: w.suspension.revision,
                            reason: f.get("reason"),
                          },
                          `${w.name} is active again.`,
                        );
                    }}
                  >
                    <fieldset disabled={busy}>
                      <legend>
                        {w.lifecycle_state === "active"
                          ? `Suspend ${w.name}`
                          : `Reinstate ${w.name}`}
                      </legend>
                      {w.lifecycle_state === "active" && (
                        <p className="muted">
                          Members lose access, the public website and joining
                          go offline, automated coaching and reminders stop and
                          payouts are held. Billing is not cancelled; finance
                          receives a follow-up.
                        </p>
                      )}
                      <Field label="Reason (recorded in the audit log)">
                        <textarea name="reason" required minLength={10} maxLength={1000} rows={3} />
                      </Field>
                      {w.lifecycle_state === "active" && (
                        <Field label="Notice for the workspace team (optional)">
                          <textarea name="notice" maxLength={500} rows={2} />
                        </Field>
                      )}
                      <div className="button-row">
                        <button className="button" type="submit">
                          {w.lifecycle_state === "active" ? "Suspend workspace" : "Reinstate workspace"}
                        </button>
                        <button className="button secondary" type="button" onClick={() => setOpen(null)}>
                          Cancel
                        </button>
                      </div>
                    </fieldset>
                  </form>
                ) : (
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => {
                      setOpen(w.id);
                      setMessage("");
                    }}
                  >
                    {w.lifecycle_state === "active" ? "Suspend…" : "Reinstate…"}
                  </button>
                )
              )}
              {w.platform_workspace && (
                <p className="muted">Platform administration workspace.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && (page > 0 || data.hasMore) && (
        <div className="button-row">
          <button className="button secondary" type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <button className="button secondary" type="button" disabled={!data.hasMore} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </section>
  );
}

function AccountLocks() {
  const [data, setData] = useState<any>(null),
    [email, setEmail] = useState(""),
    [error, setError] = useState<Failure>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async (address = "") => {
    setData(
      await governanceApi(
        "/admin/governance/accounts" +
          (address ? "?email=" + encodeURIComponent(address) : ""),
      ),
    );
  }, []);
  useEffect(() => {
    load().catch(setError);
  }, [load]);
  const account = data?.account;
  const activeLock = account?.locks?.find((l: any) => l.status === "active");
  const act = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setError(null);
    setMessage("");
    try {
      await governanceApi(path, "POST", body);
      setMessage(done);
      await load(email);
    } catch (e) {
      setError(e as Failure);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="account-locks">
      <div className="card-heading">
        <h2 id="account-locks">Account locks</h2>
      </div>
      <p className="muted">
        Locking signs the person out everywhere and blocks every sign-in
        method until a Super admin unlocks the account. You cannot lock your
        own account or the last active Super admin.
      </p>
      <form
        className="governance-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          setMessage("");
          load(email).catch(setError);
        }}
      >
        <Field label="Find an account by exact email">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <button className="button secondary" type="submit">
          Find account
        </button>
      </form>
      <GovernanceError error={error} />
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {data && email && !account && !error && (
        <p className="muted">No account uses this email.</p>
      )}
      {account && (
        <div className="governance-item">
          <div className="governance-item-head">
            <div>
              <strong>{account.name}</strong>
              <small className="muted">
                <span dir="ltr">{account.email}</span> · platform role {account.platform_role} ·{" "}
                {account.mfa_enabled ? "authenticator on" : "no authenticator"} ·{" "}
                {account.activeSessions} active session(s)
              </small>
            </div>
            <span className={"badge " + (activeLock ? "amber" : "green")}>
              {activeLock ? "Locked" : "Can sign in"}
            </span>
          </div>
          {account.memberships.length > 0 && (
            <p className="muted">
              Workspaces:{" "}
              {account.memberships
                .map((m: any) => `${m.name} (${m.role}${m.lifecycle_state !== "active" ? ", " + m.lifecycle_state : ""})`)
                .join("; ")}
            </p>
          )}
          {!account.self && !account.email_verified && (
            <form
              className="governance-action"
              onSubmit={(e) => {
                e.preventDefault();
                const reason = new FormData(e.currentTarget).get("reason");
                void act(
                  `/admin/governance/accounts/${account.id}/verify-email`,
                  { reason },
                  "The email address is confirmed.",
                );
                e.currentTarget.reset();
              }}
            >
              <fieldset disabled={busy}>
                <legend>Confirm this email address</legend>
                <p className="muted">
                  The address is not confirmed yet. Confirm it only for an account you know is genuine,
                  such as a test account while email delivery is off.
                </p>
                <Field label="Reason (recorded in the audit log)">
                  <textarea name="reason" required minLength={10} maxLength={1000} rows={2} />
                </Field>
                <button className="button" type="submit">
                  Confirm email
                </button>
              </fieldset>
            </form>
          )}
          {account.self ? (
            <p className="muted">This is your own account.</p>
          ) : (
            <form
              className="governance-action"
              onSubmit={(e) => {
                e.preventDefault();
                const reason = new FormData(e.currentTarget).get("reason");
                if (activeLock)
                  void act(
                    `/admin/governance/accounts/${account.id}/unlock`,
                    { lockId: activeLock.id, revision: activeLock.revision, reason },
                    "The account is unlocked. The person can sign in again.",
                  );
                else
                  void act(
                    `/admin/governance/accounts/${account.id}/lock`,
                    { reason },
                    "The account is locked and every session was signed out.",
                  );
                e.currentTarget.reset();
              }}
            >
              <fieldset disabled={busy}>
                <legend>{activeLock ? "Unlock this account" : "Lock this account"}</legend>
                <Field label="Reason (recorded in the audit log)">
                  <textarea name="reason" required minLength={10} maxLength={1000} rows={3} />
                </Field>
                <button className="button" type="submit">
                  {activeLock ? "Unlock account" : "Lock account"}
                </button>
              </fieldset>
            </form>
          )}
          {account.locks.length > 0 && (
            <details>
              <summary>Lock history</summary>
              <ul className="governance-history">
                {account.locks.map((l: any) => (
                  <li key={l.id}>
                    {when(l.locked_at)} by {l.locked_by}: {l.reason}
                    {l.lifted_at
                      ? ` — unlocked ${when(l.lifted_at)} by ${l.lifted_by}: ${l.lift_reason}`
                      : " — active"}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <h3>Currently locked</h3>
      {!data ? null : data.locked.length === 0 ? (
        <p className="muted">No accounts are locked.</p>
      ) : (
        <ul className="governance-history">
          {data.locked.map((l: any) => (
            <li key={l.id}>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setEmail(l.email);
                  load(l.email).catch(setError);
                }}
              >
                <bdi>{l.name}</bdi> (<span dir="ltr">{l.email}</span>)
              </button>{" "}
              · locked {when(l.locked_at)} by {l.locked_by}: {l.reason}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
