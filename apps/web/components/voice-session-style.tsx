"use client";
// The trainer's voice-session style: the Brain material the voice coach speaks
// from (tone, the trainer's own phrases, adjustment rules), Brain wording
// suggestions the trainer reviews (none is spoken until the trainer saves it),
// a preview of the script and members' recent session outcomes.
import { useCallback, useEffect, useState } from "react";
import { phraseIssues } from "../../../packages/domain/src/voice-session.ts";
/** Fired when either voice panel saves the shared, versioned voice style. */
export const VOICE_STYLE_SAVED = "voice-style-saved";

type Style = {
  tone: "calm" | "steady" | "energetic";
  intro: string[];
  warmup: string[];
  encouragement: string[];
  formReminders: string[];
  cooldown: string[];
  finish: string[];
  adjustments: { tooHeavyReducePercent: number; allowSkip: boolean };
};
type Suggestions = Partial<Record<"intro" | "warmup" | "encouragement" | "cooldown" | "finish", string[]>>;
const FIELDS: Array<[keyof Style, string, string]> = [
  ["intro", "Opening lines", "How you greet a client at the start."],
  ["warmup", "Warm-up prompts", "Ask them to say done when warm."],
  ["encouragement", "Encouragement", "Spoken after a logged set."],
  ["formReminders", "Form reminders", "General technique reminders."],
  ["cooldown", "Cool-down", "After the final set."],
  ["finish", "Sign-off", "The last line of the session."],
];
const ISSUE_TEXT: Record<string, string> = {
  number: "numbers (the app adds every number from the plan)",
  medical: "medical or treatment wording",
  red_flag: "safety terms (the app handles pain and symptoms itself)",
  prescription_change: "changes to sets, reps, weight or rest, or training to failure",
  unsafe_technique: "unsafe technique (for example holding your breath or rounding the back)",
  link: "links or addresses",
  unsupported_characters: "symbols or markup",
  too_long: "more than 200 characters",
  empty: "an empty line",
};
async function call(path: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/v1" + path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? "The request failed.");
  return data;
}
const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function VoiceSessionStyle() {
  const [revision, setRevision] = useState(0),
    [style, setStyle] = useState<Style | null>(null),
    [drafts, setDrafts] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<any>(null),
    [outcomes, setOutcomes] = useState<any[]>([]),
    [suggestions, setSuggestions] = useState<Suggestions | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await call("/voice-sessions/style");
    setRevision(r.version);
    setStyle(r.style);
    setDrafts(Object.fromEntries(FIELDS.map(([key]) => [key, (r.style[key] as string[]).join("\n")])));
    setSuggestions(r.suggestions ?? null);
    const o = await call("/voice-sessions/outcomes").catch(() => ({ sessions: [] }));
    setOutcomes(o.sessions);
  }, []);
  useEffect(() => {
    void load().catch((e) => setNotice(e.message));
  }, [load]);
  // The one-on-one panel saves into the same versioned style.
  useEffect(() => {
    const saved = (e: Event) => {
      const version = (e as CustomEvent<{ version: number }>).detail?.version;
      if (typeof version === "number") setRevision(version);
    };
    window.addEventListener(VOICE_STYLE_SAVED, saved);
    return () => window.removeEventListener(VOICE_STYLE_SAVED, saved);
  }, []);
  if (!style) return notice ? <p className="notice">{notice}</p> : null;
  const draft = (): Style => ({
    ...style,
    ...Object.fromEntries(FIELDS.map(([key]) => [key, lines(drafts[key] ?? "")])),
  });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };
  // The same wording checks the server applies, shown while typing.
  const problems = (key: string) =>
    lines(drafts[key] ?? "")
      .map((text, index) => ({ index, issues: phraseIssues(text) }))
      .filter((p) => p.issues.length);
  const blocked = FIELDS.some(([key]) => problems(key).length > 0);
  return (
    <>
      <section className="card voice-style" aria-labelledby="voice-style-title">
        <h2 id="voice-style-title">Voice-led sessions</h2>
        <p className="muted">
          Members with premium voice can be coached through a whole workout in
          your approved voice. The app writes every set, rep, weight and rest
          from their plan; your words below set the tone. Pain and symptoms
          always stop the session and come to you.
        </p>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const saved = await call("/voice-sessions/style", "PUT", { revision, style: draft() });
              setRevision(saved.version);
              // "Your one-on-one sessions" shares this version (voice-one-on-one.tsx).
              window.dispatchEvent(new CustomEvent(VOICE_STYLE_SAVED, { detail: { version: saved.version } }));
              setStyle(saved.style);
              setSuggestions(saved.suggestions ?? null);
              setNotice(`Saved as version ${saved.version}. New sessions use it.`);
            });
          }}
        >
          <label>
            <span>Tone</span>
            <select
              value={style.tone}
              onChange={(e) => setStyle({ ...style, tone: e.target.value as Style["tone"] })}
            >
              <option value="calm">Calm</option>
              <option value="steady">Steady</option>
              <option value="energetic">Energetic</option>
            </select>
          </label>
          {FIELDS.map(([key, label, help]) => {
            const found = problems(key);
            return (
              <label key={key}>
                <span>{label}</span>
                <small className="muted">{help} One line each.</small>
                <textarea
                  rows={3}
                  value={drafts[key] ?? ""}
                  aria-invalid={found.length > 0}
                  onChange={(e) => setDrafts({ ...drafts, [key]: e.target.value })}
                />
                {found.map((i) => (
                  <small key={i.index} className="voice-issue" role="alert">
                    Line {i.index + 1} cannot be spoken: {i.issues.map((x) => ISSUE_TEXT[x] ?? x).join(", ")}.
                  </small>
                ))}
              </label>
            );
          })}
          <label>
            <span>When a client says “too heavy”, lower the next set by up to (%)</span>
            <input
              type="number"
              min={0}
              max={20}
              value={style.adjustments.tooHeavyReducePercent}
              onChange={(e) =>
                setStyle({
                  ...style,
                  adjustments: {
                    ...style.adjustments,
                    tooHeavyReducePercent: Math.max(0, Math.min(20, Math.round(Number(e.target.value) || 0))),
                  },
                })
              }
            />
            <small className="muted">
              Off (0) until you choose a number: the planned weight is kept and
              “too heavy” comes to you as feedback. Reps and sets are never raised.
            </small>
          </label>
          <label className="voice-check">
            <input
              type="checkbox"
              checked={style.adjustments.allowSkip}
              onChange={(e) =>
                setStyle({ ...style, adjustments: { ...style.adjustments, allowSkip: e.target.checked } })
              }
            />{" "}
            Clients may say “skip” to skip a set or exercise (off until you allow it)
          </label>
          <div className="button-row">
            <button className="button" disabled={busy || blocked}>
              Save voice style
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => setPreview(await call("/voice-sessions/style/preview", "POST", { style: draft() })))
              }
            >
              Preview a session
            </button>
          </div>
        </form>
        <div className="voice-suggestions stack">
          <h3>Brain suggestions</h3>
          <p className="muted">
            The Brain can suggest lines in your style from your published
            communication rules. Nothing it writes is spoken until you add it
            to your phrases above and save. No client data is sent.
          </p>
          <div className="button-row">
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await call("/voice-sessions/style/suggestions", "POST");
                  setSuggestions(r.suggestions);
                  if (r.version !== undefined && revision === 0) setRevision(r.version);
                  if (r.rejected?.length)
                    setNotice(`${r.rejected.length} suggested line(s) failed the wording checks and were dropped.`);
                })
              }
            >
              Suggest lines
            </button>
            {suggestions && FIELDS.some(([key]) => (suggestions as any)[key]?.length) && (
              <button
                className="text-button"
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await call("/voice-sessions/style/suggestions", "DELETE");
                    setSuggestions(null);
                  })
                }
              >
                Dismiss suggestions
              </button>
            )}
          </div>
          {suggestions &&
            FIELDS.filter(([key]) => (suggestions as any)[key]?.length).map(([key, label]) => (
              <div key={key}>
                <strong>{label}</strong>
                <ul className="voice-outcomes">
                  {((suggestions as any)[key] as string[]).map((text) => (
                    <li key={text}>
                      {text}{" "}
                      {lines(drafts[key] ?? "").includes(text) ? (
                        <small className="muted">added (save to use it)</small>
                      ) : (
                        <button
                          className="text-button"
                          type="button"
                          onClick={() =>
                            setDrafts({ ...drafts, [key]: [...lines(drafts[key] ?? ""), text].join("\n") })
                          }
                        >
                          Add to my phrases
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
        {preview && (
          <div className="voice-preview">
            <h3>Preview</h3>
            <ol>
              {preview.lines.map((l: any) => (
                <li key={l.id}>
                  <span className="badge">{l.owner === "code" ? "from the plan" : "your words"}</span>{" "}
                  {l.text}
                </li>
              ))}
            </ol>
            {preview.rejected.length > 0 && (
              <p className="muted">{preview.rejected.length} line(s) were replaced by a safe default.</p>
            )}
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="voice-outcomes">
        <h2 id="voice-outcomes">Recent voice sessions</h2>
        {outcomes.length ? (
          <ul className="voice-outcomes">
            {outcomes.map((s) => {
              const t = s.outcomes?.totals ?? {};
              return (
                <li key={s.id}>
                  <strong>{s.member ?? "Member"}</strong> · {s.mode === "voice" ? "voice" : "text"} ·{" "}
                  {s.endReason ?? s.status} · {t.set_logged ?? 0} sets logged
                  {t.adjusted ? ` · ${t.adjusted} lighter` : ""}
                  {t.too_heavy_kept ? ` · ${t.too_heavy_kept} “too heavy” kept` : ""}
                  {t.too_easy ? ` · ${t.too_easy} “too easy”` : ""}
                  {t.skipped_set || t.skipped_exercise
                    ? ` · ${(t.skipped_set ?? 0) + (t.skipped_exercise ?? 0)} skipped`
                    : ""}
                  {t.not_done ? ` · ${t.not_done} “not done” to review` : ""}
                  {t.pain ? " · pain reported" : ""}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">No voice sessions yet.</p>
        )}
      </section>
    </>
  );
}
