"use client";

/**
 * Super admin, AI model profiles (docs/features/model-profiles.md): saved
 * model connections side by side, and the switch procedure: edit or add a
 * profile, enter its key, test the connection, run the switch check, activate
 * with one click, switch back with one click. Super admin sees real model
 * IDs; coaches only ever see a profile's label.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useConfirmBeforeLeave } from "./workspace-continuity";
import { api, Heading } from "./workspace-ui";

type Check = {
  id: string;
  status: "queued" | "running" | "passed" | "failed" | "error";
  current: boolean;
  score: number | null;
  passed: number | null;
  cases: number | null;
  safetyFailures: number | null;
  validJson: number | null;
  p95Ms: Record<string, number> | null;
  costUsd: number | null;
  reasons: string[];
  completedAt: string | null;
};
type Profile = {
  id: string;
  slug: string;
  name: string;
  label: string;
  tier: "standard" | "frontier";
  adapter: "openai_compatible" | "anthropic";
  role: "active" | "fallback" | null;
  inheritSettings: boolean;
  revision: number;
  settings: Record<string, any>;
  effective: { baseUrl: string | null; model: string | null; source: string };
  key: "settings" | "stored" | "missing" | "unreadable";
  lastTest: { status: string; message: string; checkedAt: string; current: boolean } | null;
  latestCheck: Check | null;
  ready: { key: boolean; tested: boolean; checked: boolean };
};
type Data = { profiles: Profile[]; switchBackTo: string | null; tolerance: number };

const STYLES = ["auto", "classic", "reasoning"];
const EFFORTS = ["auto", "omit", "none", "minimal", "low", "medium", "high"];
const num = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  return t === "" ? null : Number(t);
};

function settingsFrom(f: FormData, inherit: boolean) {
  let budgets: unknown = null;
  const text = String(f.get("budgets") ?? "").trim();
  if (text) budgets = JSON.parse(text);
  const out: Record<string, unknown> = {
    // Disabled fields (an inheriting profile) are not in the form data.
    requestStyle: f.get("requestStyle") ?? undefined,
    reasoningEffort: f.get("reasoningEffort") ?? undefined,
    sendTemperature: f.get("sendTemperature") === "on",
    jsonMode: f.get("jsonMode") === "on",
    vision: f.get("vision") === "on",
    defaultMaxTokens: num(f.get("defaultMaxTokens")),
    budgets,
    inputUsdPerMillion: num(f.get("inputUsdPerMillion")),
    outputUsdPerMillion: num(f.get("outputUsdPerMillion")),
    cacheReadUsdPerMillion: num(f.get("cacheReadUsdPerMillion")),
    cacheWriteUsdPerMillion: num(f.get("cacheWriteUsdPerMillion")),
    priceVersion: String(f.get("priceVersion") ?? "").trim() || null,
  };
  if (!inherit)
    Object.assign(out, {
      baseUrl: String(f.get("baseUrl") ?? "").trim() || undefined,
      model: String(f.get("model") ?? "").trim() || undefined,
      provider: String(f.get("provider") ?? "").trim() || undefined,
    });
  return out;
}

function ProfileForm({
  profile,
  onSubmit,
  busy,
}: {
  profile?: Profile;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
}) {
  const [formError, setFormError] = useState("");
  const [dirty, setDirty] = useState(false);
  useConfirmBeforeLeave(dirty);
  const s = profile?.settings ?? { requestStyle: "auto", reasoningEffort: "auto", sendTemperature: true, jsonMode: true };
  const inherit = !!profile?.inheritSettings;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    setFormError("");
    try {
      const saved = await onSubmit({
        ...(profile ? { revision: profile.revision } : { slug: String(f.get("slug") ?? "").trim() }),
        name: String(f.get("name") ?? "").trim(),
        label: String(f.get("label") ?? "").trim(),
        tier: f.get("tier"),
        adapter: inherit ? "openai_compatible" : f.get("adapter"),
        settings: settingsFrom(f, inherit),
      });
      if (saved) { setDirty(false); if (!profile) form.reset(); }
    } catch {
      setFormError("Budgets must be JSON, for example {\"coach_selection\": {\"maxTokens\": 4000, \"timeoutMs\": 60000}}");
    }
  };
  return (
    <form className="grid-form" onSubmit={submit} onChange={() => setDirty(true)}>
      {formError && <p className="notice error" role="alert">{formError}</p>}
      {!profile && (
        <label>
          Short name (letters, digits, dashes)
          <input name="slug" required pattern="[a-z0-9][a-z0-9-]{1,59}" />
        </label>
      )}
      <label>
        Name (Super admin only)
        <input name="name" defaultValue={profile?.name} required />
      </label>
      <label>
        Label coaches see (never a model or vendor name)
        <input name="label" defaultValue={profile?.label ?? "Frontier model"} required />
      </label>
      <label>
        Tier
        <select name="tier" defaultValue={profile?.tier ?? "frontier"}>
          <option value="standard">Standard</option>
          <option value="frontier">Frontier</option>
        </select>
      </label>
      <label>
        Adapter
        <select name="adapter" defaultValue={profile?.adapter ?? "openai_compatible"} disabled={inherit}>
          <option value="openai_compatible">OpenAI-compatible chat completions</option>
          <option value="anthropic">Native Messages API (prompt caching)</option>
        </select>
      </label>
      {inherit ? (
        <p className="muted">
          Address, key, model ID, request style and prices come from{" "}
          <Link href="/admin/settings">Settings, AI model</Link>.
        </p>
      ) : (
        <>
          <label>
            API base URL
            <input name="baseUrl" type="url" defaultValue={s.baseUrl} required />
          </label>
          <label>
            Model ID
            <input name="model" defaultValue={s.model} required />
          </label>
          <label>
            Provider name for cost records
            <input name="provider" defaultValue={s.provider} />
          </label>
        </>
      )}
      <label>
        Request style
        <select name="requestStyle" defaultValue={s.requestStyle} disabled={inherit}>
          {STYLES.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label>
        Reasoning effort
        <select name="reasoningEffort" defaultValue={s.reasoningEffort} disabled={inherit}>
          {EFFORTS.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" name="sendTemperature" defaultChecked={s.sendTemperature !== false} /> Send each task's
        temperature
      </label>
      <label className="check">
        <input type="checkbox" name="jsonMode" defaultChecked={s.jsonMode !== false} /> JSON mode
      </label>
      <label className="check">
        <input type="checkbox" name="vision" defaultChecked={!!s.vision} disabled={inherit} /> Image input confirmed
      </label>
      <label>
        Answer limit when a task sets none (tokens)
        <input name="defaultMaxTokens" type="number" min={256} max={64000} defaultValue={s.defaultMaxTokens ?? ""} />
      </label>
      <label>
        Per-task budgets (JSON; empty for the automatic ones)
        <textarea name="budgets" rows={3} defaultValue={s.budgets ? JSON.stringify(s.budgets) : ""} />
      </label>
      <label>
        Input price / million (USD)
        <input name="inputUsdPerMillion" type="number" step="0.0001" min={0} defaultValue={s.inputUsdPerMillion ?? ""} disabled={inherit} />
      </label>
      <label>
        Output price / million (USD)
        <input name="outputUsdPerMillion" type="number" step="0.0001" min={0} defaultValue={s.outputUsdPerMillion ?? ""} disabled={inherit} />
      </label>
      <label>
        Cache read price / million (USD)
        <input name="cacheReadUsdPerMillion" type="number" step="0.0001" min={0} defaultValue={s.cacheReadUsdPerMillion ?? ""} />
      </label>
      <label>
        Cache write price / million (USD)
        <input name="cacheWriteUsdPerMillion" type="number" step="0.0001" min={0} defaultValue={s.cacheWriteUsdPerMillion ?? ""} />
      </label>
      <label>
        Price version
        <input name="priceVersion" defaultValue={s.priceVersion ?? ""} disabled={inherit} />
      </label>
      <button className="button" type="submit" disabled={busy}>
        {profile ? "Save profile" : "Add profile"}
      </button>
    </form>
  );
}

function CheckSummary({ check }: { check: Check | null }) {
  if (!check) return <p className="muted">No switch check yet.</p>;
  if (check.status === "queued" || check.status === "running")
    return <p className="notice">Switch check {check.status}… (a few minutes)</p>;
  return (
    <p className={check.status === "passed" ? "notice" : "error"}>
      Switch check {check.status}
      {check.cases !== null && ` · score ${check.passed}/${check.cases}`}
      {check.safetyFailures !== null && ` · safety failures ${check.safetyFailures}`}
      {check.validJson !== null && ` · valid JSON ${check.validJson}/${check.cases}`}
      {check.p95Ms && ` · p95 ${Object.entries(check.p95Ms).map(([k, v]) => `${k} ${Math.round(v / 100) / 10} s`).join(", ")}`}
      {check.costUsd !== null && ` · USD ${check.costUsd}`}
      {!check.current && " · settings changed since (run again)"}
      {check.reasons.length > 0 && ` · ${check.reasons.join("; ")}`}
    </p>
  );
}

export function ModelProfiles() {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const load = useCallback(
    () =>
      api("/admin/model-profiles")
        .then(setData)
        .catch((e) => setMessage(e.message)),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const pending = data?.profiles.some((p) => p.latestCheck && ["queued", "running"].includes(p.latestCheck.status));
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [pending, load]);
  const act = async (fn: () => Promise<any>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await fn();
      setMessage(typeof result?.message === "string" ? result.message : done);
      setEditing(null);
      await load();
      return true;
    } catch (e: any) {
      setMessage(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!data) return <section className="card">{message ?? "Loading model profiles…"}</section>;
  const back = data.profiles.find((p) => p.id === data.switchBackTo);
  return (
    <section className="model-profiles">
      <Link href="/admin/settings" className="ps-back-link">
        Return to settings & connections
      </Link>
      <Heading title="AI model profiles" />
      <p className="muted">
        Add a profile, enter its key, test the connection and run the switch check; then activate it. On activation
        every coach's Brain is checked again on the new model in the background: coaches who pass keep sending
        automatically, the others wait for them and are told. Coaches see only the label. A fallback profile answers
        only when the active one is unavailable, and its answers always go to the coach.
      </p>
      {message && <p role="status" className="notice">{message}</p>}
      {back && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => void act(() => api("/admin/model-profiles/switch-back", "POST"), `Switched back to ${back.name}.`)}
        >
          Switch back to {back.name}
        </button>
      )}
      {data.profiles.map((p) => (
        <article key={p.id} className="card">
          <h3>
            {p.name} {p.role === "active" && <span className="badge">Active</span>}
            {p.role === "fallback" && <span className="badge">Fallback</span>}
          </h3>
          <p>
            Coaches see “{p.label}” · {p.tier} · {p.adapter === "anthropic" ? "native Messages API" : "OpenAI-compatible"}
            {" · "}
            {p.effective.model ?? "no model ID"} at {p.effective.baseUrl ?? "no address"} ({p.effective.source})
          </p>
          <p className="muted">
            Key: {p.key === "settings" ? "from the AI model settings" : p.key}
            {" · "}
            Connection: {p.lastTest ? `${p.lastTest.status}${p.lastTest.current ? "" : " (settings changed since)"}` : p.inheritSettings ? "see Settings, AI model" : "not tested"}
          </p>
          <CheckSummary check={p.latestCheck} />
            {!p.inheritSettings && (
              <form
                className="profile-key-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget, key = String(new FormData(form).get("key") ?? "");
                  if (await act(() => api(`/admin/model-profiles/${p.id}/key`, "PUT", { key }), "Key stored (sealed).")) form.reset();
                }}
              >
                <label className="field"><span>{p.name} API key</span><input name="key" disabled={busy} type="password" autoComplete="off" required minLength={8} /></label>
                <button className="button secondary" disabled={busy}>Save key</button>
              </form>
            )}
          <div className="button-row">
            <button className="button secondary" disabled={busy} onClick={() => setEditing(editing === p.id ? null : p.id)}>
              {editing === p.id ? "Close" : "Edit"}
            </button>
            {!p.inheritSettings && (
              <button className="button secondary" disabled={busy || !p.ready.key} onClick={() => void act(() => api(`/admin/model-profiles/${p.id}/test`, "POST"), "Connection tested.")}>
                Test connection
              </button>
            )}
            <button className="button secondary" disabled={busy || !p.ready.key || !p.ready.tested} onClick={() => void act(() => api(`/admin/model-profiles/${p.id}/check`, "POST"), "Switch check queued.")}>
              Run switch check
            </button>
            {p.role !== "active" && (
              <button className="button" disabled={busy || !p.ready.checked} onClick={() => void act(() => api(`/admin/model-profiles/${p.id}/activate`, "POST"), `${p.name} is active.`)}>
                Activate
              </button>
            )}
            {p.role === null && (
              <button className="button secondary" disabled={busy || !p.ready.key || !p.ready.tested} onClick={() => void act(() => api("/admin/model-profiles/fallback", "PUT", { profileId: p.id }), "Fallback set.")}>
                Use as fallback
              </button>
            )}
            {p.role === "fallback" && (
              <button className="button secondary" disabled={busy} onClick={() => void act(() => api("/admin/model-profiles/fallback", "PUT", { profileId: null }), "Fallback removed.")}>
                Remove fallback
              </button>
            )}
          </div>
          {editing === p.id && (
            <ProfileForm profile={p} busy={busy} onSubmit={(body) => act(() => api(`/admin/model-profiles/${p.id}`, "PUT", body), "Profile saved.")} />
          )}
        </article>
      ))}
      <details className="card">
        <summary>Add a profile</summary>
        <ProfileForm busy={busy} onSubmit={(body) => act(() => api("/admin/model-profiles", "POST", body), "Profile added. Enter its key next.")} />
      </details>
    </section>
  );
}
