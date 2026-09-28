# Trainer voice clones with Cartesia (package `core/cartesia-voice`)

Status: implemented on branch `core/cartesia-voice` (base `integrate/round2` `0e0a485`,
migration 069). Unmerged. Nothing was deployed and no real Cartesia request was made: every
check below used the Cartesia double (`tests/e2e/mocks/cartesia.ts`). The live smoke stage is
separate and still to do.

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
  when the operator switches Pro on; the trainer sees an honest note (more recording, up to 3
  hours, costs more) and the operator's price if one is set.

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
| failed | the provider refused or never confirmed; the reason is shown | try again (while recordings or the dataset remain), delete |
| deleted | removed here; provider deletion queued | none |

Rules (`packages/domain/src/voice-clone.ts`, enforced again in the database):

- One clone of each kind in progress (draft or processing) per workspace; one active clone per
  workspace; at most four clones not deleted or failed.
- Activating a clone steps the previous active clone back to ready. A newer clone of the same
  kind replaces an unused older one (the older one is deleted at the provider). A Quick and a Pro
  clone can both be kept ready, so the trainer can switch between them.
- A new clone of a kind replaces a failed clone of that kind.
- Drafts and failed clones untouched for 7 days are removed with their recordings (worker).
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

An operator can require review before members hear a clone (`VOICE_CLONE_REVIEW_REQUIRED`):
activation then leaves the workspace voice `pending` for the existing identity and rights
verification in Integration operations, where the operator can listen to the preview.

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
| Spoken replies | `POST /stt`, `ink-whisper`, word timings, language `en` | `voice.transcription`: seconds x `STT_USD_PER_HOUR` |
| Quick clone | `POST /voices/clone` (clip, name, language, description; no deprecated `mode`/`enhance`) | `voice.clone`: `VOICE_CLONE_USD` (default 0) |
| Pro clone | `POST /datasets/`, `POST /datasets/{id}/files` (purpose `fine_tune`), `POST /fine-tunes/`, `GET /fine-tunes/{id}`, `GET /fine-tunes/{id}/voices` | `voice.clone` at training start |
| Deletion | `DELETE /voices/{id}`, `/fine-tunes/{id}`, `/datasets/{id}` (404 counts as deleted) | none |
| Connection check | `GET /voices?limit=1` (read-only) | none |

- Every provider row carries the provider (`cartesia` or `elevenlabs`) and the model the voice
  speaks with; the four hard-coded `'elevenlabs'` inserts are gone.
- All voice rows share the workspace daily limit (`VOICE_DAILY_USD_LIMIT`,
  `voice_guidance_spent_today()` now counts `voice.preview` and `voice.clone`) and stay out of
  the daily model-call count (`model_usage_today()`). A preview or clone over the limit is refused
  with `VOICE_BUDGET`; a worker step over the limit waits 30 minutes.
- Costs are reserved before sending, marked `unknown` just before the request and stay unknown
  until invoice reconciliation, as for existing voice audio.
- An answer lost on the way back is never sent again blindly: every provider resource of a clone
  is named `trainsyou-<clone id>`, and the worker looks the name up (voices, datasets,
  fine-tunes) before resending. A Quick clone is resent at most twice after three look-ups; any
  duplicate found later is queued for deletion.
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
`attention` for Integration operations (which can queue it again). It runs for closed workspaces
too.

Queued by: the trainer deleting a clone; a newer clone replacing an older one; withdrawing voice
consent; personal erasure (`eraseAdditional`); ownership transfer (`transferAdditional`, new:
the previous owner's voice stops and their clones are deleted); workspace closure
(`closeAdditional`, before the clones and recordings are removed); stale drafts and failures.
Whether deleting a Cartesia fine-tune also deletes its voices is not documented, so the voice is
deleted explicitly. Deletions need the Cartesia settings to remain configured.

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
  `VOICE_CLONE_REVIEW_REQUIRED` (default off), `VOICE_TRAINING_OPT_OUT` (default off),
  `VOICE_CONTRACT_VERIFIED`.
- Speech-to-text: `STT_PROVIDER` select, blank `STT_BASE_URL` and `STT_MODEL` mean the provider's
  own (`ink-whisper` for Cartesia), `STT_API_VERSION`, USD per hour (help: about 0.07 to 0.12 for
  batch ink-whisper). `STT_ZERO_RETENTION` applies to ElevenLabs only.

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
- Integration operations: "Trainer voice clones" lists clones and deletions per workspace, with
  preview listening and "Try again" for deletions that need attention; the voice panel shows the
  provider.

## What is mocked and what is real

- Real in this branch: the request shapes, headers, version pin, multipart bodies and response
  handling written from Cartesia's public API reference (read 28 September 2026).
- Mocked: every Cartesia answer. `tests/e2e/mocks/cartesia.ts` checks the key (Bearer or
  X-API-Key) and `Cartesia-Version`, requires a dated model for Pro voices, advances fine-tunes
  through `training` to `completed` over polls, and can lose an answer after acting
  (`loseNextAnswer`) or fail a call (`failNext`).
- Not verified against Cartesia: the account's plan and Pro slots, whether Bearer or X-API-Key is
  preferred on this account, per-clone credit charges, maximum transcript length, real audio
  quality, timing and failure texts. The live smoke stage checks these.

## Owner decisions pending

1. The Pro clone price shown to trainers (`VOICE_PRO_CLONE_PRICE_AED`) and how it is billed (the
   app shows it and records it in the clone's evidence but does not charge it).
2. Whether Pro is switched on by default (it is off; it needs a Cartesia Startup plan or higher,
   with 2 Pro slots on Startup and 4 on Scale for the whole platform).
3. Whether each clone needs operator review before members hear it (off by default; the trainer's
   own recording and consent are the check).
4. Whether the Cartesia account opts out of Cartesia training on uploads (the trainer is told
   either way).
5. Whether team trainers (not only the owner) should have their own voices: today one voice per
   workspace, the owner's.
6. Whether transcription moves to Cartesia too (supported; the settings choose).

## Checks actually run

Node 24. `npx tsc --noEmit` (root) and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass. `npm run build`: pass. PGlite `tests/voice-clones.test.ts`: 14 tests, 14 pass. Related PGlite files during the stage (voice-session, integrations-completion, platform-settings, provider-configuration, programme-voice, voice-session-domain, onboarding-completion, isolation-elevation, isolation-follower, isolation-guard, isolation-scope, privacy-lifecycle, privacy-media, chat-attachments, e2e-harness-mocks, fix-keys): 130 tests, 130 pass; logical-css, fix-web, fix2-web: 19 pass. Full PGlite suite on the final code (`node --import tsx --test --test-concurrency=1 tests/*.test.ts`): 943 tests, 942 pass, 0 fail, 1 skipped. PostgreSQL restricted role: `/opt/tools/pg-sandbox.sh 56231` with 10 changed or related files: 9 files (75 tests) pass; `platform-settings.test.ts` failed all 15 tests there only because it asserts the `trainer_ci_*` database name that `scripts/run-postgres-tests.mjs` creates (the selected mode names databases `sel_*`). Whole restricted-role suite `/opt/tools/pg-sandbox.sh 56232` (migrations, runtime role, `verify-runtime-access.mjs` reporting `runtimeAccess: verified`, 44 scoped tables, 43 helpers): 125 files, 943 tests, 941 pass, 0 fail, 2 skipped, `PostgreSQL test files failed: 0`. Python deployment tests (`python3 -m unittest discover -s tests -p 'test_*deployment.py'`): 151 run, OK, 3 skipped. Not run: the e2e harness (including the new scenario) and the browser check (their ports were in use), and anything against api.cartesia.ai. Recorded also in `docs/COMPLETION_STAGES.md` stage 2026-09-28g.

## Limits

- One voice per workspace, the owner's; a team trainer cannot have a clone.
- Pro clone uploads and training run in the worker; a worker that is down leaves clones in
  processing. A Pro clone waiting more than a day for training fails with `TRAINING_TIMEOUT`.
- A Quick clone request waits for Cartesia inside the trainer's request (up to 2 minutes).
- The e2e scenario (`tests/e2e/scenarios/voice-clone.e2e.ts`, core suite) is written but was not
  run in this stage (the harness ports were in use).
- The browser recorder and upload were typechecked but not exercised in a browser.
