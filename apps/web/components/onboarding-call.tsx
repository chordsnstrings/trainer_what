"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mic, MicOff, Phone, PhoneOff, MessageCircle, X, ArrowDown } from "lucide-react";
import { ConversationAudio, pcmWav } from "../lib/conversation-audio";
import { SpeechGate, speechBand } from "../lib/speech-gate";
import { setAudioSessionType } from "../lib/audio-session";
import { fileBase64, onboardingRequest as request } from "../lib/onboarding-http";

type Phase = "off" | "connecting" | "listening" | "hearing" | "thinking" | "speaking" | "paused" | "ended";
const words: Record<Phase, string> = { off: "A conversation, at your pace", connecting: "Connecting…", listening: "I'm listening", hearing: "Listening…", thinking: "Thinking about that…", speaking: "Kamran's AI is speaking", paused: "Call paused", ended: "Your conversation is saved" };
const clock = (n: number) => Math.floor(n / 60).toString().padStart(2, "0") + ":" + (n % 60).toString().padStart(2, "0");
type Resources = { context: AudioContext; stream: MediaStream; node: AudioWorkletNode; analyser: AnalyserNode; capture: ConversationAudio; player?: AudioBufferSourceNode };
export function OnboardingCall({ audience, mode, open, onOpenChange, onConversation, onActiveChange }: {
  audience: "coach" | "member"; mode: "setup" | "teach"; open: boolean; onOpenChange: (v: boolean) => void;
  onConversation: (state: any) => void; onActiveChange: (active: boolean) => void;
}) {
  const [options, setOptions] = useState<any>(null), [phase, setPhase] = useState<Phase>("off"), [error, setError] = useState("");
  const [consent, setConsent] = useState(false), [makeVoice, setMakeVoice] = useState(false), [cloneConsent, setCloneConsent] = useState(false);
  const [language, setLanguage] = useState<"en" | "ar">("en"), [seconds, setSeconds] = useState(0), [muted, setMuted] = useState(false);
  const [sampleSeconds, setSampleSeconds] = useState(0), [cloneState, setCloneState] = useState(""), [cloneError, setCloneError] = useState("");
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
    void request("/onboarding-chat/calls/options").then(value => { if (!cancelled) setOptions(value); }).catch(e => { if (!cancelled) setError(e.message); });
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

  function closeAudio() {
    const r = resources.current; resources.current = null;
    setAudioSessionType("ambient");
    if (!r) return;
    r.node.port.onmessage = null;
    try { r.player?.stop(); } catch {}
    r.stream.getTracks().forEach(track => track.stop());
    r.node.disconnect(); r.analyser.disconnect();
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
    if (old) void request("/onboarding-chat/calls/" + old.id + "/end", {}, { keepalive: true }).catch(() => {});
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
    change("speaking"); r.capture.reset();
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const buffer = await r.context.decodeAudioData(bytes.buffer);
    if (!current(token) || resources.current !== r) return;
    await r.context.resume();
    await new Promise<void>(resolve => {
      const source = r.context.createBufferSource(); source.buffer = buffer; source.connect(r.context.destination); r.player = source;
      source.onended = () => { source.disconnect(); if (r.player === source) r.player = undefined; resolve(); };
      source.start();
    });
    // Avoid collecting the speaker's tail as the trainer's next answer/sample.
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  async function exchange(body: any, token: number) {
    if (!current(token)) return;
    change("thinking");
    const path = "/onboarding-chat/calls/" + call.current.id + "/turns";
    let result;
    try { result = await request(path, body, { signal: abort.current?.signal }); }
    catch (e) {
      if (!current(token) || (e as Error).name === "AbortError") return;
      if ((e as any).status) throw e;
      // Transport recovery with the same durable ID, never an output-repair call.
      result = await request(path, body, { signal: abort.current?.signal });
    }
    for (let i = 0; result.pending && i < 90 && current(token); i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (current(token)) result = await request(path + "/" + body.id, undefined, { signal: abort.current?.signal });
    }
    if (!current(token)) return;
    if (result.conversation) latest.current.onConversation(result.conversation);
    if (result.error || result.pending) throw Error(result.error ?? "Your reply is still being prepared. Check the saved conversation before starting another call.");
    if (result.audio) await play(result.audio, token);
    if (current(token)) { resources.current?.capture.reset(); change(mute.current ? "paused" : "listening"); }
  }
  async function turn(chunks: Float32Array[], token: number) {
    const r = resources.current;
    if (!r || !current(token)) return;
    change("thinking");
    if (cloning.current && !cloneFlight.current) {
      const available = Math.max(0, Math.floor(60 * r.context.sampleRate) - samples.current.reduce((n, s) => n + s.length, 0));
      let left = available;
      for (const chunk of chunks) { if (!left) break; const part = chunk.slice(0, left); samples.current.push(part); left -= part.length; }
      const n = samples.current.reduce((sum, s) => sum + s.length, 0) / r.context.sampleRate;
      setSampleSeconds(Math.floor(n));
      if (n >= 45 && clone.current) void createVoice();
    }
    const wav = pcmWav(chunks, r.context.sampleRate, 44);
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
      context = new Ctor(); await context!.resume();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (epoch.current !== token || !alive.current) { stream.getTracks().forEach(t => t.stop()); void context!.close(); return; }
      await context!.audioWorklet.addModule("/onboarding-audio-worklet.js");
      if (epoch.current !== token || !alive.current) { stream.getTracks().forEach(t => t.stop()); void context!.close(); return; }
      const node = new AudioWorkletNode(context!, "onboarding-capture"), analyser = context!.createAnalyser(); analyser.fftSize = 2048;
      context!.createMediaStreamSource(stream).connect(analyser); analyser.connect(node); node.connect(context!.destination);
      const r = { context: context!, stream, node, analyser, capture: new ConversationAudio(context!.sampleRate) }; resources.current = r; sampleRate.current = context!.sampleRate;
      setAudioSessionType("play-and-record");
      const callId = crypto.randomUUID(); call.current = { id: callId };
      const session = await request("/onboarding-chat/calls", { id: callId, language, mode, consent: true, ...(makeVoice ? { cloneConsent: { ownVoice: true, cloning: true, subscriberUse: true, deletion: true } } : {}) }, { signal: abort.current.signal });
      if (epoch.current !== token || !alive.current) { void request("/onboarding-chat/calls/" + session.id + "/end", {}).catch(() => {}); closeAudio(); return; }
      call.current = session;
      if (makeVoice) {
        setCloneState("Collecting only your side of the call");
        void request("/onboarding-chat/calls/" + session.id + "/clone", {}, { signal: abort.current.signal }).then(value => { if (current(token)) { clone.current = value; if (samples.current.reduce((n, s) => n + s.length, 0) / sampleRate.current >= 45) void createVoice(); } }).catch(e => { if (current(token)) { cloning.current = false; samples.current = []; setCloneError(e.message); setCloneState("Voice creation paused"); } });
      }
      const gate = new SpeechGate(), spectrum = new Float32Array(analyser.frequencyBinCount);
      node.port.onmessage = event => {
        if (!current(token)) return;
        if (!["listening", "hearing"].includes(phaseRef.current) || mute.current) { r.capture.reset(); return; }
        const pcm = event.data as Float32Array;
        let sum = 0; for (const v of pcm) sum += v * v;
        analyser.getFloatFrequencyData(spectrum); const band = speechBand(spectrum, r.context.sampleRate, analyser.fftSize);
        const speech = gate.sample(Math.sqrt(sum / pcm.length), band.ratio, band.activeBins, performance.now());
        const ready = r.capture.push(pcm, speech);
        if (ready) void turn(ready, token);
        else if (r.capture.active && phaseRef.current === "listening") change("hearing");
        else if (!r.capture.active && phaseRef.current === "hearing") change("listening");
      };
      await exchange({ id: crypto.randomUUID(), greeting: true }, token);
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop());
      if (context && context.state !== "closed" && resources.current?.context !== context) void context.close().catch(() => {});
      if (epoch.current !== token || !alive.current) return;
      stop(false); setError((e as Error).name === "NotAllowedError" ? "Allow microphone access in your browser to start a call." : (e as Error).message);
    }
  }
  function toggleMute() {
    mute.current = !mute.current; setMuted(mute.current);
    resources.current?.stream.getAudioTracks().forEach(t => { t.enabled = !mute.current; });
    resources.current?.capture.reset();
    if (["listening", "hearing", "paused"].includes(phaseRef.current)) change(mute.current ? "paused" : "listening");
  }
  return <>
    {active && !open && <div className="onboarding-call-bar"><button type="button" onClick={() => onOpenChange(true)}><Phone size={16} /> Kamran · AI · {clock(seconds)} <span>{muted ? "Muted" : words[phase]}</span></button><button type="button" aria-label="End call" onClick={() => stop()}><PhoneOff size={19} /></button></div>}
    {!active && cloneState && <div className="onboarding-clone-note"><span>{cloneState}</span><Link href="/trainer/voice">Preview and manage my voice</Link>{cloneError && <small>{cloneError}</small>}</div>}
    <dialog ref={dialog} className="onboarding-call-dialog" aria-labelledby="onboarding-call-title" onCancel={e => { e.preventDefault(); stop(); onOpenChange(false); }}>
      <div className="onboarding-call-top"><span>trainsyou · Voice conversation</span><button type="button" className="onboarding-icon" aria-label={active ? "Show conversation" : "Close voice call"} onClick={() => onOpenChange(false)}>{active ? <ArrowDown size={21} /> : <X size={21} />}</button></div>
      <div className={"onboarding-call-avatar " + phase} aria-hidden="true">K</div>
      <h2 id="onboarding-call-title">Kamran <span>AI</span></h2>
      <p className="onboarding-call-status" role="status">{muted ? "Microphone muted" : words[phase]}</p>
      {active ? <>
        <time className="onboarding-call-time">{clock(seconds)}</time>
        <div className="onboarding-call-wave" data-live={phase === "hearing" || phase === "speaking"} aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</div>
        <p className="onboarding-call-hint">Speak normally. I'll answer when you pause, then listen again.</p>
        {error && <div className="onboarding-error" role="alert"><p>{error}</p><button type="button" className="text-link" onClick={() => { setError(""); resources.current?.capture.reset(); change(mute.current ? "paused" : "listening"); }}>Resume listening</button></div>}
        {makeVoice && <div className="onboarding-call-training"><span>{cloneState}</span>{!cloneFlight.current && <><progress value={Math.min(sampleSeconds, 45)} max={45} aria-label="Your voice sample" /><small>{sampleSeconds} of 45 seconds · Your microphone only</small></>}{cloneError && <small role="status">{cloneError}</small>}</div>}
        <div className="onboarding-call-controls"><button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicOff /> : <Mic />}<span>{muted ? "Unmute" : "Mute"}</span></button><button type="button" className="end-call" onClick={() => stop()} aria-label="End call"><PhoneOff /><span>End</span></button><button type="button" onClick={() => onOpenChange(false)}><MessageCircle /><span>Messages</span></button></div>
        {phase === "speaking" && <button type="button" className="text-link" onClick={() => { try { resources.current?.player?.stop(); } catch {} }}>Skip this reply</button>}
      </> : <>
        <p className="onboarding-call-hint">{audience === "coach" ? "Talk through how you coach. Your answers become saved teaching for your Brain." : "Talk through your goals and what works for you. Your answers stay in this conversation."}</p>
        {(!options || !options.available) && <p role="status">{options?.reason ?? "Checking the voice connection…"}</p>}
        {options?.available && <div className="onboarding-call-choices">
          <label>Conversation language<select value={language} onChange={e => setLanguage(e.target.value as "en" | "ar")}><option value="en">English</option><option value="ar">العربية</option></select></label>
          <label className="onboarding-choice"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I allow my speech to be processed for this AI call.</label>
          <small>Audio goes to {options.speechProvider} for transcription. {options.zeroRetention ? "Zero retention is requested." : "The provider's retention terms apply."} We save the conversation text. Your microphone stops when you end the call or leave the app.</small>
          {audience === "coach" && options.cloning && <>
            <label className="onboarding-choice"><input type="checkbox" checked={makeVoice} onChange={e => { setMakeVoice(e.target.checked); setCloneConsent(false); }} /> Create my trainer voice while we talk</label>
            {makeVoice && <div className="onboarding-clone-consent"><p>We'll collect up to 60 seconds of your replies and make a private Cartesia voice. You'll preview it before activation.</p><ul>{Object.entries(options.cloneConsent as Record<string, string>).map(([key, text]) => <li key={key}>{text}</li>)}</ul>{!options.providerTrainingOptOut && <p>Cartesia may use recordings to improve its models under the account's current terms.</p>}<label className="onboarding-choice"><input type="checkbox" checked={cloneConsent} onChange={e => setCloneConsent(e.target.checked)} /> I agree to these voice permissions.</label></div>}
          </>}
          <button type="button" className="onboarding-start-call" disabled={!consent || (makeVoice && !cloneConsent)} onClick={() => void start()}><Phone size={21} /> {phase === "ended" ? "Call again" : "Start call"}</button>
        </div>}
        {error && <p className="onboarding-warning" role="alert">{error}</p>}
        {cloneState && <p className="onboarding-clone-note">{cloneState} <Link href="/trainer/voice">Preview and manage my voice</Link></p>}
      </>}
    </dialog>
  </>;
}
