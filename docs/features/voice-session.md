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

Update 29 September 2026 (branch `core/fix-voice`, base `core/fix-refs`): talk-back and language
fixes after the first live run of the whole chain against Cartesia (a real Quick clone, cues in
English and Arabic, spoken replies through ink-whisper, the parser and the runner). See "Talk-back
and language (29 September 2026)" below.

Update 29 September 2026, later (branch `fix/voice-talkback`, base `0c9569d`): talk-back safety
after the retest of the whole voice chain against every available transcriber (1,080 replies).
One rule is enforced everywhere: a set is logged only from an unambiguous completion in the
member's own reply language; anything uncertain asks again or does nothing, and never logs. See
"Talk-back safety after the retest" below; it replaces the rule that acted on the other-language
reading when the reply-language reading was not understood.

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
  `voice-session-suggestions-v2` since 29 September 2026, accounted as
  `voice_session_suggestions`). The prompt carries
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
  `repeat`, `not_done` (since 29 September 2026), `pain` or `unknown`. Pain and red flags
  (`safetySignal`, which honours routine negations such as "no pain"; see
  `docs/features/safety-floor.md` for the readings and combinations it also holds, such as
  "my knee gave way" or a blood-sugar reading of 65) always win. Only explicit completion words (done, finished,
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

- **Timed and distance work** (29 September 2026, `core/fix-plans`; see
  `docs/features/brain-plans.md` "Model trial fixes"): a plan exercise with `durationSeconds` or
  `distanceMeters` (sets are rounds) is voiced as rounds. `planExercises` accepts it without reps
  (reps 0), the setup line says "3 rounds of 30 seconds, hard effort" (or "20 minutes, easy
  effort" for one continuous bout, with a pace when given) and each round line says "Round 2 of 3.
  30 seconds. The clock starts now. Say done if you stop early." The runner starts the round's
  clock (`workLeft`) when that prompt has been spoken, cues "Ten seconds." (rounds of 20 s or
  more) and "Three. Two. One.", then plays the shared clip "Time." (`time_up`, new) and logs the
  round (`log_set` with `reps: 0` and `durationSeconds`), then rests or moves on (no rest after a
  continuous bout). "Done" ends a round early and logs the seconds it lasted; a pause stops the
  clock and "resume" carries on from where it stopped ("Resuming. Go."). A distance round waits
  for "done" (a spoken number is not reps there) and logs `distanceMeters`. The on-screen status
  shows the time left. `scriptIssues` also compares duration, distance, pace and effort; rep lines
  are unchanged, so `voice-session-script-v1` stays and stored scripts remain valid. The shared
  clip set is now 122 (numbers 1–100 and 22 phrases).

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
| `POST /api/v1/voice-sessions/:id/transcribe` `{audio, type, durationMs, language?}` | Server speech-to-text for one short chunk (webm, ogg, mp4, mpeg or wav; at most 500 KB; 40 per minute); needs premium voice, transcription consent and budget; the cost is reserved at the larger of the declared duration and a byte-derived upper bound (exact for PCM WAV headers, otherwise the bytes at a 6 kbit/s floor), so a long clip declared short cannot slip under the cap; the provider's timing (last word end) is written to a `voice_session.transcribed` audit event and any excess is reserved as a supplement row; the audio is held in memory only and zeroed after the call; same parse and screening as above. `language` (`en` or `ar`) is the reply language the member chose on the runner (default: their saved language); with Cartesia the reply is also read in the other language, each reading with its own cost row, and pain in either stops the session (29 September 2026) |
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

## Talk-back and language (29 September 2026)

Branch `core/fix-voice` (base `core/fix-refs`). What the app did before this, what it does now,
and what it still cannot do. The live run behind it is in "Live check of the whole chain" below.

### Spoken replies (`packages/domain/src/voice-runner.ts`)

Found by reading the chain and by the live transcripts:

- "I didn't do the last one" logged a set of **1 rep** (the pronoun "one" was read as a count),
  and so did "the last one was too heavy", "that one was easy", "next one", "done with this one"
  and "one more". "One" is now a count only on its own or after a word that reports a count
  ("just one", "that was one"), never after "the/this/that/last/next/..." or before
  "more/of/moment/...".
- A negated completion was read as a completion: "I didn't finish that set", "not done yet",
  "I'm not done", "ما خلصت" (I haven't finished) all **logged the set**. Negated completions
  never complete a set now.
- New command `not_done` for a set the member says was not done, in the past tense: "I didn't
  do the last one", "I couldn't do it", "I missed the last one", "I missed 3 reps", "لم أكمل
  المجموعة الأخيرة", "لم أقم بالمجموعة الأخيرة", "لم أستطع إكمال المجموعة", "لم أتمكن من
  إكمالها", "لم أقدر على إكمالها", "ما استطعت", "ما سويتها", "ما سويت الأخيرة", "ما خلصتها",
  "ما قدرت أكملها". `previous` is set when the reply points back ("last", "previous",
  "الأخيرة", "السابقة", "اللي فاتت"), but not for "the last two reps", "the last few" or "the
  last reps", which are reps of the set, not an earlier set ("the last one" and "the last 2
  sets" still point back); `heavy` when it also says too heavy. Still-going forms ("not done
  yet", "almost there", "لسا ما خلصت", "لم أنته بعد") are an acknowledgement: never logged,
  never reported. Gulf present "ما اقدر اكمل" (I can't finish) stays a load complaint.
- A number inside a negated clause is never a rep count (review of this branch): "I didn't do
  the last 2 reps", "I couldn't do the last two reps", "couldn't finish the last 3", "I did not
  complete 10", "ما سويت آخر ثنتين", "ما قدرت اكمل آخر ثلاث" each **logged a set** with the
  number the member did not do. The clause (the negated verb and what it governs, up to
  punctuation or a word that starts what was done instead: "but", "only", "just", "did", "بس",
  "لكن", "سويت"...) is removed before the count is read, so these are `not_done`, "I can't do
  10" earns the help line, "ما اقدر اكمل ثلاث" is too heavy and "I haven't finished 8 yet" is
  an acknowledgement; a count said after the clause is still logged as said ("I didn't finish,
  did 6", "I didn't do 8, only 6", "ما قدرت اكمل بس سويت ست" log 6).
- Arabic coverage, Modern Standard and Gulf: completion (أنهيت، أكملت، كملت، خلصتها، خلصنا،
  تمت، سويتها), counts (MSA teens "اثنا عشر", "ثلاثة عشر"; unit-and-tens "خمسة وعشرون"; tens
  60-90 and the -ون forms; Gulf one-word teens "اثنعش", "خمسطعش"...; a joined "و"/"ب" as in
  "بثماني"), effort ("تقيل", "ما اقدر ارفعه", negated "مو ثقيل وايد"), pause ("استنى",
  "اصبر", "مهلا"), repeat ("مرة ثانية", "شنو", "وش", "ما سمعتك"), carry on ("نكمل", "هيا",
  "التالي" alone, like English "next"), skip ("التمرين التالي", "نتخطى", "طوفها") and
  acknowledgements ("زين", "ماشي", "حاضر", "إن شاء الله"). Before, "التالي" skipped the set
  (English "next" only carried on) and "اثنا عشر" logged 10, "ثلاثة عشر" logged 3.
- Pain: MSA "أشعر بدوار" (I feel dizzy) was not a stop before; the runner's own stop list now
  adds dizziness (دوار), nausea and vomiting (غثيان، أستفرغ، throw up, vomit), spasm and cramp,
  "something is wrong" (في شي غلط) and "I am not well" in the first person ("I'm not okay",
  "I don't feel well", "انا مو زين", "ماني زين", "مو بخير", "احس اني مو زين"). This list only adds
  stops; the code floor (`safetySignal`) and the trainer's policy are unchanged. "الوزن مو زين"
  (the weight is not good) is not a stop. "انا مو تمام", "ماني تمام" and "احس اني مو تمام" (I'm
  not okay) stop the session like "I'm not okay" (review of this branch: they were
  acknowledgements).
- A negated acknowledgement is not one: "مو زين", "مب زين", "مو تمام", "not okay", "not fine",
  "I'm not sure" earn the help line, which names pain. Before the review the new Arabic
  acknowledgement words made "مو زين" (not good) a silent acknowledgement, where it had been
  unknown before this branch.
- "Thank you" (and "شكراً", "يعطيك العافية") is an acknowledgement: polite, and also what the
  speech model returned for a reply it could not read ("Thank you." for Arabic "ثمان تكرارات"
  read as English), so it never earns the help line.

Review round 2 of this branch (same day):

- A negated or hedged completion logged the set at the full target. This branch had added "did
  it", "made it" and "nailed it" as completion words, so "I never made it", "I almost made it",
  "I nearly made it", "I never did it", "I almost did it", "I never nailed it" and "not quite made
  it" each **logged the set** (on the base they were the help line). The same happened with words
  that were completions before this branch: "it wasn't done", "wasn't finished", "nowhere near
  done", "nearly done", "ما تم", "ما تمت", "ما انجزت", "مو خلاص". Now past-tense forms ("never
  did/made/nailed", "almost/nearly/not quite made/did", "wasn't done", "didn't get it done", "لم
  يتم", "ما انجزتها") are `not_done`, and any completion word after a negation in the same clause
  (no punctuation between, at most three English or two Arabic filler words such as "it", "quite",
  "بعد") is not a completion: the reply is a still-going acknowledgement ("I haven't made it",
  "nearly done", "ما تم", "مو خلاص"). Arabic "لا" does not negate a completion ("لا خلصت" is "no,
  I finished"). "Did it", "made it", "nailed it", "barely made it", "ما شاء الله خلصت" and "ما في
  ألم خلصت" still complete the set.
- A negated request to carry on moved the session on. This branch had added "مستعد", "جاهزه",
  "نكمل", "هيا" and "التالي" to the carry-on words without negation, so "مو مستعد", "لست مستعدة",
  "مب جاهزه", "ما ني مستعد", "ما نكمل", "ما ابي نكمل" and "هيا لا" **resumed**: in a rest the
  next set started at once, in the set-up set 1 started. The English forms ("I'm not ready", "I
  can't continue", "I can't go on", "don't start yet", "I don't want to continue") resumed on the
  base too, and "don't skip" and "I'm not ready for the next exercise" skipped. A carry-on or skip
  word after a negation in the same clause (English negations, and Arabic "ما/مو/مب/مش/لست/ماني/
  ليس/غير"; "لا" and "لن" only before a verb: "لا تبدا", "لن أكمل", "لا تتخطى"), or followed by a
  final "no"/"لا" ("ready? no", "هيا لا"), is now a **pause**: the rest clock stops and nothing
  starts until the member says to carry on. Gulf "ما اكمل" (I'm not carrying on) was a silent
  acknowledgement and is now a pause; "ما اقدر اكمل" stays a load complaint. "What's next" in
  Arabic ("ما التالي") repeats the prompt, like English "what's next".
- "آخر وحدة" / "آخر واحدة" (the last one, the usual Gulf and MSA form) did not point back, so in a
  set "ما سويت آخر وحدة" named the current, unlogged set instead of the set just logged, and the
  member was not told to correct the log. "آخر" now points back, except before a rep number or
  "تكرار" ("آخر ثنتين", "آخر تكرارين"), which are reps of the set, and "التكرارات الأخيرة" no
  longer points back either. "واحد/واحدة" after "آخر", "هذي", "هذا", "كل", "نفس"... or before
  "ثانية", "كمان"... is a pronoun, not a count: "آخر واحدة كانت ثقيلة" and "هذي واحدة صعبة"
  logged **a set of 1 rep** (on the base too; the Arabic of "the last one was too heavy") and are
  now too heavy; "آخر واحدة ما سويتها" logged 1 rep and is now `not_done` pointing back. A number
  after "last", "first", "آخر" or "أول" is never a count ("the last two were hard" logged 2 reps,
  "the first 5 were easy" logged 5).

### "Not done" in the runner

`not_done` never logs, never skips and never moves the session on. The runner says "Noted. Your
trainer will review it." (the existing shared clip) and records the outcome `not_done` with the
set it is about: the set just finished during a rest or the cool-down; the set before the current
one when the reply points back ("the last one" during set 2 is set 1); otherwise the current set.
The outcome says whether the runner had logged that set (`logged`). A logged set stays logged:
the page tells the member to correct it on the workout log (`POST /workouts/:id/sets/:eventId/correct`
already exists) and the trainer sees "not done to review" in Recent voice sessions. With "too
heavy" in the same reply the load rule applies as for "too heavy". Before the session starts it
does nothing; while paused it is noted and the pause holds. The events route accepts `not_done`
and `logged` (`outcomeSchema`).

### Which language each line is spoken in

- Before, every session line, shared phrase and guided segment was sent to Cartesia with
  `language: "en"` (the worker passed no `textLanguage`), including the trainer's Arabic phrases
  and Arabic plan cues. `generateTrainerVoice` now sends the line's own language when the caller
  does not fix it (`speechLanguage`, `packages/domain/src/speech-language.ts`: Arabic when a line
  has more Arabic than Latin letters). The preview line still fixes English.
- Code-owned lines (setup, set, rest, rest over, the safety line) and the shared clips are
  English templates and are always sent as English (`lineLanguage`), even when an exercise name
  in them is Arabic. Review of this branch: "Last exercise: تمرين الضغط على الأرض مع رفع القدمين.
  3 sets of 12 reps." has more Arabic than Latin letters and was sent as Arabic, template and
  numbers included. The worker passes the language (`textLanguage`) for every clip. A guided
  segment's language is decided without its exercise name (`guidedSegmentLanguage`): English
  unless the trainer's cue in it outweighs the template.
- The clip fingerprint (session clips) and the guided-audio fingerprint take the language the
  line is sent in and include it when it is not English, so audio made the old way is never
  reused; a code line with an Arabic exercise name keeps its old (English) fingerprint.
- A bilingual trainer's phrases follow the member's language: `buildSessionScript` takes the
  member's saved language (`notification_preferences.data.language`, read when a session is
  prepared) and uses the trainer's phrases of each kind in that language first; phrases in the
  other language are used only when the trainer wrote none of that kind in it. Before, an English
  member heard the trainer's English and Arabic intro lines back to back and encouragement
  alternated between the languages. The plan cue is the trainer's own and is spoken to everyone.
  Stored scripts stay valid (`voice-session-script-v1` unchanged; `scriptIssues` does not check
  the choice).

### Speech-to-text in two languages (Cartesia)

Cartesia's batch ink-whisper is told the language and cannot detect it. Live, a reply in the
other language came back as unrelated words: English "Pain." read as Arabic was "أمي", "My knee
hurts." was "أمي أمي", Arabic "ألم" read as English was "I", "يعورني ظهري" was "Ia ur ni vahri".
So a member whose saved language was English and who reported pain in Arabic (or the reverse,
including the English word "pain" the safety line asks for) was **not stopped**. Now:

- With Cartesia the transcribe route reads each reply twice, in the member's reply language and
  in the other language, in parallel (each reading reserves and prices its own
  `voice.transcription` row; the second carries `screening: true`; the budget check covers
  both). ElevenLabs detects the language itself and is read once.
- Every reading is screened (trainer policy and code floor, `heldByScreen`): pain in either
  opens the hold and stops the session.
- (Replaced after the retest, see "Talk-back safety after the retest": only the reply-language
  reading is ever acted on, and the other reading is screened for pain phrases.) Otherwise the
  reply-language reading is acted on, or the other reading when only that one was
  understood (`replyTranscript`: the first reading was unknown or a bare acknowledgement).
- When the reply-language reading fails and the other succeeds (review of this branch), the
  other reading is screened for pain (and opens the hold when flagged) but never acted on: the
  route answers 502 `SPEECH_UNCONFIRMED` and the member says it again, as when every reading
  fails. Before the review it acted on the other reading, which for speech in the reply
  language is often unrelated words ("It wasn't the gay light." for Gulf "too heavy"). The
  failed reading's cost row stays `unknown` (it was sent); the other is `estimated`. A failed
  screening reading changes nothing: the reply reading is used.
- The runner has "I reply in" (the app's language, English or العربية), kept per device; it sets
  the on-device recognition language (`ar-AE`/`en-US`) and is sent as `language` to the
  transcribe route.

Replaying the 18 live cross-language readings through this rule: all 8 pain reports stop the
session (4 were missed before) and 5 more replies are understood. The one conflict left: Gulf
"الوزن ثقيل وايد" read as English was "It wasn't the gay light." (too easy); with English as the
reply language the English reading wins and it is only noted as "too easy" (no load change).
Choosing Arabic on the runner reads it correctly.

### Brain wording suggestions

In the model trial the voice wording call was refused as "not in the expected form" for Claude
Opus 5.5 and Sonnet 5 on the bilingual trainer (five warm-up lines where four are kept; the
prompt never said four) and for Claude Haiku 4.5 on all three trainers (one line as a plain
string; other key names). Prompt `voice-session-suggestions-v2` states the exact keys, that each
is a list, the per-kind limits (4, 4, 8, 4, 4; `SUGGESTION_LIMITS`) and English or Arabic
following the trainer's phrases. `readVoiceSuggestions` reads leniently: a kind may be a list or
one line; lines past a kind's limit, non-text items and unknown keys are dropped; an answer with
none of the kinds is still refused. Every line still goes through `checkedSuggestions` and the
trainer's review; nothing is spoken until the trainer saves it. With the trial's raw answers
(regression tests): Opus and Sonnet T2 are accepted with Arabic lines; Haiku T2 gives four
lines. The payload carries no IDs, so no short references (`prompt-refs`) are needed here.

Review round 2: Haiku T1 put the kinds under `suggestions` with other names ("opening", "warmUp",
"coolDown", "signOff"). The reader now also takes a known other name of a kind (compared without
case, spaces, dashes or underscores: opening/welcome/greeting for intro, sign-off/closing/farewell
for finish, warm-up, cool-down, encouragements) and, only when the top level has no kind, the
kinds one level down under `suggestions`. Haiku T1 is now read (all five kinds, six lines; none
fails the checks). Haiku T3 (`{"wording", "script", "emotion"}`: one line with no kind) is
still refused, because reading a kind from it would be a guess. The prompt contract (the five keys, each a list, and the
limits 4/4/8/4/4) is pinned by `tests/voice-session.test.ts` on the system prompt actually sent.
Not done: the three Haiku voice wording tasks were **not re-run** against v2 (this worktree has no
model provider configured), so whether Haiku now follows the stated keys is unverified; only its
recorded T1 and T2 answers are known to be read. The call still sends `response_format: {type:
"json_object"}`, not a JSON schema: no model call in the app sends a schema (they all send
`json_object` to an OpenAI-compatible endpoint), and schema support differs by provider (one that
refuses the parameter would fail the call outright); the lenient reader, the line checks and the
trainer's review already cover a wrong shape.

### Live check of the whole chain (29 September 2026)

A scratchpad script (not in the repository) ran the app's own functions from this worktree
against api.cartesia.ai: `generateTrainerVoice`, `transcribeSpeech`, `CartesiaClient.cloneVoice`
through `cartesiaVoiceClient(voiceContract())`, `checkSample`, `buildSessionScript`,
`parseVoiceCommand`, `heardReply` and `stepRunner`. It ran under `node --test` so the app's test
transport hook could send the requests through this sandbox's HTTPS proxy (`providerRequest`
pins DNS and connects directly, which the sandbox does not allow); everything above the transport
was the app's code. Model `sonic-3.6`, API version `2026-08-14`, key read from a file and never
printed. Rates used for estimates: text to speech about 1 credit per character, batch
speech-to-text 1 credit per 2 seconds (Cartesia's credits page); 5 USD per 100,000 credits (Pro
plan) and 49 USD per 1,250,000 (Startup).

| Step | Latency | Billed | Result |
| --- | --- | --- | --- |
| Sample, stock voice "Skylar" (273 characters) | 2.1 s | 273 credits | 15.1 s MP3; passes the app's Quick clone recording check |
| Quick clone (`POST /voices/clone`, name `trainsyou-<uuid>`, `en`) | 3.4 s | not shown by the API | voice made; the name look-up found it 95 ms later |
| Cue EN: setup line (62) / set line (95) / countdown "Three. Two. One." (16) | 1.4 / 1.3 / 0.5 s | 173 | 5.9 / 6.6 / 2.4 s of audio in the clone |
| Cue AR: intro phrase (21) / plan cue (35) / encouragement (14), sent as `ar` | 0.4-0.5 s | 70 | 2.2 / 3.3 / 2.0 s; read back as Arabic almost word for word |
| The Arabic plan cue sent as `en` (the old behaviour) | 0.6 s | 35 | read back with "ذهركي" for "ظهرك" |
| Talk-back, stock voices "Daniel" (en) and "Raed" (ar), 6 replies | 0.3-0.6 s each | 118 | "Done. 8 reps.", "That was too heavy.", "I didn't do the last one.", "خلصت سويت ثمان", "الوزن ثقيل وايد", "لم أكمل المجموعة الأخيرة": every one transcribed exactly and parsed to reps 8, too heavy, not done (English), reps 8, too heavy, not done (Arabic) |
| ink-whisper, 10 readings | 0.19-0.38 s each | 21.8 s of audio | the same Gulf reply read as English: "It wasn't the gay light." |
| Runner, English and Arabic members | - | - | set 1 logged with 8 reps at 60 kg; too heavy lowered set 2 to 54 kg (trainer rule 10%); not done noted for set 1 with `logged: true`, nothing logged; after the rest, set 2 announced at 54 kg |
| Delete the clone, then the name look-up | 1.2 s | - | deleted; look-up empty |

Totals: 669 characters and 21.8 s of transcription, about 680 credits: 0.034 USD at the Pro plan
rate (0.027 at Startup). A first attempt stopped before sending the clone request (the script's
own clone description had a semicolon, which the app's form check refuses) after one 273-character
sample. A second scratchpad script then read 9 replies in both languages and 4 Arabic lines in an
English stock voice with `ar` and `en` (345 characters, 26 readings): with `en` the English voice
said "مستكيماً" for "مستقيماً" and "الحسل" for "الحصة"; with `ar` every line came back correctly.
`GET /usage/credits` answered 401 (it needs an admin key), so the credits are estimates.

Timing: the countdown clip lasts 2.35 s. It starts when three seconds of rest are left, so the
counts land about 0.8 s apart and it ends about 0.6 s before the rest does. Left as is.

### Music under the cues: sunoapi.org probe (not built)

The app has no music. One instrumental track was generated through sunoapi.org's documented API
from a scratchpad script (no app code; key read from a file, never printed): `POST
/api/v1/generate` with `customMode: true`, `instrumental: true`, `model: "V6"`, a style of "upbeat
electronic workout music, 128 bpm ...", `negativeTags` "vocals, singing, spoken word, slow tempo",
`duration: 60` and the required `callBackUrl` (an example.com address; the task was polled with
`GET /api/v1/generate/record-info`).

| Measure | Result |
| --- | --- |
| Request accepted | 162 ms, one task id |
| Ready (`SUCCESS`, polled every 5 s) | 45 s after the request; `FIRST_SUCCESS` was not seen between polls |
| Output | two variations of the one request, model `chirp-hawk`: 73.2 s (1.7 MB) and 59.0 s (1.4 MB) MP3, 60 s asked for; files on `tempfile.aiquickdraw.com` (the docs say files are kept 14 days) |
| Credits | 2,965.6 before, 2,953.6 after: 12 credits for the request, 0.06 USD at the published 5 USD per 1,000 or 50 USD per 10,000 credits |

What integrating it would take:

- **Terms first (owner decision).** sunoapi.org is run by MIRA MUSE LLC, not Suno Inc., and its
  terms say nothing about rights in the music. Suno's own terms (effective 3 September 2026)
  forbid robots and scraping and limit commercial use of output to what Suno's paid tiers allow.
  Using this music in a paid product needs a legal review, or a licensed source instead.
- **A library, not per-session generation.** 45 s and 0.06 USD per request, two variations each:
  generate a small set per mood and tempo (warm-up about 110 bpm, work about 128 bpm, cool-down
  about 90 bpm) once per workspace or for the platform, download it at once (the provider keeps
  files 14 days) and store it like session clips; a new integration contract and settings
  (provider, key, price, rights), a `music.generation` cost row under a budget, and a callback
  endpoint or worker polling.
- **Timed music under the cues.** A second audio chain in the runner (Web Audio, started by the
  Start button's tap so iOS allows it), looping the phase's track; every `say` effect ducks it
  (about 25% gain, 150-250 ms ramps) and restores it when the clip ends; music during sets,
  lower during rest; its own mute. Track length and tempo do not follow set length, so it is a
  bed, not a score.
- **Talk-back conflict.** The speaker's music reaches the microphone: the speech service's voice
  activity threshold would trigger on it and send music for transcription (cost, nonsense
  replies). Music must be ducked hard or paused while the member may reply, or replies become
  push-to-talk while music plays; browser echo cancellation does not reliably remove the page's
  own music.

### Checks actually run (29 September 2026)

Node 24.19, in the `core/fix-voice` worktree with its own `node_modules` (a first run without it
resolved `@trainer/*` to the main checkout and failed 4 unrelated tests; they pass here).

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass.
- New `tests/voice-talkback.test.ts`: 15/15 (live transcripts, English, MSA and Gulf replies, pain,
  both-language readings, the runner's "not done", line language, fingerprints, the bilingual
  script and the trial's raw Brain answers).
- Related PGlite files, run together: `voice-talkback`, `voice-session-domain`, `voice-session`,
  `voice-clones`, `programme-voice`, `integrations-completion`, `joining-complimentary`,
  `platform-finance`, `platform-finance-bcd`, `prompt-refs`, `fix-keys`,
  `e2e-harness-import-history`, the six `web-address-*` files, `provider-configuration`,
  `e2e-harness-mocks`, `privacy-lifecycle`, `messaging-safety-policy`: 278 tests, 278 pass.
- Whole PGlite suite (`node --import tsx --test tests/*.test.ts`): 1,120 tests, 1,119 pass,
  0 fail, 1 skipped.
- PostgreSQL restricted role, `/opt/tools/pg-sandbox.sh 56543` with `voice-session`,
  `voice-clones`, `integrations-completion`, `programme-voice`, `privacy-lifecycle`,
  `platform-finance`, `voice-talkback`: 68 migrations, `runtimeAccess: verified` (44 scoped
  tables, 46 helpers), 96 tests pass, `PG_SELECTED_FAILED_FILES=0`.
- Mutation check: ten deliberate breaks (English again as the speech language, "one" as a count,
  no "not done", screening only the first reading, a strict suggestion reader, no member-language
  choice, one transcription language, negated completions completing, "not done" logging a set,
  no language in the clip fingerprint) each made at least one of these tests fail; the files were
  restored after each.
- Live: the Cartesia chain and the cross-language check above (run once each, plus the first
  attempt that stopped before the clone), and the sunoapi.org probe.

Not run: `next build`, the e2e harness, a browser check of the runner (microphone, playback,
the reply-language control), and the live chain after the last changes (the "thank you"
acknowledgement, the parser's non-global test patterns and the two-language transcribe route are
covered by the tests above, using the live transcripts).

After the review fixes (numbers in a negated clause, negated acknowledgements, "انا مو تمام", MSA
"لم أستطع", English code lines, a failed reply-language reading), same day and worktree:

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass.
- `tests/voice-talkback.test.ts`: 20/20 (5 new tests for the review findings).
  `tests/voice-clones.test.ts`: 27/27 (new: a failed reading in either language, with the
  Cartesia double failing one language; the worker sends a code line with an Arabic exercise
  name as English). The budget check there now counts rows whose outcome is unknown at their
  full reservation, as `voice_guidance_spent_today()` does.
- Related PGlite files together (`e2e-harness-import-history`, `fix-keys`,
  `integrations-completion`, `voice-clones`, `voice-session-domain`, `voice-session`,
  `voice-talkback`, `web-address-moat`, `web-address-subdomains`, `programme-voice`,
  `e2e-harness-mocks`, `provider-configuration`, `privacy-lifecycle`, `platform-finance`,
  `messaging-safety-policy`): 163/163.
- Whole PGlite suite: 1,126 tests, 1,125 pass, 0 fail, 1 skipped.
- `/opt/tools/pg-sandbox.sh 56577` with `voice-session`, `voice-clones`,
  `integrations-completion`, `programme-voice`, `privacy-lifecycle`, `platform-finance`,
  `voice-talkback`: 68 migrations, `runtimeAccess: verified` (44 scoped tables, 46 helpers),
  102 tests pass, `PG_SELECTED_FAILED_FILES=0`.
- Parser outputs before and after on every quoted string of the voice test files (963) and the
  180 live transcripts: the only change is "الوزن مو زين" (acknowledgement, now the help line).
- Mutation check: nine breaks (the count read from the whole reply, no "last N reps" rule,
  negated acknowledgements kept, no "تمام" in the first-person stop, no MSA "could not", code
  lines by letters, the worker sending no language, acting on the screening reading, the guided
  exercise name deciding the language) each failed at least one test; files restored after each.

Not run after the review fixes: the live Cartesia chain, `next build`, the e2e harness and a
browser check.

After review round 2 (negated and hedged completions, negated carry-on and skip, "آخر وحدة" and
Arabic "one", the lenient reader's other names), same day and worktree:

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass.
- `tests/voice-talkback.test.ts`: 23/23 (3 new tests with parser and runner cases; the trial test
  now reads Haiku T1). `tests/voice-session.test.ts` pins the five keys of the prompt and reads a
  nested answer through the route.
- Related files together (`voice-talkback`, `voice-session-domain`, `voice-session`,
  `voice-clones`, `programme-voice`, `integrations-completion`, `e2e-harness-mocks`): 107/107.
- Whole PGlite suite: 1,129 tests, 1,128 pass, 0 fail, 1 skipped.
- `/opt/tools/pg-sandbox.sh 56592` with `voice-session`, `voice-talkback`, `voice-clones`,
  `programme-voice`, `integrations-completion`, `voice-session-domain`: 68 migrations,
  `runtimeAccess: verified` (44 scoped tables, 46 helpers), 96 tests pass,
  `PG_SELECTED_FAILED_FILES=0` (also on port 56591 before the last change).
- Parser outputs before and after on every quoted string of the voice test files and the live
  transcripts (1,261 strings): 52 changed, all of them the new review cases; none of the 48 live
  transcripts changed. A corpus of 166 ordinary replies (completions, counts, carry-on, skip,
  pause, effort, acknowledgements in English and Arabic, with "no pain", "ما في ألم", "ما شاء
  الله", "ما عليه" before them) changed only for "I'm not ready", "not ready yet" and "I can't
  continue".
- Mutation check: 16 breaks (no past-tense "did/made/nail", no hedged past, no "wasn't done", no
  negated-completion rule, the negated completion not removed, "لا" negating a completion, no
  negated carry-on rule, no final "no", skip not held back, no "لا/لن" before a verb, "آخر" not
  pointing back, Arabic "one" read as a count, no Arabic "last N reps" rule, a number after
  "last" read as a count, no other names for kinds, no nested kinds) each failed at least one
  test; files restored after each. (Run before the name lookup became a `Map`, which also stops
  keys such as "constructor" from matching; tested.)

Not run after round 2: the live Cartesia chain, the Haiku voice wording tasks, `next build`, the
e2e harness and a browser check.

### Still not done

- **Arabic code lines.** Every number, set, rest and safety line (the code-owned lines and the
  shared clips) is English. An Arabic member hears the trainer's Arabic phrases and cues in
  Arabic and the plan in English. Arabic code lines need Arabic templates validated like the
  English ones, an Arabic shared clip set per voice version (about 120 more clips, about 1,000
  characters), Arabic runner texts and on-screen text.
- The runner's screen text is English.
- A guided-audio segment that mixes the English template with an Arabic cue is sent in the
  majority language of template and cue (the exercise name does not count); session scripts do
  not have this problem (one line each).
- On-device recognition reads one language (the reply-language choice); only the speech service
  reads both.
- A `not_done` reply keeps no count: "I didn't do the last 2 reps" names the set for the trainer
  but not how many reps were missed (the number is ambiguous: "the last 2" is the missed count,
  "I didn't do 8" is the target). Present-tense "I can't do 10" earns the help line, not "too
  heavy".
- (Fixed after the retest: the other reading is screened for pain phrases, not a bare "ألم".)
  The other-language reading is screened for pain too. In the live readings it never produced a
  red flag from a reply that had none (a translation such as "لا ألم" could, and would then stop
  the session for the trainer to review); none was seen.
- Two exercises with the same name share set logs (the workout log keys sets by exercise name).
- ink-whisper returns "Thank you." for noise; it is now ignored as an acknowledgement.
- Negation is read only in the same clause and within a few words (review round 2): "I don't think
  that I am really ready" (four words between) still resumes, and punctuation in a transcript
  ends the clause. On-device recognition adds no punctuation, so "not sure I'm done" is read as
  a negated completion (an acknowledgement; the member says "done" again), where "not sure, done"
  completes the set. Pausing on "I'm not
  ready" means the member must say "resume" to go on; "not now" / "مو الحين" still earn the help
  line.
- Not live-tested: a Pro clone, a real browser (microphone, echo, playback), iOS background audio,
  and per-clone credit charges (the usage endpoint needs an admin key).

## Talk-back safety after the retest (29 September 2026)

Branch `fix/voice-talkback` (base `0c9569d`). The retest (scratchpad `brain-retest/voice`,
`voice-summary.md`) voiced 40 member replies (English, Modern Standard Arabic, Gulf and
code-switched; done, counts, negated, hedged, not done, pain, pause, skip, effort) in two voices,
under three levels of gym noise, and read them with Cartesia ink-whisper through the app's
two-language route and with every OpenAI transcriber (`gpt-transcribe`, `gpt-4o-transcribe`,
`gpt-4o-mini-transcribe`, `whisper-1`, once, and `gpt-transcribe` twice through the route): 1,080
results. The app then logged sets it should not have. The rule now enforced: **a set is logged
only from an unambiguous completion in the member's own reply language; anything uncertain asks
again or does nothing, and never logs.** Pain said in either language still stops the session.

What changed (`packages/domain/src/voice-runner.ts`, `apps/api/src/voice-session.ts`,
`apps/web/components/voice-session.tsx`):

1. **Hedges never log** (retest finding 1). Gulf "تقريباً خلصت" (almost finished) logged the set at
   the target with every transcriber. A hedge anywhere in the reply now turns a completion or a
   count into an acknowledgement (during a set the member hears "say done when you finish the
   set, or tell me how many reps you did"): Arabic "تقريباً / تقريبا / تقريبًا / بالتقريب",
   "يعني", "شبه", "كاد / كادت / كدت", "أوشك / على وشك", "شارف", "قربت", "يمكن", "ربما", "أظن",
   "أعتقد", "حوالي", "بحدود", "نص / نصف", "باقي", "مو متأكد", "ما أدري / مدري"; English "almost",
   "nearly", "approximately", "roughly", "maybe", "probably", "I think", "I guess", "not sure",
   "sort of", "kind of", "pretty much", "mostly", "half", and "about / around / like / over / up
   to / at least" before a number or "8 or so". The text is folded first, so diacritics, alef
   forms, alef maqsura and ta marbuta ("يعنى", "شبة") are read alike; transliterated "taqriban"
   and "ya3ni" too. "كدت أكملها" (I almost finished it), like "I almost made it", is `not_done`.
   "Barely made it" and "close to failure" still complete.
2. **Nothing is acted on from the other-language reading** (finding 2). Cartesia read Gulf
   "طوفها" (skip it) as "طوفا" in Arabic and "2." in English, and the route acted on "2." and
   logged a set of 2 reps. `replyTranscript` now always returns the reply-language reading; the
   other reading is only screened for pain. When the reply-language reading is not understood the
   member is asked again (the help line, or "say done" in a set); when it failed or heard nothing
   while the other heard words, the route answers 502 `SPEECH_UNCONFIRMED` ("say it again"). The
   route also kept the readings in place: before, an empty reply-language reading was dropped and
   the other reading took its place and was acted on in full. A member whose reply language is
   English and who counts in Arabic ("ثمان تكرارات" read as "Thank you.") is asked again and
   should choose العربية under "I reply in" (or tap).
3. **A number is a count only when tied to the set** (finding 4, and the rule for counts):
   followed by a rep word ("10 reps", "ثمان تكرارات", "8 ربز"), just after a word that reports
   it ("did 10", "سويت عشر", "just one", "that was one", "sawwait 12", "ست بس"), or the whole
   reply ("Eight.", "٨", "twenty five", "اثنا عشر"). A number word right after an effort word
   ("ثقيل واحد", "heavy one", "too hard, two") is never a count unless a rep word follows. So
   "الوزن ثقيل واحد" (misheard "وايد") is too heavy, "ما خمسة" (misheard "ما خلصت"), "ما تقدر
   تكمل ثلاث ست", "أعطى 12", "the weight was 20" and "I got 2 left" log nothing, and "هل ست؟
   سويت ثمان" logs 8, not 6. "ست / سيت" after a number is "set", "ساعات" hours, "left / more /
   remaining / باقي" what is left. Digits written into a word ("5alast") are not a number.
   **Implausible counts are asked again** (`plausibleReps`, in the runner): a heard count must be
   at least 1 and at most one and a half times the target or five more, whichever is larger,
   never more than twice it (a set of 5 allows 1 to 10, of 10 allows 1 to 15, of 20 allows 1 to
   30). "سويت عشر" read as "تسعة عشر" (19) is asked again for a set of 5 or 10. A count typed on
   the runner's screen (`typed: true`) is not checked. The member who really did more says
   "done" (the target is logged) and corrects the log on the workout page.
4. **The other reading stops the session only for a pain phrase** (finding 3). "I didn't finish
   that set." read as Arabic was "ألم أنه لا ينفع هذا المنزل": "ألم" there is the question
   particle ("didn't...?"), and the session stopped and opened a training hold.
   `otherReadingScreenText` removes the words that are pain only in a phrase ("ألم", "آلام",
   "إصابة") from the other reading before it is screened, unless they are the whole reading
   ("ألم", "آه ألم"), carry an article or clitic ("الألم", "بألم") or have a pain context next to
   them in the same clause ("عندي / فيني / أحس / أشعر / أعاني من ألم", "ألم في / بـ", "ألم شديد",
   a body part). Every other red flag and the trainer's policy terms are screened as before, and
   the reply-language reading is screened unchanged. True pain is not weakened: code-switched "My
   back يعورني" and its Latin transliterations stop the session read once or twice.
   **Transliterated Gulf pain** (the runner's own stop list, `UNWELL`): "yawrni", "yaourni",
   "yaurni", "yaurne", "iauurni", "yauri", "yawni", "y3awrni" (يعورني), "awarni" (عورني),
   "yooja3ni", "tooja3ni" (يوجعني), "alam", and Gulf "تعبان / تعبانة" with "ta3ban", "taaban"
   ("I'm unwell"), not after a negation ("مو تعبان", "mu ta3ban"). Every OpenAI model had returned
   "My back يعورني" in Latin letters and never stopped the session. "تعبت" (I got tired) and
   English "tired" are not stops. Also "البدوار" (misheard "بدوار", dizziness) stops.
   **Transliterated Gulf completions**: "khalast", "5alast" (خلصت), "khalasna", "kammalt",
   "sawwaitha" complete a set; "sawwait" ties a count; "ma khalast" is still going, "ma
   sawwaitha" not done. "So wait, twelve" (how OpenAI wrote "سويت twelve") stays a pause.
5. **"خلص" and "خلاص" alone are not a completion** (finding 6; trainer decision). "خلاص" is also
   "stop" or "enough", and a hurried "خلص" may be the start of anything; the member hears the
   help line and says "خلصت", "done" or a count. With a completion or a count they are fine
   ("خلاص خلصت", "ثمان خلاص"), and "مو خلاص" is still "not finished". Before this branch "خلاص"
   alone completed the set.
6. Found while checking the rule on English: a completion still to come or asked about logged
   the set: "I need to finish", "I have to complete 8", "let me finish", "I'll finish", "I'm
   going to finish", "done soon", "done in a sec", "am I done?". These are acknowledgements now
   and their number is not a count. Arabic future forms ("لازم أخلص", "راح أخلص", "بخلص") were
   never completion words.

Replaying all 1,080 retest results through the fixed code (the route's rules with the default
policy, then the runner at set 1 of Back Squat 3 x 5 at 60 kg, as the retest did): **0 unsafe
logs** (before: 3 to 5 per transcriber set-up, 32 in all), **0 false stops** (before: 1), 0 wrong
counts from a count said (before: 3; "done" with the count unheard still logs the target), no
missed pain for either two-reading route, missed pain 15 in all (before: 25), and correct actions
up (Cartesia route 82.5% to 85.0%, `gpt-transcribe` twice 90.0% to 90.8%, `gpt-transcribe` once
with the member's language 87.5% to 90.0%). The pain still missed by single readings (14
distinct transcripts, 15 results) carry no pain word in any script ("My back yawned.", "Мой бак? Я ору.", "أشوري بدوا"):
only a second reading can catch them, which is why a provider that is read once should be read
twice for members who code-switch. Some replies that were acted on before now ask again (a
count in an untied sentence, "Hallas.", a reply understood only in the other language): that is
the rule's cost.

Parser outputs before and after on 2,093 strings (every quoted string of the voice test files,
the retest scripts and every retest transcript): the changes are the cases above; the rest are
test labels, SQL and chat messages whose numbers are no longer read as counts, and "ركبتي تعبانة"
(my knee is sore), which now stops a voice session (the chat floor still does not hold it).

Tests: `tests/voice-talkback-retest.test.ts` (every example of the retest summary with the exact
transcripts; a table over all 40 scripts at a set of 5 and of 10 and through the route with the
reply reading failing; every one of the 1,080 transcriptions, `tests/voice-talkback-retest-fixtures.ts`,
asserting no unsafe log, no wrong count, no false stop and no missed pain for two readings),
`tests/voice-clones.test.ts` (the route with the Cartesia double: "طوفا" / "2.", the "ألم" false
stop, an empty reply reading, "تقريباً خلصت", a device transcript, "My back yawrni." / "مي باك
يعورني"), and updated expectations in `tests/voice-talkback.test.ts` ("خلاص" alone; only the reply
reading is acted on).

### Checks actually run (`fix/voice-talkback`, 29 September 2026)

Node 24.19, worktree `.claude/worktrees/fix-voice-talkback` with its own `node_modules`.

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass.
- `tests/voice-talkback-retest.test.ts`: 8/8. `tests/voice-clones.test.ts`: 28/28 (1 new).
- Every test file that imports the voice modules, together (`voice-talkback`,
  `voice-talkback-retest`, `voice-session-domain`, `voice-session`, `voice-clones`,
  `safety-floor`, `brain-plans-timed`, `programme-voice`, `integrations-completion`,
  `marketing-site`, `onboarding-completion`, `platform`, `programme-billing`,
  `programme-review`, `programme-stripe-mock`, `e2e-harness-mocks`): 245/245, run on the final
  code.
- Whole PGlite suite (`node --import tsx --test tests/*.test.ts`): 1,245 tests, 1,244 pass, 0
  fail, 1 skipped. Started before the last two edits (one duplicate token removed from the Latin
  negation list, "mb" added; two tests strengthened), after which the voice files above were
  run again.
- Replay of all 1,080 retest results through the fixed code (scratchpad script mirroring the
  route; the same check is in the test file): the numbers above.
- Parser outputs before (the base, `0c9569d`) and after on 2,093 strings: see above.
- Mutation check: 14 deliberate breaks (no hedge rule, acting on the other reading, untied
  counts, no effort-word rule, every count plausible, no pain-phrase rule for the other reading,
  no transliterated pain, "خلاص" completing, no intent rule twice, digits in words read as
  numbers, typed counts checked, a blank reply reading acted on in the route, the other reading
  screened raw in the route) each failed at least one test; the files were restored after each.

**Not run:** `/opt/tools/pg-sandbox.sh` (PostgreSQL with the restricted runtime role) and the
e2e harness (`scripts/e2e/run.mjs`, which covers the transcribe route). On this machine
`/dev/null` had been replaced by a regular file owned by root, so `initdb` as the `postgres`
user fails ("cannot create /dev/null: Permission denied") before any migration; a workaround
was not permitted in this session. Both must be run where `/dev/null` is a device. Also not
run: `next build`, a live re-run of the retest against the fixed code, the Haiku voice wording
tasks, and a browser check of the runner.

Not done: an OpenAI speech-to-text provider (the retest's recommendation; the app has ElevenLabs
and Cartesia only), a hint on the runner when a reply sounded like the other language, a live
re-run of the retest against the fixed code, and a browser check of the runner.

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
- A timed round is timed by the page's clock from the end of its prompt; a distance round is not
  measured (the member says done and the prescribed distance is logged). Time or distance logs
  cannot yet be corrected on the workout log's correction form (reps, load and RIR only).
- The session plays in the trainer's voice only while the page is open; iOS background audio
  and screen-lock behaviour were not tested.
