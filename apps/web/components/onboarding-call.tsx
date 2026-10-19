"use client";
import { useLocale } from "../lib/i18n/react";
import { onboardingCopy } from "../lib/onboarding-copy";
import { useEffect, useRef, useState } from "react";
import Link from "./preview-navigation";
import { Mic, MicOff, Phone, PhoneOff, MessageCircle, X, ArrowDown } from "lucide-react";
import { ConversationAudio, pcmWav } from "../lib/conversation-audio";
import { VoiceWaitCues } from "../lib/voice-wait-cues";
import { VoiceInput, VOICE_SAMPLE_RATE } from "../lib/voice-input";
import { VoicePlayback } from "../lib/voice-playback";
import { setAudioSessionType } from "../lib/audio-session";
import { fileBase64, onboardingRequest as request } from "../lib/onboarding-http";

type Phase = "off" | "connecting" | "listening" | "hearing" | "thinking" | "speaking" | "paused" | "ended";
const words: Record<Phase, string> = { off: "A conversation, at your pace", connecting: "Connecting…", listening: "I'm listening", hearing: "Listening…", thinking: "Thinking about that…", speaking: "Speaking…", paused: "Call paused", ended: "Your conversation is saved" };
const clock = (n: number) => Math.floor(n / 60).toString().padStart(2, "0") + ":" + (n % 60).toString().padStart(2, "0");
type Resources = { context: AudioContext; stream: MediaStream; input?: VoiceInput; echo: boolean; tentative?: boolean; capture: ConversationAudio; player?: VoicePlayback; cue?: AudioBufferSourceNode };
export function OnboardingCall({ audience, mode, purpose = "onboarding", coachName = "Kamran", open, onOpenChange, onConversation, onActiveChange }: {
  purpose?: "onboarding" | "coaching"; coachName?: string;
  audience: "coach" | "member"; mode: "setup" | "teach" | "website"; open: boolean; onOpenChange: (v: boolean) => void;
  onConversation: (state: any) => void; onActiveChange: (active: boolean) => void;
}) {
  const locale = useLocale();
  const copy = (text: string) => onboardingCopy(locale, text);
  const prefix = purpose === "coaching" ? "/coaching/calls" : "/onboarding-chat/calls";
  const [options, setOptions] = useState<any>(null), [phase, setPhase] = useState<Phase>("off"), [error, setError] = useState("");
  const [consent, setConsent] = useState(false), [makeVoice, setMakeVoice] = useState(false), [cloneConsent, setCloneConsent] = useState(false);
  const [language, setLanguage] = useState<"en" | "ar">(locale), [seconds, setSeconds] = useState(0), [muted, setMuted] = useState(false);
  const [sampleSeconds, setSampleSeconds] = useState(0), [cloneState, setCloneState] = useState(""), [cloneError, setCloneError] = useState("");
  const [waitNote, setWaitNote] = useState(""), [cueSpeaking, setCueSpeaking] = useState(false);
  const cueClips = useRef<string[]>([]), waitCues = useRef<VoiceWaitCues | null>(null), inFlight = useRef(false), interrupted = useRef(false), queued = useRef<Float32Array[] | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), epoch = useRef(0), alive = useRef(true), phaseRef = useRef<Phase>("off"), mute = useRef(false);
  const call = useRef<any>(null), resources = useRef<Resources | null>(null), abort = useRef<AbortController | null>(null), started = useRef(0);
  const cloning = useRef(false), clone = useRef<any>(null), samples = useRef<Float32Array[]>([]), sampleRate = useRef(16000), cloneFlight = useRef(false);
  const latest = useRef({ onConversation, onActiveChange }); latest.current = { onConversation, onActiveChange };
  const change = (next: Phase) => { phaseRef.current = next; if (alive.current) setPhase(next); };
  const current = (token: number) => alive.current && epoch.current === token && !!call.current;
  const active = !["off", "ended"].includes(phase);

  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  useEffect(() => {
    if (!open || options) return;
    let cancelled = false;
    void request(prefix + "/options").then(value => { if (!cancelled) setOptions(value); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [open, options]);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - started.current) / 1000));
      if (Date.now() - started.current >= 30 * 60000) { stop(false); setError("This call reached 30 minutes. Your conversation is saved."); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  useEffect(() => {
    alive.current = true;
    const leave = () => { if (document.hidden && !["off", "ended"].includes(phaseRef.current)) { stop(false); setError("The call ended when you left the app. Your conversation is saved."); } };
    document.addEventListener("visibilitychange", leave);
    return () => { alive.current = false; document.removeEventListener("visibilitychange", leave); stop(false); };
  }, []);

  function stopCue() {
    if (alive.current) setCueSpeaking(false);
    try { resources.current?.cue?.stop(); } catch {}
    if (resources.current) resources.current.cue = undefined;
  }
  function stopWaiting() { waitCues.current?.end(); if (alive.current) setWaitNote(""); }
  async function playCue(encoded: string, valid: () => boolean, token: number) {
    const r = resources.current;
    if (!r || !valid() || !current(token) || mute.current || interrupted.current) return;
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const buffer = await r.context.decodeAudioData(bytes.buffer);
    await r.context.resume();
    if (!valid() || !current(token) || resources.current !== r || mute.current || interrupted.current) return;
    // Cues have a hard length bound even if a provider returns unexpected audio.
    await new Promise<void>(resolve => {
      const source = r.context.createBufferSource(); source.buffer = buffer; source.connect(r.context.destination); r.cue = source; setCueSpeaking(true);
      source.onended = () => { source.disconnect(); if (r.cue === source) { r.cue = undefined; if (alive.current) setCueSpeaking(false); } resolve(); };
      source.start(); source.stop(r.context.currentTime + Math.min(buffer.duration, 4));
    });
  }
  function drain(token: number) {
    if (!current(token) || inFlight.current) return;
    const next = queued.current;
    if (next) { queued.current = null; void turn(next, token, false); }
    else change(mute.current ? "paused" : resources.current?.capture.active ? "hearing" : "listening");
  }
  function closeAudio() {
    stopWaiting(); cueClips.current = []; queued.current = null; inFlight.current = false;
    const r = resources.current; resources.current = null;
    setAudioSessionType("ambient");
    if (!r) return;
    r.input?.dispose();
    try { r.player?.stop(); } catch {}
    r.stream.getTracks().forEach(track => track.stop());
    void r.context.close().catch(() => {});
    r.capture.reset();
  }
  function stop(saveSample = true) {
    if (saveSample && cloning.current && !cloneFlight.current && clone.current && resources.current) {
      const length = samples.current.reduce((n, s) => n + s.length, 0) / sampleRate.current;
      if (length >= 10) void createVoice();
    }
    const old = call.current; call.current = null;
    epoch.current++; abort.current?.abort(); closeAudio(); samples.current = []; cloning.current = false;
    latest.current.onActiveChange(false);
    if (old) void request(prefix + "/" + old.id + "/end", {}, { keepalive: true }).catch(() => {});
    if (alive.current) { change("ended"); setMuted(false); } else phaseRef.current = "ended";
  }
  async function createVoice() {
    const c = clone.current;
    if (!c || cloneFlight.current || !cloning.current) return;
    const pcm = samples.current; samples.current = [];
    const wav = pcmWav(pcm, sampleRate.current, 60);
    if (wav.durationMs < 10000) return;
    cloneFlight.current = true; if (alive.current) setCloneState("Creating your voice…");
    try {
      const uploaded = await request("/voice/clones/" + c.id + "/samples", { audio: await fileBase64(wav.blob), type: "audio/wav", durationSeconds: wav.durationMs / 1000 });
      const result = await request("/voice/clones/" + c.id + "/submit", { revision: uploaded.version });
      clone.current = result;
      if (alive.current) { setCloneState(result.status === "ready" ? "Your voice is ready to preview" : result.progress ?? "Your voice is being prepared"); if (result.error) setCloneError(result.error.message); }
    } catch (e) {
      // Never make a second clone for an uncertain provider outcome.
      if (alive.current) { setCloneState("Voice sample needs a check"); setCloneError((e as Error).message); }
    }
  }
  async function play(encoded: string, token: number) {
    const r = resources.current;
    if (!r || !current(token)) return;
    stopWaiting(); change("speaking"); r.capture.reset();
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const buffer = await r.context.decodeAudioData(bytes.buffer);
    if (!current(token) || resources.current !== r || interrupted.current) return;
    await r.context.resume();
    if (!current(token) || resources.current !== r || interrupted.current) return;
    const player = new VoicePlayback(r.context, buffer, buffer.duration);
    r.player = player;
    if (!r.tentative) player.resume();
    await player.done;
    if (r.player === player) r.player = undefined;
    // Avoid collecting the speaker's tail as the trainer's next answer/sample.
    if (!interrupted.current) await new Promise(resolve => setTimeout(resolve, 350));
  }
  async function exchange(body: any, token: number) {
    if (!current(token) || inFlight.current) return;
    inFlight.current = true; interrupted.current = false;
    change("thinking"); setWaitNote(""); waitCues.current?.begin();
    const path = prefix + "/" + call.current.id + "/turns";
    let complete = false;
    try {
      let result;
      try { result = await request(path, body, { signal: abort.current?.signal }); }
      catch (e) {
        if (!current(token) || (e as Error).name === "AbortError") return;
        if ((e as any).status) throw e;
        // Transport recovery keeps the durable ID; no second paid turn.
        result = await request(path, body, { signal: abort.current?.signal });
      }
      for (let i = 0; result.pending && i < 90 && current(token); i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (current(token)) result = await request(path + "/" + body.id, undefined, { signal: abort.current?.signal });
      }
      if (!current(token)) return;
      stopWaiting();
      if (result.conversation) latest.current.onConversation(result.conversation);
      if (result.error || result.pending) throw Error(result.error ?? "Your reply is still being prepared. Check the saved conversation before starting another call.");
      if (result.audio && !interrupted.current) await play(result.audio, token);
      complete = true;
    } finally {
      if (current(token)) {
        inFlight.current = false; stopWaiting();
        if (complete) drain(token);
      }
    }
  }
  async function turn(chunks: Float32Array[], token: number, collectSample = true) {
    const r = resources.current;
    if (!r || !current(token)) return;
    change("thinking");
    if (collectSample && cloning.current && !cloneFlight.current) {
      const available = Math.max(0, Math.floor(60 * VOICE_SAMPLE_RATE) - samples.current.reduce((n, s) => n + s.length, 0));
      let left = available;
      for (const chunk of chunks) { if (!left) break; const part = chunk.slice(0, left); samples.current.push(part); left -= part.length; }
      const n = samples.current.reduce((sum, s) => sum + s.length, 0) / VOICE_SAMPLE_RATE;
      setSampleSeconds(Math.floor(n));
      if (n >= 45 && clone.current) void createVoice();
    }
    const wav = pcmWav(chunks, VOICE_SAMPLE_RATE, 44);
    try { await exchange({ id: crypto.randomUUID(), audio: await fileBase64(wav.blob), durationMs: wav.durationMs }, token); }
    catch (e) { if (current(token)) { change("paused"); setError((e as Error).message); } }
  }
  async function start() {
    if (!consent || !options?.available || (makeVoice && !cloneConsent) || !["off", "ended"].includes(phaseRef.current)) return;
    const token = ++epoch.current; change("connecting"); setError(""); setSeconds(0); setMuted(false); mute.current = false;
    setSampleSeconds(0); setCloneError(""); setCloneState(""); clone.current = null; cloneFlight.current = false; samples.current = []; cloning.current = makeVoice;
    started.current = Date.now(); abort.current = new AbortController(); latest.current.onActiveChange(true);
    let stream: MediaStream | undefined, context: AudioContext | undefined;
    try {
      const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Ctor || !navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") throw Error("This browser can't make voice calls. Try a current browser, or keep chatting by text.");
      context = new Ctor({ sampleRate: 48000 }); await context!.resume();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (epoch.current !== token || !alive.current) { stream.getTracks().forEach(t => t.stop()); void context!.close(); return; }
      const r: Resources = { context: context!, stream, echo: stream.getAudioTracks()[0]?.getSettings().echoCancellation === true,
        capture: new ConversationAudio(VOICE_SAMPLE_RATE, 44, 224) };
      resources.current = r; sampleRate.current = VOICE_SAMPLE_RATE;
      setAudioSessionType("play-and-record");
      const callId = crypto.randomUUID(); call.current = { id: callId };
      const session = await request(prefix, { id: callId, language, mode, consent: true, ...(makeVoice ? { cloneConsent: { ownVoice: true, cloning: true, subscriberUse: true, deletion: true } } : {}) }, { signal: abort.current.signal });
      if (epoch.current !== token || !alive.current) { void request(prefix + "/" + session.id + "/end", {}).catch(() => {}); closeAudio(); return; }
      call.current = session;
      cueClips.current = []; queued.current = null; inFlight.current = false; interrupted.current = false;
      waitCues.current = new VoiceWaitCues({
        clips: () => cueClips.current,
        play: (clip, valid) => playCue(clip, valid, token),
        stop: stopCue,
        longWait: () => { if (current(token)) setWaitNote(language === "ar" ? "يستغرق الرد وقتًا أطول قليلًا. يمكنك متابعة المحادثة هنا أو بالرسائل." : "This reply is taking a little longer. You can stay here or continue in Messages."); },
      });
      // Optional preparation runs alongside the greeting, never ahead of it.
      if (stream.getAudioTracks()[0]?.getSettings().echoCancellation !== false) void request(prefix + "/" + session.id + "/cues", {}, { signal: abort.current.signal }).then(value => {
        if (current(token) && Array.isArray(value.cues)) cueClips.current = value.cues.slice(0, 2);
      }).catch(() => {});
      if (makeVoice) {
        setCloneState("Collecting only your side of the call");
        void request(prefix + "/" + session.id + "/clone", {}, { signal: abort.current.signal }).then(value => { if (current(token)) { clone.current = value; if (samples.current.reduce((n, s) => n + s.length, 0) / sampleRate.current >= 45) void createVoice(); } }).catch(e => { if (current(token)) { cloning.current = false; samples.current = []; setCloneError(e.message); setCloneState("Voice creation paused"); } });
      }
      r.input = await VoiceInput.create({
        context: r.context, stream, signal: abort.current.signal, denoise: !makeVoice,
        mode: () => {
          if (!current(token) || mute.current || queued.current || !["listening", "hearing", "thinking", "speaking"].includes(phaseRef.current) ||
              (!r.echo && (r.cue || phaseRef.current === "speaking"))) return "blocked";
          return inFlight.current && !interrupted.current ? "interrupt" : "listen";
        },
        onReset: () => { r.capture.reset(); r.tentative = false; r.player?.resume(); },
        onError: () => { if (current(token)) { stop(false); setError("Voice processing stopped. Please start another call."); } },
        onFrame: (pcm, decision) => {
          if (!current(token)) return;
          r.tentative = decision.tentative;
          if (decision.tentative) r.player?.pause(); else r.player?.resume();
          if (decision.interrupt && inFlight.current && !interrupted.current) interrupt();
          const ready = r.capture.push(pcm, decision.speech);
          if (ready) {
            if (inFlight.current) {
              queued.current = ready;
              setWaitNote(language === "ar" ? "حفظت إضافتك. لحظة واحدة." : "I've kept your addition. One moment.");
            } else void turn(ready, token, !interrupted.current);
          } else if (r.capture.active && phaseRef.current === "listening") change("hearing");
          else if (!r.capture.active && phaseRef.current === "hearing") change("listening");
        },
      });
      if (!current(token)) { r.input.dispose(); return; }
      await exchange({ id: crypto.randomUUID(), greeting: true }, token);
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop());
      if (context && context.state !== "closed" && resources.current?.context !== context) void context.close().catch(() => {});
      if (epoch.current !== token || !alive.current) return;
      stop(false); setError((e as Error).name === "NotAllowedError" ? "Allow microphone access in your browser to start a call." : (e as Error).message);
    }
  }
  function interrupt() {
    interrupted.current = true; stopWaiting(); resources.current?.player?.stop();
    setWaitNote(language === "ar" ? "أسمعك. تفضل." : "I'm listening. Go ahead.");
  }
  function toggleMute() {
    mute.current = !mute.current; setMuted(mute.current);
    if (mute.current) stopWaiting();
    resources.current?.stream.getAudioTracks().forEach(t => { t.enabled = !mute.current; });
    resources.current?.input?.reset();
    resources.current?.capture.reset();
    if (["listening", "hearing", "paused"].includes(phaseRef.current)) change(mute.current ? "paused" : "listening");
  }
  return <>
    {active && !open && <div className="onboarding-call-bar"><button type="button" onClick={() => onOpenChange(true)}><Phone size={16} /> {audience === "member" ? coachName : options?.name ?? coachName} · Assisted · {clock(seconds)} <span>{muted ? copy("Muted") : copy(words[phase])}</span></button><button type="button" aria-label={copy("End call")} onClick={() => stop()}><PhoneOff size={19} /></button></div>}
    {!active && cloneState && <div className="onboarding-clone-note"><span>{cloneState}</span><Link href="/trainer/voice">Preview and manage my voice</Link>{cloneError && <small>{cloneError}</small>}</div>}
    <dialog ref={dialog} className="onboarding-call-dialog" aria-labelledby="onboarding-call-title" onCancel={e => { e.preventDefault(); stop(); onOpenChange(false); }}>
      <div className="onboarding-call-top"><span>trainsyou · Voice conversation</span><button type="button" className="onboarding-icon" aria-label={active ? copy("Show conversation") : copy("Close voice call")} onClick={() => onOpenChange(false)}>{active ? <ArrowDown size={21} /> : <X size={21} />}</button></div>
      <div className={"onboarding-call-avatar " + phase} aria-hidden="true">{(audience === "member" ? coachName : options?.name ?? coachName).slice(0, 1)}</div>
      <h2 id="onboarding-call-title">{audience === "member" ? coachName : options?.name ?? coachName} <span>{copy("AI-assisted voice")}</span></h2>
      <p className="onboarding-call-status" role="status">{muted ? copy("Microphone muted") : copy(words[phase])}</p>
      {active ? <>
        <time className="onboarding-call-time">{clock(seconds)}</time>
        <div className="onboarding-call-wave" data-live={phase === "hearing" || phase === "speaking" || cueSpeaking} data-voice-cue={cueSpeaking} aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</div>
        <p className="onboarding-call-hint">Speak naturally. You can add something while I think, or interrupt my reply.</p>
        {waitNote && <p className="onboarding-call-hint" role="status">{waitNote}</p>}
        {error && <div className="onboarding-error" role="alert"><p>{error}</p><button type="button" className="text-link" onClick={() => { setError(""); resources.current?.capture.reset(); drain(epoch.current); }}>{copy("Resume listening")}</button></div>}
        {makeVoice && <div className="onboarding-call-training"><span>{cloneState}</span>{!cloneFlight.current && <><progress value={Math.min(sampleSeconds, 45)} max={45} aria-label="Your voice sample" /><small>{sampleSeconds} of 45 seconds · Your microphone only</small></>}{cloneError && <small role="status">{cloneError}</small>}</div>}
        <div className="onboarding-call-controls"><button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? copy("Unmute microphone") : copy("Mute microphone")}>{muted ? <MicOff /> : <Mic />}<span>{muted ? copy("Unmute") : copy("Mute")}</span></button><button type="button" className="end-call" onClick={() => stop()} aria-label={copy("End call")}><PhoneOff /><span>{copy("End")}</span></button><button type="button" onClick={() => onOpenChange(false)}><MessageCircle /><span>{copy("Messages")}</span></button></div>
        {phase === "speaking" && <button type="button" className="text-link" onClick={interrupt}>{copy("Let me speak")}</button>}
      </> : <>
        <p className="onboarding-call-hint">{purpose === "coaching" ? copy("Talk through your training, just as you would by message. This assisted voice follows your coach’s guidance.") : audience === "coach" ? "Talk through how you coach. Your answers become saved teaching for your Brain." : copy("Talk through your goals and what works for you. Your answers stay in this conversation.")}</p>
        {(!options || !options.available) && <p role="status">{options?.reason ?? copy("Checking the voice connection…")}</p>}
        {options?.available && <div className="onboarding-call-choices">
          <label>{copy("Conversation language")}<select value={language} onChange={e => setLanguage(e.target.value as "en" | "ar")}><option value="en">English</option><option value="ar">العربية</option></select></label>
          <label className="onboarding-choice"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> {copy("I allow my speech to be processed for this AI call.")}</label>
          <small>{copy("Audio is sent to")} <bdi>{options.speechProvider}</bdi> {copy("for transcription.")} {options.zeroRetention ? copy("Zero retention is requested.") : copy("The provider's retention terms apply.")} {copy("We save the conversation text. Your microphone stops when you end the call or leave the app.")}</small>
          {audience === "coach" && options.cloning && <>
            <label className="onboarding-choice"><input type="checkbox" checked={makeVoice} onChange={e => { setMakeVoice(e.target.checked); setCloneConsent(false); }} /> Create my trainer voice while we talk</label>
            {makeVoice && <div className="onboarding-clone-consent"><p>We'll collect up to 60 seconds of your replies and make a private voice with the AI model. You'll preview it before activation.</p><ul>{Object.entries(options.cloneConsent as Record<string, string>).map(([key, text]) => <li key={key}>{text}</li>)}</ul>{!options.providerTrainingOptOut && <p>The AI model provider may use recordings to improve its models under the account's current terms.</p>}<label className="onboarding-choice"><input type="checkbox" checked={cloneConsent} onChange={e => setCloneConsent(e.target.checked)} /> I agree to these voice permissions.</label></div>}
          </>}
          <button type="button" className="onboarding-start-call" disabled={!consent || (makeVoice && !cloneConsent)} onClick={() => void start()}><Phone size={21} /> {phase === "ended" ? copy("Call again") : copy("Start call")}</button>
        </div>}
        {error && <p className="onboarding-warning" role="alert">{error}</p>}
        {cloneState && <p className="onboarding-clone-note">{cloneState} <Link href="/trainer/voice">Preview and manage my voice</Link></p>}
      </>}
    </dialog>
  </>;
}
