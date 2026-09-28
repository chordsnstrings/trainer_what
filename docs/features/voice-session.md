# Voice coach that runs the workout session (package `core/voice-session`)

Status: implemented on branch `core/voice-session` (base `b4ac2b5`, migration 065). The
checks below were run exactly as recorded; limits are listed at the end. Nothing was
deployed and no real provider was contacted.

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
- `buildSessionScript` produces `voice-session-script-v1`: intro + a code-owned safety line,
  warm-up, per exercise a setup line ("Exercise 1 of 2: Back squat. 3 sets of 8 reps at 60
  kilograms."), the trainer's cue, form reminders, one announcement per set, rest and
  rest-over prompts, encouragement, cool-down and finish, plus the trainer's adjustment rules.
  Each line has an owner: `code` (numbers and safety, generated from the plan), `trainer`
  (their phrases or cue) or `brain` (model wording).
- `phraseIssues` refuses free wording with digits or number words (English and Arabic), medical
  or treatment language ("ibuprofen", "ice it", "push through the pain", "no pain no gain"...),
  red-flag terms (`safetySignal`), instructions to change the prescription ("extra set", "add
  weight", "heavier"...), links or markup, or more than 200 characters. A refused line is
  replaced by the trainer's phrase or the tone's safe default; refusals are counted on the
  session event.
- `scriptIssues(script, plan)` re-checks a stored script: exercise count and every prescribed
  number, the exact text of every code-owned line, the safety line, the rules, and every free
  line. The API refuses to store an invalid script and the worker refuses to voice one.
- Trainer style (`voiceStyleSchema`, versioned per workspace): tone (calm, steady, energetic),
  their own intro/warm-up/encouragement/form/cool-down/finish phrases, `modelPhrasing`, and
  adjustment rules `tooHeavyReducePercent` (0-20, default 10) and `allowSkip`.
- Optional Brain wording: when the trainer turns on `modelPhrasing` and a model is configured,
  the configured model rewords lines from the trainer's phrases and the published Brain's
  `communication` rules (prompt `voice-session-phrasing-v1`, accounted as
  `voice_session_script`). The prompt carries exercise names and cues only: no member data and
  no prescribed numbers. Every returned line is checked as above.
- `reducedLoad` / `adjustmentAllowed`: one "too heavy" reduction to at most the rule's
  percentage below the prescribed load, rounded down to 0.5 kg, never raising load or reps.

### Runner (`packages/domain/src/voice-runner.ts`, pure)

- `parseVoiceCommand` maps a reply to `done`, `reps n` (digits, English number words, Arabic
  digits and basic Arabic words), `too_heavy`, `too_easy`, `pause`, `resume`, `skip`,
  `repeat`, `pain` or `unknown`. Pain and red flags (`safetySignal`, which honours routine
  negations such as "no pain") always win.
- `stepRunner(ctx, state, event)` phases: ready → intro → warm-up → setup → set → rest → ... →
  cool-down → finished, plus paused and stopped. Events: start, prompt finished, tick, command,
  held, end. Effects: say (session lines and shared clips, with the same words as text), log a
  set, report pain, outcome, finished. Rest plays "ten seconds" and a three-two-one countdown.
  An adjusted set is announced from shared clips ("Next set. 8 reps 54 kilograms"). Skipping
  follows the trainer's rule; pain stops from any phase; the plan's set count is never
  exceeded.

### Data (migration `065_voice_sessions.sql`)

- `voice_session_styles` (per workspace, versioned; coaching team only). Members read the
  current style only through the definer `voice_session_style()` (membership predicate).
- `voice_sessions` (member, workout, script fingerprint, mode `voice|text`, status, audio
  status `none|generating|ready|partial|capped|revoked`, script, style version, generator,
  voice id/version, unavailable reason, outcomes and events). Unique per member, workout and
  script, so a prepared session is reused. A member reads/writes its own rows; owner and staff
  read them.
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
| `GET /api/v1/voice-sessions/workout/:workoutId` | Gate (mode and reasons) and the latest session for the workout |
| `POST /api/v1/voice-sessions` `{workoutId, playbackConsent?: true}` | Prepare: builds and stores the script, queues clips in voice mode, reuses or upgrades an existing session (text → voice, revoked or capped → re-queued), rebuilds a stale script after a substitution |
| `GET /api/v1/voice-sessions/:id` | Session view with gate and audio progress |
| `GET /api/v1/voice-sessions/:id/audio?after=` | Ready audio in pages of about 1.5 MB (base64), re-checking premium, playback consent, verified voice version and holds; `private,no-store` |
| `POST /api/v1/voice-sessions/:id/utterance` `{transcript}` | Parse a device transcript and re-screen it with the trainer's published safety policy; a red flag or pain opens the existing training hold and stops the session |
| `POST /api/v1/voice-sessions/:id/transcribe` `{audio, type, durationMs}` | Server speech-to-text for one short chunk (webm, ogg, mp4, mpeg or wav; at most 500 KB and 15 s; 40 per minute); needs premium voice, transcription consent and budget; the audio is held in memory only and zeroed after the call; same parse and screening as above |
| `POST /api/v1/voice-sessions/:id/events` `{status?, outcomes[]}` | Append runner outcomes (adjustments validated against the script's rule), mark running/completed/stopped |
| `POST /api/v1/voice-sessions/consent` `{playback?, transcription?}` | Record consent; withdrawing playback revokes the member's stored clips and turns sessions to text |

Trainer routes (owner or staff): `GET`/`PUT /api/v1/voice-sessions/style` (versioned
compare-and-set, wording checked), `POST /api/v1/voice-sessions/style/preview` (sample
script), `GET /api/v1/voice-sessions/outcomes` (recent sessions with outcome counts per
exercise, for Brain corrections).

Safety and gating: the prepare route requires an active membership and an active workout and
refuses while training is held (training hold, safety-held workout or coach takeover).
Consent versions use the published privacy document (`legalAcceptanceVersion`) plus
`voice-session:v1`. A trainer revoking the voice or a new enrollment version revokes all clips
and turns sessions to text (`disableUserIntegrations`, enrollment route). Privacy: export
includes sessions (scripts and outcomes, no audio); erasure deletes the member's sessions and
clips (and a trainer's clips); workspace closure removes the three tables.

Guided fix (`integrations-completion.ts`): segments use the exercise `cue`; the heading uses
`program.title`.

### Worker

`processVoiceSessions(db)` runs as its own task from the worker loop (like wearable reads,
with the cycle's reviewed configuration) for active workspaces. `processVoiceSessionAudio`
(worker elevation, listed in `ELEVATIONS.worker`) takes up to five generating sessions and 20
clips per pass, most urgent first (the first twelve lines, then the rest, then shared clips).
Before paying it re-checks the verified voice and its version, premium voice, the member's
playback consent, the workout (active; finished or held stops generation) and
`scriptIssues`; a session clip must equal its script line and a shared clip its code-owned
phrase. A clip already made for the same member with the same text, voice, model and price is
copied. The budget is checked per clip under the workspace voice-budget lock; reaching it marks
the session `capped` (pending clips skipped, ready ones kept; preparing again after the budget
allows re-queues them). Each call reserves a `voice.session` cost row, marks it `unknown`
before sending and never re-sends an ambiguous outcome; delivered audio leaves cost
reconciliation open, as for guided audio.

### Speech-to-text provider

Super admin settings gain `speech_to_text` (ElevenLabs): `STT_PROVIDER`, `STT_BASE_URL`,
`STT_API_KEY` (encrypted), `STT_MODEL` (default `scribe_v1`), `STT_PRICE_VERSION`,
`STT_USD_PER_HOUR`, `STT_ZERO_RETENTION` (sends `enable_logging=false`) and
`STT_CONTRACT_VERIFIED`. It is disabled until configured and approved
(`integrationCapability`). The connection check reads `GET /models` (no audio sent) and
reports `verified`; without the approval flag no request is sent (`unavailable`).
`transcribeSpeech` sends one multipart request; `providerRequest` now accepts binary bodies.

### Web

- `components/voice-session.tsx` (`/app/voice-session/:workoutId`, linked from the workout
  page): prepare panel with clear states (no premium, voice not verified, contract not
  approved, budget reached, consent needed, held); the runner plays clips from memory
  (downloaded once in pages; missing clips are shown as text), runs set and rest clocks, logs
  sets through the existing device queue (`offline-queue.ts`, same keys and receipts, replay on
  reconnect), reports pain through `POST /workouts/:id/pain` with retries and an offline
  message, finishes the workout only after queued sets synced, flushes outcomes, and checks for
  holds every 30 s. Spoken replies: on-device recognition only when the browser reports local
  processing (`SpeechRecognition.available({processLocally: true})`), or the speech service
  after the member's transcription consent (simple voice activity detection, never while the
  trainer's voice is playing). Every device transcript is re-screened on the server. Tap buttons
  for every command and a separate Pain button. Mute keeps everything as text; prompts are in a
  polite live region; controls are real buttons with labels.
- `components/voice-session-style.tsx` under Trainer voice: tone, phrases (checked live with the
  same domain rules), adjustment rules, Brain rewording opt-in, a preview and recent session
  outcomes.
- `app/voice-session.css`: logical properties only; grids wrap at 390 px.
- Minimal `workspace.tsx` edits: one import, one route branch, one link.

### Mocks

`tests/e2e/mocks/voice.ts`: text-to-speech records the text; new `POST /v1/speech-to-text`
(multipart; a test picks the words with a `TRANSCRIPT:<words>;` marker in the audio or
`nextTranscripts`; `failTranscription`; records model, size and zero retention) and
`GET /v1/models`. `tests/e2e/mocks/index.ts` saves `speech_to_text` settings in the harness;
`model-rules.ts` answers the `Voice session phrasing` prompt from the trainer's own phrases.

## Checks actually run

All on 28 September 2026 in this worktree.

- `node node_modules/typescript/bin/tsc --noEmit`: passed (0 errors).
- `node --import tsx --test tests/voice-session-domain.test.ts`: 12/12 passed (PGlite not
  needed).
- `node --import tsx --test tests/voice-session.test.ts` (PGlite, full app, voice mock over
  TLS): 9/9 passed. Covers text fallback and gating, guided cue/title fix, playback consent,
  worker generation (18 session + 120 shared clips), cost rows left for reconciliation, paging,
  cached re-prepare, set logging through the workout endpoint from runner effects, adjustment
  validation, trainer outcomes, the budget cap and resume, clip reuse (0 generated, 18 copied),
  row security between members and for shared clips, transcription consent/format/cost/zero
  retention, device-transcript re-screening, pain → safety hold and stopped session, blocked
  transcription and preparation while held, consent withdrawal and voice revocation removing
  audio, style checks/versioning/definer access, Brain wording checks and prompt contents,
  model-call limit excluding voice rows, speech-to-text connection check and 503 fallback.
- Related existing suites on PGlite: `logical-css`, `rtl-layout`, `isolation-elevation`,
  `isolation-guard`, `provider-configuration`, `fix-settings`, `e2e-harness-mocks`: 43/43
  passed; `integrations-completion`, `coaching-completion`, `platform-settings`,
  `privacy-lifecycle`, `isolation-follower`, `isolation-scope`: 61/61 passed.
- PostgreSQL parity: `/opt/tools/pg-sandbox.sh 56133` with `voice-session`,
  `voice-session-domain`, `integrations-completion`, `privacy-lifecycle`,
  `isolation-follower`, `coaching-completion`: 55 migrations applied, runtime access verifier
  passed (40 scoped tables, 41 helpers), 59/59 tests passed as the restricted runtime role
  (`PG_SELECTED_FAILED_FILES=0`).

Not run: the whole suite, `next build`, the e2e harness (`npm run e2e`) and a browser check of
the runner (the optional Playwright check was not done).

## Limits

- Real ElevenLabs quality, latency, languages, pricing and zero-retention support are not
  qualified; only the mock was used. Cost rows stay `unknown` until invoice reconciliation.
- On-device recognition is used only where the browser exposes local processing (currently few
  browsers); elsewhere members use the speech service (premium, consent) or buttons. Browser
  voice activity detection is a simple level threshold and was not tested in a browser.
- Numbers above 100 and loads that are not whole or half kilograms are shown on screen with a
  "check the screen" clip rather than spoken.
- The Brain wording is optional and per session; the model is not asked to write numbers and
  no member data is sent. Outcomes are summarized for the trainer; turning them into Brain rule
  corrections remains the trainer's action (no model weights are trained).
- Adjustments are limited to one load reduction per exercise within the trainer's rule; the
  runner never raises load, reps or sets.
- The session plays in the trainer's voice only while the page is open; iOS background audio
  and screen-lock behaviour were not tested.
