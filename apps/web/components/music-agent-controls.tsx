"use client";
import { useEffect, useState } from "react";
import { api } from "./workspace-ui";
export type MusicAgentData = {
  enabled: boolean;
  auto_publish: boolean;
  recovery_confirmed: boolean;
  request_limit: number;
  credit_limit: number;
  external_requests: number;
  external_credits: number;
  model_call_limit: number;
  model_usd_limit: number;
  usedRequests: number;
  reservedCredits: number;
  modelCalls: number;
  reservedModelUsd: number;
  status: string;
  message: string | null;
  checked_at: string | null;
};
export type MusicPlanData = {
  id: string;
  playlist: string;
  status: string;
  error?: string;
};
const values = (a: MusicAgentData) => ({
  enabled: a.enabled,
  autoPublish: a.auto_publish,
  recoveryConfirmed: a.recovery_confirmed,
  requestLimit: Number(a.request_limit),
  creditLimit: Number(a.credit_limit),
  externalRequests: Number(a.external_requests),
  externalCredits: Number(a.external_credits),
  modelCallLimit: Number(a.model_call_limit),
  modelUsdLimit: Number(a.model_usd_limit),
});
type Act = (fn: () => Promise<unknown>, message: string) => Promise<boolean>;
export function MusicAgentControls({
  agent,
  plans,
  busy,
  act,
}: {
  agent: MusicAgentData;
  plans: MusicPlanData[];
  busy: boolean;
  act: Act;
}) {
  const [draft, setDraft] = useState(() => values(agent)),
    [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(values(agent));
  }, [agent, dirty]);
  const set = (key: keyof typeof draft, value: number | boolean) => {
    setDirty(true);
    setDraft((d) => ({ ...d, [key]: value }));
  };
  const save = async (enabled: boolean) => {
    if (
      await act(
        () => api("/admin/music/agent", "POST", { ...draft, enabled }),
        enabled
          ? "Music agent started. You can close this page; work continues on the server."
          : "Settings saved. Music agent paused.",
      )
    )
      setDirty(false);
  };
  return (
    <section
      className="card stack music-agent"
      aria-labelledby="music-agent-title"
    >
      <div className="card-heading">
        <h2 id="music-agent-title">Music agent</h2>
        <span className="badge">
          {agent.enabled ? agent.status.replaceAll("_", " ") : "Paused"}
        </span>
      </div>
      <p>
        The frontier model plans varied instrumentals in small batches. The
        server generates, downloads and saves MP3s across all eight genres. It
        stops at 30 available songs per playlist and fills gaps within your
        limits.
      </p>
      <div className="music-agent-metrics">
        <div>
          <strong>
            {agent.usedRequests} / {agent.request_limit}
          </strong>
          <span>Requests reserved</span>
        </div>
        <div>
          <strong>
            {Number(agent.reservedCredits).toLocaleString()} /{" "}
            {Number(agent.credit_limit).toLocaleString()}
          </strong>
          <span>Music credits reserved</span>
        </div>
        <div>
          <strong>
            {agent.modelCalls} / {agent.model_call_limit}
          </strong>
          <span>AI planning calls</span>
        </div>
        <div>
          <strong>
            ${Number(agent.reservedModelUsd).toFixed(3)} / $
            {Number(agent.model_usd_limit).toFixed(2)}
          </strong>
          <span>AI allowance reserved</span>
        </div>
      </div>
      {agent.message && (
        <p className="notice" role="status">
          {agent.message}
        </p>
      )}
      {agent.checked_at && (
        <p className="muted">
          Last worker check: {new Date(agent.checked_at).toLocaleString()}
        </p>
      )}
      {agent.enabled && (
        <div className="button-row">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  api("/admin/music/agent", "POST", {
                    ...values(agent),
                    enabled: false,
                  }),
                "Agent paused. Already-paid music will finish downloading.",
              )
            }
          >
            Pause agent
          </button>
        </div>
      )}
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void save(true);
        }}
      >
        <label className="voice-check">
          <input
            type="checkbox"
            checked={draft.autoPublish}
            onChange={(e) => set("autoPublish", e.target.checked)}
          />
          Publish checked MP3s automatically
        </label>
        <p className="muted">
          Automatic checks decode files, check duration and long silences,
          remove duplicates, and normalize volume. They verify the provider's
          instrumental setting; they do not listen for vocals or judge musical
          quality. Turn this off for listening review before publication.
        </p>
        <details>
          <summary>Budgets and previous purchases</summary>
          <div className="music-agent-fields">
            <label>
              Total generation requests
              <input
                type="number"
                min="1"
                required
                value={draft.requestLimit}
                onChange={(e) => set("requestLimit", Number(e.target.value))}
              />
            </label>
            <label>
              Total music credits
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={draft.creditLimit}
                onChange={(e) => set("creditLimit", Number(e.target.value))}
              />
            </label>
            <label>
              Requests made outside this app
              <input
                type="number"
                min={Number(agent.external_requests)}
                required
                value={draft.externalRequests}
                onChange={(e) =>
                  set("externalRequests", Number(e.target.value))
                }
              />
            </label>
            <label>
              Credits reserved outside this app
              <input
                type="number"
                min={Number(agent.external_credits)}
                step="0.01"
                required
                value={draft.externalCredits}
                onChange={(e) => set("externalCredits", Number(e.target.value))}
              />
            </label>
            <label>
              Total AI planning calls
              <input
                type="number"
                min="1"
                required
                value={draft.modelCallLimit}
                onChange={(e) => set("modelCallLimit", Number(e.target.value))}
              />
            </label>
            <label>
              Total AI allowance (USD)
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={draft.modelUsdLimit}
                onChange={(e) => set("modelUsdLimit", Number(e.target.value))}
              />
            </label>
          </div>
          <p className="muted">
            Totals include previous purchases and never reset when you pause or
            restart. Count imported tasks under outside-app purchases. Daily
            music limits are in Settings; AI planning is limited to eight
            batches daily. No automatic credit purchases.
          </p>
        </details>
        <label className="voice-check">
          <input
            type="checkbox"
            required
            checked={draft.recoveryConfirmed}
            onChange={(e) => set("recoveryConfirmed", e.target.checked)}
          />
          Earlier purchases are imported and reconciled, and their usage is
          included above.
        </label>
        <div className="button-row">
          <button className="button" disabled={busy}>
            {busy
              ? "Saving…"
              : agent.enabled
                ? "Save agent settings"
                : "Start music agent"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => void save(false)}
          >
            Save paused
          </button>
        </div>
      </form>
      {plans
        .filter((p) => ["failed", "unknown"].includes(p.status))
        .map((p) => (
          <div key={p.id} className="notice">
            <p>
              {p.playlist}: {p.error}
            </p>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void act(
                  () => api(`/admin/music/plans/${p.id}/standard`, "POST", {}),
                  "Standard arrangements saved. No new AI call; the original cost reservation remains.",
                )
              }
            >
              Use standard arrangements
            </button>
          </div>
        ))}
    </section>
  );
}
