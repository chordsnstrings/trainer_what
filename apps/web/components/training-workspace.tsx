"use client";
import { ClientTwin } from "./client-twin";
import { trainingWeek } from "../lib/training-week";
import { memberApiUrl } from "../lib/trainer-preview-routing";
import { useWorkspaceValue } from "./workspace-continuity";
import { promptWorkspace } from "./workspace-feedback";
import { Field } from "./field";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "./preview-navigation";
import { TrainingHoldNotice } from "./coaching-completion";
import { ChatAttachmentList, ChatAttachmentPicker, type ChatAttachment } from "./chat-attachments";
import { CoachingFollowups } from "./coaching-followups";
import { HealthKitActivityCard } from "./healthkit-sync";
import { MemberFinder, withPicked, type MemberOption } from "./member-finder";
import { MemberPlan } from "./brain-plans";
import { prescriptionText, workMeasure } from "../../../packages/domain/src/prescription.ts";
import { ResponsiveTable, Skeleton } from "./phone-ui";
import { MemberChat } from "./member-chat";
import { ConversationIdentity, ConversationLegend, conversationKind } from "./conversation-identity";
import { useConversationScroll } from "./use-conversation-scroll";
import { ArrowDown, Send } from "lucide-react";
import { useErrorText, useLocale, useT } from "../lib/i18n/react";
import { errorText } from "../lib/i18n/errors";
import {
  calendarDate,
  formatDate,
  formatDateTime,
  formatCountdown,
  formatSetsReps,
  zoneName,
} from "../lib/format";
import type { Locale } from "../lib/i18n/core";

/** The page language, for messages built outside a component. */
function pageLocale(): Locale {
  return typeof document !== "undefined" &&
    document.documentElement.lang === "ar"
    ? "ar"
    : "en";
}

async function api(path: string, method = "GET", body?: unknown) {
  const r = await fetch(memberApiUrl("/api/v1" + path), { method, credentials: "same-origin", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(d.message ?? "Request failed"); return d;
}

function useTraining(userId?: string) {
  const [data, setData] = useState<any>(), [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const load = useCallback(async () => { const result = await api("/training/overview" + (userId ? "?subscriberId=" + userId : "")); setData(result); return result; }, [userId]);
  useEffect(() => { void load().catch((e) => setError(errorText(e, pageLocale()))); }, [load]);
  async function action(fn: () => Promise<any>, success?: string) { setBusy(true); setError(""); setMessage(""); try { const r = await fn(); await load(); setMessage(success ?? (pageLocale() === "ar" ? "تم الحفظ" : "Saved")); return r; } catch (e) { setError(errorText(e, pageLocale())); return null; } finally { setBusy(false); } }
  return { data, busy, message, error, action, load };
}
const exercise = () => ({ instanceId: crypto.randomUUID(), block: "main", side: "both", name: "", sets: 3, reps: 10, restSeconds: 90, loadKg: 0, rir: 2, cue: "", demonstrationUrl: "", alternatives: [] as any[] });
function cleanExercise(e: any) { const { demonstrationUrl, measure, reps, durationSeconds, distanceMeters, ...rest } = e; const kind = measure ?? workMeasure(e); return { ...rest, ...(kind === "time" ? { durationSeconds: durationSeconds ?? 60 } : kind === "distance" ? { distanceMeters: distanceMeters ?? 500 } : { reps: reps ?? 10 }), ...(demonstrationUrl ? { demonstrationUrl } : {}) }; }
function ExerciseEditor({ values, onChange, library }: { values: any[]; onChange: (values: any[]) => void; library: any[] }) {
  const patch = (i: number, key: string, value: any) => onChange(values.map((e, j) => j === i ? { ...e, [key]: value } : e));
  return <div>{values.map((e, i) => <fieldset key={i} style={{ marginBlock: 16 }}><legend>Exercise {i + 1}</legend>
    {library.length > 0 && <Field label="Use a library exercise"><select value="" onChange={(event) => { const found = library.find((v) => v.id === event.target.value); if (found) { const { allowedUses, ...prescription } = found.data; onChange(values.map((v, j) => j === i ? { ...exercise(), ...prescription, instanceId: crypto.randomUUID() } : v)); } }}><option value="">Choose an exercise</option>{library.map((v) => <option key={v.id} value={v.id}>{v.data.name}</option>)}</select></Field>}
    <div className="form-grid"><Field label="Work measure"><select value={e.measure ?? workMeasure(e)} onChange={event => patch(i,"measure",event.target.value)}><option value="reps">Repetitions</option><option value="time">Time</option><option value="distance">Distance</option></select></Field>
    <Field label="Block"><select value={e.block ?? "main"} onChange={event => patch(i,"block",event.target.value)}><option value="warmup">Warm-up</option><option value="main">Main work</option><option value="cooldown">Cool-down</option></select></Field>
    <Field label="Side"><select value={e.side ?? "both"} onChange={event => patch(i,"side",event.target.value)}><option value="both">Both / not applicable</option><option value="left">Left</option><option value="right">Right</option></select></Field>
    <Field label="Grouping"><select value={e.group?.kind ?? ""} onChange={event => patch(i,"group",event.target.value ? {id: e.group?.id ?? "A",kind:event.target.value} : undefined)}><option value="">Straight sets</option><option value="superset">Superset</option><option value="circuit">Circuit</option></select></Field>
    {e.group && <Field label="Group label"><input required maxLength={40} value={e.group.id} onChange={event => patch(i,"group",{...e.group,id:event.target.value})}/><span className="muted">Keep matching labels together with equal rounds. Rest follows the last exercise.</span></Field>}</div>
    <Field label="Exercise name"><input value={e.name} required maxLength={100} onChange={(event) => patch(i, "name", event.target.value)} /></Field>
    <div className="form-grid">{[["sets", "Sets", 1, 10], [...(e.measure === "time" || (!e.measure && e.durationSeconds) ? ["durationSeconds", "Seconds per round", 5, 7200] : e.measure === "distance" || (!e.measure && e.distanceMeters) ? ["distanceMeters", "Metres per round", 10, 50000] : ["reps", "Repetitions", 1, 100])], ["loadKg", "Load (kg)", 0, 500], ["restSeconds", "Rest (seconds)", 0, 600], ["rir", "Repetitions in reserve", 0, 10]].map(([key, label, min, max]) => <Field key={String(key)} label={String(label)}><input type="number" min={Number(min)} max={Number(max)} step={key === "loadKg" ? 0.5 : 1} value={e[String(key)] ?? (key === "durationSeconds" ? 60 : key === "distanceMeters" ? 500 : 10)} onChange={(event) => patch(i, String(key), Number(event.target.value))} required /></Field>)}</div>
    <Field label="Coaching cue"><textarea value={e.cue} onChange={(event) => patch(i, "cue", event.target.value)} maxLength={1000} rows={2} /></Field>
    <Field label="Demonstration link (HTTPS)"><input type="url" value={e.demonstrationUrl ?? ""} onChange={(event) => patch(i, "demonstrationUrl", event.target.value)} placeholder="https://" /></Field>
    <Field label="Approved alternative"><input value={e.alternatives[0]?.name ?? ""} placeholder="Optional alternative exercise" onChange={(event) => patch(i, "alternatives", event.target.value ? [{ name: event.target.value, loadKg: e.alternatives[0]?.loadKg ?? 0, cue: e.alternatives[0]?.cue ?? "" }] : [])} /></Field>
    {e.alternatives.length > 0 && <div className="form-grid"><Field label="Alternative load (kg)"><input type="number" min={0} max={500} step={0.5} value={e.alternatives[0].loadKg} onChange={(event) => patch(i, "alternatives", [{ ...e.alternatives[0], loadKg: Number(event.target.value) }])} /></Field><Field label="Alternative cue"><input value={e.alternatives[0].cue} onChange={(event) => patch(i, "alternatives", [{ ...e.alternatives[0], cue: event.target.value }])} /></Field></div>}
    {values.length > 1 && <button type="button" className="text-button" onClick={() => onChange(values.filter((_, j) => j !== i))}>Remove exercise</button>}
  </fieldset>)}<button type="button" className="button secondary" disabled={values.length >= 20} onClick={() => onChange([...values, exercise()])}>Add exercise</button></div>;
}
const dateToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export function TrainingPrograms({ state }: { state: any }) {
  const sub = state.user.role === "subscriber", [selected, setSelected] = useState(""), t = useTraining(sub ? state.user.userId : selected || undefined), router = useRouter();
  // Members read their plan in their language; the trainer's tools are unchanged.
  const tr = useT("training"), locale = useLocale();
  const status = (value: string) => sub && ["assigned", "template", "planned", "started", "completed", "canceled", "moved"].includes(value) ? tr(`status_${value}` as "status_assigned") : value;
  // The pickers list the first followers; more are found by server search.
  const [picked, setPicked] = useState<MemberOption[]>([]), people = withPicked<MemberOption>(t.data?.members ?? [], picked);
  const [sessions, setSessions] = useState([{ label: "Session A", weekday: 1, exercises: [exercise()] }]), [library, setLibrary] = useState<any[]>([]);
  useEffect(() => { if (!sub) void api("/training/exercises").then(setLibrary).catch(() => {}); }, [sub]);
  const programs = t.data?.records.filter((r: any) => r.kind === "program" && ["assigned", "template"].includes(r.status)) ?? [], planned = t.data?.records.filter((r: any) => r.kind === "planned_session").sort((a: any, b: any) => a.data.date.localeCompare(b.data.date)) ?? [];
  return <><div className="page-heading"><h1>{sub ? tr("planTitle") : "Programs and training calendar"}</h1><p className="muted">{sub ? tr("planIntro") : "Multiweek plans, clear prescriptions and flexible training days."}</p></div>
    {t.error && <p role="alert" className="notice">{t.error}</p>}{t.message && <p role="status" className="notice">{t.message}</p>}
    {t.data && <TrainingHoldNotice records={t.data.records} />}
    {sub && <MemberPlan />}
    {!sub && <><MemberFinder hasMore={!!t.data?.membersHasMore} onPick={(m) => setPicked((v) => [...v, m])} /><section className="card"><h2>Create a program</h2><form onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget); void t.action(() => api("/programs", "POST", { program: { title: f.get("title"), goal: f.get("goal"), daysPerWeek: sessions.length, weeks: Number(f.get("weeks")), exercises: sessions[0].exercises.map(cleanExercise), sessions: sessions.map((s) => ({ ...s, exercises: s.exercises.map(cleanExercise) })) }, ...(f.get("subscriber") ? { subscriberId: f.get("subscriber"), startDate: f.get("startDate"), timezone: f.get("timezone") } : {}) }), "Program and calendar saved"); }}>
      <div className="form-grid"><Field label="Program name"><input name="title" required maxLength={120} /></Field><Field label="Training goal"><input name="goal" required maxLength={1000} /></Field><Field label="Number of weeks"><input name="weeks" type="number" min={1} max={26} defaultValue={4} required /></Field><Field label="Assign to"><select name="subscriber"><option value="">Save as my template</option>{people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field><Field label="Start date"><input name="startDate" type="date" defaultValue={dateToday()} required /></Field><Field label="Calendar timezone"><input name="timezone" defaultValue="Asia/Dubai" required /></Field></div>
      {sessions.map((s, i) => <fieldset key={i} style={{ marginBlock: 24 }}><legend>Training day {i + 1}</legend><div className="form-grid"><Field label="Session name"><input value={s.label} required onChange={(e) => setSessions((v) => v.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} /></Field><Field label="Weekday"><select value={s.weekday} onChange={(e) => setSessions((v) => v.map((x, j) => j === i ? { ...x, weekday: Number(e.target.value) } : x))}>{["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((name, day) => <option key={name} value={day}>{name}</option>)}</select></Field></div><ExerciseEditor values={s.exercises} library={library} onChange={(values) => setSessions((v) => v.map((x, j) => j === i ? { ...x, exercises: values } : x))} />{sessions.length > 1 && <button type="button" className="text-button" onClick={() => setSessions((v) => v.filter((_, j) => j !== i))}>Remove training day</button>}</fieldset>)}
      <div className="button-row"><button type="button" className="button secondary" disabled={sessions.length >= 7} onClick={() => setSessions((v) => [...v, { label: `Session ${String.fromCharCode(65 + v.length)}`, weekday: [0, 1, 2, 3, 4, 5, 6].find((d) => !v.some((s) => s.weekday === d)) ?? 0, exercises: [exercise()] }])}>Add training day</button><button className="button" disabled={t.busy} type="submit">Save program</button><button type="button" className="button secondary" disabled={t.busy || !sessions[0].exercises[0].name} onClick={() => void t.action(async () => { await api("/training/exercises", "POST", cleanExercise(sessions[0].exercises[0])); setLibrary(await api("/training/exercises")); }, "First exercise saved to your library")}>Save first exercise to library</button></div>
    </form></section><Field label="View a client's plans"><select value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">All clients and templates</option>{people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field></>}
    <div className="two-columns">{programs.map((p: any) => <section key={p.id} className="card"><span className="badge">{status(p.status)}</span><h2 dir="auto">{p.data.title}</h2><p dir="auto">{p.data.goal}</p><p className="muted">{sub ? tr("weeksSessions", { weeks: tr("weeks", { count: p.data.weeks ?? 4 }), sessions: tr("sessionsEachWeek", { count: p.data.daysPerWeek }) }) : `${p.data.weeks ?? 4} weeks · ${p.data.daysPerWeek} sessions each week`}</p>{p.data.exercises.map((e: any, i: number) => <p key={e.instanceId ?? `${e.name}:${i}`}><strong dir="auto">{e.name}</strong> · {sub && workMeasure(e) === "reps" ? tr("exerciseLine", { setsReps: formatSetsReps(e.sets, e.reps, locale), load: e.loadKg, rest: e.restSeconds, rir: e.rir ?? 2 }) : prescriptionText({ ...e, rir: e.rir ?? 2 })}</p>)}
      {!sub && p.status === "template" && <form onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget); void t.action(() => api(`/programs/${p.id}/assign`, "POST", { version: p.version, subscriberId: f.get("subscriber"), startDate: f.get("date"), timezone: "Asia/Dubai" }), "Template assigned with a training calendar"); }}><Field label="Client"><select name="subscriber" required><option value="">Choose a client</option>{people.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field><Field label="First week starts"><input name="date" type="date" defaultValue={dateToday()} required /></Field><button className="button" type="submit" disabled={t.busy}>Assign template</button></form>}
      {!sub && p.status === "assigned" && <ProgramProgression program={p} busy={t.busy} action={t.action} />}
      {sub && !planned.some((s: any) => s.data.programId === p.id && s.status === "planned") && <button className="button" disabled={t.busy} onClick={() => void t.action(() => api("/workouts/start", "POST", { programId: p.id }), tr("workoutReady")).then((r) => r && router.push(`/app/workouts/${r.id}`))}>{tr("startWorkout")}</button>}
    </section>)}</div>
    <section className="card"><h2>{sub ? tr("calendar") : "Training calendar"}</h2>{!planned.length && <p>{sub ? tr("calendarEmpty") : "Assign a program to create the client's sessions."}</p>}{planned.map((p: any) => <article key={p.id} style={{ borderTop: "1px solid var(--line)", paddingBlock: 16 }}><h3>{sub ? formatDate(p.data.date, { weekday: true, locale }) : p.data.date} · <bdi>{p.data.label}</bdi></h3><p className="muted">{sub ? tr("weekLine", { week: p.data.week, zone: zoneName(p.data.timezone, locale), status: status(p.status) }) : `Week ${p.data.week} · ${p.data.timezone} · ${p.status}`}</p>{p.status === "planned" && <><div className="button-row">{sub && <button className="button" disabled={t.busy} onClick={() => void t.action(() => api("/workouts/start", "POST", { programId: p.data.programId, plannedSessionId: p.id }), tr("sessionStarted")).then((r) => r && router.push(`/app/workouts/${r.id}`))}>{tr("startThis")}</button>}{sub && <a className="text-link" href={`/app/voice-session/planned/${p.id}`}>{tr("prepareVoice")}</a>}<button className="button secondary" disabled={t.busy} onClick={async () => { const note = (await promptWorkspace(sub ? tr("skipWhy") : "Why are you skipping this session?")); if (note) void t.action(() => api(`/training/sessions/${p.id}/cancel`, "POST", { version: p.version, note }), sub ? tr("skipped") : "Session skipped"); }}>{sub ? tr("skip") : "Skip session"}</button></div><details><summary>{sub ? tr("move") : "Move this session"}</summary><form onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget); void t.action(() => api(`/training/sessions/${p.id}/reschedule`, "POST", { version: p.version, date: f.get("date"), note: f.get("note") }), sub ? tr("moved") : "Session moved"); }}><Field label={sub ? tr("newDate") : "New date"}><input type="date" name="date" defaultValue={p.data.date} min={dateToday()} required /></Field><Field label={sub ? tr("reason") : "Reason"}><input name="note" required minLength={3} /></Field><button className="button secondary" disabled={t.busy} type="submit">{sub ? tr("saveDate") : "Save date"}</button></form></details></>}{p.status === "started" && sub && <a href={`/app/workouts/${p.data.workoutId}`}>{tr("continueSession")}</a>}</article>)}</section>
  </>;
}
function ProgramProgression({ program, busy, action }: { program: any; busy: boolean; action: (fn: () => Promise<any>, message?: string) => Promise<any> }) {
  const exercises = [...program.data.exercises, ...(program.data.sessions ?? []).flatMap((s: any) => s.exercises)].filter((e: any, i: number, all: any[]) => all.findIndex(v => (v.instanceId ?? v.name) === (e.instanceId ?? e.name)) === i);
  const [choice,setChoice] = useState(0), selected = exercises[choice] ?? exercises[0], measure = workMeasure(selected);
  return <details><summary>Revise an exercise</summary><Field label="Exercise to revise"><select value={choice} onChange={e => setChoice(Number(e.target.value))}>{exercises.map((e,i) => <option key={e.instanceId ?? i} value={i}>{i+1}. {e.name} · {e.side ?? "both"} · {e.block ?? "main"}</option>)}</select></Field>
    <form key={choice} onSubmit={event => { event.preventDefault(); const f = new FormData(event.currentTarget); void action(() => api(`/programs/${program.id}/progression`,"POST",{ version:program.version, exercise:selected.name, ...(selected.instanceId ? {instanceId:selected.instanceId} : {}), loadKg:Number(f.get("loadKg")), reps:measure === "reps" ? Number(f.get("work")) : 1, ...(measure === "time" ? {durationSeconds:Number(f.get("work"))} : measure === "distance" ? {distanceMeters:Number(f.get("work"))} : {}), rir:Number(f.get("rir")),note:f.get("note") }),"Future sessions now use the revised prescription"); }}>
      <div className="form-grid"><Field label="Load (kg)"><input name="loadKg" type="number" min={0} max={500} step={0.5} defaultValue={selected?.loadKg ?? 0} required/></Field><Field label={measure === "time" ? "Seconds per round" : measure === "distance" ? "Metres per round" : "Repetitions"}><input name="work" type="number" min={measure === "time" ? 5 : measure === "distance" ? 10 : 1} max={measure === "time" ? 7200 : measure === "distance" ? 50000 : 100} defaultValue={selected?.durationSeconds ?? selected?.distanceMeters ?? selected?.reps} required/></Field><Field label="Repetitions in reserve"><input name="rir" type="number" min={0} max={10} defaultValue={selected?.rir ?? 2} required/></Field></div><Field label="Reason and coaching instructions"><textarea name="note" required minLength={10} rows={2}/></Field><button type="submit" className="button" disabled={busy}>Update future sessions</button>
    </form></details>;
}

/**
 * Session tools under the workout. On the member's workout screen the rest
 * timer is the screen's own (`rest`): the bottom action bar and these tools
 * show one countdown, never two that disagree.
 */
export function WorkoutTools({ workout, userId, onChange, rest }: { workout: any; userId: string; onChange?: () => Promise<void> | void; rest?: { left: number; start: (seconds: number) => void; reset: () => void } }) {
  const t = useTraining(userId), [ownSeconds, setSeconds] = useState(0), [until, setOwnUntil] = useState<number | null>(null);
  const seconds = rest ? rest.left : ownSeconds;
  const setUntil = (value: number | null) => (rest ? (value === null ? rest.reset() : rest.start(Math.round((value - Date.now()) / 1000))) : setOwnUntil(value));
  const tr = useT("training"), locale = useLocale();
  useEffect(() => { if (!until) return; const tick = () => { const left = Math.max(0, Math.ceil((until - Date.now()) / 1000)); setSeconds(left); if (!left) setOwnUntil(null); }; tick(); const interval = setInterval(tick, 250); return () => clearInterval(interval); }, [until]);
  const current = t.data?.records.find((r: any) => r.id === workout.id) ?? workout, sets = t.data?.sets.filter((s: any) => s.workout_id === current.id) ?? [];
  async function act(fn: () => Promise<any>, success: string) { const r = await t.action(fn, success); if (r) await onChange?.(); }
  return <section className="card"><h2>{tr("tools")}</h2>{t.error && <p role="alert" className="notice">{t.error}</p>}{t.message && <p role="status" className="notice">{t.message}</p>}
    <div className="button-row"><strong role="timer" aria-live="off">{tr("restTimer", { time: formatCountdown(seconds, locale) })}</strong>{[60, 90, 120].map((s) => <button key={s} className="button secondary" onClick={() => setUntil(Date.now() + s * 1000)}>{tr("seconds", { n: s })}</button>)}<button className="button secondary" onClick={() => { setUntil(null); setSeconds(0); }}>{tr("resetTimer")}</button></div>
    {current.data.program.exercises.map((e: any, exerciseIndex: number) => <div key={e.instanceId ?? exerciseIndex} style={{ marginBlock: 16 }}><strong dir="auto">{e.name}</strong><span className="muted">{workMeasure(e) === "reps" ? tr("targetRir", { rir: e.rir ?? 2 }) : ` · ${prescriptionText(e, { rir: false })}`}</span><div className="button-row">{e.durationSeconds > 0 && <button className="button secondary" onClick={() => setUntil(Date.now() + e.durationSeconds * 1000)}>{tr("startWork", { n: e.durationSeconds })}</button>}{e.restSeconds > 0 && <button className="button secondary" onClick={() => setUntil(Date.now() + e.restSeconds * 1000)}>{tr("startRest", { n: e.restSeconds })}</button>}{e.demonstrationUrl && <a target="_blank" rel="noreferrer" href={e.demonstrationUrl}>{tr("watchDemo")}</a>}</div>{e.alternatives?.length > 0 && current.status === "active" && <details><summary>{tr("alternatives")}</summary><p className="muted">{tr("alternativesHelp")}</p>{e.alternatives.map((v: any) => <button key={v.name} className="button secondary" disabled={t.busy} onClick={() => void act(() => api(`/workouts/${current.id}/substitute`, "POST", { version: current.version, exercise: e.name, exerciseIndex, replacement: v.name, reason: "equipment_unavailable" }), tr("alternativeApplied"))}>{tr("alternativeLine", { name: v.name, load: v.loadKg })}</button>)}</details>}</div>)}
    <details><summary>{tr("reviewSets")}</summary><button className="text-button" onClick={() => void t.load()}>{tr("refreshLogs")}</button>{!sets.length && <p>{tr("noSavedSets")}</p>}{sets.map((s: any) => { const revision = Math.max(0, ...(t.data?.records.filter((r: any) => r.kind === "workout_correction" && r.data.eventId === s.id).map((r: any) => r.data.revision) ?? [])); return <form key={s.id + ":" + revision} onSubmit={(event) => { event.preventDefault(); const f = new FormData(event.currentTarget); void act(() => api(`/workouts/${current.id}/sets/${s.id}/correct`, "POST", { revision, ...(f.has("durationSeconds") ? { durationSeconds: Number(f.get("durationSeconds")) } : {}), ...(f.has("distanceMeters") ? { distanceMeters: Number(f.get("distanceMeters")) } : {}), reps: Number(f.get("reps")), loadKg: Number(f.get("loadKg")), rir: Number(f.get("rir")), note: f.get("note") }), tr("correctionRecorded")); }}><h3>{tr("setTitle", { exercise: s.data.exercise, set: s.data.set })}</h3><div className="form-grid">{s.data.durationSeconds !== undefined || s.data.distanceMeters !== undefined ? <><input type="hidden" name="reps" value="0"/><Field label={locale === "ar" ? s.data.durationSeconds !== undefined ? "الثواني الفعلية" : "الأمتار الفعلية" : s.data.durationSeconds !== undefined ? "Actual seconds" : "Actual metres"}><input type="number" name={s.data.durationSeconds !== undefined ? "durationSeconds" : "distanceMeters"} min={0} max={s.data.durationSeconds !== undefined ? 36000 : 200000} defaultValue={s.data.durationSeconds ?? s.data.distanceMeters} required /></Field></> : <Field label={tr("actualReps")}><input type="number" name="reps" min={0} max={200} defaultValue={s.data.reps} required /></Field>}<Field label={tr("actualLoad")}><input type="number" name="loadKg" min={0} max={500} step={0.5} defaultValue={s.data.loadKg} required /></Field><Field label={tr("actualRir")}><input type="number" name="rir" min={0} max={10} defaultValue={s.data.rir ?? 2} required /></Field></div><Field label={tr("correctionReason")}><input name="note" minLength={3} required /></Field><button className="button secondary" disabled={t.busy} type="submit">{tr("saveCorrection")}</button></form>; })}</details>
    {current.status === "active" && <button className="text-button" disabled={t.busy} onClick={async () => { const note = (await promptWorkspace(tr("endWhy"))); if (note) void act(() => api(`/workouts/${current.id}/abandon`, "POST", { note }), tr("endedEarly")); }}>{tr("endEarly")}</button>}
  </section>;
}

/** "29 Sep 2026" (Arabic "29 سبتمبر 2026"): the app's one date format (lib/format.ts). */
const shortDate = (value: string, locale: Locale = "en") => formatDate(value, { locale });
const SESSION_STATUS = ["completed", "active", "abandoned", "safety_hold"] as const;
export function TrainingProgress({ state }: { state: any }) {
  const sub = state.user.role === "subscriber", [selected, setSelected] = useState(sub ? state.user.userId : state.members?.find((m: any) => m.role === "subscriber")?.id ?? ""), [picked, setPicked] = useState<MemberOption[]>([]), t = useTraining(selected || undefined);
  const tr = useT("training"), locale = useLocale();
  const sessionStatus = (value: string) => (SESSION_STATUS as readonly string[]).includes(value) ? tr(`session_${value as (typeof SESSION_STATUS)[number]}`) : value.replaceAll("_", " ");
  const rows = t.data?.records ?? [], workouts = rows.filter((r: any) => r.kind === "workout"), byExercise = new Map<string, { sets: number; volume: number; maxLoad: number; last: string }>();
  for (const s of t.data?.sets ?? []) { const v = byExercise.get(s.data.exercise) ?? { sets: 0, volume: 0, maxLoad: 0, last: s.created_at }; v.sets++; v.volume += s.data.reps * s.data.loadKg; v.maxLoad = Math.max(v.maxLoad, s.data.loadKg); byExercise.set(s.data.exercise, v); }
  return <><h1>{tr("progressTitle")}</h1><p className="muted">{sub ? tr("progressIntroMember") : tr("progressIntro")}</p>{!sub && <Field label="Client"><select value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">Select a client</option>{withPicked<MemberOption>(state.members?.filter((m: any) => m.role === "subscriber") ?? [], picked).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>}{!sub && <MemberFinder hasMore={!!state.pages?.members?.hasMore} onPick={(m) => { setPicked((v) => [...v, m]); setSelected(m.id); }} />}{t.error && <p role="alert">{t.error}</p>}{sub && t.data && <section className="card"><h2>{locale === "ar" ? "هذا الأسبوع" : "This week"}</h2>{(() => { const week = trainingWeek(rows, calendarDate(new Date())); return <><p>{locale === "ar" ? `${week.completed} حصص مكتملة · ${week.planned} حصص مجدولة` : `${week.completed} completed sessions · ${week.planned} scheduled sessions`}</p><p className="muted">{week.next ? (locale === "ar" ? "الحصة التالية: " : "Next scheduled session: ") + shortDate(week.next, locale) : (locale === "ar" ? "لا توجد حصة قادمة مجدولة. راجع خطتك أو تواصل مع مدربك." : "No upcoming session is scheduled. Check your plan or ask your coach.")}</p><a className="text-button" href="/app/program">{locale === "ar" ? "عرض الخطة" : "View plan"}</a></>; })()}</section>}<section className="card"><h2>{tr("completedSessions", { count: workouts.filter((w: any) => w.status === "completed").length })}</h2><p>{tr("loggedSets", { count: (t.data?.sets ?? []).length })}{(() => { const today = calendarDate(new Date()), left = rows.filter((r: any) => r.kind === "planned_session" && r.status === "planned" && String(r.data?.date ?? "") >= today).length; return left ? tr("plannedToGo", { count: left }) : ""; })()}</p><ResponsiveTable label={tr("byExercise")} columns={[{ key: "exercise", label: tr("colExercise") }, { key: "sets", label: tr("colSets"), numeric: true }, { key: "volume", label: tr("colVolume"), numeric: true }, { key: "max", label: tr("colHeaviest"), numeric: true }, { key: "last", label: tr("colLast") }]} rows={[...byExercise].map(([name, v]) => ({ key: name, cells: { exercise: <bdi>{name}</bdi>, sets: v.sets, volume: Math.round(v.volume * 10) / 10, max: v.maxLoad, last: shortDate(v.last, locale) } }))} empty={<p className="muted">{tr("progressEmpty")}</p>} />{t.data?.partial && <p className="muted">{tr("partial")}</p>}</section><section className="card"><h2>{tr("history")}</h2>{!workouts.length && <p className="muted">{tr("historyEmpty")}</p>}<ul className="session-history">{workouts.map((w: any) => <li key={w.id}>{sub ? <a className="session-history-link" href={`/app/workouts/${w.id}`}><strong dir="auto">{w.data.program.title}</strong><span>{shortDate(w.created_at, locale)} · {sessionStatus(w.status)}</span></a> : <span className="session-history-link"><strong dir="auto">{w.data.program.title}</strong><span>{shortDate(w.created_at, locale)} · {sessionStatus(w.status)}</span></span>}</li>)}</ul></section><HealthKitActivityCard userId={selected || undefined} /></>;
}

/** The subscriber uses the same chat everywhere, including trainer previews. */
export function CoachingMessages(props: { state: any; subscriberId?: string; clientName?: string }) {
  return props.state.user.role === "subscriber" ? <MemberChat state={props.state} /> : <TrainerConversation key={props.subscriberId ?? "client-picker"} {...props} />;
}

function TrainerConversation({ state, subscriberId, clientName }: { state: any; subscriberId?: string; clientName?: string }) {
  const [target, setTarget] = useState(subscriberId ?? state.members?.find((m: any) => m.role === "subscriber")?.id ?? "");
  const [picked, setPicked] = useState<MemberOption[]>([]), [messages, setMessages] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(false), [personal, setPersonal] = useState(false), [loaded, setLoaded] = useState(false);
  const [text, setText] = useWorkspaceValue(`chat:${target}:text`, "", true);
  const [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]), [uploading, setUploading] = useState(false), [composerKey, setComposerKey] = useState(0);
  const [sending, setSending] = useState<string | null>(null);
  const currentTarget = useRef(target), newest = useRef(""); currentTarget.current = target;
  const tr = useT("training"), chat = useT("chat"), locale = useLocale(), toError = useErrorText();
  const clients = withPicked<MemberOption>(state.members?.filter((m: any) => m.role === "subscriber") ?? [], picked);
  const name = clientName ?? clients.find(m => m.id === target)?.name ?? "Client";
  const coach = state.tenant.name;
  const scroll = useConversationScroll(sending ? `sending:${sending}` : messages.at(-1)?.id ?? "", loaded, target);
  const load = useCallback(async (before?: string) => {
    if (!target) { setLoaded(true); return; }
    setReading(true);
    try {
      const result = await api("/messages/thread?subscriberId=" + target + (before ? "&before=" + before : ""));
      if (currentTarget.current !== target) return;
      const restore = before ? scroll.prependHistory() : undefined;
      setMessages(old => before ? [...result.messages, ...old] : [...old.filter(m => !result.messages.some((r: any) => r.id === m.id)), ...result.messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
      restore?.();
      if (before || !newest.current) setHasMore(result.hasMore);
      newest.current = result.messages.at(-1)?.id ?? newest.current;
      setPersonal(!!result.personalReview);
      setLoaded(true);
    } finally { if (currentTarget.current === target) setReading(false); }
  }, [target]);
  useEffect(() => {
    setMessages([]); setError(""); setLoaded(false); setHasMore(false); setPersonal(false); newest.current = "";
    void load().catch(e => { if (currentTarget.current === target) { setLoaded(true); setError(errorText(e, pageLocale())); } });
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load().catch(() => {}); }, 8000);
    return () => clearInterval(timer);
  }, [load, target]);
  async function send() {
    if (busy || uploading || !target || (!text.trim() && !attachments.length)) return;
    const draft = text, files = attachments;
    setBusy(true); setError(""); setNotice(""); scroll.followNext(); setSending(draft.trim());
    try {
      await api("/messages", "POST", { text: draft, subscriberId: target, attachmentIds: files.map(file => file.id) });
      setText(current => current === draft ? "" : current);
      setAttachments(current => current.filter(file => !files.some(sent => sent.id === file.id)));
      setComposerKey(v => v + 1);
      // A committed message must not become a retry when refreshing fails.
      await load().catch(() => setNotice("Your message was sent. Refresh to see the latest conversation."));
    } catch (e) { setError(toError(e)); }
    finally { setBusy(false); setSending(null); }
  }
  function pick(id: string) { setTarget(id); setAttachments([]); setNotice(""); }
  return <div className="trainer-conversation stack">
    <header className="page-heading"><h1>{subscriberId ? name : "Client conversations"}</h1><p className="muted">Stay close to your clients. Step in personally whenever they need you.</p></header>
    {!subscriberId && <div className="conversation-client-picker"><Field label="Client"><select value={target} disabled={busy || uploading} onChange={e => pick(e.target.value)}><option value="">Choose a client</option>{clients.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field><MemberFinder hasMore={!!state.pages?.members?.hasMore} disabled={busy || uploading} onPick={m => { setPicked(v => [...v, m]); pick(m.id); }} /></div>}
    {error && <div role="alert" className="notice error"><p>{error}</p><button type="button" className="text-button" disabled={reading} onClick={() => void load().then(() => setError(""), e => setError(toError(e)))}>Refresh conversation</button></div>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {target && <details className="card"><summary>Client plan and coaching context</summary><ClientTwin userId={target} name={name} compact /><a className="text-button" href={`/trainer/subscribers/${target}/plan`}>Open training plan</a></details>}
    {target && <section className="card trainer-chat-card">
      <div className="conversation-toolbar"><div><strong dir="auto">{name}</strong><p className="muted">{personal ? "You’re replying personally. Assisted replies are paused." : "Coaching support is available. Your personal replies appear in a different colour."}</p></div><button className="button secondary" disabled={busy || uploading || !loaded} onClick={async () => { setBusy(true); setError(""); try { await api("/takeover", "POST", { subscriberId: target, active: !personal }); await load(); } catch (e) { setError(toError(e)); } finally { setBusy(false); } }}>{personal ? "Resume assisted replies" : "I’ll reply myself"}</button></div>
      <details className="conversation-tools"><summary>{chat("conversationDetails")}</summary><ConversationLegend coach={coach} /></details>
      <section className="chat-thread conversation-scroll" ref={scroll.thread} onScroll={scroll.onScroll} aria-label={tr("conversation")} tabIndex={0}>
        {hasMore && messages.length > 0 && <button type="button" className="text-button chat-earlier" disabled={reading} onClick={() => void load(messages[0].id).catch(e => setError(toError(e)))}>{tr("loadEarlier")}</button>}
        {!loaded && <Skeleton label={tr("loadingChat")} lines={4} />}
        <ol className="chat-messages" aria-live="polite">{messages.map(m => <li key={m.id} className={`chat-message is-${conversationKind(m.data.author)}${m.data.author === "trainer" ? " is-mine" : ""}`}>
          <p className="chat-meta"><ConversationIdentity author={m.data.author} coach={coach} client={name} trainer /><time dateTime={m.created_at}>{m.data.scheduled ? tr("scheduled") : ""}{formatDateTime(m.created_at, { locale })}</time></p>
          {m.data.text && <p className="chat-text" dir="auto">{m.data.text}</p>}
          <ChatAttachmentList files={m.data.attachments ?? []} user={state.user} onRemove={id => setMessages(old => old.map(message => message.id === m.id ? { ...message, data: { ...message.data, attachments: message.data.attachments.filter((file: ChatAttachment) => file.id !== id) } } : message))} />
        </li>)}
        {sending !== null && !messages.some(m => m.data?.author === "trainer" && m.data?.text === sending && Date.now() - new Date(m.created_at).getTime() < 120000) && <li className="chat-message is-mine is-personal is-sending"><p className="chat-meta"><ConversationIdentity author="trainer" coach={coach} trainer /><span>{tr("sending")}</span></p><p className="chat-text" dir="auto">{sending}</p></li>}</ol>
        {loaded && !messages.length && sending === null && <div className="chat-empty"><h2>Start with a check-in</h2><p className="muted">Ask how training is going, share encouragement or help {name.split(" ")[0]} with the next step.</p></div>}
      </section>
      {scroll.newMessages && <button className="button secondary conversation-latest" type="button" onClick={scroll.toLatest}><ArrowDown size={16} aria-hidden="true" />{chat("latestMessages")}</button>}
      <form className="trainer-chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
        <Field label={tr("yourMessage")}><textarea value={text} onChange={e => setText(e.target.value)} required={!attachments.length} maxLength={4000} rows={3} placeholder={`Message ${name.split(" ")[0]}`} /></Field>
        <details className="conversation-tools"><summary>Photos and files{attachments.length ? ` · ${attachments.length} attached` : ""}</summary><ChatAttachmentPicker key={target + ":" + composerKey} subjectId={target} files={attachments} user={state.user} onChange={setAttachments} onBusy={setUploading} disabled={busy} /></details>
        <div className="conversation-send-row"><span className="conversation-source is-personal"><i aria-hidden="true" />Personal reply</span><button className="button chat-send" disabled={busy || uploading || (!text.trim() && !attachments.length)} type="submit"><Send size={16} aria-hidden="true" />{busy ? "Sending…" : "Send to client"}</button></div>
      </form>
    </section>}
    {target && <CoachingFollowups key={target} subscriberId={target} user={state.user} />}
  </div>;
}
