"use client";
import { useEffect, useState } from "react";
async function request(path: string, method = "GET", body?: unknown) {
  const r = await fetch("/api/v1/team" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message ?? "Team request failed.");
  return data;
}
export function TeamControls({ role }: { role: string }) {
  const [data, setData] = useState<any>(null),
    [notice, setNotice] = useState(""),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () => request("").then(setData);
  useEffect(() => {
    if (role === "owner") void load().catch((e) => setNotice(e.message));
  }, [role]);
  async function act(path: string, method: string, body: unknown) {
    setBusy(true);
    try {
      const result = await request(path, method, body);
      await load();
      setNotice("Team access updated.");
      if (result.url) setUrl(result.url);
      return result;
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (role !== "owner")
    return (
      <section className="card">
        <h1>Team administration</h1>
        <p>The workspace owner manages team access.</p>
      </section>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PEOPLE AND ACCESS</p>
          <h1>Your team.</h1>
          <p className="muted">
            Verify your authenticator in{" "}
            <a href="/trainer/settings">Account settings</a> before managing
            access. Role changes revoke this workspace’s active sessions
            immediately.
          </p>
        </div>
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <section className="card">
        <h2>Invite a team member</h2>
        <p className="muted">
          Coaching staff manage clients and sessions. Finance staff handle
          billing and statements. Neither role can manage ownership or team
          access.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void act("/invitations", "POST", {
              email: f.get("email"),
              role: f.get("role"),
            });
          }}
        >
          <label className="field">
            <span>Email</span>
            <input name="email" type="email" required />
          </label>
          <label className="field">
            <span>Access</span>
            <select name="role">
              <option value="staff">Coaching staff</option>
              <option value="finance">Finance</option>
            </select>
          </label>
          <button className="button" disabled={busy}>
            Create invitation
          </button>
        </form>
        {url && (
          <div className="notice">
            <p>
              Invitation created. Share this one-time link with the invited
              person; it expires in seven days.
            </p>
            <input
              aria-label="Invitation link"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
            />
          </div>
        )}
      </section>
      <section className="card">
        <h2>Current team</h2>
        {data?.members.map((m: any) => (
          <article key={m.id} className="list-row">
            <div>
              <strong>{m.name}</strong>
              <p>
                {m.email} · {m.role}
              </p>
              <p className="muted">
                Authenticator: {m.mfa_enabled ? "enabled" : "not enabled"} ·
                Passkeys: {m.passkeys ?? "unavailable"} · Last active:{" "}
                {m.last_active
                  ? new Date(m.last_active).toLocaleString()
                  : "No recorded activity"}{" "}
                · Last sign-in:{" "}
                {m.last_sign_in
                  ? new Date(m.last_sign_in).toLocaleString()
                  : "No active session"}
              </p>
            </div>
            {m.role !== "owner" && m.id !== data.currentUserId && (
              <details>
                <summary>Change access</summary>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act("/" + m.id, "PATCH", {
                      revision: m.version,
                      role: f.get("role"),
                      reason: f.get("reason"),
                    });
                  }}
                >
                  <label className="field">
                    <span>Role</span>
                    <select name="role" defaultValue={m.role}>
                      <option value="staff">Coaching staff</option>
                      <option value="finance">Finance</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Reason</span>
                    <input
                      name="reason"
                      minLength={5}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <button className="button" disabled={busy}>
                    Save role
                  </button>
                </form>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act("/" + m.id, "DELETE", {
                      revision: m.version,
                      reason: f.get("reason"),
                    });
                  }}
                >
                  <label className="field">
                    <span>Reason to revoke access</span>
                    <input
                      name="reason"
                      minLength={5}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <button className="button secondary" disabled={busy}>
                    Revoke workspace access
                  </button>
                </form>
              </details>
            )}
          </article>
        ))}
        {data && !data.members.length && (
          <p className="muted">No team members.</p>
        )}
      </section>
      <section className="card">
        <h2>Outstanding invitations</h2>
        {data?.invitations.map((i: any) => (
          <div className="list-row" key={i.id}>
            <div>
              <strong>{i.email}</strong>
              <p>
                {i.role} · expires {new Date(i.expires_at).toLocaleString()}
              </p>
            </div>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void act(`/invitations/${i.id}/revoke`, "POST", {
                  reason: "Owner revoked outstanding invitation",
                })
              }
            >
              Revoke invitation
            </button>
          </div>
        ))}
        {data && !data.invitations.length && (
          <p className="muted">No outstanding invitations.</p>
        )}
      </section>
      <section className="card">
        <h2>Access audit</h2>
        {data?.audit.map((e: any) => (
          <div className="list-row" key={e.id}>
            <div>
              <strong>
                {e.name.replaceAll("team.", "").replaceAll("_", " ")}
              </strong>
              <p>
                {new Date(e.created_at).toLocaleString()} ·{" "}
                {e.data.reason ?? e.data.email ?? e.subject_id}
              </p>
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
