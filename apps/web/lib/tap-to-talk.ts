// Tap to talk for "My own music" mode (docs/features/voice-session.md, "Own
// music"). The microphone is never left open: a tap switches the audio
// session to "play-and-record" (this pauses the member's music on iPhone),
// records one reply with the session's quiet and 6-second stops, then closes
// the tracks and returns to "ambient". A pure state machine; the voice
// session component performs the effects.

export type TalkPhase = "idle" | "opening" | "recording" | "sending";
export type TalkState = {
  phase: TalkPhase;
  /** When the current phase started (ms). */
  since: number;
  /** Whether speech was heard in this recording. */
  heard: boolean;
  /** When the current quiet started after speech (0 while speaking). */
  quietSince: number;
};
export type TalkEvent =
  /** The member tapped the talk button. */
  | { type: "tap"; now: number }
  /** The microphone is open (and the echo grace after a cue has passed). */
  | { type: "mic_ready"; now: number }
  | { type: "mic_failed" }
  /** A loudness reading (server recording) or a clock tick (device recognition). */
  | { type: "level"; loud: boolean; now: number }
  /** On-device recognition returned its final words. */
  | { type: "result" }
  /** The reply was sent and handled (or failed). */
  | { type: "done" }
  /** The session ended, paused for pain, or the mode changed. */
  | { type: "cancel" };
export type TalkEffect =
  | "session_record"
  | "open_mic"
  | "start_recording"
  | "stop_and_send"
  | "discard"
  | "close_mic"
  | "session_ambient";
/** The session's existing limits: 800 ms of quiet after speech, at most 6 s. */
export const TALK_LIMITS = { quietMs: 800, maxMs: 6000, noSpeechMs: 5000 } as const;
export const idleTalk = (): TalkState => ({ phase: "idle", since: 0, heard: false, quietSince: 0 });

const close: TalkEffect[] = ["close_mic", "session_ambient"];
export function stepTalk(s: TalkState, e: TalkEvent): [TalkState, TalkEffect[]] {
  const idle = idleTalk();
  if (e.type === "cancel")
    return s.phase === "idle" || s.phase === "sending"
      ? [idle, []]
      : [idle, s.phase === "recording" ? ["discard", ...close] : close];
  switch (s.phase) {
    case "idle":
      return e.type === "tap"
        ? [{ phase: "opening", since: e.now, heard: false, quietSince: 0 }, ["session_record", "open_mic"]]
        : [s, []];
    case "opening":
      if (e.type === "mic_ready") return [{ phase: "recording", since: e.now, heard: false, quietSince: 0 }, ["start_recording"]];
      if (e.type === "mic_failed" || e.type === "tap") return [idle, close];
      return [s, []];
    case "recording": {
      const send: [TalkState, TalkEffect[]] = [
        { phase: "sending", since: s.since, heard: true, quietSince: 0 },
        ["stop_and_send", ...close],
      ];
      const drop: [TalkState, TalkEffect[]] = [idle, ["discard", ...close]];
      if (e.type === "result") return [idle, close];
      if (e.type === "tap") return s.heard ? send : drop;
      if (e.type !== "level") return [s, []];
      if (e.now - s.since >= TALK_LIMITS.maxMs) return s.heard ? send : drop;
      if (e.loud) return [{ ...s, heard: true, quietSince: 0 }, []];
      if (!s.heard) return e.now - s.since >= TALK_LIMITS.noSpeechMs ? drop : [s, []];
      const quietSince = s.quietSince || e.now;
      return e.now - quietSince > TALK_LIMITS.quietMs ? send : [{ ...s, quietSince }, []];
    }
    case "sending":
      return e.type === "done" ? [idle, []] : [s, []];
  }
}
