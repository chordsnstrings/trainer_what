# Voice coach that runs the workout session (package `core/voice-session`)

Status: implemented on branch `core/voice-session` (base `b4ac2b5`, migration 065), then
revised after review (second commit on the branch; see "Review fixes"). The checks below
were run exactly as recorded; limits are listed at the end. Nothing was deployed and no
real provider was contacted.

Update 28 September 2026 (stage 2026-09-28g, branch `core/cartesia-voice`): the voice provider
is a choice of ElevenLabs or Cartesia, and a trainer can make a Quick or Pro clone of their own
voice in the app; activating it makes it the voice these sessions speak in. Cost rows now carry
the configured provider, and a voice held by another provider falls back to text
(`VOICE_UNAVAILABLE`). Speech-to-text can also be Cartesia (`ink-whisper`). See
`docs/features/trainer-voice.md`. Review round 1 of that stage: with Cartesia, spoken replies
are transcribed in the member's saved language (`ar` or `en`, since batch ink-whisper does not
detect it and replies, including pain words, are parsed in both); `STT_ZERO_RETENTION` must be
off with Cartesia (it cannot be requested); the member's transcription consent names the
provider (`gate.speechProvider`) and says whose retention terms apply; speech is sent with the
text's language, not the voice's recording language.

## Plan (written before implementation)

Today a member can only ask for one fixed sentence per exercise in the trainer's voice
(`/api/v1/guided/:workoutId/audio`, `integrations-completion.ts`). That text used `ex.notes`
(not a field of the exercise schema) instead of the trainer's `cue`, and the heading used
`program.name` instead of `program.title`. Both are fixed here.

The new voice-led session is for a member whose membership includes premium voice
(`memberAccess(...).premiumVoice`, `entitlements.ts`) in a workspace with a verified,
consented trainer voice and an approved voice contract (`VOICE_CONTRACT_VERIFIED`). Everyone
else gets the same session as a text-guided runner (on-screen prompts, timers, tap buttons,
optional on-device speech commands).

1. **Session script (pure domain).** A structured script built from the active workout's
   planned exercises; every number written by code; free wording from the trainer's
   versioned style or checked Brain wording; the whole script re-validated before any audio
   is paid for.
2. **Audio ahead of the session (worker)** with ElevenLabs text-to-speech, one workspace
   voice budget, short reusable clips for the dynamic parts, no automatic re-send of an
   ambiguous provider outcome.
3. **Runner (pure state machine + web component)** that logs sets through the existing
   endpoint and device queue, adjusts only within the trainer's rule and stops for pain.
4. **Spoken replies** from on-device recognition or ElevenLabs speech-to-text through the
   server, re-screened on the server; buttons always work.
5. **Gating and fallbacks**, a speech-to-text provider with a connection check,
   **learning** from session outcomes, and **tests**.

## What was built

### Brain script (`packages/domain/src/voice-session.ts`, browser-safe)

- `planExercises(program)` reads the workout's exercises strictly (sets 1-10, reps 1-100,
  load 0-500 kg, rest 0-600 s); anything else is `VOICE_PLAN_UNSUPPORTED` (409).
- `buildSessionScript` produces `voice-session-script-v1` (every line owned by `code` or
  `trainer`; model wording is never spoken unless the trainer saved it into the style):
  intro + a code-owned safety line,
  warm-up, per exercise a setup line ("Exercise 1 of 2: Back squat. 3 sets of 8 reps at 60
  kilograms."), the trainer's cue (an automatically delivered Brain plan stores the library's
  cue, never the model's; a plan the trainer approved keeps the cue they saved), form reminders, one announcement per set, rest and
  rest-over prompts, encouragement, cool-down and finish, plus the trainer's adjustment rules.
  Each line has an owner: `code` (numbers, safety and tone defaults) or `trainer` (their
  saved phrases or their plan cue).
- `phraseIssues` refuses free wording with digits or number words (English and Arabic), medical
  or treatment language ("ibuprofen", "ice it", "push through the pain", "no pain no gain",
  ignoring or training through a symptom: "if your shoulder clicks, just keep going", "work
  through the burn"...), red-flag terms (`safetySignal`), instructions to change the
  prescription ("extra set", "add weight", "heavier", training to failure: "until you can't",
  "a few extra", skipping the warm-up...), unsafe technique ("hold your breath", "strain hard",
  "round your back", "yank"...; negated forms such as "don't round your back" are allowed),
  links or markup, or more than 200 characters.
- `cueIssues` (the trainer's plan cue, spoken verbatim) applies the same red-flag, medical,
  prescription and technique checks; numbers are allowed only as tempo or timing ("three
  seconds down", "3-1-1", "a count of two") and never next to kg, reps, sets, rounds or
  "more". The guided-audio route (`integrations-completion.ts`) uses the same check and leaves
  out a cue that fails. A refused line is
  replaced by the trainer's phrase or the tone's safe default; refusals are counted on the
  session event.
- `scriptIssues(script, plan)` re-checks a stored script: exercise count and every prescribed
  number, the exact text of every code-owned line, the safety line, the rules, and every free
  line. The API refuses to store an invalid script and the worker refuses to voice one.
- Trainer style (`voiceStyleSchema`, versioned per workspace): tone (calm, steady, energetic),
  their own intro/warm-up/encouragement/form/cool-down/finish phrases, and adjustment rules
  `tooHeavyReducePercent` (0-20) and `allowSkip`. Both rules are **off by default** (0 and
  false): the voice coach keeps the plan until the trainer opts in and saves a style version.
- Brain wording suggestions (owner rule "hand it to the trainer when not confident"): the
  trainer asks the Brain for lines (`POST /voice-sessions/style/suggestions`, prompt
  `voice-session-suggestions-v1`, accounted as `voice_session_suggestions`). The prompt carries
  the tone, the trainer's phrases and the published `communication` rules only: no exercises
  (technique stays the trainer's own words), no member data, no numbers. Returned lines are
  checked with `phraseIssues`; the passing ones are stored as pending suggestions on the style
  row and shown in the style panel. Nothing is spoken until the trainer adds a line to their
  phrases and saves; saving removes the adopted lines from the pending list.
- `reducedLoad` / `adjustmentAllowed`: one "too heavy" reduction to at most the rule's
  percentage below the prescribed load, rounded down to 0.5 kg, never raising load or reps.

### Runner (`packages/domain/src/voice-runner.ts`, pure)

- `parseVoiceCommand` maps a reply to `done`, `reps n` (digits, English number words, Arabic
  digits and basic Arabic words), `too_heavy`, `too_easy`, `pause`, `resume`, `ack`, `skip`,
  `repeat`, `pain` or `unknown`. Pain and red flags (`safetySignal`, which honours routine
  negations such as "no pain"; see `docs/features/safety-floor.md` for the readings and
  combinations it also holds, such as "my knee gave way" or a blood-sugar reading of 65) always win. Only explicit completion words (done, finished,
  complete, that's it, تم, خلصت...) or a rep count log a set; "okay", "yes", "sure" are `ack`
  and "go", "ready", "next", "let's go" are `resume`, which never log a set (during a set they
  get a "say done when you finish" hint; `ack` never skips a rest or resumes a pause). Negated
  effort ("not heavy", "it's not too heavy", "wasn't that hard") is not a complaint. A number
  after "set"/"of" or before a unit (kg, seconds, sets) is not a rep count, and a rep count
  wins over "heavy" in the same reply (`{reps: 6, heavy: true}`: the set is logged as said and
  the next set is lightened within the rule).
- Echo guard (`heardReply`, `isPromptEcho`): the phone speaker's echo of the trainer's voice
  must never act as a reply (the safety line contains "say pain", set prompts contain "8
  reps", "Next set." parses as resume). Replies are dropped while a clip plays and for 700 ms
  after it; for 4 s after it, a reply that repeats a recent prompt (the whole prompt, a
  contiguous run of two or more of its words, or three or more words that are 70% from it)
  is dropped too. A property test feeds every spoken line and every shared phrase at every
  runner phase and asserts no state change.
- `stepRunner(ctx, state, event)` phases: ready → intro → warm-up → setup → set → rest → ... →
  cool-down → finished, plus paused and stopped. Events: start, prompt finished, tick, command,
  held, end. Effects: say (session lines and shared clips, with the same words as text), log a
  set, report pain, outcome, finished. Rest plays "ten seconds" and a three-two-one countdown.
  An adjusted set is announced from shared clips ("Next set. 8 reps 54 kilograms"). Skipping
  follows the trainer's rule; pain stops from any phase; the plan's set count is never
  exceeded. "Too heavy" in the rest after an exercise's final set is noted for the trainer
  (`too_heavy_kept`) and never changes the finished or the next exercise.

### Data (migration `065_voice_sessions.sql`)

- `voice_session_styles` (per workspace, versioned; coaching team only), with `suggestions`
  (pending Brain wording, never spoken; version 0 = default style with suggestions only).
  Members read the current style (not the suggestions) only through the definer
  `voice_session_style()` (membership predicate).
- `voice_sessions` (member, workout or planned session, script fingerprint, mode `voice|text`, status, audio
  status `none|generating|ready|partial|capped|revoked`, script, style version, generator,
  voice id/version, unavailable reason, outcomes and events). Unique per member, workout and
  script (and per member, planned session and script while unbound), so a prepared session is
  reused. A session prepared ahead has `workout_id` NULL and `planned_session_id` set (both
  foreign keys to `records`, cascade on delete); it is bound to the workout when it starts.
  A member reads/writes its own rows; owner and staff read them.
- `voice_session_clips`: one clip per spoken line (session clips) or a shared clip per voice
  version (numbers 1-100, "point five", "kilograms", "reps", "rest", "next set", "last set",
  countdown, "logged", "skipped", "paused", "resuming", "lighter weight", "check the screen",
  "keep this weight", "stopping"...). Audio is kept only while `ready`; a member reads its own
  clips and, while a current member, the shared ones; only the owner scope (the worker) writes
  shared clips.
- `voice_guidance_spent_today()` now counts guided audio, session clips and transcription
  under one `VOICE_DAILY_USD_LIMIT` (same signature and grants).
- `model_usage_today()` no longer counts voice rows. Before this, every voice clip was a
  `cost_events` row that also counted against `MODEL_MAX_DAILY_CALLS`; one prepared session
  (138 rows in the test) would have exhausted the workspace's AI coaching allowance.
- RLS enabled and forced on the three tables; `trainer_app` grants in the migration; no
  service-role grants (`infra/runtime-role.sql` note); `scripts/verify-runtime-access.mjs`
  classifies the tables as scoped and checks `voice_session_style()` as a definer helper.

### API (`apps/api/src/voice-session.ts`, registered in `app.ts`)

Member routes (the member's own scope; no elevation):

| Route | Purpose |
| --- | --- |
| `GET /api/v1/voice-sessions/workout/:workoutId` | Gate and the workout's current session: its own, or one prepared ahead for its planned session, bound here after re-validation. A script made stale by a substitution or revision is never returned (`session: null, stale: true`) |
| `GET /api/v1/voice-sessions/planned/:plannedSessionId` | Gate, the planned session (status, date, label, program, workout once started) and its session prepared ahead (stale ones are not returned) |
| `POST /api/v1/voice-sessions` `{workoutId` or `plannedSessionId, playbackConsent?: true}` | Prepare for an active workout or ahead from a planned session (a started one resolves to its workout): builds and stores the script, queues clips in voice mode, reuses or upgrades an existing session (text → voice, revoked or capped → re-queued), revokes a stale script and builds anew |
| `GET /api/v1/voice-sessions/:id` | Session view with gate, audio progress (`readyKeys`), `stale` (checked against the current plan) and `runnable` (current and ready or running) |
| `GET /api/v1/voice-sessions/:id/audio?after=` or `?keys=l:…,s:…` | Ready audio by key order in pages of about 1.5 MB (base64), or up to 60 named clips as they become ready; sizes are read first and audio only for the chosen page; re-checks premium, playback consent, verified voice version and holds; `private,no-store` |
| `POST /api/v1/voice-sessions/:id/utterance` `{transcript}` | Parse a device transcript and re-screen it with the trainer's published safety policy; a red flag or pain opens the existing training hold and stops the session |
| `POST /api/v1/voice-sessions/:id/transcribe` `{audio, type, durationMs}` | Server speech-to-text for one short chunk (webm, ogg, mp4, mpeg or wav; at most 500 KB; 40 per minute); needs premium voice, transcription consent and budget; the cost is reserved at the larger of the declared duration and a byte-derived upper bound (exact for PCM WAV headers, otherwise the bytes at a 6 kbit/s floor), so a long clip declared short cannot slip under the cap; the provider's timing (last word end) is written to a `voice_session.transcribed` audit event and any excess is reserved as a supplement row; the audio is held in memory only and zeroed after the call; same parse and screening as above |
| `POST /api/v1/voice-sessions/:id/events` `{status?, outcomes[]}` | Append runner outcomes (adjustments validated against the script's rule), mark running/completed/stopped (running needs a bound workout) |
| `POST /api/v1/voice-sessions/consent` `{playback?, transcription?}` | Record consent; withdrawing playback revokes the member's stored clips and turns sessions to text |

Trainer routes (owner or staff): `GET`/`PUT /api/v1/voice-sessions/style` (versioned
compare-and-set, wording checked; `GET` includes pending suggestions),
`POST`/`DELETE /api/v1/voice-sessions/style/suggestions` (ask the Brain for wording
suggestions / dismiss them), `POST /api/v1/voice-sessions/style/preview` (sample script), `GET
/api/v1/voice-sessions/outcomes` (recent sessions with outcome counts per exercise, for Brain
corrections).

Safety and gating: the prepare route requires an active membership and an active workout or an
open planned session, and refuses while training is held (training hold, safety-held workout
or coach takeover).
Consent versions use the published privacy document (`legalAcceptanceVersion`) plus
`voice-session:v1`. A trainer revoking the voice or a new enrollment version revokes all clips
and turns sessions to text (`disableUserIntegrations`, enrollment route). Privacy: export
includes sessions (scripts and outcomes, no audio); erasure deletes the member's sessions and
clips (and a trainer's clips); workspace closure removes the three tables.

Guided fix (`integrations-completion.ts`): segments use the exercise `cue` (screened with
`cueIssues`; a failing cue is left out); the heading uses `program.title`.

### Worker

`processVoiceSessions(db)` runs as its own task from the worker loop (like wearable reads,
with the cycle's reviewed configuration) for active workspaces. `processVoiceSessionAudio`
(worker elevation, listed in `ELEVATIONS.worker`) first sweeps clips left `reserved` for more
than five minutes (a crash between reservation and send) to `unknown` with their cost rows
(never re-sent) and closes generating sessions with nothing left to make. It then takes up to
five generating sessions that still have pending clips, least recently served first (so a
stuck or large session cannot starve the workspace), and 20 clips per pass, most urgent first
(the first twelve lines, then the rest, then shared clips). A session stays generating until
its voice version's shared clips are made too. Before paying it re-checks the verified voice
and its version, premium voice, the member's playback consent, the plan (the workout's, or for
a session prepared ahead the planned session's, or that workout's once started; finished,
skipped or safety-held stops generation; an active training hold pauses it as `capped` with
`TRAINING_HELD`) and `scriptIssues`; a session clip must equal its script line and a shared
clip its code-owned phrase. A clip already made for the same member with the same text, voice, model and price is
copied. The budget is checked per clip under the workspace voice-budget lock; reaching it marks
the session `capped` (pending clips skipped, ready ones kept; preparing again after the budget
allows re-queues them). Each call reserves a `voice.session` cost row, marks it `unknown`
before sending and never re-sends an ambiguous outcome; delivered audio leaves cost
reconciliation open, as for guided audio.

### Speech-to-text provider

Super admin settings gain `speech_to_text` (ElevenLabs; Cartesia since stage 2026-09-28g, see
`trainer-voice.md`): `STT_PROVIDER`, `STT_BASE_URL`,
`STT_API_KEY` (encrypted), `STT_MODEL` (default `scribe_v1`), `STT_PRICE_VERSION`,
`STT_USD_PER_HOUR`, `STT_ZERO_RETENTION` (sends `enable_logging=false`) and
`STT_CONTRACT_VERIFIED`. It is disabled until configured and approved
(`integrationCapability`). The connection check reads `GET /models` (no audio sent) and
reports `verified`; without the approval flag no request is sent (`unavailable`).
`transcribeSpeech` sends one multipart request; `providerRequest` now accepts binary bodies.

### Web

- `components/voice-session.tsx` (`/app/voice-session/:workoutId`, linked from the workout
  page, and `/app/voice-session/planned/:plannedSessionId`, linked from each planned session
  in the training calendar as "Prepare the voice-led session ahead"; the ahead page shows
  preparation progress and starts the workout straight into the runner): prepare panel with
  clear states (no premium, voice not verified, contract not
  approved, budget reached, consent needed, held). The runner is keyed by session only, so
  switching voice on or off, withdrawing consent or a worker revocation keeps its place (mode
  and audio are props; buffered outcomes are sent on unmount); the script is memoised on its
  fingerprint, so progress polls never restart the microphone (the listening effects read the
  transcript handler through a ref); clips are fetched by key as they become ready (early
  lines play in the trainer's voice while the rest is prepared; missing clips are shown as
  text); it starts only a current `ready` or `running` session, shows "Prepare again" for a
  stale or revoked one and "ended" otherwise, and stops with the same action if its 30 s check
  finds the workout was changed. It runs set and rest clocks, logs
  sets through the existing device queue (`offline-queue.ts`, same keys and receipts, replay on
  reconnect), reports pain through `POST /workouts/:id/pain` with retries and an offline
  message, finishes the workout only after queued sets synced, flushes outcomes, and checks for
  holds every 30 s. Spoken replies: on-device recognition only when the browser reports local
  processing (`SpeechRecognition.available({processLocally: true})`), or the speech service
  after the member's transcription consent (simple voice activity detection, 16 kbit/s).
  Echo guard: on-device recognition is aborted while a clip plays and restarted 700 ms after;
  a server recording is not started during playback or within 700 ms of it, and one that is
  running when a clip starts is discarded unsent; every result then passes `heardReply`. The
  Pain button always works; the page says replies are not heard while the trainer speaks.
  The Skip button is shown only when the trainer's rule allows skipping. Every device transcript is re-screened on the server. Tap buttons
  for every command and a separate Pain button. Mute keeps everything as text; prompts are in a
  polite live region; controls are real buttons with labels.
- `components/voice-session-style.tsx` under Trainer voice: tone, phrases (checked live with the
  same domain rules), adjustment rules (off until chosen), Brain suggestions (ask, add a line to
  your phrases, dismiss), a preview and recent session outcomes.
- `app/voice-session.css`: logical properties only; grids wrap at 390 px.
- Minimal `workspace.tsx` edits: one import, one route branch, one link.

### Mocks

`tests/e2e/mocks/voice.ts`: text-to-speech records the text; new `POST /v1/speech-to-text`
(multipart; a test picks the words with a `TRANSCRIPT:<words>;` marker in the audio or
`nextTranscripts`; `failTranscription`; records model, size and zero retention) and
`GET /v1/models`; transcripts carry word timings (0.4 s per word). `tests/e2e/mocks/index.ts`
saves `speech_to_text` settings in the harness; `model-rules.ts` answers the `Voice session
phrasing` suggestions prompt from the trainer's own phrases (no per-exercise lines).

## Review fixes (second pass, 28 September 2026)

- Blocker, echo of the trainer's voice: `heardReply`/`isPromptEcho` in the domain, recognition
  aborted during playback and for 700 ms after, server recordings discarded when a clip
  starts; property test over every spoken line and shared phrase at every runner phase.
- Acknowledgements and negation: `ack`/`resume` never log a set; negated effort is ignored; a
  rep count wins over "heavy" and keeps it as a flag; numbers after "set"/"of" or before units
  are not reps.
- Speech-to-text cost: byte-derived upper bound (exact for PCM WAV, else a 6 kbit/s floor);
  provider timing in an audit event and any excess reserved as a supplement row (usage rows
  cannot change after the send; `protect_model_usage` enforces it).
- Staleness: both GET routes re-validate against the current plan; the runner starts only a
  runnable session and stops when its check finds the plan changed.
- Runner keyed by session id; script memoised by fingerprint; transcript handler held in a ref.
- Model wording: no longer spoken; Brain suggestions go to the trainer for approval; no model
  form or technique lines; failure, ignore-symptom, skip-warm-up and unsafe-technique patterns.
- Cues: same checks as spoken lines, numbers only as tempo; guided audio screens cues too.
- Audio ahead of the session: prepare from a planned session; bind with re-validation when the
  workout starts; clips fetched incrementally by key.
- Minors: stuck `reserved` sweep and least-recently-served selection; audio page sizes read
  before audio; "too heavy" after a final set is only noted; adjustment rules off by default.

Declined: the optional "at least 3 s before a bare done logs" rule. The set clock starts with
the set announcement, which lasts longer than 3 s, so the rule would add nothing beyond the
echo guard, and the Done button must work at once.

## Checks actually run

All on 28 September 2026 in this worktree, after the review fixes.

- `npx tsc --noEmit`: passed (0 errors).
- `node --import tsx --test tests/voice-session-domain.test.ts`: 15/15 passed.
- `node --import tsx --test tests/voice-session.test.ts` (PGlite, full app, voice mock over
  TLS): 10/10 passed. New coverage: the planned-session path (audio before the day, bound on
  start with no new audio, a substitution makes the script stale and GET returns no runnable
  session, preparing again revokes it), the reserved-clip sweep, clips by key, byte-derived
  transcription cost near the cap (refused, nothing sent) and far from it (reserved at 533 s or
  more for a 400 KB clip declared as 200 ms), provider timing, opt-in adjustment rules, and
  Brain suggestions (checked, stored, never spoken, used only after the trainer saves them,
  dismissed).
- Related PGlite suites: `logical-css`, `rtl-layout`, `isolation-elevation`, `isolation-guard`,
  `provider-configuration`, `fix-settings`, `e2e-harness-mocks`: 43/43 passed;
  `integrations-completion`, `coaching-completion`, `platform-settings`, `privacy-lifecycle`,
  `isolation-follower`, `isolation-scope`: 61/61 passed.
- PostgreSQL parity: `/opt/tools/pg-sandbox.sh 56133` with `voice-session`,
  `voice-session-domain`, `integrations-completion`, `privacy-lifecycle`,
  `isolation-follower`, `coaching-completion`: 55 migrations applied, runtime access verifier
  passed (40 scoped tables, 41 helpers), 63/63 tests passed as the restricted runtime role
  (`PG_SELECTED_FAILED_FILES=0`).

Not run: the whole suite, `next build`, the e2e harness (`npm run e2e`) and a browser check of
the runner. No browser was used, so the echo guard, microphone restarts and incremental clip
loading are untested in a real browser.

## Limits

- Real ElevenLabs quality, latency, languages, pricing and zero-retention support are not
  qualified; only the mock was used. Cost rows stay `unknown` until invoice reconciliation.
  The 6 kbit/s floor over-reserves normal compressed replies (about 2.7 times at the runner's
  16 kbit/s). This is deliberate, so the cap holds.
- Echo guard trade-offs: replies spoken while the trainer's voice plays are not heard (the
  Pain button still works). For 4 s after a clip, a reply of two or more words that appears in
  that prompt (for example "too heavy" just after the help clip) is ignored and must be
  repeated or tapped.
- On-device recognition is used only where the browser exposes local processing (currently few
  browsers); elsewhere members use the speech service (premium, consent) or buttons. Browser
  voice activity detection is a simple level threshold and was not tested in a browser.
- Numbers above 100 and loads that are not whole or half kilograms are shown on screen with a
  "check the screen" clip rather than spoken.
- When a changed plan stops a running session, preparing again starts the new script from the
  beginning; sets already logged stay in the workout log, but the runner does not skip them.
- Brain suggestions cover the opening, warm-up, encouragement, cool-down and sign-off only; form
  reminders and cues are the trainer's own words. Outcomes are summarized for the trainer;
  turning them into Brain rule corrections remains the trainer's action (no model weights are
  trained).
- Adjustments are limited to one load reduction per exercise within the trainer's rule (off by
  default); the runner never raises load, reps or sets.
- The session plays in the trainer's voice only while the page is open; iOS background audio
  and screen-lock behaviour were not tested.
