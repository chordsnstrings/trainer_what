# Guided-session implementation — 5 October 2026

Deployment follow-up: owner authorized deployment on 5 October. CI caught missing music-table registration in the runtime privilege gate. Fresh-host service grants and forced-RLS/tenant-denial verification are corrected; the complete local runtime gate passes with 75 migrations. Corrected-head CI and actual deployment verification remain pending.

Branch: `feat/guided-session-complete-2026-10-05`. Built into the existing web app. The owner superseded the native-prototype-first gate. Not deployed.

## Implemented

- One guided runner for text and approved trainer voice; legacy routes redirect to that experience. Existing configured frontier model prepares narration; Cartesia/Kamran remains subject to the existing trainer voice rights and consent gates.
- Explicit exercise readiness, exact prescribed sets/reps/load/time/distance, optional same-exercise automatic pacing, full rest, extra rest, repeat, pause, trainer-authorized reductions/skips, completion and durable pain reporting. Timed expiry does not claim physical completion. Clocks begin after the cue, pause across interruptions and restore paused.
- Local and account checkpoints bound to the script revision; optimistic concurrency stops stale-device writes. Ordinary set logs carry into guidance. Indexed set intents and legacy retry compatibility protect logging across routes. Coaching outcomes persist with stable event IDs.
- Voice clips selected by immutable key/version, stale playback callbacks cancelled, current consent/entitlement checked. Default closed microphone, Hold/Tap to talk, local silence/impact filtering, bounded capture, cancelled-result guards and safety holds. Ambient sound makes no routine transcription/model calls. A deliberate unknown utterance becomes a question draft; only explicit Ask Coach uses the existing guarded coaching route.
- Eight instrumental genres. Shuffle without repeats, previous/next, repeat modes, favorites, hidden tracks, queue, independent volume and speech ducking. Separate Music and Coach remote modes; Coach Next confirms readiness/completion, Previous repeats, Play/Pause controls the session. A consumed test signal and debounce prevent accidental advancement. Track endings do not complete sets.
- Platform administration: bounded generation, reserved credits, submission-day budget checks, unknown-outcome reconciliation, idempotent import of already-paid task IDs, instrumental-request verification, review, durable MP3 storage, authenticated range playback. A playlist becomes discoverable only with at least 30 approved tracks. No top-up or automatic resubmission of an unknown request.
- White cards, consistent spacing/touch targets, compact session settings, corrected desktop heading, English/Arabic wording, RTL layout and dark-theme-compatible surfaces.

The runner follows the trainer's explicit ordered exercise blocks. Timed/distance work is supported. It does not infer new circuits, sided prescriptions, exercise substitutions or reduced-duration plans from conversation; those remain trainer-authored programme data.

## Music checkpoint and continuation

38 distinct MP3 files are downloaded and structurally checked: Flow 6, EDM 6, Rock 6, R&B 4, Hip-Hop 4, Afro/Latin 4, Synthwave 4, Recovery 4. Listening review is pending. Target remains 240 accepted tracks, 30 per genre.

21 accepted provider task IDs are preserved: 19 downloaded and two pending (R&B slot 2 and Hip-Hop slot 2). Afro/Latin slot 2 has one unknown submission after this session's network policy interrupted access to `apibox.erweima.ai`; reconcile it before any replacement. There are 98 unattempted brief slots. Do not discard or recreate the existing intent files.

Initial balance: 2788.1 credits. The first request produced two distinct approximately four-minute songs; balance became 2776.1, an observed 12-credit cost. The last recorded pre-submission balance is 2536.1. Final balance and the interrupted submission charge are unverified. The builder caps all 120 intents at 1440 reserved credits. No account top-up occurred.

Durable archive: `workout-music-checkpoint-2026-10-05.zip`, 218038476 bytes. Library file `libfile_d5505a105648819180145bd1b9ba97cb` / file `file_00000000f954823086f608fc214c4ab0`. It contains all 38 songs, checksums/audio metrics, 22 intent records, 120 briefs and `tasks.json` for the 21 known tasks. No credential is inside the archive or Git.

Continue from an authenticated environment with provider access:

1. Restore the archive. Put the owner-supplied SunoAPI key in protected runtime input/settings. The local temporary key is outside Git and is not a durable production setting.
2. Reconcile the unknown Afro/Latin intent with provider history. Preserve its original intent; attach the actual task ID if found. Never blindly resubmit it.
3. Poll/download existing tasks with `scripts/build-workout-music.py --key-file <protected-key> --directory <extracted-archive> --briefs <extracted-archive>/briefs.json --origin https://trainsyou.com --rounds 120`. Add `--submit --max-requests 120 --credit-budget 1440 --credits-per-request 12 --concurrency 8` to fill only untouched brief slots after reconciliation. Recheck the provider quote; keep existing intents and cost reservations.
4. After deployment, import `tasks.json` at `/admin/music`. This never generates replacement music. The worker can download paid tasks while paid generation remains disabled. Save `MUSIC_CREDITS_PER_JOB=12` only after verifying the current quote; use a bounded daily budget when enabling new generation.
5. Complete instrumental/listening review, approve suitable tracks and replace rejected outputs through reconciled, bounded new intents until every playlist has at least 30 accepted songs. Persist all additional provider outputs before their retention window expires.
6. Check production storage/backups for roughly 1.4 GB for a 240-song bank. Audio is stored in PostgreSQL and range reads fetch the requested bytes; no unconfigured volume or temporary provider URL is the durable source.

Claude's existing DigitalOcean authority remains intact. Continue its DNS, certificate, host and domain work under the current handoff authorization.

## Verification boundary

Targeted domain/API/provider/UI tests cover current consent, ownership, concurrency, recovery, repeated intents, budget reservations, import mismatch, byte ranges, deliberate completion, zero/full rest and shuffle behavior. Browser journeys cover readiness, confirmation, recovery, music separation, remote preflight and pain retry at phone/desktop/RTL widths. The guided browser suite is registered in CI.

Root TypeScript and production build pass. All 188 targeted tests and eight browser journeys pass. Screenshots at 390/1440 px and RTL layout were reviewed; no page errors. Exact evidence: `docs/evidence/guided-session-implementation-2026-10-05.json`. Fixture checks do not certify physical iOS/Android lock-screen/headset behavior, live Cartesia latency or real-gym acoustic accuracy. Those need actual device/provider runs; the UI states browser availability and supports visible controls throughout. There is no native prototype or native application in this change.
