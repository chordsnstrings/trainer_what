# Guided session audit — 5 October 2026

Audit only. No application changes or deployment. Application baseline: `e7ffa0c4cbc11769f413a27a31dc73a45d4cb090`; local documentation baseline: `b83252833fcc0dcd6efc412768a6e9b990109240`.

Scope: the workout's **Guided session** option (`/app/guided/:workoutId`), its API, audio access, pain reporting, recovery and layout. The separate **Voice-led session** runner was compared as an existing foundation; its live microphone/provider/device behavior was not fully audited here.

## Confirmed defects

| Priority | Finding | Evidence / required behavior |
| --- | --- | --- |
| High | Playback consent revocation leaves stored guided audio accessible. | After successful `/voice-sessions/consent` revocation, the old `/guided/audio/:id` still returns HTTP 200. Revocation updates the newer voice-session tables only. Apply current playback consent to legacy audio delivery and revoke legacy clips too. |
| High | Removing the premium voice add-on leaves stored audio accessible. | With an active training-only subscription, the same audio GET returns 200. `guidedMaterial` returns premium status, but this GET ignores it. Recheck current entitlement before delivery. |
| High | Delayed audio can belong to the previous exercise. | Request Squat audio, move to Lunge, resolve the request: Lunge displays Squat's audio URL. Bind responses to the current exercise/session; discard stale responses. |
| High | Pain-report confirmation fails after a successful report. | Pain POST succeeds and creates a hold. Shared `useAction` then refreshes the held guide; HTTP 409 replaces the success notice. Confirm the report independently of the expected guidance stop. |
| High | A failed pain report loses the entered note. | POST 503 leaves the guide stopped but clears/closes the note before acknowledgment. Preserve the note and provide retry with an accurate delivery status. |
| Medium | Pause has no resume. | Pausing disables navigation, timer and preparation. Nothing clears the paused state. Add explicit safe resume; distinguish voluntary pause from an enforced hold. |
| Medium | Read recovery remains stuck. | An initial 503 pauses the guide. A successful subsequent poll reloads the exercise but leaves controls paused and the stale error visible. Recover transient failures without bypassing holds; provide retry and bounded requests. |
| Medium | Refresh loses exercise and timer progress. | Exercise two plus active rest becomes exercise one and Ready after reload. Persist resumable progress and reconcile current workout/hold state. |
| Medium | Prescribed zero rest becomes 60 seconds. | Actual API returns `restSeconds:60` for a valid zero-rest exercise, while its cue omits rest. Replace the falsy-number fallback so zero is preserved. |
| Medium | The Play button only prepares a second player. | The returned native audio element is paused, with no autoplay or play call. Unticking voice consent leaves its controls usable; pausing the guide also leaves the native player available. Use coherent preparation/playback/consent states. |

## Product and UI gaps

| Area | Finding / recommendation |
| --- | --- |
| Workout execution | This guide is an exercise viewer with a manual rest timer. It has no per-set execution/logging, timed-work countdown or embedded demonstrations. Completion sends the member back to workout logging. |
| Prescription fidelity | Generated guidance omits prescribed load and effort/RIR. Carry the full structured prescription into the runner and spoken/text cues. |
| Two session experiences | Guided and Voice-led sessions have divergent state, consent, logging and recovery. Prefer one runner with text/voice modes, building on the existing richer runner after targeted qualification. |
| Localization | UI labels support Arabic, but API cue sentences are hardcoded English. Generate locale-aware instructions from structured values. |
| Visual hierarchy | At desktop width, oversized full-row rest/stop controls, an isolated half-row Previous button and a small native player waste space. On mobile, the long stack separates exercise, voice and completion actions. Group the active exercise, prescription, timer and playback; use one clear primary action and a consistent safety entry point. |
| Mobile continuity | No wake-lock request in this guide; the richer runner has one. Qualify foreground/background, screen-lock and interruption recovery on actual supported phones. Current checks do not prove device audio behavior. |
| Regression coverage | Existing guided tests emphasize API generation and source assertions. Preserve executable coverage for the reproduced pause, recovery, pain, stale-audio, consent and prescription defects during implementation. |

## Checks and limits

- Seven grouped browser reproductions passed against an isolated seeded app; zero page errors.
- Text and voice layouts checked at 390 and 1440 px. No horizontal overflow; visible buttons were at least 44 px high. Hidden sheet controls were excluded from touch-target judgments.
- Two targeted in-memory API tests passed, including the existing voice-enrollment path and a new audit reproduction. They confirm the defects above, not feature correctness. One synthetic provider request; no live voice/model call.
- Observed strengths: owner/workspace binding, active membership and hold checks, trainer-voice verification/version checks, cue screening, request deduplication, budget accounting and private no-store audio responses. This is not a complete security certification.
- Evidence: `docs/evidence/guided-session-audit-2026-10-05.json`. Temporary reproduction scripts/logs/screenshots remain in local `test-results/` and `/tmp`; the structured findings and results are durable here.
- No production writes, paid-provider tests or physical-device qualification. Arabic behavior was inspected in source, not browser-tested in this audit.

## Recommended order

1. Close audio-access gaps, stale audio and pain-report failures.
2. Fix pause/recovery, durable progress and zero rest.
3. Consolidate the session runner; include the full prescription and integrated logging.
4. Refine layout/localization and qualify device behavior.

This audit does not alter Claude's existing DigitalOcean authority or deployment runbook. No guided-session fixes have been made.
