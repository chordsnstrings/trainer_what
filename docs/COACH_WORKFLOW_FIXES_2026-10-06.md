# Coach workflow fixes — 6 October 2026

Published in PR #35 on `fix/coach-workflow-2026-10-06`. Production remains `0773411` until normal release gates pass. Standing owner authorization: always deploy. The longer live Suno run is tracked in `CLAUDE_HANDOFF.md`.

## Changes

| Finding | Implemented behavior |
| --- | --- |
| F01 | Updated health disclosures trigger training holds, stop prepared/running guidance and pause affected nutrition. Existing pain stops preserve their original reason. History remains intact. |
| F02 | Nutrition checks consented training intake, member messages, workout notes and holds before cached delivery, generation and return. Clinical disclosures require review. Today hides held nutrient targets. |
| F03 | Missing prerequisites persist as visible, unsent generation records. Jobs resume the same intent after setup changes. Historical no-library jobs recover. Unknown paid outcomes never retry automatically. |
| F04 | Publication, fresh checkout, product activation and audio purchases require deliverable services. Existing checkout reconciliation is preserved. Tenant-scoped readiness exposes no private Brain material. |
| F05 | Offer-aware member checklist joins membership, intake, workouts, food and audio. Coach setup separates teaching progress from workout/audio delivery and evaluated capabilities. |
| F06 | Intake captures available weekdays, session-minute limit and timezone. Generated plans validate every week against them. Existing calendar moves/skips handle exceptions. |
| F07 | Food profile records optional weight. Individual target entry prefills it; target provenance is explicit. Meal generation receives permitted upcoming training and corrected reported workload. Consent/context changes invalidate in-flight results. No calorie-burn inference or automatic target adjustment. |
| F08 | Shared authoring and progression support reps, time and distance. Immutable corrections store actual time/distance. Guided distance completion accepts actual metres; a blank result explicitly confirms the prescribed distance. Wrong-unit replies cannot complete rep sets. |
| F09 | Prescriptions, generation, editing, validation and playback preserve warm-up/main/cool-down blocks, supersets/circuits, sides and repeated movements with unique IDs. Rounds alternate correctly, including rest previews and recovery. Prescribed preparation/recovery replaces generic phases. |
| F10 | Code-owned setup, work/rest, safety, recovery and shared clips use deterministic English/Arabic templates and separate language keys. Cached audio fingerprints include the localized script. No extra AI calls. |

Model teaching remains versioned rules/examples/retrieval. Public wording remains “frontier model.” Existing consent, qualified automation, append-only financial history and reconciliation controls stay active.

## Checks

TypeScript and production build pass. Focused API/domain checks cover safety propagation, unsent intent recovery, nutrition clinical review and permitted training context, actual-result corrections, repeated-instance adaptation, Arabic cues, grouped rounds, voice lifecycle, sale readiness, tenant scope and payment reconciliation. [Detailed run evidence](evidence/coach-workflow-fixes-2026-10-06.json) records actual counts and fixture corrections. Providers are synthetic in these checks.

Nine browser journeys pass against the production build with no page errors or horizontal overflow. Local Chromium and an isolated synthetic database cover deliberate progression, recovery, music/remote separation, pain retry, timed completion and Arabic circuits with actual-distance logging. Desktop and phone screenshots were visually reviewed. Physical headset/lock-screen reliability remains unmeasured.

## Release and continuation

- Apply migration `087_coach_workflow.sql` through the normal release. The narrow readiness helper is registered in the runtime access verifier. Run the restricted PostgreSQL and exact-head CI gates before merging.
- Plan prompt/validator changed to `brain-plan-v6` / `brain-plan-validator-v6`. Refresh each coach's plan qualification before automatic delivery. Stale qualifications continue routing to review.
- **F11 in progress:** prior pending tasks reconciled; the longer live Suno run is producing additional music within the original 120-request/1440-credit cap. One unknown Afro/Latin intent remains reserved. Preserve every paid output; final checkpoint records counts and balance. Import and listening review precede published playlists.
- **F12 remains empirically incomplete:** Claude: run the bounded fresh-coach → member → workout/nutrition → Cartesia/Kamran → guided logging journey with the configured frontier model. Cover English/Arabic, provider failures, stale plans and consent withdrawal. Measure latency, cost, wrong transitions and review rate on real iOS/Android/headsets in a noisy gym. Preserve closed-microphone operation and deliberate commands.
- Existing DigitalOcean continuation authority remains active. The owner's standing deployment instruction supersedes the earlier publication-authorization blocker.

## Release check corrections

Run `37425623889` passed subscriber/guided, wildcard and Compose checks. Both database suites exposed the same five failures. Catalog withdrawal now records an additional reason for already-held current/future meal plans; snapshots remain immutable. Member copy uses the English/Arabic catalogs. Guided progression fixtures record prior completed sets, and Arabic speech fixtures assert localized code-owned templates and language-specific cache keys. TypeScript passes; all targeted corrections pass (nutrition withdrawal rechecked after adding the second invalidation event). No release gate was weakened.
