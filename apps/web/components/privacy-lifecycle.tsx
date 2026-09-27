"use client";
import { useEffect, useState } from "react";

async function request(path: string, body?: unknown) {
  const r = await fetch("/api/v1" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const value = await r.json();
  if (!r.ok)
    throw new Error(value.message ?? "The request could not be completed");
  return value;
}
function Notice({ text }: { text: string }) {
  return text ? (
    <p className="notice" role="status">
      {text}
    </p>
  ) : null;
}
export function PersonalPrivacyStatus() {
  const [data, setData] = useState<any>(null),
    [message, setMessage] = useState("");
  useEffect(() => {
    void request("/privacy/status")
      .then(setData)
      .catch((e) => setMessage(e.message));
  }, []);
  return (
    <section className="card">
      <h2>Your privacy requests</h2>
      <Notice text={message} />
      <p>
        Local account erasure and provider or backup cleanup are tracked
        separately. Retained financial and consent records follow the applicable
        retention policy.
      </p>
      {data && !data.requests.length && (
        <p className="muted">No deletion request has been submitted.</p>
      )}
      {data?.requests.map((r: any) => (
        <p key={r.id}>
          {r.status.replaceAll("_", " ")} ·{" "}
          {new Date(r.created_at).toLocaleDateString()}
        </p>
      ))}
      {data?.followups.map((f: any) => (
        <p key={f.id}>
          {f.subject}: {f.status} · review by{" "}
          {new Date(f.due_at).toLocaleDateString()}
        </p>
      ))}
    </section>
  );
}
export function WorkspaceLifecycle({ role }: { role: string }) {
  const [data, setData] = useState<any>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () => request("/tenant/lifecycle").then(setData);
  useEffect(() => {
    void load().catch((e) => setMessage(e.message));
  }, []);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const value = await request("/tenant/lifecycle" + path, body);
      if (value.signInRequired) {
        window.location.assign("/login");
        return;
      }
      await load();
      setMessage("Request saved.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>Workspace ownership and closure</h2>
      <p className="muted">
        Verify Account security immediately before these actions. An ownership
        transfer requires the new owner’s password and fresh MFA. Closure needs
        a separate administrator’s review after all financial obligations are
        resolved.
      </p>
      <Notice text={message} />
      {data?.requests.map((r: any) => (
        <article className="card" key={r.id}>
          <h3>{r.kind.replaceAll("_", " ")}</h3>
          <p>
            {r.status} · expires {new Date(r.expires_at).toLocaleDateString()}
          </p>
          {r.status === "pending" &&
            r.target_user_id === data.currentUserId && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act("/" + r.id + "/accept", {
                    expectedRevision: r.revision,
                    password: f.get("password"),
                    acceptResponsibilities: true,
                  });
                }}
              >
                <label className="field">
                  <span>Your current password</span>
                  <input
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <label className="check-field">
                  <input type="checkbox" required />I accept responsibility for
                  this workspace and its clients.
                </label>
                <button className="button" disabled={busy}>
                  Accept ownership
                </button>
              </form>
            )}
          {r.status === "pending" &&
            r.requested_by === data.currentUserId &&
            role === "owner" && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void act("/" + r.id + "/cancel", {
                    expectedRevision: r.revision,
                  })
                }
              >
                Cancel request
              </button>
            )}
        </article>
      ))}
      {role === "owner" && (
        <>
          <h3>Transfer to a team member</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act("/ownership-transfer", {
                targetUserId: f.get("targetUserId"),
                password: f.get("password"),
                reason: f.get("reason"),
              });
            }}
          >
            <label className="field">
              <span>New owner</span>
              <select name="targetUserId" required defaultValue="">
                <option value="" disabled>
                  Choose verified staff
                </option>
                {data?.members
                  .filter((m: any) => m.role === "staff")
                  .map((m: any) => (
                    <option value={m.id} key={m.id}>
                      {m.name} · {m.email}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Reason</span>
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={1000}
              />
            </label>
            <label className="field">
              <span>Current password</span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button className="button" disabled={busy}>
              Request ownership transfer
            </button>
          </form>
          <h3>Close this workspace</h3>
          {!!data?.blockers.length && (
            <p className="notice">
              Resolve:{" "}
              {data.blockers
                .map((b: any) => `${b.kind.replaceAll("_", " ")} (${b.count})`)
                .join(", ")}
              .
            </p>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void act("/closure", {
                password: f.get("password"),
                reason: f.get("reason"),
                confirmClosure: true,
              });
            }}
          >
            <label className="field">
              <span>Closure reason</span>
              <textarea
                name="reason"
                required
                minLength={10}
                maxLength={1000}
              />
            </label>
            <label className="field">
              <span>Current password</span>
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label className="check-field">
              <input type="checkbox" required />I understand that reviewed
              closure removes the app, website and coaching data, ends team
              access, and retains legally required financial records.
            </label>
            <button
              className="button secondary"
              disabled={busy || !!data?.blockers.length}
            >
              Request closure review
            </button>
          </form>
        </>
      )}
    </section>
  );
}
export function PrivacyEvidenceFields() {
  return (
    <>
      <label className="field">
        <span>Provider and source review evidence</span>
        <input
          name="evidenceReference"
          required
          minLength={10}
          maxLength={500}
        />
      </label>
      <label className="field">
        <span>Approved retention policy version</span>
        <input
          name="retentionPolicyVersion"
          required
          minLength={3}
          maxLength={100}
        />
      </label>
      <label className="field">
        <span>Backup purge deadline</span>
        <input name="backupPurgeBy" type="date" required />
      </label>
      <label className="field">
        <span>Financial retention review date</span>
        <input name="retentionReviewBy" type="date" required />
      </label>
      <label className="field">
        <span>Providers requiring cleanup (one per line)</span>
        <textarea
          name="providers"
          maxLength={3000}
          placeholder="Model provider&#10;Email delivery provider"
        />
      </label>
      <label className="check-field">
        <input type="checkbox" required />I reviewed the provider inventory,
        data sources and retention requirements; provider cleanup below remains
        pending until evidence is recorded.
      </label>
    </>
  );
}
export function privacyEvidence(form: FormData, expectedRevision: number) {
  const date = (name: string) =>
    new Date(String(form.get(name)) + "T23:59:59Z").toISOString();
  return {
    expectedRevision,
    providerReviewComplete: true,
    thirdPartySourceReviewComplete: true,
    evidenceReference: form.get("evidenceReference"),
    retentionPolicyVersion: form.get("retentionPolicyVersion"),
    backupPurgeBy: date("backupPurgeBy"),
    retentionReviewBy: date("retentionReviewBy"),
    providers: String(form.get("providers") ?? "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((name) => ({ name, dueAt: date("backupPurgeBy") })),
  };
}
export function PrivacyFollowups({ tenantId }: { tenantId: string }) {
  const [tasks, setTasks] = useState<any[]>([]),
    [closures, setClosures] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const prefix = "/admin/tenants/" + tenantId + "/privacy";
  async function load() {
    const [a, b] = await Promise.all([
      request(prefix + "/followups"),
      request(prefix + "/lifecycle"),
    ]);
    setTasks(a);
    setClosures(b.requests.filter((r: any) => r.kind === "closure"));
  }
  useEffect(() => {
    if (tenantId) void load().catch((e) => setMessage(e.message));
  }, [tenantId]);
  async function act(path: string, body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      await request(prefix + path, body);
      await load();
      setMessage("Evidence saved.");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>Provider, backup and retention follow-ups</h3>
      <Notice text={message} />
      {!tasks.length && (
        <p className="muted">No follow-up tasks for this workspace.</p>
      )}
      {tasks.map((t) => (
        <details key={t.id}>
          <summary>
            {t.subject} · {t.status}
            {t.overdue ? " · overdue" : ""}
          </summary>
          <p>
            Due {new Date(t.due_at).toLocaleDateString()}.{" "}
            {t.evidence_reference ?? ""}
          </p>
          {t.status !== "completed" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void act("/followups/" + t.id, {
                  expectedRevision: t.revision,
                  outcome: f.get("outcome"),
                  evidenceReference: f.get("evidenceReference"),
                  ...(f.get("nextReviewAt")
                    ? {
                        nextReviewAt: new Date(
                          String(f.get("nextReviewAt")) + "T23:59:59Z",
                        ).toISOString(),
                      }
                    : {}),
                });
              }}
            >
              <label className="field">
                <span>Outcome</span>
                <select name="outcome">
                  <option value="completed">Completed with evidence</option>
                  {t.scope === "retention" && (
                    <option value="retained">Continue lawful retention</option>
                  )}
                </select>
              </label>
              <label className="field">
                <span>
                  Provider receipt, purge report or retention evidence
                </span>
                <input
                  name="evidenceReference"
                  required
                  minLength={10}
                  maxLength={1000}
                />
              </label>
              {t.scope === "retention" && (
                <label className="field">
                  <span>Next review if retaining</span>
                  <input name="nextReviewAt" type="date" />
                </label>
              )}
              <button className="button" disabled={busy}>
                Record evidence
              </button>
            </form>
          )}
        </details>
      ))}
      <h3>Workspace closure reviews</h3>
      {!closures.length && <p className="muted">No closure requests.</p>}
      {closures.map((r) => (
        <details key={r.id}>
          <summary>
            {r.status} · {new Date(r.created_at).toLocaleDateString()}
          </summary>
          <p>{r.data.reason}</p>
          {r.status === "pending" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(
                  "/lifecycle/" + r.id + "/close",
                  privacyEvidence(new FormData(e.currentTarget), r.revision),
                );
              }}
            >
              <PrivacyEvidenceFields />
              <button className="button" disabled={busy}>
                Approve and close workspace
              </button>
            </form>
          )}
        </details>
      ))}
    </section>
  );
}
