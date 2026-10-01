"use client";

/**
 * Super admin, Home page assistant (docs/features/kamran-assistant.md):
 * switch Kamran's AI voice on or off, set the daily spend cap in AED, choose
 * the voice from the connected Cartesia account (default: the voice named
 * Kamran), and see today's counts and cost. Settings are saved through the
 * standard settings endpoint (Settings, Home page voice assistant).
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { api } from "./workspace-ui";

type Data = {
  settings: { enabled: boolean; dailyCapAed: number; voiceId: string | null };
  revision: number;
  readiness: { ready: boolean; reasons: string[] };
  voices: Array<{ id: string; name: string }> | null;
  voicesError: string | null;
  defaultVoice: { id: string; name: string } | null;
  voiceInUse: string | null;
  today: {
    day: string;
    turns: number;
    costAed: number;
    capAed: number;
    capReached: boolean;
    hiddenUntil: string | null;
    modelInputTokens: number;
    modelOutputTokens: number;
    modelUsd: number;
    sttSeconds: number;
    sttUsd: number;
    ttsCharacters: number;
    ttsUsd: number;
    screened: number;
    handoffs: number;
    refused: number;
  };
};

const usd = (n: number) => `USD ${n.toFixed(4)}`;

export function MarketingAssistantAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api("/admin/marketing-assistant"));
    } catch (error) {
      setMessage((error as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!data) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setMessage(null);
    try {
      await api("/admin/settings/marketing_assistant", "PUT", {
        revision: data.revision,
        enabled: true,
        values: {
          MARKETING_ASSISTANT_ENABLED: f.get("enabled") === "on" ? "true" : "false",
          MARKETING_ASSISTANT_DAILY_AED: String(f.get("cap") ?? "10"),
          MARKETING_ASSISTANT_VOICE_ID: String(f.get("voice") ?? ""),
        },
      });
      setMessage("Saved.");
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <section className="card">{message ?? "Loading the home page assistant…"}</section>;
  const t = data.today;
  return (
    <section className="card marketing-assistant-admin">
      <h2>Home page assistant</h2>
      <p>
        Kamran&apos;s AI voice on the home page answers visitors from the site&apos;s own pages and
        calculators. No audio or words are stored; only today&apos;s counts and cost.
      </p>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <p className="notice">
        {data.readiness.ready
          ? t.capReached
            ? `On, but hidden until ${new Date(t.hiddenUntil ?? "").toLocaleString()}: today's cap is reached.`
            : "On and shown on the home page."
          : `Not shown: ${data.readiness.reasons.join(" ")}`}
      </p>
      <form className="grid-form" onSubmit={save}>
        <label>
          <input type="checkbox" name="enabled" defaultChecked={data.settings.enabled} /> Show the
          voice assistant on the home page
        </label>
        <label>
          Daily spend cap (AED)
          <input name="cap" type="number" min={0.5} max={1000} step={0.5} defaultValue={data.settings.dailyCapAed} required />
        </label>
        <label>
          Marketing assistant voice
          <select name="voice" defaultValue={data.settings.voiceId ?? ""}>
            <option value="">
              {data.defaultVoice ? `Default: ${data.defaultVoice.name}` : "Default: the voice named Kamran (not found)"}
            </option>
            {(data.voices ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.id})
              </option>
            ))}
          </select>
        </label>
        {data.voicesError && <p className="notice">{data.voicesError}</p>}
        <button className="button" type="submit" disabled={busy}>
          Save
        </button>
      </form>
      <h3>Today ({t.day}, UAE)</h3>
      <dl className="marketing-assistant-today">
        <dt>Spend</dt>
        <dd>
          AED {t.costAed.toFixed(2)} of {t.capAed.toFixed(2)}
        </dd>
        <dt>Spoken turns</dt>
        <dd>{t.turns}</dd>
        <dt>Model</dt>
        <dd>
          {t.modelInputTokens.toLocaleString()} in / {t.modelOutputTokens.toLocaleString()} out tokens, {usd(t.modelUsd)}
        </dd>
        <dt>Speech-to-text</dt>
        <dd>
          {t.sttSeconds.toFixed(1)} s, {usd(t.sttUsd)}
        </dd>
        <dt>Voice</dt>
        <dd>
          {t.ttsCharacters.toLocaleString()} characters, {usd(t.ttsUsd)}
        </dd>
        <dt>Replies replaced by a safe line</dt>
        <dd>{t.screened}</dd>
        <dt>Taken to Start coaching</dt>
        <dd>{t.handoffs}</dd>
        <dt>Refused (cap or visitor limits)</dt>
        <dd>{t.refused}</dd>
      </dl>
      <p>
        <Link href="/admin/settings">All settings</Link> · <Link href="/admin/model-profiles">AI model profiles</Link>
      </p>
    </section>
  );
}
