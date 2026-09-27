"use client";
import { useEffect, useState } from "react";
import {
  PrivacyEvidenceFields,
  PrivacyFollowups,
  privacyEvidence,
} from "./privacy-lifecycle";
export function PrivacyOperations({ tenants }: { tenants: any[] }) {
  const [tenant, setTenant] = useState(tenants[0]?.id ?? ""),
    [rows, setRows] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0);
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
        Verify Account security before processing requests. Resolve billing and
        booking obligations first. Local erasure creates separate provider,
        backup and retention evidence tasks.
      </p>
      <label className="field">
        <span>Workspace</span>
        <select
          value={tenant}
          onChange={(e) => {
            setTenant(e.target.value);
            setMessage("");
          }}
        >
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
                setBusy(true);
                const form = new FormData(e.currentTarget);
                try {
                  await request(
                    "/" + r.id + "/erase",
                    privacyEvidence(form, r.version),
                  );
                  setRows(await request());
                  setRevision((x) => x + 1);
                  setMessage(
                    "Local erasure completed. Provider and backup tasks remain open until evidence is recorded.",
                  );
                } catch (e) {
                  setMessage((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <PrivacyEvidenceFields />
              <button className="button" disabled={busy}>
                Erase member’s local coaching data
              </button>
            </form>
          )}
        </details>
      ))}
      {tenant && (
        <PrivacyFollowups key={tenant + ":" + revision} tenantId={tenant} />
      )}
    </section>
  );
}
