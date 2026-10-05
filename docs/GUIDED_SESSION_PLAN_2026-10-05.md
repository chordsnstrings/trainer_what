# Guided coaching session — proposed flow

5 October 2026. Planning only; no implementation, deployment or paid-provider call. Builds on the guided audit and the existing voice runner. Native companion work below is a recommendation, not an implementation authorization. Existing DigitalOcean authority remains unchanged.

## Product contract

Reproduce the coach's preparation, explanation, timing, listening, adaptation and follow-up. Voice alone cannot observe form, count actual repetitions or verify completion. Label member reports, elapsed timers and any future sensor observations separately. Never claim to see good form or detect fatigue without evidence.

Use one Guided session entry with text/voice modes. Start with the owner's authorized Kamran voice for the pilot. Other trainers remain bound to their own authorized voice; no silent cross-trainer fallback.

| Component | Responsibility |
| --- | --- |
| Trainer Brain / configured Seed 2.0 frontier model | Personal wording, bounded session preparation and contextual replies grounded in the trainer's published methods and member history. |
| Session engine | Exact exercise/set/side, prescription, clocks, readiness, rules, state transitions, logging and audio selection. No model calls for ticks or routine Next/Done. |
| Cartesia | Voice generation in the selected authorized voice; speech transcription through the appropriate configured language path. |
| Existing Suno API service | Generate a reusable instrumental music catalogue ahead of sessions. The player selects tracks; generation never blocks a workout. |

## Member journey

| Phase | What happens | Exit condition |
| --- | --- | --- |
| Check in | Confirm today's available time, equipment, readiness and relevant concerns. Show workout, estimated duration, language, voice and music choices. Test sound/microphone; captions and buttons always work. | Member starts; current membership/consents/plan/holds pass. |
| Prepare | Freeze the current workout and trainer-style versions. Build structured events, reuse/generate missing speech, select music and preload the opening plus the next exercise. | Required opening audio is ready, or member chooses text. Show real preparation progress. |
| Welcome and warm-up | Brief personal greeting and today's purpose. Run the actual prescribed warm-up as timed/repetition steps; do not invent one from narration. | Warm-up steps completed or an allowed alternative confirmed. |
| Exercise setup | Announce movement, sets, reps/time/distance, load and units, tempo, effort target, side and equipment. Show the trainer's demonstration and concise approved cue. | Member says Ready or taps Start set. |
| Start set | Announce current set/round and exact target. Count in when enabled. Start work timing at the audible Go marker, not when TTS generation finishes. | Actual playback start/marker, or explicit text-mode start. |
| Work | Music continues. Sparse relevant cues; no continual chatter. Natural-pace reps wait for Done/actual count. Timed work uses a clock; coached tempo gives optional pacing, never a claim of measured reps. | Explicit completion, interval end, pause, adjustment or stop. |
| Record | Capture actual reported reps/load/duration/distance and optional effort. A clear Done means the member reports completing the target; corrections remain easy. Timer expiry records elapsed time, not verified physical performance. | Save locally immediately and sync once; incomplete work remains distinguishable. |
| Rest | Start rest at the completion event. Music returns to normal level. Ask a brief effort question if useful; announce the next set/target before the final countdown. More rest, Repeat and Not ready remain available. | Rest elapsed and readiness condition satisfied. Zero rest stays zero. |
| Transition | Explain the next movement and equipment/side change. Respect circuits, supersets, unilateral order and trainer-prescribed transitions. | Member ready; never assume equipment is available. |
| Finish | Run prescribed cool-down, summarize reported results and actual session time, ask about difficulty/concerns, sync results and explain the next scheduled session. | Confirm saved versus pending sync. Feed relevant outcomes into the existing trainer feedback loop. |

## Speech preparation and exact clip selection

1. Compile the approved workout into a versioned manifest. Every event carries session/workout revision, exercise ID, set/round, side, phase, locale, target values and trigger condition. Code supplies numbers and units; checked trainer/Brain wording supplies tone.
2. Generate complete natural phrases for setup, each distinct set target, rest and transitions. Cache unchanged phrases by tenant/voice version, language, normalized text, TTS model/settings and script version. Share generic phrases only within the authorized voice scope; keep personalized clips member-private. Avoid robotic number-fragment assembly for the main experience.
3. Store clip ID, text, actual duration, optional word markers, checksum and ready/failed status. A session manifest references clips explicitly; array position or a filename alone cannot select audio.
4. On each valid state event, resolve its exact manifest entry and current queue generation. Check current permission and revision before enqueue and before playback. Preload a small upcoming window. Changing exercise/target, pausing, reporting pain, revoking consent or replacing the session cancels obsolete work and clears queued/playing audio.
5. Reject late responses from an earlier event/turn. Cartesia context cancellation prevents further generation; our player must independently discard already-buffered chunks. Provider context/flush IDs map responses to utterances [1].
6. Priority: stop/safety, intentional user interruption, mandatory instruction/countdown, useful cue, encouragement. One voice at a time. Drop optional speech that cannot finish before a mandatory event; never play overdue countdowns in a burst.
7. Cache the fixed plan speech ahead of use. Generate a new response only for a genuine question or approved change. Validate its final facts/actions before speech. A provider outage leaves the same text/timer flow usable.

## Timing and completion rules

- **Natural repetitions:** default for ordinary strength sets. Measure elapsed work from Start to the member's completion event. A predicted set duration may inform the estimate or a gentle check-in, never auto-log reps or force rest.
- **Coached tempo:** optional prescribed rhythm/counting. The cadence is a pacing aid; ask for corrections to the performed count. Music tempo never silently changes prescribed tempo.
- **Timed work:** deadline anchored to actual start audio. Pause preserves remaining work. Record elapsed interval separately from member-confirmed completion; allow early finish and correction.
- **Distance:** await reported completion/distance unless an explicitly integrated sensor provides it. Do not infer distance from elapsed time.
- **Rest:** begins immediately on Done/tap, while confirmation/effort conversation may overlap. Explicit pause freezes it; More rest extends it. Countdown clips are scheduled against their measured audio markers. If the next setup exceeds available rest, use a separate readiness transition, never shorten the prescribed rest.
- **Duration estimate:** warm-up + expected work + prescribed rests + setup/transitions + cool-down. Repetition estimates use prescribed tempo where available, otherwise a labeled estimate from relevant history. Do not double-count overlapping speech/music. Update the range from actual pace and extra rest; never silently cut required work to hit the original estimate.
- Persist exercise/set/side, revision, phase, clocks, pending outcomes and last applied event. Use monotonic time while active and durable checkpoints for resume. Only one controlling device/tab. Reconnect reconciles events idempotently; it does not replay completed sets. Unexpected interruption returns paused with a short recap; do not auto-credit elapsed suspended work.

## Music and listening

Recommended initial bank: 24 approved instrumental tracks, four moods × three energy levels × two variants. Generate once, verify actual duration/quality, normalize levels, tag and store on our infrastructure. The service supports instrumental tasks and completion callbacks; its current generation page says files remain for 14 days, so provider URLs are not durable storage [2]. Existing owner-confirmed commercial rights remain the project decision; this plan does not reopen that issue.

Music plays continuously during work and rest. Keep tracks going across set boundaries; crossfade at natural transitions. Lower music under speech, restore it smoothly afterward and provide separate voice/music controls. During intentional talk-back, mute or strongly lower music and stop coach speech so the member can be heard. Stop/pain overrides both. Personal external music stays optional; third-party app volume/ducking cannot be treated as under our control.

Launch reliable push-to-talk for speaker/noisy-gym use. Offer hands-free listening only on qualified headset/device combinations, with echo suppression and visible mic status. A deliberate interruption immediately clears the speech queue. Capture session/set identity when recording starts; a late transcript cannot complete the following set. Ignore our own prompts and music; uncertain speech asks for clarification. Stop/pause buttons remain immediate even without network/STT.

Simple commands use the existing checked parser: Ready, Done, actual reps, Pause, Resume, Repeat, More rest, Too heavy, Not done, equipment unavailable and pain. Contextual questions use a small current-state/coach-context request to the frontier model. Proposed substitutions/load changes must pass trainer rules and be stated/confirmed before application. Pain stops locally and queues the existing hold/report workflow; never promise delivery until acknowledged. Do not treat transcript uncertainty as completed work.

Current Cartesia streaming transcription lists English, French, Hindi, Japanese and Spanish, excluding Arabic [3]. Its batch transcription supports Arabic and requires a language setting [4]. Keep the existing qualified Arabic short-utterance path initially; test dialect/noise/code-switching and latency. Do not promise identical bilingual streaming behavior or replace the existing safety parser merely because an API is newer.

## Mobile architecture and recovery

Reuse the web runner and domain rules. One Start gesture unlocks audio; handle playback rejection explicitly [5]. Use screen wake lock while foregrounded, captions and media controls. Wake lock is for visible documents and can be revoked [6]. It is not background execution support.

For dependable locked-phone music, correctly timed cues and interaction, recommend a native companion with a real native audio/recording service sharing the same session rules. A plain WebView wrapper is insufficient. iOS provides audio-session/background modes; Android provides a background MediaSessionService [7][8]. This is an architecture recommendation based on those capabilities, not a claim that all browser background playback fails. Physical-device qualification remains mandatory; even native audio must handle calls, routing and OS interruptions.

Offline: preserve text, timers, current progress and pending reports. Keep personalized speech private; permit cached playback only within an explicit bounded offline permission policy. Online revocation stops playback and clears cached authorization. Instant revocation of bytes already downloaded to a disconnected phone cannot be guaranteed. Never silently restart paid requests with unknown outcomes. Track/music failure must not block the workout.

## Controls, cost and delivery

Runner screen: current exercise/demonstration, set and target, prominent work/rest clock, next instruction and transcript. One phase-specific primary button, plus accessible Pause, Talk and Stop. Put secondary music, repeat and detailed logging controls nearby without duplicating large cards. Summary distinguishes reported, timed and pending results.

Cost rules: one bounded narration preparation call per new session revision; reuse on retry/resume. Routine control/timing makes no model call. Contextual conversation is metered and capped. Generate only cache misses, not every possible numeric phrase. Reuse music across sessions. Batch Arabic transcription only for captured speech; hands-free has an explicit listening/cost policy. Measure actual model tokens, TTS characters, STT audio seconds, music tasks, cache hits, storage/egress and retry costs; no invented per-session price.

| Stage | Deliverable and acceptance |
| --- | --- |
| 1 | Fix all guided audit defects, unify routes onto the existing richer runner, preserve text access. Test consent/downgrade, stale audio, pain delivery, pause/recovery, zero rest and reload. |
| 2 | Versioned manifest, durable state, complete prescription, precise event/audio mapping, captions and same-screen logging. Cover reps/time/distance, sides, supersets/circuits, corrections and trainer changes. |
| 3 | Kamran phrase generation/cache, bounded adaptive replies and music catalogue/player. Test queue cancellation, ducking, no overlapping instructions and no repeated generation charges. |
| 4 | Native audio companion and selected hands-free mode. Run full sessions on actual Android/iPhone, speaker/headset/Bluetooth, lock/unlock, calls, disconnect, poor network and low-power interruptions. |
| 5 | Controlled trainer/member pilot. Measure command accuracy, wrong-state playback, timer error, response delay, completion/correction rates, recovery, battery use and actual cost. Expand only the qualified modes. |

Proposed engineering targets, not measured results: zero wrong-state clips or duplicate logs in acceptance scenarios; immediate local stop/pause (target under 250 ms); cached cues begin within 300 ms; scheduled countdown markers within 250 ms in supported uninterrupted modes. Measure p95 adaptive-response latency from end of speech to audible response, targeting under two seconds where supported; slow replies show Listening/Thinking rather than advancing the session. Qualify a continuous 60-minute session with normal interruption/recovery scenarios.

## Research sources

Reviewed 5 October 2026. Provider documentation confirms capabilities, not production account readiness or measured performance. No credentials were read and no paid generation was run.

1. Cartesia TTS contexts, cancellation, timestamps and flush mapping: https://docs.cartesia.ai/api-reference/tts/websocket and https://docs.cartesia.ai/use-the-api/tts-websocket/context-flushing-and-flush-i-ds
2. Existing music service generation contract: https://docs.sunoapi.org/suno-api/generate-music
3. Cartesia streaming transcription language list: https://docs.cartesia.ai/build-with-cartesia/stt/latest
4. Cartesia batch transcription languages: https://docs.cartesia.ai/api-reference/stt/transcribe
5. Chrome autoplay and playback handling: https://developer.chrome.com/blog/autoplay/ and https://developer.chrome.com/blog/play-returns-promise/
6. Screen Wake Lock: https://developer.mozilla.org/en-US/docs/Web/API/WakeLock/request
7. Apple playback/recording sessions: https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playandrecord
8. Android background media: https://developer.android.com/media/media3/session/background-playback
9. BytePlus structured response contract: https://docs.byteplus.com/en/docs/modelark/responses-api-structured-output (schema support must be checked against the configured endpoint; server validation remains mandatory).

Repository foundations: `packages/domain/src/voice-session.ts`, `voice-runner.ts`, `voice-narration.ts`; `apps/api/src/voice-session.ts`; `apps/web/components/voice-session.tsx`; `apps/web/lib/audio-session.ts`. Legacy defects: `docs/GUIDED_SESSION_AUDIT_2026-10-05.md`. Historical feature-document statuses are not evidence of current provider readiness.
