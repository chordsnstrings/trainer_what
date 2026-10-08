"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Check, MessageCircle, Pause, RotateCcw, X } from "lucide-react";
import type { ChatData, ChatMessage } from "../../../packages/domain/src/onboarding-chat";
import { useWorkspaceValue } from "./workspace-continuity";
import { MemberIntake } from "./member-intake";

type State = ChatData & {
  id: string; version: number; ready: boolean; missing: string[]; programReady?: boolean;
  permissions: { coaching: boolean; nutrition: boolean; nutritionIncluded: boolean; active: boolean };
  setup?: any; brain?: any;
};
type Props = { audience: "coach" | "member"; mode?: "setup" | "teach"; onSaved?: () => void | Promise<void>; onDetails?: () => void };
const labels: Record<string, string> = {
  publicName: "Your name", businessName: "Business name", city: "City", specialty: "Specialty",
  audience: "Who you coach", approach: "Your approach", alwaysDo: "Always", neverDo: "Never",
  referOut: "Referral boundaries", headline: "Page headline", bio: "About you",
  name: "Offer name", priceAed: "Price in AED", billing: "Billing", programmeDays: "Programme days",
  age: "Age", goal: "Goal", experience: "Experience", daysPerWeek: "Days each week",
  availableWeekdays: "Available days", maxSessionMinutes: "Session minutes", equipment: "Equipment",
  limitations: "Health and movement notes", diet: "Food preferences", allergyStatus: "Allergies",
  allergens: "Allergens", exclusions: "Foods you avoid", kitchenEquipment: "Kitchen equipment",
  cookingMinutes: "Cooking minutes", foodBudget: "Food budget", nutritionScope: "Food support",
  nutritionNotes: "Food notes",
};
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const choices: Record<string, string[]> = {
  experience: ["I'm a beginner", "I'm intermediate", "I'm advanced"],
  daysPerWeek: ["2 days a week", "3 days a week", "4 days a week"],
  maxSessionMinutes: ["30 minutes", "45 minutes", "60 minutes"],
  equipment: ["A full gym", "Dumbbells at home", "No equipment"],
  limitations: ["No injuries or limitations"],
  allergyStatus: ["No food allergies", "I have food allergies", "I'm not sure"],
  exclusions: ["I don't avoid any foods"],
  foodBudget: ["Low", "Moderate", "Flexible"],
  nutritionScope: ["General meal planning", "I need help with a medical condition"],
  billing: ["Monthly membership", "Paid upfront"],
};
async function request(path: string, body?: unknown) {
  const response = await fetch("/api/v1" + path, {
    method: body === undefined ? "GET" : "POST", cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message ?? "Something went wrong. Try again."), { status: response.status });
  return data;
}
function valueText(key: string, value: any, state: State) {
  if (key === "specialty") return state.setup?.about.specialties.find((s: any) => s.id === value)?.label ?? value;
  if (key === "availableWeekdays") return value.map((day: number) => days[day]).join(", ");
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  return String(value).replaceAll("_", " ");
}
export function MemberOnboarding({ intake, onSaved }: { intake?: any; onSaved?: () => void | Promise<void> }) {
  const [details, setDetails] = useWorkspaceValue("member:onboarding-details", false, true);
  return details ? <div className="onboarding-fallback">
    <button type="button" className="button secondary" onClick={() => setDetails(false)}><MessageCircle size={16} /> Back to conversation</button>
    <MemberIntake intake={intake} onSaved={onSaved} />
  </div> : <OnboardingChat audience="member" onSaved={onSaved} onDetails={() => setDetails(true)} />;
}
export function OnboardingChat({ audience, mode = "setup", onSaved, onDetails }: Props) {
  const [state, setState] = useState<State | null>(null);
  const [text, setText, clearText] = useWorkspaceValue("onboarding:composer:" + audience, "", true);
  const [sending, setSending] = useState(false), [error, setError] = useState("");
  const [review, setReview] = useState(false), [rulesOpen, setRulesOpen] = useState(false);
  const [answerMode, setAnswerMode] = useState(false), [scenarioMode, setScenarioMode] = useState(false);
  const [ruleId, setRuleId] = useState(""), [escalate, setEscalate] = useState(false);
  const [older, setOlder] = useState<ChatMessage[]>([]), [before, setBefore] = useState<string | null>(null), [historyDone, setHistoryDone] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [consent, setConsent] = useState(false), [nutritionConsent, setNutritionConsent] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null);
  const flight = useRef(false), mounted = useRef(true), latest = useRef<State | null>(null);
  const restoreRequest = useRef<{ path: string; body: any; sentText?: string } | null>(null);
  latest.current = state;
  const load = useCallback(async () => {
    try {
      const next = await request("/onboarding-chat?mode=" + mode);
      if (mounted.current) { setState(next); setError(""); }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
  }, [mode]);
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; };
  }, [load]);
  useEffect(() => {
    if (!state?.pending || sending) return;
    const id = window.setInterval(() => { void load(); }, 4000);
    return () => window.clearInterval(id);
  }, [state?.pending?.id, sending, load]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [state?.messages.length, sending]);
  const busy = sending || !!state?.pending;
  const act = async (action: string, extra: Record<string, any> = {}) => {
    if (!latest.current || flight.current || latest.current.pending) return;
    await transmit("/onboarding-chat/actions", { id: crypto.randomUUID(), version: latest.current.version, action, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...extra });
    if (action === "compile") setRulesOpen(true);
  };
  async function transmit(path: string, body: any, sentText?: string) {
    if (flight.current) return;
    flight.current = true; setSending(true); setError("");
    restoreRequest.current = { path, body, sentText };
    try {
      const next = await request(path, body);
      restoreRequest.current = null;
      if (["quiz-answer", "scenario"].includes(body.action) && !next.error) { setText(""); clearText(); }
      if (sentText !== undefined && next.messages?.some((m: ChatMessage) => m.from === "person" && m.id === body.id)) { setText(""); clearText(); }
      if (mounted.current) {
        setState(next);
        if (!next.error) { setAnswerMode(false); setScenarioMode(false); }
      }
      // A failed background refresh must never turn a successful save into a resend.
      if (!next.error && path.endsWith("/actions")) void Promise.resolve(onSaved?.()).catch(() => {});
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        if ((e as any).status === 409) { restoreRequest.current = null; await load(); setError((e as Error).message); }
      }
    } finally {
      flight.current = false; if (mounted.current) setSending(false);
    }
  }
  async function send(value = text) {
    const clean = value.trim();
    if (!clean || !state || busy || flight.current) return;
    if (answerMode && currentCase) { await act("quiz-answer", { roundId: state.brain.quiz.open.id, caseId: currentCase.id, verdict: "change", text: clean }); return; }
    if (scenarioMode) { await act("scenario", { text: clean, ruleId, escalate }); return; }
    await transmit("/onboarding-chat/messages", { id: crypto.randomUUID(), version: state.version, mode, text: clean }, clean);
  }
  async function allow(food = false) {
    if (flight.current) return;
    flight.current = true; setSending(true); setError("");
    try {
      for (const type of food ? ["nutrition", "nutrition_model"] : ["coaching"])
        await request("/privacy/consent", { type, granted: true });
      const current = await request("/onboarding-chat?mode=" + mode);
      setState(current);
      if (food) {
        const next = await request("/onboarding-chat/actions", { id: crypto.randomUUID(), version: current.version, action: "resume" });
        setState(next);
      }
      if (food) setNutritionConsent(false); else setConsent(false);
    } catch (e) { setError((e as Error).message); }
    finally { flight.current = false; setSending(false); }
  }
  const currentCase = state?.brain?.quiz.open?.cases.find((c: any) => !c.answer);
  const drafts = state?.brain?.rules.filter((r: any) => r.status === "draft") ?? [];
  const confirmed = state?.brain?.rules.filter((r: any) => r.status === "confirmed") ?? [];
  const uncompiled = state?.teachingIds.filter(id => !state.compiledIds.includes(id)).length ?? 0;
  const teaching = audience === "coach";
  const field = state?.lastQuestion?.field;
  const problem = error || state?.error;
  const lastPerson = state?.messages.filter(m => m.from === "person").at(-1);
  const rows = state ? Object.entries(state.facts).filter(([, value]) => value !== undefined && value !== null && value !== "") : [];
  const messages = [...older, ...(state?.messages ?? [])];
  if (!state) return <section className="onboarding-chat" aria-label="Onboarding conversation"><div className="onboarding-loading" role="status">{error || "Opening your conversation…"}</div>{error && <button className="button secondary" onClick={() => void load()}>Try again</button>}</section>;
  return <section className="onboarding-chat" aria-label={teaching ? "Trainer onboarding conversation" : "Your coaching profile conversation"}>
    <header className="onboarding-chat-header">
      <span className="onboarding-avatar" aria-hidden="true"><MessageCircle size={21} /></span>
      <div><h1>{teaching ? mode === "teach" ? "Teach your Brain" : "Let's get you started" : "Let's get to know you"}</h1><p>AI {teaching ? "setup guide" : "coaching assistant"} · {busy ? "Working on your reply" : "Your conversation is saved"}</p></div>
      <button className="onboarding-icon" aria-label={review ? "Close saved details" : "View saved details"} aria-expanded={review} onClick={() => setReview(!review)}><Check size={20} /></button>
    </header>
    <div className="onboarding-chat-body">
      <div className="onboarding-thread">
        {state.archived && !historyDone ? <button className="text-link" disabled={busy} onClick={async () => {
          try { const result = await request("/onboarding-chat/history" + (before ? "?before=" + encodeURIComponent(before) : "")); setOlder(old => [...result.messages, ...old]); setBefore(result.before); if (!result.messages.length) setHistoryDone(true); } catch (e) { setError((e as Error).message); }
        }}>Earlier messages</button> : null}
        <div className="onboarding-messages" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
          {messages.map((message, i) => <div key={message.id} className={"onboarding-message " + message.from + (messages[i - 1]?.from === message.from ? " grouped" : "")}>
            <span className="sr-only">{message.from === "person" ? "You" : "Assistant"}: </span>
            <p dir="auto">{message.text}</p>
          </div>)}
        </div>
        {!state.permissions.coaching && <div className="onboarding-inline-card">
          <p>Your coach and this AI assistant can use the goals and health details you share to prepare your coaching. You can withdraw permission in Privacy.</p>
          <label className="onboarding-choice"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I allow my information to be used for coaching.</label>
          <a className="text-link" href="/privacy" target="_blank" rel="noreferrer">Privacy policy</a>
          <button className="button" disabled={!consent || busy} onClick={() => void allow()}>Let's start</button>
          {onDetails && <button className="text-link" onClick={onDetails}>Use profile form</button>}
        </div>}
        {state.permissions.coaching && <>
          {review && <div className="onboarding-inline-card onboarding-review" aria-label="Saved details">
            <div className="onboarding-card-top"><h2>What I've understood</h2><button className="onboarding-icon" aria-label="Close review" onClick={() => setReview(false)}><X size={18} /></button></div>
            <p>Tell me what to change. {teaching ? "Draft rules need your approval before they can be used." : "Your coach uses the profile you confirm below."}</p>
            {rows.length ? <dl>{rows.map(([key, value]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd>{valueText(key, value, state)} <button className="text-link" aria-label={"Change " + (labels[key] ?? key)} onClick={() => { setText("Change my " + (labels[key] ?? key).toLowerCase() + " to "); input.current?.focus(); }}>Change</button></dd></div>)}</dl> : <p>Your answers will appear here.</p>}
            {state.missing.length > 0 && <p className="muted">Still to cover: {state.missing.map(k => labels[k] ?? k).join(", ")}.</p>}
            {state.ready && <button className="button" disabled={busy} onClick={() => void act("profile")}>{teaching ? "Save profile and page draft" : "Confirm my coaching profile"}</button>}
            {teaching && state.facts.name && state.facts.priceAed && state.facts.billing && <button className="button secondary" disabled={busy} onClick={() => void act("offer")}>Save offer draft</button>}
            {!teaching && state.permissions.nutrition && !state.missing.length && <button className="button secondary" disabled={busy} onClick={() => void act("nutrition")}>Confirm my food preferences</button>}
          </div>}
          {teaching && <div className="onboarding-brain" aria-label="Brain review">
            {uncompiled > 0 && <button className="button secondary" disabled={busy} onClick={() => void act("compile")}>Review what I've taught you <span className="onboarding-count">{uncompiled}</span></button>}
            {drafts.length > 0 && <details className="onboarding-inline-card" open={rulesOpen} onToggle={e => setRulesOpen(e.currentTarget.open)}>
              <summary>{drafts.length} draft {drafts.length === 1 ? "rule" : "rules"} to review</summary>
              <p>These are drafts. Approval makes them available for Brain checks.</p>
              {drafts.map((r: any) => <article className="onboarding-rule" key={r.id}><strong>{r.title}</strong><p>{r.condition}</p><p>{r.directive}</p>{r.flags?.length > 0 && <p className="onboarding-warning">Needs individual review: {r.flags.join(", ").replaceAll("_", " ")}</p>}</article>)}
              {!!state.brain.approveAll.length && <button className="button" disabled={busy} onClick={() => void act("approve", { rules: state.brain.approveAll })}>Approve these {state.brain.approveAll.length} clear rules</button>}
              {!!state.brain.flaggedDrafts && <Link className="text-link" href="/trainer/brain/constitution">Review flagged rules</Link>}
            </details>}
            {currentCase ? <div className="onboarding-inline-card onboarding-practice">
              <small>Practice · {state.brain.quiz.open.answered + 1} of {state.brain.quiz.open.total}</small>
              <p><strong>A client says</strong></p><p>{currentCase.message}</p>
              <p><strong>Your Brain would {currentCase.route === "escalate" ? "refer this for review" : "reply"}</strong></p><p>{currentCase.reply}</p>
              <div className="onboarding-options"><button className="button" disabled={busy} onClick={() => void act("quiz-answer", { roundId: state.brain.quiz.open.id, caseId: currentCase.id, verdict: "yes" })}>Yes, that sounds like me</button><button className="button secondary" disabled={busy} onClick={() => { setAnswerMode(true); setScenarioMode(false); input.current?.focus(); }}>I'd say it differently</button></div>
            </div> : confirmed.length > 0 && <button className="button secondary" disabled={busy} onClick={() => void act("quiz")}>Try a client situation</button>}
            {confirmed.length > 0 && <div className="onboarding-inline-card">
              <p>{state.brain.ownCases.count < state.brain.ownCases.forWaitsForMe ? "Let's also check situations you've written yourself." : "Have another situation you'd like to check?"}</p>
              <small>{state.brain.ownCases.count} saved · {state.brain.ownCases.forWaitsForMe} needed for review mode</small>
              <button className="text-link" disabled={busy} onClick={() => { setScenarioMode(true); setAnswerMode(false); setRuleId(confirmed[0]?.id ?? ""); input.current?.focus(); }}>Add a client situation</button>
            </div>}
            {state.brain?.launch?.supervised?.ready && <button className="button" disabled={busy} onClick={() => void act("publish")}>Use Brain in review mode</button>}
            {state.brain?.launch?.supervised?.missing?.length > 0 && <details className="onboarding-inline-card"><summary>What your Brain still needs</summary><ul>{state.brain.launch.supervised.missing.map((item: string) => <li key={item}>{item}</li>)}</ul></details>}
          </div>}
          {!teaching && state.applied.profile && <>
            {state.permissions.nutritionIncluded && !state.permissions.nutrition && <div className="onboarding-inline-card"><p>Your membership includes nutrition. Want to talk through food preferences too?</p><label className="onboarding-choice"><input type="checkbox" checked={nutritionConsent} onChange={e => setNutritionConsent(e.target.checked)} /> I allow nutrition data processing and AI meal planning.</label><button className="button secondary" disabled={!nutritionConsent || busy} onClick={() => void allow(true)}>Continue with food preferences</button><Link className="text-link" href="/app/nutrition">Review nutrition permissions</Link></div>}
            <Link className="button secondary" href="/app/program">{state.programReady ? "Open my workout" : "Check my training plan"}</Link>
            {state.applied.nutrition && <Link className="text-link" href="/app/nutrition">Open Nutrition</Link>}
          </>}
          {state.ready && !review && <button className="button secondary" disabled={busy} onClick={() => setReview(true)}>Review my {teaching ? "profile and page" : "answers"}</button>}
          {!busy && !state.paused && !answerMode && !scenarioMode && !review && <div className="onboarding-options" aria-label="Suggested replies">
            {(choices[field ?? ""] ?? []).map(choice => <button key={choice} className="onboarding-chip" onClick={() => void send(choice)}>{choice}</button>)}
            {field === "availableWeekdays" && <><div className="onboarding-weekdays">{days.map((day, i) => <button type="button" key={day} className="onboarding-chip" aria-pressed={selectedDays.includes(i)} onClick={() => setSelectedDays(current => current.includes(i) ? current.filter(d => d !== i) : [...current, i])}>{day.slice(0, 3)}</button>)}</div><button className="onboarding-chip" disabled={!selectedDays.length} onClick={() => void send("I can train on " + selectedDays.map(d => days[d]).join(", "))}>Use these days</button></>}
            {field === "specialty" && state.setup?.about.specialties.map((s: any) => <button key={s.id} className="onboarding-chip" onClick={() => void send("My specialty is " + s.label)}>{s.label}</button>)}
          </div>}
        </>}
        {busy && <div className="onboarding-pending" role="status"><span aria-hidden="true">•••</span> {sending ? "Working on that…" : "Your reply is still being prepared…"}</div>}
        {problem && <div className="onboarding-error" role="alert"><p>{problem}</p><div className="onboarding-options">
          {restoreRequest.current ? <button className="text-link" disabled={busy} onClick={() => { const saved = restoreRequest.current!; void transmit(saved.path, saved.body, saved.sentText); }}><RotateCcw size={14} /> Retry saved request</button> : <button className="text-link" disabled={busy} onClick={() => void load()}>Refresh conversation</button>}
          {state.error && lastPerson && <button className="text-link" disabled={busy} onClick={() => void transmit("/onboarding-chat/messages", { id: crypto.randomUUID(), version: state.version, mode, text: lastPerson.text, retryOf: lastPerson.id })}>Try reply again</button>}
          {onDetails && <button className="text-link" onClick={onDetails}>Use {teaching ? "setup" : "profile"} forms</button>}
        </div></div>}
        <div ref={end} />
      </div>
      <footer className="onboarding-compose-area">
        {state.permissions.coaching && <>
          {(answerMode || scenarioMode) && <div className="onboarding-compose-context"><span>{answerMode ? "Write the reply you'd use." : "Describe a client situation in your own words."}</span><button className="text-link" onClick={() => { setAnswerMode(false); setScenarioMode(false); }}>Cancel</button>
            {scenarioMode && <><label>Rule to check<select value={ruleId} onChange={e => setRuleId(e.target.value)}>{confirmed.map((r: any) => <option value={r.id} key={r.id}>{r.title}</option>)}</select></label><label className="onboarding-choice"><input type="checkbox" checked={escalate} onChange={e => setEscalate(e.target.checked)} /> This needs referral or human review</label></>}
          </div>}
          <form className="onboarding-composer" onSubmit={e => { e.preventDefault(); void send(); }}>
            <textarea ref={input} aria-label="Your onboarding message" placeholder={answerMode ? "I'd say…" : scenarioMode ? "A client tells me…" : "Message…"} value={text} maxLength={4000} rows={2} disabled={!state.permissions.coaching} onChange={e => setText(e.target.value)} onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); void send(); }
            }} />
            <button type="submit" className="onboarding-send" aria-label="Send message" disabled={busy || !text.trim()}><ArrowUp size={22} /></button>
          </form>
          <div className="onboarding-utilities"><span>{text ? "Draft saved on this device" : "A few words is enough"}</span><button className="text-link" disabled={busy} onClick={() => void act(state.paused ? "resume" : "pause")}><Pause size={13} />{state.paused ? "Continue" : "Save for later"}</button>{!state.paused && field && !["review", "teaching"].includes(field) && <button className="text-link" disabled={busy} onClick={() => void act("skip")}>Ask later</button>}</div>
        </>}
        <div className="onboarding-footer-links">
          {onDetails && <button className="text-link" onClick={onDetails}>Use {teaching ? "setup" : "profile"} forms</button>}
          {teaching && <><Link className="text-link" href="/setup/page?details=1">Page details</Link><Link className="text-link" href="/setup/plan?details=1">Offer details</Link><Link className="text-link" href="/setup/live?details=1">Launch checks</Link></>}
        </div>
      </footer>
    </div>
  </section>;
}
