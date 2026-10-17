# WHOOP recovery and training — 17 October 2026

Status: implemented and locally verified; CI and release pending. Baseline `bf5df60fbd9c49bb38447432e585b6663825d140`; branch `work/whoop-training-2026-10-17`. Owner request: include WHOOP and allow it to change training.

## Audit

The repository already has WHOOP v2 OAuth, encrypted rotating credentials, hourly sync, revocation, settings and member connection controls. Imported observations explicitly permit deterministic features and exclude model prompts. The workout-start path currently copies the assigned prescription unchanged. Recovery does not influence training. The adapter omits HRV/resting heart rate and does not carry calibration eligibility; recovery timing currently uses record creation time rather than its associated sleep.

## Implementation contract

1. Extend the existing approved adapter with bounded recovery, HRV, resting heart rate and sleep-performance facts. Associate recovery with scored main sleep when available; do not use naps, calibration, invalid or stale readings for automatic changes. Preserve provider provenance and data-use restrictions.
2. Let trainers explicitly enable and configure low/moderate-recovery rules. Rules only reduce prescribed load and repetition/time/distance volume; retain exercise choice, order, sets, rests, warm-up and cool-down. Green recovery retains the assigned workload. These are trainer choices, not medical thresholds or measured efficacy claims.
3. Require an explicit subscriber opt-in and platform approval of the intended WHOOP training use. Show recovery, freshness and the rule in Connections/Today. At workout start, recheck current permissions, source, policy and existing safety/access gates in the same transaction, then freeze the adjusted session. Repeated starts reuse the same workout. Never rewrite a running session or the trainer's programme.
4. Guided playback must use the actual frozen workout and retire any stale pre-generated script. Retain the original prescription and an auditable adjustment receipt. Raw WHOOP observations remain outside model prompts, learning and advertising; downstream use of adjusted workout prescriptions is covered by the explicit feature consent and provider-use approval.
5. Test parsing/freshness, bounded changes across exercise measures, permission/policy changes, isolation, duplicate starts and guided-plan consistency. Run normal release gates, update handoff, merge and verify serving release. Do not make live provider calls or enable provider settings without account evidence.

## Current official sources checked

- [WHOOP API v2](https://developer.whoop.com/api/): recovery, sleep, workouts and cycle read scopes; scored recovery includes calibration state, HRV and resting heart rate.
- [OAuth](https://developer.whoop.com/docs/developing/oauth/): confidential OAuth authorization and rotating refresh tokens.
- [WHOOP 101](https://developer.whoop.com/docs/whoop-101/): recovery zones are low 0–33, moderate 34–66 and high 67–100.
- [API terms, effective 6 October 2026](https://developer.whoop.com/api-terms-of-use/): data-use restrictions include AI uses and derived data, with an express authorization exception in section 4.2. General API restrictions also apply. A generic OAuth grant is not treated as approval of every downstream use; existing contract approval stays intact and training use receives a separate gate and consent.

## Verification and remaining setup

Local TypeScript and production build pass. The 36 focused WHOOP/integration checks and 85 affected regression checks pass (overlapping suites; do not add the counts). Tests cover provider normalization/rescoring, main-sleep linkage, current-day/freshness limits, calibration, bounded reductions, policy/consent revisions, workspace isolation, safety holds, idempotent starts, privacy withdrawal, actual weekly prescriptions and stale guided-script rebuilding. The full Chromium and headless-shell downloads both returned invalid archives in this workspace; no local browser pass is claimed. The real trainer/member desktop/phone/Arabic journey is included in the subscriber UI CI gate.

Live operation requires the platform's WHOOP client credentials, registered HTTPS callback, approved scopes and account/data-use approval. Synthetic verification cannot prove WHOOP app approval, member data accuracy or training outcomes.


## Setup and use

- In Superadmin WHOOP settings, configure the registered client ID, client secret, HTTPS redirect and approved scopes, including `offline read:recovery read:sleep`. Preserve the existing contract-verification gate. Enable `WHOOP_TRAINING_APPROVED` only when account/data-use approval covers this training use and downstream coaching/voice use of the adjusted prescription. This release does not enable or edit any live provider setting.
- In **My Brain → Plans** (`/trainer/brain/plans`), enable recovery rules and set low/moderate reductions. Load reductions are bounded to 0–30%; reps/time/distance reductions to 0–50%. The initial choices are 10%/25% for low and 0%/10% for moderate; they are inactive until the trainer enables them. These defaults are configurable product choices, not efficacy claims.
- A member connects WHOOP through **Connections** (`/app/wearables`) and separately enables **Use recovery for my workouts**. Today shows the last reading and applicable rule. The existing hourly sync/manual sync provides updates.
- Workout start freezes the adjusted programme with its original, policy/permission/source versions and per-exercise before/after receipt. Manual logging and guided playback display the receipt. Weekly reviews use the actual workout prescription. High recovery, stale/unscored/calibrating/unlinked data, permission withdrawal, disabled rules or a future/past planned date cause no automatic adjustment. Existing safety/access gates remain authoritative.
- Migration `099_whoop_training.sql` adds only the tenant-scoped read function for the published policy; policies/preferences/receipts use existing records. Runtime grants are explicitly allowlisted. No dependency was added.
- Rollback: disable `WHOOP_TRAINING_APPROVED` or the trainer rule to stop new adjustments. Running workouts retain their frozen prescriptions. The additive migration need not be removed.

No live WHOOP read, paid model/voice call, provider approval, data-accuracy claim or physical-device acceptance was made for this change. CI and exact serving evidence will be recorded after they complete.

## Release check progress

PR #71 opened at head `0784fdd2c942f84e877632e04e059eb8721a61a3` (tree `848a7fbec63c220446dae429b242e70663552bdf`). Initial CI run `39003597429` passed migration/runtime-grant checks and both edge/topology gates. The existing subscriber intake browser journey timed out on the workspace opening screen before the WHOOP journey; its deliberately queued bootstrap returned HTTP 200 in 26 ms. The harness now awaits that response before asserting rendered visibility, preserving the assertion and every subsequent interaction. Today also avoids a WHOOP read when the integration is unconfigured/unapproved. Fresh complete head checks are required; the initial failure is not waived.

The existing `docs/PROJECT_MEMORY.md` remains unchanged: automatic approval review rejected republishing its operational payload. Task progress is recorded here and in the approved Claude handoff. Repository code publication used the connected GitHub API; remote blob and tree hashes were checked against the tested local tree.

Second-head CI (`8cfb87bde8e485fa86872ff2b0e76382a7827251`, run `39003923480`) passed the complete existing subscriber and guided/music browser journeys. The WHOOP browser journey passed trainer-rule saves, persistent explicit member permission, the real reduced workout and the guided receipt. Its Arabic step used a public URL language hint instead of the signed-in member's saved preference; the fixture now changes language through the real Profile settings form. The initial desktop/phone screenshots were inspected: the consent explanation needed its own block below the checkbox, which is now linked with `aria-describedby`. Screenshots also wait for expanded receipt animation and dismiss optional analytics through its real control. Final-head checks remain required.

Third-head browser evidence (`09f19b0c0a635af2409860b8cb16c8a264b49fa5`, run `39004365271`, artifact `12090730977`) again passed the four WHOOP functional steps with no client exceptions. Updated phone screenshots were inspected: consent now uses the full card width and expanded before/after receipts are readable. The remaining fixture failure was an exact accessible-name selector for the existing language field, whose label includes option text. It now uses the same English/Arabic label pattern as `rtl-check.mjs`; no application language behavior or assertion was weakened.
