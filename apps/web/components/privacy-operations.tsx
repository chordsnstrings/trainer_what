"use client";
import { useEffect, useState } from "react";
export function PrivacyOperations({ tenants }: { tenants: any[] }) {
  const [tenant, setTenant] = useState(tenants[0]?.id ?? ""),
    [rows, setRows] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function request(path = "", body?: unknown) {
    const r = await fetch(`/api/v1/admin/tenants/${tenant}/privacy${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message);
    return data;
  }
  useEffect(() => {
    if (tenant)
      void request()
        .then(setRows)
        .catch((e) => setMessage(e.message));
  }, [tenant]);
  return (
    <section className="card">
      <h2>Privacy requests</h2>
      <p className="muted">
        Resolve subscriptions and provider/source reviews before local erasure.
        Financial and consent references follow the recorded retention policy.
      </p>
      <label className="field">
        <span>Workspace</span>
        <select value={tenant} onChange={(e) => setTenant(e.target.value)}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {!rows.length && <p className="muted">No privacy requests.</p>}
      {rows.map((r) => (
        <details key={r.id}>
          <summary>
            {r.name} · {r.status.replaceAll("_", " ")}
          </summary>
          {r.status !== "local_erasure_completed" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                setBusy(true);
                try {
                  await request("/" + r.id + "/erase", {
                    providerReviewComplete: true,
                    thirdPartySourceReviewComplete: true,
                    evidenceReference: f.get("evidenceReference"),
                    retentionPolicyVersion: f.get("retentionPolicyVersion"),
                    backupPurgeBy: new Date(
                      String(f.get("backupPurgeBy")) + "T23:59:59Z",
                    ).toISOString(),
                  });
                  setRows(await request());
                  setMessage(
                    "Local erasure completed. Track the recorded backup and provider review evidence.",
                  );
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                <span>Provider and data-source review evidence</span>
                <input name="evidenceReference" minLength={10} required />
              </label>
              <label className="field">
                <span>Approved retention policy version</span>
                <input name="retentionPolicyVersion" minLength={3} required />
              </label>
              <label className="field">
                <span>Scheduled backup purge deadline</span>
                <input name="backupPurgeBy" type="date" required />
              </label>
              <label className="check-field">
                <input type="checkbox" required />I verified provider handling,
                reviewed trainer sources for this person's data, and recorded
                the lawful retention requirements.
              </label>
              <button className="button" disabled={busy}>
                Erase subscriber’s local coaching data
              </button>
            </form>
          )}
        </details>
      ))}
    </section>
  );
}
