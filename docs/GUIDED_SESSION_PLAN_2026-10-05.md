# Guided coaching session — proposed flow

5 October 2026, revision 3. Complete proposed flow, updated for the owner's 15:43 Asia/Dubai request to work out without repeatedly handling the phone. Adds optional Coach remote controls and automatic rest-to-set transitions; retains eight 30-track playlists, noisy-gym filtering and low AI usage. Planning only; no implementation, deployment or paid-provider call. The owner supplied a Suno API credential for use when needed; it has not been configured or copied into these files. Store credentials only in protected server settings when used. Native companion work remains a recommendation. Existing DigitalOcean authority remains unchanged.

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
| Prepare | Prepare speech when a scheduled workout becomes available. At check-in, freeze the current workout/style versions and update only changed instructions. Select a playlist and preload opening/next-exercise speech and upcoming music. | Required opening audio is ready, or member chooses text. Show real preparation progress; a music failure never blocks Start. |
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

## Music catalogue and playlists

Replace the earlier 24-track proposal with **eight system playlists, at least 30 distinct approved instrumental tracks each: 240 tracks minimum**. Recommended tracks are roughly three to five minutes; this is a production target, not a provider-duration guarantee. No duplicate file, renamed copy or repeated loop counts as another song. Each launch playlist has its own distinct catalogue. Member favourites are a saved collection, not a system playlist advertised as containing 30 tracks.

| Playlist | Musical direction / use | Minimum |
| --- | --- | ---: |
| Flow State | Atmospheric electronic, steady focus, restrained dynamics | 30 |
| EDM Drive | House/progressive electronic, upbeat continuous energy | 30 |
| Rock Strength | Guitar/drum instrumentals, strong rhythm | 30 |
| R&B Groove | Soulful keys, bass and relaxed rhythmic grooves | 30 |
| Hip-Hop / Trap | Instrumental beats, weight-training energy | 30 |
| Afro / Latin Groove | Percussion-led rhythmic variety | 30 |
| Synthwave | Retro electronic, sustained movement | 30 |
| Recovery | Ambient/chill, warm-up or cool-down preference | 30 |

**Production:** create two candidate tracks per playlist first to qualify style and mixing; these are not published playlists. Then generate bounded batches until every playlist has 30 accepted tracks. Count approved outputs, not requests: one request may return multiple variations. Check account credits/pricing when implementation starts, enforce a job spend ceiling, reconcile unknown tasks before retry and do not auto-purchase credits. Log actual generation cost and replace only rejected/missing tracks. The user's supplied credential is for this service, never browser code, Git or documentation.

Use instrumental generation with no vocals or spoken samples. Vary instruments, arrangement and intensity using reusable prompt templates. Check duration, clipping, unwanted vocals, obvious artifacts and duplicate/near-duplicate audio; audition the style and cue mix. Normalize levels, record track metadata/rights provenance and copy accepted audio to durable object storage. The API supports instrumental tasks/callbacks and currently retains generated files for 14 days [2]. Validate callbacks against the known provider task and fetch status through the authenticated API before accepting assets. Existing owner-confirmed commercial rights remain the project decision.

**Playback:** genre selection, shuffle on/off, repeat off/playlist/track, next/previous track, favourites, hide track and queue preview. Shuffle uses a persisted shuffled list: no repeat until eligible tracks are exhausted; avoid immediately repeating the last track when starting another cycle. Previous uses playback history; changing shuffle never restarts the playing track. Cache/preload upcoming tracks. Resume retains playlist, track, position and queue. Hidden/unavailable tracks are skipped; a failed track must not restart a set or stop coaching. Replace or unpublish a system playlist if its eligible catalogue drops below 30. No track generation on play, skip, shuffle or favourite.

Music stays continuous through work and rest. Crossfade tracks at suitable boundaries; do not swap genre every set. Lower music under coach speech and restore it smoothly. Hold to talk mutes or strongly lowers music and stops coach speech. Separate voice/music volume and mute; muting music does not pause the workout. Stop/pain stops both. Optional energy matching selects from pre-tagged tracks without a model call and never changes the exercise cadence. Personal external music remains optional; its volume cannot be assumed controllable by our app.

## Noisy gyms and intentional listening

**Default speech mode: Hold to talk; otherwise the microphone is off.** Routine progression uses the qualified remote/button controls below, so speech is optional. No continuous gym recording or cloud transcription. Large Done, Pause, More rest and Stop controls also remain in the app. Release-to-submit and an accessible tap-to-start/stop alternative serve members who cannot hold a button; show a clear recording indicator and bounded capture window.

Speech activity is not speaker identity or permission. Music, breathing, impacts and another person's conversation must not become commands merely because a detector thinks they resemble speech. Speech detectors output speech probabilities [10]; microphone echo/noise controls are capability-dependent [11]. Neither proves that the member is addressing the app.

| Gate | Processing | Paid call |
| --- | --- | --- |
| Intent | Explicit talk interaction opens a short capture window. Future hands-free requires an on-device wake phrase and a qualified device/headset. | None |
| Local filter | Request supported echo cancellation/noise suppression; detect speech locally, trim silence and suppress obvious noise/our playback. Keep short commands such as Stop usable. Empty/non-speech capture is discarded locally. | None |
| Transcription | Send one bounded, intentional speech clip in the selected language. Maximum one request in flight. Never upload the ambient session or retry rejected noise automatically. | STT only |
| Command | Strict parser applies valid current-state commands: Done, actual reps, Pause, Resume, Repeat, More rest, Not done or pain. Deduplicate events and reject obsolete turns. | No frontier-model call |
| Unclear | Show transcript/clarification or use a cached short response. Do not interpret random text as completed exercise or automatically ask a model to explain noise. | None beyond the initial STT |
| Ask coach | Only a deliberate meaningful question needs the frontier model, with a short state/history summary. Validate proposed changes against trainer rules before applying. | One bounded model call; TTS only for uncached reply |

Capture session/set/phase identity at recording start. A late transcript cannot finish the next set. Hold to talk pauses work/tempo timing and current speech; rest may continue. If a reply extends beyond rest, wait for readiness instead of starting an exercise while still answering. Resume is explicit after interrupted work. Silence never means Done. Nearby speech cannot be reliably excluded by loudness or a headset alone; hands-free is opt-in, conservative and disabled on unqualified/noisy configurations.

One request per captured turn, bounded duration, cooldown, per-session cost ceilings and no recursive clarification loops. Proposed automatic-mode fallback: after three rejected/unclear captures within one minute, close hands-free capture and offer Hold to talk; do not send the same audio repeatedly. This threshold needs device testing. In default mode, noise outside an intentional capture causes **zero paid calls**. Noise slipping into an intentional capture can still incur one STT call; never promise perfect filtering.

Stop/pause buttons act locally and immediately. Pain stops locally and queues the hold/report workflow; preserve the note, retry safely and show Pending versus Sent. No voice mode can promise to hear a pain word while its microphone is off. Display mic state honestly. Discard short raw recordings after processing under the provider's actual retention policy; retain only necessary session outcomes. No speaker-biometric enrollment in the initial design.

Current Cartesia streaming transcription excludes Arabic [3]; its batch service supports Arabic with a selected language [4]. Keep the existing tested short-utterance Arabic path and qualify dialect/noise/code-switching. Use manual-turn transcription for intentional speech [12]. Do not promise identical streaming behavior across languages or weaken the existing safety parser.

## Coach remote: phone stays in the pocket

Recommended primary journey: start the session once, put the phone away, hear the coach, perform the prescribed set, signal completion with a supported headset control, then let rest/countdown/next-set guidance run. Lock-screen controls provide an alternative; they are not the only way to continue. One signal is needed per completed rep set, not per rep. No automatic rep inference is introduced.

**Two explicit control modes.** Music mode keeps media Next/Previous as music navigation. Optional Coach remote maps supported remote Next to the session's Advance action and Previous to Repeat instruction; Play/Pause pauses/resumes the session and its audio. Show and speak the selected mode once. Do not silently change meanings mid-session. In Coach remote, song changes use clearly labeled in-app/custom music controls or an intentional qualified voice action; music ending never emits workout Advance. This explicitly replaces revision 2's unconditional rule that lock-screen Next always means Next track.

| Current state | Advance action | Coach response |
| --- | --- | --- |
| Exercise setup / waiting ready | Confirm readiness and start the planned count-in. | Exact set/target, then Go. |
| Active repetition set | Record the member's confirmation that the displayed target was completed; enter rest. | Brief result and rest duration. Actual-count correction remains available. |
| Timed/distance work | End early / open the appropriate completion confirmation; do not claim the full planned duration/distance automatically. | State what was measured/reported; ask for missing actual distance where needed. |
| Rest | Mark readiness for the next set; do not erase prescribed rest. | Next target or remaining rest, with repeated feedback suppressed. |
| Countdown | No duplicate transition or logging. | Continue the current count-in. |
| Paused / stopped / finished | No completion or restart. | Resume through Play; stopped/finished sessions require an explicit valid restart/new session. |

**Automatic pacing is opt-in.** After confirmed completion, start the full rest, announce the next target near its end, then count in and start the next set of the same exercise. A pause, interruption, stale plan, hold or unresolved conversation cancels that scheduled start. At a new exercise/equipment transition, wait for Ready/Advance. Members who prefer manual pacing press Advance after rest expires. Extra rest extends the deadline and invalidates old countdown audio. Timed interval ending records elapsed time separately from physical completion.

Do a short remote-control check at setup. Detect the actual supported media events and explain that device's gesture; do not promise universal double-tap/triple-tap or override volume/assistant gestures. Headset controls depend on which app owns the active media session. Coach remote is initially supported with our own coaching/music player; third-party music needs separately qualified controls or lock-screen/watch/app fallback. Do not assume another music app forwards its buttons to us.

Each event is bound to the active session/phase generation. Debounce hardware repeats, deduplicate retries and require a valid state transition. A duplicated event must never log the following set or skip rest. Give an immediate local earcon/short cached acknowledgment; no model/STT call. Provide Undo/correction on the session surface; Previous repeats guidance rather than silently undoing records. Headphone removal, calls and lost audio focus pause with explicit resume.

### Lock screen and optional shortcuts

Display workout phase, exercise, set/target, rest deadline and the next action. Avoid exposing private concerns or detailed health notes on the lock screen. Prefer explicit controls: **Finished set**, **Pause/Resume**, **+15 seconds rest** and **Ready** where the OS surface permits them. Use the system timer presentation rather than assuming a widget can execute JavaScript every second. The native session service owns timing; lock-screen UI only reflects it.

- **Android:** Media3 supports custom media command buttons and background media sessions [13]. Place the important workout actions in the available compact slots; actual layout/visibility depends on OS/controller/device settings. Use uniquely identified session actions and never infer workout completion from the music player's own Next event.
- **iPhone:** use the active native audio session and MPRemoteCommandCenter for supported remote/headset actions [14]. A Live Activity can expose labeled actions without opening the full app [15], but Apple's interaction guidance describes locked-device authentication while AppIntent policy also supports actions allowed while locked [16]. Qualify each intended surface on real iOS versions; do not promise that setting an intent policy alone guarantees a no-unlock button. Keep the tested media/headset route as the fallback.
- **Later conveniences:** App Shortcuts can expose session actions through Siri, Shortcuts or supported Action buttons [17]. A watch companion could provide one-tap completion, extra rest and haptics where that watch platform permits it. These need separate platform/device qualification, not assumptions about every watch or earbud. No proprietary speaker identification or continuous cloud listening is required.

Proof-of-concept acceptance before wider build: a full rep-set → rest → next-set → next-exercise journey with the phone genuinely locked, music playing, zero foreground-app reopening during ordinary sets and zero frontier/STT calls for remote actions. Verify authentication behavior, button routing, duplicate presses, session switching, early completion, pause at countdown zero, headset disconnect and third-party music interference. Target platform confidence before generating the full music bank.

## Mobile architecture and recovery

Reuse the web runner and domain rules. One Start gesture unlocks audio; handle playback rejection explicitly [5]. Use screen wake lock while foregrounded, captions and media controls. Wake lock is for visible documents and can be revoked [6]. It is not background execution support.

For dependable locked-phone music, correctly timed cues and interaction, recommend a native companion with a real native audio/recording service sharing the same session rules. A plain WebView wrapper is insufficient. iOS provides audio-session/background modes; Android provides a background MediaSessionService [7][8]. This is an architecture recommendation based on those capabilities, not a claim that all browser background playback fails. Physical-device qualification remains mandatory; even native audio must handle calls, routing and OS interruptions.

Offline: preserve text, timers, current progress and pending reports. Keep personalized speech private; permit cached playback only within an explicit bounded offline permission policy. Online revocation stops playback and clears cached authorization. Instant revocation of bytes already downloaded to a disconnected phone cannot be guaranteed. Never silently restart paid requests with unknown outcomes. Track/music failure must not block the workout.

## UX and UI

Mobile-first, clean white default, strong typography, restrained trainer accent and generous consistent spacing. Respect trainer identity while maintaining contrast. Avoid nested card containers, oversized desktop buttons, competing primary actions and separate logging pages. Preserve usable layouts on tablet/desktop with bounded content width.

| Screen/state | UI contract |
| --- | --- |
| Before starting | Workout overview, estimated duration, remembered playlist with Preview/Shuffle, voice/language, Hold-to-talk default and compact sound check. One Start workout button. Mic permission only when enabling talk. |
| Working | Exercise/demo, set number, exact target and elapsed/time-left display. Next target in one line. Large Finished set primary action for reps; timed work shows the clock plus Finish early. |
| Resting | Large rest clock, completed-set confirmation and next target. More rest is obvious. Ready/Start next follows the prescription/readiness rules; zero rest does not create a fake countdown. |
| Speaking/listening | Short coach caption and explicit Mic off / Listening / Processing status. Recording is cancellable. Unclear input presents correction options, not technical errors or surprise progression. |
| Persistent controls | Large Pause/Resume, Hold to talk and Stop. Stop acts immediately; optional report details come afterward. Controls remain reachable without opening a menu. |
| Music drawer | Compact now-playing row expands to playlists, queue, shuffle/repeat, favourite, hide and separate volumes. Distinguish Next track from Next exercise. Music controls never change workout progress. |
| Recovery | Resume exactly where paused, with a brief recap. Clear Offline / Saved on device / Synced state. No lost notes or duplicate logs. |
| Summary | Actual time, completed/partial sets, reported results and pending sync. Quick corrections and next scheduled workout. |

Use at least 48 px main touch targets, text labels, captions and keyboard/screen-reader support. Reduced-motion option; do not announce each ticking second to screen readers. Account for safe areas and keyboard height; music and session bars must never cover each other. Keep a quiet noise/help indicator instead of repeated popups. Lock-screen/headset Next follows the explicitly selected Music or Coach remote mode above; pause/interruption behavior coordinates workout timing and audio. Headphone disconnect pauses and offers safe resume, never unexpected loud speaker playback.

Trainer setup retains voice/style preview, pronunciation, verbosity, counting preference, approved cues/demos and adjustment rules. Super admin manages secret-backed provider settings, job budgets, track QA, playlist counts, retire/replace and music cost. Trainers choose a default mood; members can override it. A playlist appears as Ready only after 30 approved playable tracks exist.

## Cost and delivery

One bounded narration preparation call per new session revision, reused on resume. Cached routines, clocks, buttons, playlist selection/shuffle and sound filtering make no frontier-model calls. Intentional voice commands use one short STT request unless a separately qualified on-device recognizer is available. Only meaningful Ask coach turns use the frontier model. Generate speech cache misses and share generic authorized phrases; do not eagerly generate every numeric combination. Generate the music bank once and reuse it across members; no per-session music job.

Record actual model tokens, TTS characters, STT seconds, music tasks, cache hits, storage/egress and unknown/retry costs. Rate/cost limits apply to provider processing, never to local Stop/Pause. At limits, keep captions/buttons/timers and explain the voice fallback. No invented per-session price or token-saving percentage.

| Stage | Deliverable and acceptance |
| --- | --- |
| 1 | Fix all guided audit defects, unify routes onto the existing richer runner, preserve text access. Test consent/downgrade, stale audio, pain delivery, pause/recovery, zero rest and reload. |
| 2 | Versioned manifest, durable state, complete prescription, precise event/audio mapping, captions and same-screen logging. Cover reps/time/distance, sides, supersets/circuits, corrections and trainer changes. |
| 2a | Native locked-phone/headset prototype before large music generation. Qualify explicit control modes, labeled actions where available, same-exercise automatic pacing, hardware-event deduplication and OS authentication/routing limits. |
| 3 | Kamran phrase cache, deliberate talk pipeline, 16-track style trial then 240 accepted tracks across eight 30-track playlists. Ship player/queue/shuffle UI; test duplicate avoidance, ducking, cancellation and billing reconciliation. No playlist is published below its minimum. |
| 4 | Native audio companion and selected hands-free mode. Test real gym music, impacts, grunts, bystanders saying Done, our own voice, genuine quiet/short commands and English/Arabic. Verify no ambient paid requests in default mode; measure automatic-mode false wakes/STT calls separately. Run full Android/iPhone sessions with speaker/headset/Bluetooth, lock/unlock, calls, disconnect, poor network and low power. |
| 5 | Controlled trainer/member pilot. Measure command accuracy, wrong-state playback, timer error, response delay, completion/correction rates, recovery, battery use and actual cost. Expand only the qualified modes. |

Proposed engineering targets, not measured results: zero wrong-state clips or duplicate logs in acceptance scenarios; immediate local stop/pause (target under 250 ms); cached cues begin within 300 ms; scheduled countdown markers within 250 ms in supported uninterrupted modes. Measure p95 adaptive-response latency from end of speech to audible response, targeting under two seconds where supported; slow replies show Listening/Thinking rather than advancing the session. Qualify a continuous 60-minute session with normal interruption/recovery scenarios.

## Research sources

Reviewed 5 October 2026; revision 2 added music/noise research, and revision 3 checked native media, headset, lock-screen and shortcut capabilities. Provider documentation confirms capabilities, not production account readiness or measured performance. The owner supplied a credential in conversation; it was not used, persisted in project files or tested. No paid generation was run.

1. Cartesia TTS contexts, cancellation, timestamps and flush mapping: https://docs.cartesia.ai/api-reference/tts/websocket and https://docs.cartesia.ai/use-the-api/tts-websocket/context-flushing-and-flush-i-ds
2. Existing music service generation contract: https://docs.sunoapi.org/suno-api/generate-music
3. Cartesia streaming transcription language list: https://docs.cartesia.ai/build-with-cartesia/stt/latest
4. Cartesia batch transcription languages: https://docs.cartesia.ai/api-reference/stt/transcribe
5. Chrome autoplay and playback handling: https://developer.chrome.com/blog/autoplay/ and https://developer.chrome.com/blog/play-returns-promise/
6. Screen Wake Lock: https://developer.mozilla.org/en-US/docs/Web/API/WakeLock/request
7. Apple playback/recording sessions: https://developer.apple.com/documentation/avfaudio/avaudiosession/category-swift.struct/playandrecord
8. Android background media: https://developer.android.com/media/media3/session/background-playback
9. BytePlus structured response contract: https://docs.byteplus.com/en/docs/modelark/responses-api-structured-output (schema support must be checked against the configured endpoint; server validation remains mandatory).
10. Local speech detector behavior/quality metrics: https://github.com/snakers4/silero-vad/wiki/Quality-Metrics (research reference, not a committed dependency choice).
11. Microphone capabilities: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/noiseSuppression and https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/echoCancellation
12. Cartesia manual transcription: https://docs.cartesia.ai/examples/stt-manual-finalize-websocket
13. Android media controls: https://developer.android.com/media/implement/surfaces/mobile and https://developer.android.com/media/media3/session/control-playback
14. Apple remote commands: https://developer.apple.com/documentation/mediaplayer/mpremotecommandcenter
15. Apple interactive surfaces: https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities
16. AppIntent authentication policy: https://developer.apple.com/documentation/appintents/appintent/authenticationpolicy (surface restrictions still require testing).
17. App Shortcuts: https://developer.apple.com/design/human-interface-guidelines/app-shortcuts

Repository foundations: `packages/domain/src/voice-session.ts`, `voice-runner.ts`, `voice-narration.ts`; `apps/api/src/voice-session.ts`; `apps/web/components/voice-session.tsx`; `apps/web/lib/audio-session.ts`. Legacy defects: `docs/GUIDED_SESSION_AUDIT_2026-10-05.md`. Historical feature-document statuses are not evidence of current provider readiness.
