"use client";
import { VoiceOneOnOne } from "./voice-one-on-one";
import { BrainFidelity } from "./brain-fidelity";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useConversationMotion } from "./onboarding-motion";
import Link from "next/link";
import { ArrowUp, ArrowDown, Send, Check, MessageCircle, Pause, RotateCcw, Phone, Mic, MoreHorizontal, ChevronRight, Sparkles } from "lucide-react";
import type { ChatData, ChatMessage, OnboardingAttachment } from "../../../packages/domain/src/onboarding-chat";
import type { CoachingCoverage } from "../../../packages/domain/src/coaching-interview";
import { useWorkspaceValue } from "./workspace-continuity";
import { MemberIntake } from "./member-intake";
import { OnboardingFiles, OnboardingFile, type OnboardingFilesHandle } from "./onboarding-files";
import { OnboardingCall } from "./onboarding-call";
import { ConversationTools, type ConversationPanel } from "./onboarding-tools";
import { chatAppearance, onboardingRequest as request, type ChatAppearance } from "../lib/onboarding-http";

type State = ChatData & {
  id: string; version: number; ready: boolean; missing: string[]; programReady?: boolean;
  permissions: { coaching: boolean; nutrition: boolean; nutritionIncluded: boolean; active: boolean };
  setup?: any; brain?: any;
  coachingCoverage?: CoachingCoverage;
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
  const motion = useConversationMotion();
  const [state, setState] = useState<State | null>(null);
  const [text, setText, clearText] = useWorkspaceValue("onboarding:composer:" + audience, "", true);
  const [sending, setSending] = useState(false), [error, setError] = useState("");
  const [appearance, setAppearance] = useState<ChatAppearance>("web");
  const [files, setFiles] = useWorkspaceValue<OnboardingAttachment[]>("onboarding:files:" + audience, [], true);
  const [uploading, setUploading] = useState(false), [dragging, setDragging] = useState(false);
  const [callOpen, setCallOpen] = useState(false), [callActive, setCallActive] = useState(false);
  const [optimistic, setOptimistic] = useState<ChatMessage | null>(null), [arriving, setArriving] = useState<Set<string>>(new Set()), [newMessages, setNewMessages] = useState(false);
  const known = useRef<Set<string> | null>(null), nearBottom = useRef(true), thread = useRef<HTMLDivElement>(null), filePicker = useRef<OnboardingFilesHandle>(null), textRef = useRef(text);
  textRef.current = text;
  const [panel, setPanel] = useState<ConversationPanel>(null), [rulesOpen, setRulesOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const sentHere = useRef(new Set<string>()), composer = useRef<HTMLElement>(null);
  const [answerMode, setAnswerMode] = useState(false), [scenarioMode, setScenarioMode] = useState(false);
  const [ruleId, setRuleId] = useState(""), [escalate, setEscalate] = useState(false);
  const [older, setOlder] = useState<ChatMessage[]>([]), [before, setBefore] = useState<string | null>(null), [historyDone, setHistoryDone] = useState(false);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [consent, setConsent] = useState(false), [nutritionConsent, setNutritionConsent] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null);
  const flight = useRef(false), mounted = useRef(true), latest = useRef<State | null>(null);
  const restoreRequest = useRef<{ path: string; body: any; sentText?: string } | null>(null);
  latest.current = state;
  const receive = useCallback((next: State) => {
    if (!mounted.current) return;
    const ids = new Set(next.messages.map(m => m.id));
    const unseen = known.current ? [...ids].filter(id => !known.current!.has(id)) : [];
    if (unseen.length) setArriving(current => new Set([...current, ...unseen]));
    known.current = new Set([...(known.current ?? []), ...ids]);
    setState(next);
    setOptimistic(old => old && ids.has(old.id) ? null : old);
  }, []);
  const load = useCallback(async () => {
    try {
      const next = await request("/onboarding-chat?mode=" + mode);
      if (mounted.current) { receive(next); setError(""); }
    } catch (e) { if (mounted.current) setError((e as Error).message); }
  }, [mode, receive]);
  useEffect(() => { setAppearance(chatAppearance(navigator.userAgent, navigator.platform, navigator.maxTouchPoints)); }, []);
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; };
  }, [load]);
  useEffect(() => {
    if (!state?.pending || sending) return;
    const id = window.setInterval(() => { void load(); }, 4000);
    return () => window.clearInterval(id);
  }, [state?.pending?.id, sending, load]);
  useEffect(() => { if (state && !state.permissions.coaching) { setFiles([]); setOptimistic(null); setOlder([]); } }, [state?.permissions.coaching, setFiles]);
  useLayoutEffect(() => {
    const root = thread.current;
    if (!root) return;
    // Place new content in view before its first animated frame. Smooth scrolling
    // here can finish after the bubble's pop and can falsely mark us as reading history.
    if (nearBottom.current) root.scrollTop = root.scrollHeight;
    else if (state?.messages.at(-1)?.from === "assistant") setNewMessages(true);
  }, [state?.messages.at(-1)?.id, state?.pending?.id, sending, optimistic?.id]);
  useEffect(() => { if (input.current) { input.current.style.height = "0px"; input.current.style.height = Math.min(input.current.scrollHeight, 144) + "px"; } }, [text, sending]);
  useEffect(() => {
    if (!arriving.size) return;
    const timer = window.setTimeout(() => setArriving(new Set()), 900);
    return () => window.clearTimeout(timer);
  }, [arriving]);
  useEffect(() => {
    if (!composer.current || !thread.current) return;
    const observer = new ResizeObserver(() => {
      if (nearBottom.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
    });
    observer.observe(composer.current);
    return () => observer.disconnect();
  }, [state?.id]);
  const busy = sending || !!state?.pending || callActive;
  const act = async (action: string, extra: Record<string, any> = {}) => {
    if (!latest.current || flight.current || latest.current.pending) return;
    setPanel(null);
    const next = await transmit("/onboarding-chat/actions", { id: crypto.randomUUID(), version: latest.current.version, action, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...extra });
    if (next && !next.error && ["compile", "approve"].includes(action)) { setRulesOpen(true); setPanel("brain"); }
    if (next && !next.error && ["profile", "offer", "nutrition"].includes(action)) setPanel("details");
  };
  async function transmit(path: string, body: any, sentText?: string) {
    if (flight.current) return;
    flight.current = true; setSending(true); setError("");
    restoreRequest.current = { path, body, sentText };
    if (path.endsWith("/messages") && !body.retryOf) {
      nearBottom.current = true;
      known.current?.add(body.id);
      sentHere.current.add(body.id);
      setArriving(current => new Set([...current, body.id]));
      setOptimistic({ id: body.id, from: "person", text: body.text || "I've shared a file for us to look at.", at: new Date().toISOString(), attachments: files });
    }
    try {
      const next = await request(path, body);
      restoreRequest.current = null;
      if (["quiz-answer", "scenario"].includes(body.action) && !next.error) { setText(""); clearText(); }
      if (sentText !== undefined && next.messages?.some((m: ChatMessage) => m.from === "person" && m.id === body.id)) {
        if (textRef.current.trim() === sentText) { setText(""); clearText(); }
        setFiles(files.filter(f => !body.attachmentIds?.includes(f.id)));
      }
      if (mounted.current) {
        receive(next);
        if (!next.error) { setAnswerMode(false); setScenarioMode(false); }
      }
      // A failed background refresh must never turn a successful save into a resend.
      if (!next.error && path.endsWith("/actions")) void Promise.resolve(onSaved?.()).catch(() => {});
      return next;
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        if ((e as any).status) setOptimistic(null);
        if ((e as any).status === 409) { restoreRequest.current = null; await load(); setError((e as Error).message); }
      }
    } finally {
      flight.current = false; if (mounted.current) setSending(false);
    }
  }
  async function send(value = text) {
    const clean = value.trim();
    if ((!clean && !files.length) || !state || busy || uploading || flight.current) return;
    if (answerMode && currentCase) { await act("quiz-answer", { roundId: state.brain.quiz.open.id, caseId: currentCase.id, verdict: "change", text: clean }); return; }
    if (scenarioMode) { await act("scenario", { text: clean, ruleId, escalate }); return; }
    await transmit("/onboarding-chat/messages", { id: crypto.randomUUID(), version: state.version, mode, text: clean, ...(files.length ? { attachmentIds: files.map(f => f.id), attachmentRights: true } : {}) }, clean);
  }
  async function allow(food = false) {
    if (flight.current) return;
    flight.current = true; setSending(true); setError("");
    try {
      for (const type of food ? ["nutrition", "nutrition_model"] : ["coaching"])
        await request("/privacy/consent", { type, granted: true });
      const current = await request("/onboarding-chat?mode=" + mode);
      receive(current);
      if (food) {
        const next = await request("/onboarding-chat/actions", { id: crypto.randomUUID(), version: current.version, action: "resume" });
        receive(next);
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
  const messages = [...older, ...(state?.messages ?? []), ...(optimistic && !state?.messages.some(m => m.id === optimistic.id) ? [optimistic] : [])];
  const lastAssistant = messages.map(message => message.from).lastIndexOf("assistant");
  if (!state) return <section className="onboarding-chat" data-chat-style={appearance} aria-label="Onboarding conversation"><div className="onboarding-loading" role="status">{error || "Opening your conversation…"}</div>{error && <button className="button secondary" onClick={() => void load()}>Try again</button>}</section>;
  return <section className={"onboarding-chat" + (dragging ? " drag-over" : "")} data-chat-style={appearance} data-chat-motion={motion.enabled ? "on" : "off"} data-chat-mode={mode} aria-label={teaching ? "Trainer onboarding conversation" : "Your coaching profile conversation"} onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }} onDrop={e => { e.preventDefault(); setDragging(false); filePicker.current?.add(Array.from(e.dataTransfer.files)); }}>
    <header className="onboarding-chat-header">
      <span className="onboarding-avatar" aria-hidden="true">K</span>
      <div><h1>Kamran <small>AI</small></h1><p><span className="onboarding-presence" key={callActive ? "call" : sending || state.pending ? "reply" : state.paused ? "paused" : "ready"}>{callActive ? "Voice call in progress" : sending || state.pending ? "Replying…" : state.paused ? "Conversation saved · paused" : teaching ? mode === "teach" ? "Your coaching ideas, in your words" : "Your setup conversation" : "Your coaching conversation"}</span></p></div>
      <button type="button" className="onboarding-icon" aria-label={callActive ? "Return to voice call" : "Start voice conversation"} disabled={!state.permissions.coaching || sending || !!state.pending} onClick={() => setCallOpen(true)}><Phone size={20} /></button>
      <button type="button" className="onboarding-icon onboarding-more" aria-label="Conversation options" aria-haspopup="dialog" aria-expanded={panel !== null} onClick={() => setPanel("menu")}><MoreHorizontal size={22} />{(uncompiled > 0 || drafts.length > 0 || state.ready && !state.applied.profile) && <span className="onboarding-attention" aria-hidden="true" />}</button>
    </header>
    <OnboardingCall audience={audience} mode={mode} open={callOpen} onOpenChange={setCallOpen} onConversation={receive} onActiveChange={setCallActive} />
    <ConversationTools panel={panel} onPanel={setPanel} motionEnabled={motion.enabled}>
      {panel === "menu" && <div className="onboarding-tool-menu">
        <div className="onboarding-motion-choice">
          <label htmlFor="conversation-motion">Message animations</label>
          <select id="conversation-motion" value={motion.choice} onChange={e => motion.choose(e.target.value as "system" | "on" | "off")} aria-describedby="conversation-motion-detail">
            <option value="system">Match this device</option><option value="on">On</option><option value="off">Off</option>
          </select>
          <small id="conversation-motion-detail">{motion.enabled ? "New messages pop in and reply dots move." : motion.choice === "system" ? "Your device or display preference is reducing motion. Choose On to animate this conversation." : "Messages appear without movement."}</small>
        </div>
        <button type="button" className="onboarding-tool-action" onClick={() => setPanel("details")}><Check size={18} /><span>View saved details<small>Review the answers you've shared</small></span><ChevronRight size={16} /></button>
        {teaching && <button type="button" className="onboarding-tool-action" onClick={() => setPanel("brain")}><Sparkles size={18} /><span>Brain review<small>{uncompiled ? uncompiled + " new teaching notes" : drafts.length ? drafts.length + " draft rules" : "Rules, practice and your client situations"}</small></span><ChevronRight size={16} /></button>}
        {state.permissions.coaching && <>
          <button type="button" className="onboarding-tool-action" disabled={busy} onClick={() => void act(state.paused ? "resume" : "pause")}><Pause size={18} /><span>{state.paused ? "Continue conversation" : "Save for later"}<small>Your conversation and draft stay saved</small></span></button>
          {!state.paused && field && !["review", "teaching", "coaching.review"].includes(field) && <button type="button" className="onboarding-tool-action" disabled={busy} onClick={() => void act("skip")}><span>Ask later<small>Come back to the current question</small></span></button>}
          {!state.paused && state.skipped.length > 0 && <button type="button" className="onboarding-tool-action" disabled={busy} onClick={() => void act("resume")}><RotateCcw size={18} /><span>Revisit deferred questions<small>Continue with the details we left for later</small></span></button>}
          {!!((choices[field ?? ""] ?? []).length || field === "availableWeekdays" || field === "specialty") && <button type="button" className="onboarding-tool-action" disabled={busy} onClick={() => { setShowSuggestions(!showSuggestions); setPanel(null); }}><MessageCircle size={18} /><span>{showSuggestions ? "Hide suggested replies" : "Suggested replies"}<small>Optional shortcuts for this question</small></span></button>}
        </>}
        <div className="onboarding-tool-links">
          {onDetails && <button className="text-link" onClick={() => { setPanel(null); onDetails(); }}>Use {teaching ? "setup" : "profile"} forms</button>}
          {teaching && <><Link className="text-link" href="/setup/page?details=1">Page details</Link><Link className="text-link" href="/setup/plan?details=1">Offer details</Link><Link className="text-link" href="/setup/live?details=1">Launch checks</Link></>}
          {!teaching && state.applied.nutrition && <Link className="text-link" href="/app/nutrition">Open Nutrition</Link>}
        </div>
      </div>}
          {panel === "details" && <div className="onboarding-inline-card onboarding-review">
            <p>Tell me what to change. {teaching ? "Draft rules need your approval before they can be used." : "Your coach uses the profile you confirm below."}</p>
            {rows.length ? <dl>{rows.map(([key, value]) => <div key={key}><dt>{labels[key] ?? key}</dt><dd>{valueText(key, value, state)} <button className="text-link" aria-label={"Change " + (labels[key] ?? key)} onClick={() => { setText("Change my " + (labels[key] ?? key).toLowerCase() + " to "); setPanel(null); requestAnimationFrame(() => requestAnimationFrame(() => input.current?.focus())); }}>Change</button></dd></div>)}</dl> : <p>Your answers will appear here.</p>}
            {state.missing.length > 0 && <p className="muted">Still to cover: {state.missing.map(k => labels[k] ?? k).join(", ")}.</p>}
            {state.ready && <button className="button" disabled={busy} onClick={() => void act("profile")}>{teaching ? "Save profile and page draft" : "Confirm my coaching profile"}</button>}
            {teaching && state.facts.name && state.facts.priceAed && state.facts.billing && <button className="button secondary" disabled={busy} onClick={() => void act("offer")}>Save offer draft</button>}
            {!teaching && state.permissions.nutrition && !state.missing.length && <button className="button secondary" disabled={busy} onClick={() => void act("nutrition")}>Confirm my food preferences</button>}
          </div>}
          {panel === "brain" && teaching && <div className="onboarding-brain" aria-label="Brain review">
            <details className="onboarding-inline-card"><summary>Your communication style</summary><VoiceOneOnOne /></details>
            <details className="onboarding-inline-card"><summary>Compare my replies</summary><BrainFidelity /></details>
            {state.coachingCoverage && <details className="onboarding-inline-card onboarding-coverage">
              <summary>{state.coachingCoverage.covered} of {state.coachingCoverage.total} coaching topics covered</summary>
              <p>These are the details you've explained. Your draft rules still need review and practice checks before your Brain uses them.</p>
              {state.coachingCoverage.topics.map(topic => <details key={topic.id}>
                <summary>{topic.title}<small>{topic.status === "covered" ? "Covered" : topic.status === "partial" ? "More detail needed" : topic.status === "deferred" ? "Left for later" : "Still to discuss"}</small></summary>
                {topic.notes.map(note => <blockquote key={note.point}>{note.evidence}</blockquote>)}
                {topic.next && <p>{topic.next}</p>}
              </details>)}
            </details>}
            {!uncompiled && !drafts.length && !confirmed.length && <p>Share how you coach in our conversation. We can review your teaching here when you're ready.</p>}
            {uncompiled > 0 && <button className="button secondary" disabled={busy} onClick={() => void act("compile")}>Review what I've taught you <span className="onboarding-count">{uncompiled}</span></button>}
            {drafts.length > 0 && <details className="onboarding-inline-card" open={rulesOpen} onToggle={e => setRulesOpen(e.currentTarget.open)}>
              <summary>{drafts.length} draft {drafts.length === 1 ? "rule" : "rules"} to review</summary>
              <p>These are drafts. Approval makes them available for Brain checks.</p>
              {drafts.map((r: any) => <article className="onboarding-rule" key={r.id}><strong>{r.title}</strong><p>{r.condition}</p><p>{r.directive}</p>{r.flags?.length > 0 && <p className="onboarding-warning">Needs individual review: {r.flags.join(", ").replaceAll("_", " ")}</p>}</article>)}
              {!!state.brain.approveAll.length && <button className="button" disabled={busy} onClick={() => void act("approve", { rules: state.brain.approveAll })}>Approve these {state.brain.approveAll.length} clear rules</button>}
              {!!state.brain.flaggedDrafts && <Link className="text-link" href="/trainer/brain/constitution">Review flagged rules</Link>}
            </details>}
            {confirmed.length > 0 && <button className="button secondary" disabled={busy} onClick={() => { if (currentCase) { setPanel(null); nearBottom.current = true; requestAnimationFrame(() => thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: motion.enabled ? "smooth" : "auto" })); } else void act("quiz"); }}>{currentCase ? "Continue practice" : "Try a client situation"}</button>}
            {confirmed.length > 0 && <div className="onboarding-inline-card">
              <p>{state.brain.ownCases.count < state.brain.ownCases.forWaitsForMe ? "Let's also check situations you've written yourself." : "Have another situation you'd like to check?"}</p>
              <small>{state.brain.ownCases.count} saved · {state.brain.ownCases.forWaitsForMe} needed for review mode</small>
              <button className="text-link" disabled={busy} onClick={() => { setScenarioMode(true); setAnswerMode(false); setRuleId(confirmed[0]?.id ?? ""); setPanel(null); requestAnimationFrame(() => requestAnimationFrame(() => input.current?.focus())); }}>Add a client situation</button>
            </div>}
            {state.brain?.launch?.supervised?.ready && <button className="button" disabled={busy} onClick={() => void act("publish")}>Use Brain in review mode</button>}
            {state.brain?.launch?.supervised?.missing?.length > 0 && <details className="onboarding-inline-card"><summary>What your Brain still needs</summary><ul>{state.brain.launch.supervised.missing.map((item: string) => <li key={item}>{item}</li>)}</ul></details>}
          </div>}
    </ConversationTools>
    <div className="onboarding-chat-body">
      <div className="onboarding-thread" ref={thread} onScroll={e => { const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop < 80; if (nearBottom.current) setNewMessages(false); }}>
        {state.archived && !historyDone ? <button className="text-link" disabled={busy} onClick={async () => {
          try { const root = thread.current, height = root?.scrollHeight ?? 0, top = root?.scrollTop ?? 0; const result = await request("/onboarding-chat/history" + (before ? "?before=" + encodeURIComponent(before) : "")); setOlder(old => [...result.messages, ...old]); setBefore(result.before); if (!result.messages.length) setHistoryDone(true); requestAnimationFrame(() => { if (root) root.scrollTop = top + root.scrollHeight - height; }); } catch (e) { setError((e as Error).message); }
        }}>Earlier messages</button> : null}
        <div className="onboarding-messages" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
          {messages.map((message, i) => <div key={message.id} className={"onboarding-message " + message.from + (messages[i - 1]?.from === message.from ? " grouped" : "") + (arriving.has(message.id) ? " arriving" : "")} data-message-id={message.id} data-sent-here={sentHere.current.has(message.id) ? "true" : undefined} style={{ "--chat-arrival-delay": Math.min(180, [...arriving].filter(id => messages.find(m => m.id === id)?.from === "assistant").indexOf(message.id) * 90) + "ms" } as CSSProperties} onAnimationEnd={event => { if (event.target === event.currentTarget) setArriving(current => { const next = new Set(current); next.delete(message.id); return next; }); }}>
            <span className="sr-only">{message.from === "person" ? "You" : "Assistant"}: </span>
            {message.attachments?.map(file => <OnboardingFile file={file} key={file.id} />)}
            <p className="onboarding-message-content" dir="auto">{message.text}</p>
            {i === lastAssistant && !busy && <div className="onboarding-message-actions">
              {state.ready && !state.applied.profile && <button type="button" className="onboarding-message-link" onClick={() => setPanel("details")}>Review my {teaching ? "profile and page" : "answers"}<ChevronRight size={14} /></button>}
              {!teaching && state.applied.profile && <Link className="onboarding-message-link" href="/app/program">{state.programReady ? "Open my workout" : "Check my training plan"}<ChevronRight size={14} /></Link>}
            </div>}
            <span className="onboarding-message-meta">{message.source === "voice" && <Mic size={11} aria-label="From your voice conversation" />}<time dateTime={message.at}>{new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>{message.from === "person" && (optimistic?.id === message.id ? <span className="onboarding-saving">{error ? "Not confirmed" : "Sending…"}</span> : <Check className="onboarding-saved-check" size={13} aria-label="Saved" />)}</span>
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
          {teaching && currentCase && <div className="onboarding-message assistant onboarding-practice">
            <small>Practice · {state.brain.quiz.open.answered + 1} of {state.brain.quiz.open.total}</small>
            <p><strong>A client says</strong></p><p>{currentCase.message}</p>
            <p><strong>Your Brain would {currentCase.route === "escalate" ? "refer this for review" : "reply"}</strong></p><p>{currentCase.reply}</p>
            <div className="onboarding-options"><button className="onboarding-reply" disabled={busy} onClick={() => void act("quiz-answer", { roundId: state.brain.quiz.open.id, caseId: currentCase.id, verdict: "yes" })}>Yes, that sounds like me</button><button className="onboarding-reply" disabled={busy} onClick={() => { setAnswerMode(true); setScenarioMode(false); input.current?.focus(); }}>I'd say it differently</button></div>
          </div>}
          {!teaching && state.applied.profile && <>
            {state.permissions.nutritionIncluded && !state.permissions.nutrition && <div className="onboarding-inline-card"><p>Your membership includes nutrition. Want to talk through food preferences too?</p><label className="onboarding-choice"><input type="checkbox" checked={nutritionConsent} onChange={e => setNutritionConsent(e.target.checked)} /> I allow nutrition data processing and AI meal planning.</label><button className="button secondary" disabled={!nutritionConsent || busy} onClick={() => void allow(true)}>Continue with food preferences</button><Link className="text-link" href="/app/nutrition">Review nutrition permissions</Link></div>}
          </>}
          {!busy && !state.paused && !answerMode && !scenarioMode && showSuggestions && <div className="onboarding-options" aria-label="Suggested replies">
            {(choices[field ?? ""] ?? []).map(choice => <button key={choice} className="onboarding-chip" onClick={() => void send(choice)}>{choice}</button>)}
            {field === "availableWeekdays" && <><div className="onboarding-weekdays">{days.map((day, i) => <button type="button" key={day} className="onboarding-chip" aria-pressed={selectedDays.includes(i)} onClick={() => setSelectedDays(current => current.includes(i) ? current.filter(d => d !== i) : [...current, i])}>{day.slice(0, 3)}</button>)}</div><button className="onboarding-chip" disabled={!selectedDays.length} onClick={() => void send("I can train on " + selectedDays.map(d => days[d]).join(", "))}>Use these days</button></>}
            {field === "specialty" && state.setup?.about.specialties.map((s: any) => <button key={s.id} className="onboarding-chip" onClick={() => void send("My specialty is " + s.label)}>{s.label}</button>)}
          </div>}
        </>}
        {(sending || state.pending) && <div className="onboarding-pending" role="status"><span className="onboarding-typing" aria-hidden="true"><i /><i /><i /></span><span className="sr-only">Preparing your reply…</span></div>}
        {problem && <div className="onboarding-error" role="alert"><p>{problem}</p><div className="onboarding-options">
          {restoreRequest.current ? <button className="text-link" disabled={busy} onClick={() => { const saved = restoreRequest.current!; void transmit(saved.path, saved.body, saved.sentText); }}><RotateCcw size={14} /> Retry saved request</button> : <button className="text-link" disabled={busy} onClick={() => void load()}>Refresh conversation</button>}
          {state.error && lastPerson && <button className="text-link" disabled={busy} onClick={() => void transmit("/onboarding-chat/messages", { id: crypto.randomUUID(), version: state.version, mode, text: lastPerson.text, retryOf: lastPerson.id })}>Try reply again</button>}
          {onDetails && <button className="text-link" onClick={onDetails}>Use {teaching ? "setup" : "profile"} forms</button>}
        </div></div>}
        <div ref={end} />
      </div>
      <footer className="onboarding-compose-area" ref={composer}>
      {newMessages && <button type="button" className="onboarding-latest" aria-label="Latest messages" onClick={() => { nearBottom.current = true; thread.current?.scrollTo({ top: thread.current.scrollHeight, behavior: motion.enabled ? "smooth" : "auto" }); setNewMessages(false); }}><ArrowDown size={16} /><span className="sr-only">Latest messages</span></button>}
        {state.permissions.coaching && <>
          {(answerMode || scenarioMode) && <div className="onboarding-compose-context"><span>{answerMode ? "Write the reply you'd use." : "Describe a client situation in your own words."}</span><button className="text-link" onClick={() => { setAnswerMode(false); setScenarioMode(false); }}>Cancel</button>
            {scenarioMode && <><label>Rule to check<select value={ruleId} onChange={e => setRuleId(e.target.value)}>{confirmed.map((r: any) => <option value={r.id} key={r.id}>{r.title}</option>)}</select></label><label className="onboarding-choice"><input type="checkbox" checked={escalate} onChange={e => setEscalate(e.target.checked)} /> This needs referral or human review</label></>}
          </div>}
          {!!files.length && <div className="onboarding-file-tray" aria-label="Files ready to send">{files.map(file => <OnboardingFile key={file.id} file={file} disabled={busy || uploading} remove={() => { void request("/onboarding-chat/attachments/" + file.id, undefined, { method: "DELETE" }).then(() => setFiles(files.filter(f => f.id !== file.id))).catch(e => setError(e.message)); }} />)}<small>Check the preview before sending. Tell me what you'd like to use from these files.</small></div>}
          <form className="onboarding-composer" onSubmit={e => { e.preventDefault(); void send(); }}>
            <OnboardingFiles ref={filePicker} files={files} onChange={setFiles} onBusy={setUploading} disabled={busy || answerMode || scenarioMode} ios={appearance === "ios"} />
            <textarea ref={input} aria-label="Your onboarding message" placeholder={answerMode ? "I'd say…" : scenarioMode ? "A client tells me…" : callActive ? "Your call is in progress…" : "Message…"} value={sending && restoreRequest.current?.sentText === text.trim() ? "" : text} maxLength={4000} rows={1} disabled={!state.permissions.coaching || callActive} onChange={e => setText(e.target.value)} onPaste={e => { const pasted = Array.from(e.clipboardData.files); if (pasted.length) { e.preventDefault(); filePicker.current?.add(pasted); } }} onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); void send(); }
            }} />
            <button type="submit" className="onboarding-send" data-sending={sending ? "true" : undefined} aria-label="Send message" disabled={busy || uploading || (!text.trim() && !files.length)}>{appearance === "ios" ? <ArrowUp size={22} /> : <Send size={19} />}</button>
          </form>
          {state.paused && <div className="onboarding-paused"><span>Conversation paused</span><button className="text-link" disabled={busy} onClick={() => void act("resume")}>Continue</button></div>}
        </>}
      </footer>
    </div>
  </section>;
}
