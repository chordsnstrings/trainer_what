# Trainer voice clones with Cartesia (package `core/cartesia-voice`)

Status: implemented on branch `core/cartesia-voice` (base `integrate/round2` `0e0a485`,
migration 069), with review round 1 fixed on the same branch (see "Review round 1").
Unmerged. Nothing was deployed and no real Cartesia request was made: every check below used
the Cartesia double (`tests/e2e/mocks/cartesia.ts`). The live smoke stage is separate and
still to do.

Owner direction (28 September 2026): "This is the Cartesia API which we will use to train the
voice model (quick) and pro if the trainer wants to. The voice clone will be attached to that
specific trainer."

## What it does

A trainer (the workspace owner) records or uploads their own voice, confirms four consent
statements and chooses:

- **Quick clone** (Cartesia instant clone, `POST /voices/clone`): one recording of 10 to 60
  seconds; made while the trainer waits (seconds).
- **Pro clone** (Cartesia fine-tune): at least 30 minutes of recordings, uploaded to a
  Cartesia dataset, trained by Cartesia for up to 3 hours and polled by the worker. Offered only
  when the operator switches Pro on; the trainer sees an honest note (at least 30 minutes of
  recording, up to 3 hours of training) and the operator's price only if one is set.

The trainer previews a fixed line in the new voice and then activates it. Activation writes the
workspace voice (`trainer_voices`), the only voice members hear, so voice-led sessions, script
audio and guided audio speak in the active clone. With no active voice, members keep today's
behaviour: text-guided sessions and written guidance.

ElevenLabs stays available: with `VOICE_PROVIDER=elevenlabs` the trainer links an existing voice
ID and an administrator verifies identity and rights, as before. With Cartesia, linking a pasted
voice ID is refused (`VOICE_CLONE_REQUIRED`): it could name another workspace's clone in the same
Cartesia account.

## States

```
draft -> processing -> ready -> active
              \-> failed        ready <-> active
any state -> deleted
```

| State | Meaning | Trainer actions |
| --- | --- | --- |
| draft | consent recorded; recordings being added (sealed, kept here) | add or remove recordings, send, cancel |
| processing | the provider is making it; `step` is the worker's next provider step: `clone`, `clone_unknown` (answer lost, reconciling), `dataset`, `upload`, `fine_tune`, `training`, `voices` | wait (Quick: seconds; Pro: up to 3 hours), delete |
| ready | the provider voice exists | preview, use for members, delete |
| active | the workspace voice (one per workspace) | preview, stop using (back to ready), delete |
| failed | the provider refused, never confirmed, stayed unreachable, or training failed; the reason is shown | try again, unless the same recordings would fail again (`RECORDING_MISSING`, `RECORDING_UNREADABLE`, `TRAINING_FAILED`: delete and record a new clone); delete |
| deleted | removed here; provider deletion queued | none |

Rules (`packages/domain/src/voice-clone.ts`, enforced again in the database):

- One clone of each kind in progress (draft or processing) per workspace; one active clone per
  workspace; at most four clones not deleted or failed.
- Activating a clone steps the previous active clone back to ready. A newer clone of the same
  kind replaces an unused older one (the older one is deleted at the provider). A Quick and a Pro
  clone can both be kept ready, so the trainer can switch between them.
- A new clone of a kind replaces a failed clone of that kind.
- Drafts and failed clones untouched for 7 days are removed with their recordings (worker),
  whatever the voice settings are (also while voice is paused or another provider is chosen).
- A provider that keeps answering "try again later" (HTTP 429, or unreachable before sending)
  is retried with a growing wait (2 minutes doubling to 1 hour); after 10 such answers in a row
  the clone fails with `PROVIDER_UNAVAILABLE`.
- Pro deadlines count from the current training attempt (not the first submission): no answer
  within a day fails with `TRAINING_TIMEOUT`; a completed training that lists no voice within
  6 hours fails with `PROVIDER_VOICE_MISSING`. A failed Pro clone's training is queued for
  deletion at once, so it holds no Pro slot.
- A preview must exist before activation (`VOICE_PREVIEW_REQUIRED`).
- Only the trainer who recorded a clone sees or uses it; members, team members and other
  workspaces never do.

## Consent

`POST /api/v1/voice/clones` requires all four statements (`CLONE_CONSENT`, version
`trainer-voice-clone:v1`), each shown in the trainer screen:

1. It is my own voice; nobody else speaks and I am not imitating anyone.
2. My recordings are sent to the voice provider to make a private copy for this workspace.
3. My subscribers with premium voice hear it read their assigned workouts, and nothing else.
4. I can stop or delete it at any time, and deleting removes it at the provider.

A `voice` consent row is written (`legal version|trainer-voice-clone:v1`) and the statements,
the provider-training note and any Pro price shown are kept in the clone's evidence. The screen
also says whether the operator's Cartesia account opted out of Cartesia training its models on
uploads (`VOICE_TRAINING_OPT_OUT`; Cartesia's terms allow that use unless the account opts out).
Cartesia has no consent or identity check of its own, so this record is the platform's.

Consent is rechecked before every provider request (the trainer must still own the workspace and
their latest voice consent must be granted). Members hear the voice only while that holds:
`guided_voice()` (migration 069) now also requires the recording trainer to be the workspace
owner and returns the voice's provider, model and language. Withdrawing voice consent
(`POST /privacy/consent`, or `POST /voice/revoke`) deletes every clone and queues its provider
deletion.

Operator review before members hear a clone (`VOICE_CLONE_REVIEW_REQUIRED`) is **on by
default** (review round 1): activation leaves the workspace voice `pending` for the existing
identity and rights verification in Integration operations, where the operator can listen to the
preview. Switching it off lets the trainer's own recording and consent be the only check.

## Recordings

- Formats Cartesia accepts: MP3, WAV, FLAC, OGG and WebM (not the MP4 audio Safari records;
  that browser is told to upload a file). The first bytes must match the declared format.
- At most 7 MB per recording, so the base64 request stays under the web proxy's 10 MB body
  buffer (Next.js `proxyClientMaxBodySize`). Pro: at most 60 recordings, 250 MB and 3 hours in
  total; each at least 5 seconds; 30 minutes in total to send.
- Length: a WAV header is read exactly; for compressed formats the browser's measured length is
  accepted only when the file size is plausible for it (6 kbit/s to the format's maximum).
- Storage: `trainer_voice_samples`, sealed with the server key (AES-256-GCM, `sealBytes`, bound
  to the workspace and the recording id), owner-only row security. Only the size, length and
  SHA-256 remain after the provider holds the recording: a Quick clone's recording is deleted
  when the clone is ready; a Pro clone's recordings are deleted one by one as each upload is
  confirmed. Recordings are never exported (the personal export lists their metadata) and never
  shown to anyone but the trainer. Nothing is written to logs.
- A recording sealed with a retired encryption key cannot be opened; the clone fails and asks the
  trainer to record again (recordings are not included in `npm run secrets:reseal`).

## Provider calls and money

Adapter: `packages/providers/src/cartesia.ts` (`CartesiaClient`), wired through
`packages/providers/src/integrations.ts`. Every request sends `Authorization: Bearer <key>` and
the pinned `Cartesia-Version` (default `2026-08-14`). The key never appears in a message, return
value or log line; provider error text has any `sk_car_…` removed.

| Use | Request | Cost row (`cost_events`) |
| --- | --- | --- |
| Speech (sessions, guided audio, previews) | `POST /tts/bytes`, MP3 44.1 kHz 128 kbps, `voice: {mode:"id", id}` (valid for 2026-03-01 and 2026-08-14) | `voice.session`, `voice.guidance`, `voice.preview`: characters x `VOICE_USD_PER_1000_CHARACTERS` |
| Spoken replies | `POST /stt`, `ink-whisper`, word timings, language from the member's saved language (`ar` or `en`; batch ink-whisper does not detect it) | `voice.transcription`: seconds x `STT_USD_PER_HOUR` |
| Quick clone | `POST /voices/clone` (clip, name, language, description; no deprecated `mode`/`enhance`) | `voice.clone`: `VOICE_CLONE_USD` (default 0) |
| Pro clone | `POST /datasets/`, `POST /datasets/{id}/files` (purpose `fine_tune`), `POST /fine-tunes/`, `GET /fine-tunes/{id}`, `GET /fine-tunes/{id}/voices` | `voice.clone` at training start |
| Deletion | `DELETE /voices/{id}`, `/datasets/{id}`; a fine-tune: `GET /fine-tunes/{id}/voices`, each voice deleted, then `DELETE /fine-tunes/{id}` (404 counts as deleted) | none |
| Connection check | `GET /voices?limit=1` (read-only) | none |

- Every provider row carries the provider (`cartesia` or `elevenlabs`) and the model the voice
  speaks with; the four hard-coded `'elevenlabs'` inserts are gone.
- All voice rows share the workspace daily limit (`VOICE_DAILY_USD_LIMIT`,
  `voice_guidance_spent_today()` now counts `voice.preview` and `voice.clone`) and stay out of
  the daily model-call count (`model_usage_today()`). A preview or clone over the limit is refused
  with `VOICE_BUDGET`; a worker step over the limit waits 30 minutes.
- Clone and Pro training costs are reserved before sending. A request the provider may have
  processed (made, or answer lost) leaves the cost `unknown` until invoice reconciliation; a
  request never sent or refused by the provider (HTTP 429 or 4xx) is released: recorded at zero
  with `pricing.released` (`not_sent` or `provider_refused`), so retries never fill the daily
  voice limit. A reservation left by a crash between reservation and answer becomes `unknown`
  after 15 minutes (worker). Previews keep the voice-session pattern (unknown just before sending).
- An answer lost on the way back is never sent again blindly: every provider resource of a clone
  is named `trainsyou-<clone id>` (each Pro training attempt `trainsyou-<clone id>-<n>`, so an
  earlier failed attempt is never mistaken for the current one), and the worker looks the name
  up (every page of the voice, dataset and fine-tune lists) before resending. A Quick clone or a
  Pro training is resent at most twice, each time after three look-ups a minute apart; an
  abandoned training attempt's name is queued for deletion; any duplicate found is queued for
  deletion. Trying a Quick clone again after `PROVIDER_UNCONFIRMED` looks the name up first.
- A Quick clone keeps no model of its own: it speaks with the configured `VOICE_MODEL`, so a model
  change (for example off a sunset snapshot) reaches every Quick clone.
- Speech sends `language` as the language of the text (English for today's session scripts,
  shared phrases and the preview line), never the language the voice was recorded in, which is
  used only to make the clone.
- After a Pro clone is ready its dataset (the trainer's raw recordings) is queued for deletion at
  Cartesia; a failed Pro clone keeps it only while trying again can help.
- A Pro clone speaks with a dated model it was trained for (`proCloneModel`: the configured model
  if it is a supported snapshot, else the newest snapshot of the same family, e.g.
  `sonic-3.6-2026-08-27`); a bare alias would answer `voice_model_mismatch`.
- A voice held by another provider than the configured one is never sent: sessions and guided
  audio fall back to text (`VOICE_UNAVAILABLE`) when an operator switches provider.

## Deletion at the provider

`voice_provider_deletions` (migration 069) holds provider references only (kind `voice`,
`fine_tune`, `dataset`, or `named` for everything carrying a clone's name), never audio or a
person, and the app role cannot delete its rows. The trainer's delete runs it at once; the
worker (every 30 seconds) retries with backoff up to 10 attempts, then marks the row
`attention` and raises a platform alert (`voice.provider_deletion:<id>`, resolved when a retry
succeeds); Integration operations lists every workspace's open deletions (closed ones included,
through `voice_provider_deletions_outstanding()`, platform administrators only) and can queue one
again. It runs for closed workspaces too.

- **The saved Cartesia account deletes, not the active contract.** Deletions and the 7-day
  purge keep running while voice is paused (contract approval off, integration disabled or a
  connection check pending): the worker opens the saved Cartesia key from Superadmin settings.
  Switching `VOICE_PROVIDER` away from Cartesia, clearing its key or disconnecting it is refused
  (`VOICE_CLONES_AT_PROVIDER`) while any clone exists at Cartesia or any deletion is
  unconfirmed (`voice_provider_work_outstanding()`). If no Cartesia account can be found at all
  (an environment-only setup changed, or the key cannot be opened), the trainer's delete says so,
  operators get the `voice.provider_account_missing` alert, and the queue runs once it is back.
- **Named deletions** are queued only when a request may have left something without an id (the
  clone was still processing, or an answer was lost). They are confirmed only after three empty
  look-ups five minutes apart (a lagging list or an in-flight request, which times out within
  three minutes, cannot slip through), and they match the name and its attempt suffixes.
- **Pro voices.** Cartesia names a Pro voice itself, so deleting a fine-tune first lists its
  voices and deletes each (whether deleting a fine-tune deletes its voices is not documented).
- A request whose answer was lost after the clone was deleted or erased queues its name for
  deletion again.

Queued by: the trainer deleting a clone; a newer clone replacing an older one; withdrawing voice
consent; personal erasure (`eraseAdditional`); ownership transfer (`transferAdditional`, new:
the previous owner's voice stops and their clones are deleted); workspace closure
(`closeAdditional`, before the clones and recordings are removed); stale drafts and failures.
The trainer screen keeps listing existing clones, with their delete button, while clones are
switched off.

## Configuration (Super admin, Trainer voice and Speech-to-text)

- `VOICE_PROVIDER`: select, `elevenlabs` (default, unchanged behaviour) or `cartesia`.
- `VOICE_BASE_URL`: blank means the provider's standard address (`https://api.cartesia.ai` or
  `https://api.elevenlabs.io/v1`); a saved standard address of the other provider reads as blank.
- `VOICE_MODEL` (Cartesia: `sonic-3.6` or a dated snapshot), `VOICE_API_VERSION` (default
  `2026-08-14`), reviewed price version, USD per 1,000 characters (help text: about 0.04 to 0.065
  at published plan prices), workspace daily USD limit.
- `VOICE_QUICK_CLONE_ENABLED` (default on), `VOICE_PRO_CLONE_ENABLED` (default off),
  `VOICE_PRO_CLONE_SLOTS` (default 2; counted across the platform by
  `voice_pro_clones_in_use()`, including Pro clones still being deleted),
  `VOICE_PRO_CLONE_PRICE_AED` (shown, not charged), `VOICE_CLONE_USD` (default 0),
  `VOICE_CLONE_REVIEW_REQUIRED` (default **on**), `VOICE_TRAINING_OPT_OUT` (default off),
  `VOICE_CONTRACT_VERIFIED`. Leaving Cartesia is refused while clones depend on it (above).
- Speech-to-text: `STT_PROVIDER` select, blank `STT_BASE_URL` and `STT_MODEL` mean the provider's
  own (`ink-whisper` for Cartesia), `STT_API_VERSION`, USD per hour (help: about 0.07 to 0.12 for
  batch ink-whisper). `STT_ZERO_RETENTION` applies to ElevenLabs only; with Cartesia it must be
  off (the app cannot request Cartesia's Enterprise zero retention), otherwise speech-to-text
  stays unapproved and the connection check answers "unavailable". The member's transcription
  consent names the provider and says whose retention terms apply.

## Tenant isolation

- `trainer_voice_clones`, `trainer_voice_samples`, `voice_provider_deletions`: tenant row security
  plus an owner-only restrictive policy (forced); the grant verifier classifies all three.
- API routes act only on clones of the calling owner (`user_id`), so another workspace, a member,
  a team member or a new owner after a transfer gets 404 or 403.
- A provider voice ID belongs to one clone (`trainer_voice_clone_provider_voice`, unique across
  workspaces), and pasted Cartesia IDs are refused.
- Members read only `guided_voice()` (verified voice, owner still current, consent granted).
- Operators list clones and deletions across workspaces with recent MFA (platform-operator
  elevation, `voice-clones.ts` added to `ELEVATIONS`), see no recording or provider voice ID, and
  can listen to a preview only within its own workspace.

## API

| Route | Who | Purpose |
| --- | --- | --- |
| `GET /api/v1/voice/clones` | owner | provider, availability, Pro slots left, price, consent text, limits, languages, workspace voice, clones |
| `POST /api/v1/voice/clones` | owner | start a clone (kind, language, consent, Pro acknowledgement) |
| `POST /api/v1/voice/clones/:id/samples` | owner | add a recording (base64, type, measured seconds) |
| `DELETE /api/v1/voice/clones/:id/samples/:sampleId` | owner | remove a draft recording |
| `POST /api/v1/voice/clones/:id/submit` / `retry` | owner | send (Quick is made inline) / send a failed clone again |
| `POST` / `GET /api/v1/voice/clones/:id/preview` | owner | make (once, charged) / play the preview |
| `POST /api/v1/voice/clones/:id/activate` / `deactivate` | owner | use for members / stop |
| `DELETE /api/v1/voice/clones/:id` | owner | delete here and at the provider |
| `GET /api/v1/admin/integrations/voice-clones` | admin, recent MFA | clones and open deletions |
| `GET /api/v1/admin/integrations/voice-clones/:id/preview?tenantId=` | admin, recent MFA | listen during review |
| `POST /api/v1/admin/integrations/voice-deletions/:id/retry` | admin, recent MFA | requeue an `attention` deletion |

Events: `voice.clone_started`, `_submitted`, `_retried`, `_ready`, `_previewed`, `_activated`,
`_deactivated`, `_deleted`, `voice.clone_preview_reviewed`, `voice.provider_deletion_retried`.

## Web

- Trainer voice tab (`apps/web/components/trainer-voice-clone.tsx`): with Cartesia, "Your voice
  clone" replaces the ElevenLabs enrollment form: new clone (Quick or Pro, language, the consent
  statements, the provider-training note, the Pro note and price), recording with the microphone
  (WebM or OGG Opus; Quick stops at 60 seconds, Pro segments at 5 minutes) or file upload, the
  recordings and readiness, progress while processing (polled), preview player, use, stop,
  try again and delete (with confirmation).
- While clones are switched off (another provider, or voice paused) the trainer still sees
  their clones with a delete button and a notice; nothing else is offered.
- Integration operations: "Trainer voice clones" lists clones per workspace (newest 100) and
  every workspace's unconfirmed deletions, attention first, with preview listening and "Try
  again" for deletions that need attention; the voice panel shows the provider.

## What is mocked and what is real

- Real in this branch: the request shapes, headers, version pin, multipart bodies and response
  handling written from Cartesia's public API reference (read 28 September 2026).
- Mocked: every Cartesia answer. `tests/e2e/mocks/cartesia.ts` checks the key (Bearer or
  X-API-Key) and `Cartesia-Version`, requires a dated model for Pro voices, advances fine-tunes
  through `training` to `completed` over polls, and can lose an answer after acting
  (`loseNextAnswer`) or fail a call (`failNext`).
- Not verified against Cartesia: the account's plan and Pro slots, whether Bearer or X-API-Key is
  preferred on this account, per-clone credit charges, maximum transcript length, real audio
  quality, timing and failure texts, how a Pro voice is named, and that a Pro voice still speaks
  after its dataset is deleted. The live smoke stage checks these (Pro stays off until then).

## Owner decisions pending

1. The Pro clone price shown to trainers (`VOICE_PRO_CLONE_PRICE_AED`) and how it is billed (the
   app shows it and records it in the clone's evidence but does not charge it).
2. Whether Pro is switched on by default (it is off; it needs a Cartesia Startup plan or higher,
   with 2 Pro slots on Startup and 4 on Scale for the whole platform).
3. Whether each clone needs operator review before members hear it (on by default since review
   round 1), and whether to strengthen the check (a random phrase read aloud in the recording, a
   short sealed excerpt kept for the reviewer).
4. Whether the Cartesia account opts out of Cartesia training on uploads (the trainer is told
   either way).
5. Whether team trainers (not only the owner) should have their own voices: today one voice per
   workspace, the owner's.
6. Whether transcription moves to Cartesia too (supported; the settings choose).

## Checks actually run

Node 24. `npx tsc --noEmit` (root) and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass. `npm run build`: pass. PGlite `tests/voice-clones.test.ts`: 14 tests, 14 pass. Related PGlite files during the stage (voice-session, integrations-completion, platform-settings, provider-configuration, programme-voice, voice-session-domain, onboarding-completion, isolation-elevation, isolation-follower, isolation-guard, isolation-scope, privacy-lifecycle, privacy-media, chat-attachments, e2e-harness-mocks, fix-keys): 130 tests, 130 pass; logical-css, fix-web, fix2-web: 19 pass. Full PGlite suite on the final code (`node --import tsx --test --test-concurrency=1 tests/*.test.ts`): 943 tests, 942 pass, 0 fail, 1 skipped. PostgreSQL restricted role: `/opt/tools/pg-sandbox.sh 56231` with 10 changed or related files: 9 files (75 tests) pass; `platform-settings.test.ts` failed all 15 tests there only because it asserts the `trainer_ci_*` database name that `scripts/run-postgres-tests.mjs` creates (the selected mode names databases `sel_*`). Whole restricted-role suite `/opt/tools/pg-sandbox.sh 56232` (migrations, runtime role, `verify-runtime-access.mjs` reporting `runtimeAccess: verified`, 44 scoped tables, 43 helpers): 125 files, 943 tests, 941 pass, 0 fail, 2 skipped, `PostgreSQL test files failed: 0`. Python deployment tests (`python3 -m unittest discover -s tests -p 'test_*deployment.py'`): 151 run, OK, 3 skipped. Not run: the e2e harness (including the new scenario) and the browser check (their ports were in use), and anything against api.cartesia.ai. Recorded also in `docs/COMPLETION_STAGES.md` stage 2026-09-28g. Review round 1 checks are listed at the end of "Review round 1" below.

## Limits

- One voice per workspace, the owner's; a team trainer cannot have a clone.
- Pro clone uploads and training run in the worker; a worker that is down leaves clones in
  processing. A Pro training attempt without an answer for a day fails with `TRAINING_TIMEOUT`.
- Leaving Cartesia needs every clone deleted first; there is no operator action that retires all
  trainers' clones at once.
- A Quick clone request waits for Cartesia inside the trainer's request (up to 2 minutes).
- The e2e scenario (`tests/e2e/scenarios/voice-clone.e2e.ts`, core suite) is written but was not
  run in this stage (the harness ports were in use).
- The browser recorder and upload were typechecked but not exercised in a browser.

## Review round 1 (28 September 2026)

Each finding was checked against the code (and the reviewer's focused tests where given) before
fixing. Regression tests are in `tests/voice-clones.test.ts` (10 new tests, 24 in total).

| # | Finding | Outcome |
| --- | --- | --- |
| 1 (major) | Provider deletions and the 7-day purge stopped when voice was paused or another provider chosen; the trainer screen hid the clones; the delete message was untrue | Fixed. Deletions use the saved Cartesia account whether or not voice is active (`cartesiaDeletionClient`, `storedIntegrationValues`); the purge runs regardless; the screen keeps clones deletable; saving settings that leave Cartesia, clear its key or disconnect it is refused while clones or deletions depend on it (`registerSettingsGuard`, `voice_provider_work_outstanding()`); pausing stays possible; with no Cartesia account at all the delete message says so and operators get an alert. The saved key is a single field, so "keep deleting after switching provider" is achieved by refusing the switch, not by keeping a second key |
| 2 | Named deletions were single-shot; an answer lost after the clone was deleted was not re-queued; lists read one page | Fixed: three empty look-ups five minutes apart; `queueStrays` re-queues the name; all list look-ups page |
| 3 | A Pro voice (named by Cartesia) could survive fine-tune deletion | Fixed: fine-tune deletion lists and deletes its voices first; the double now names Pro voices itself |
| 4 | A Pro clone's raw recordings stayed in the Cartesia dataset | Fixed: dataset queued for deletion once the Pro voice is ready (and when a failure cannot be retried); the live smoke must confirm the Pro voice keeps speaking afterwards |
| 5 | Clone review defaulted to off | Fixed: `VOICE_CLONE_REVIEW_REQUIRED` defaults to on. Not done: a liveness phrase and a reviewer excerpt (owner decision 3) |
| 6 | `STT_ZERO_RETENTION` silently ignored with Cartesia | Fixed: the combination stays unapproved (capability, contract, connection check); the member consent names the provider and whose retention applies |
| 7 | Stuck deletions were visible only for the 100 newest workspaces; no alert | Fixed: `voice_provider_deletions_outstanding()` lists every workspace's open deletions (platform administrators only); `attention` raises a platform alert, cleared when a retry succeeds |
| 8 | The runtime gate did not check the owner-only policy or the queue's missing DELETE | Fixed in `scripts/verify-runtime-access.mjs` |
| 9 (major) | Speech was sent with the recording's language | Fixed: the text's language (English) is sent |
| 10 (major) | A Pro retry after 24 hours timed out at once; the timed-out fine-tune kept a slot untracked | Fixed: deadline from the attempt's own start; a failed Pro clone's fine-tune is queued for deletion (counted as a slot until confirmed) |
| 11 (major) | Fine-tune reconciliation by name could adopt an old attempt | Fixed: each attempt is named `<clone name>-<n>`, matches are filtered by dataset, three look-ups before a resend, an abandoned attempt's name is queued for deletion |
| 12 (major) | Retries left phantom `unknown` costs that filled the daily limit | Fixed: refused or unsent requests are released (recorded at zero); retries back off to an hour and stop after 10 in a row (`PROVIDER_UNAVAILABLE`); a crash-left reservation becomes unknown after 15 minutes |
| 13 (major) | Cartesia STT forced English for Arabic-speaking members | Fixed: the member's saved language (`ar`/`en`) is sent; an Arabic pain report now holds training in the test |
| 14 | A Quick clone kept the model it was made with | Fixed: Quick clones store no model and follow `VOICE_MODEL`. Not done: keeping refused session speech out of unknown cost (voice-session accounting, unchanged) |
| 15 | Retrying after `PROVIDER_UNCONFIRMED` resent without a look-up | Fixed: the retry starts by looking up the name; the duplicate sweep runs whenever an earlier request was sent |
| 16 | Name look-ups read only the first page | Fixed (with finding 2); a list longer than 50 pages is treated as unconfirmed, never as "not there" |
| 17 | Failed Pro clones could not recover; the voices step had no deadline | Fixed: `TRAINING_FAILED`, `RECORDING_UNREADABLE` and `RECORDING_MISSING` are not retryable (the API refuses with `VOICE_CLONE_START_AGAIN`, the screen hides "Try again", the message says to start a new clone); the voices step fails after 6 hours |
| 18 | Inaccurate copy | Fixed: the Pro note mentions cost only with the operator's price; `/voice/revoke` says clones are deleted at the provider unless a hand-linked voice was in use |

Review round 1 checks: Node 24.19. `npx tsc --noEmit` (root) and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass. `npm run build`: pass. PGlite `tests/voice-clones.test.ts`: 24 tests, 24 pass (10 new). Related PGlite files (voice-session, integrations-completion, platform-settings, provider-configuration, programme-voice, voice-session-domain, onboarding-completion, isolation-elevation, isolation-follower, isolation-guard, isolation-scope, privacy-lifecycle, privacy-media, chat-attachments, e2e-harness-mocks, fix-keys, governance-alerts, fix-settings, platform): 176 tests, 176 pass; logical-css, fix-web, fix2-web, governance-web: 26 pass. Full PGlite suite (`node --import tsx --test --test-concurrency=1 tests/*.test.ts`): 953 tests, 952 pass, 0 fail, 1 skipped. PostgreSQL restricted role: `/opt/tools/pg-sandbox.sh 56233` with voice-clones, voice-session, integrations-completion, privacy-lifecycle, governance-alerts, isolation-follower, isolation-elevation, programme-voice, onboarding-completion and provider-configuration: `PG_SELECTED_FAILED_FILES=0` (90 tests pass); whole restricted-role suite `/opt/tools/pg-sandbox.sh 56234` (`verify-runtime-access.mjs`: `runtimeAccess: verified`, 44 scoped tables, 45 helpers, with the new policy and no-DELETE assertions): 125 files, 953 tests, 951 pass, 0 fail, 2 skipped, `PostgreSQL test files failed: 0`; after a last small change (secrets opened only when the saved provider is Cartesia) voice-clones and voice-session were run again with `/opt/tools/pg-sandbox.sh 56235`: 34 tests pass, and the full PGlite suite above ran on the final code. The working tree was scanned for the real Cartesia key: not found. Not run: the e2e harness and the browser check (their ports were in use), Python deployment tests (no deployment files changed), and anything against api.cartesia.ai.
