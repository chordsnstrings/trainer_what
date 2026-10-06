# Coach workflow fixes — 6 October 2026

Local implementation on `fix/coach-workflow-2026-10-06`. Application checkpoint: `5f95483`; safety/setup base: `9c9497f`. Production remains the previously verified `0773411`; no deployment or paid provider call was made in this work.

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
- **F11 remains externally incomplete:** restored 38 songs from Library archive `libfile_d5505a105648819180145bd1b9ba97cb`. There are 21 known tasks (19 downloaded, two pending), one unknown Afro/Latin slot 2 and 98 untouched requests. Read-only Suno connectivity timed out; no requests were resubmitted. Claude: reconcile intents, continue the existing 120-request/1440-credit cap, import paid outputs, listen/review and finish eight 30-song playlists.
- **F12 remains empirically incomplete:** Claude: run the bounded fresh-coach → member → workout/nutrition → Cartesia/Kamran → guided logging journey with the configured frontier model. Cover English/Arabic, provider failures, stale plans and consent withdrawal. Measure latency, cost, wrong transitions and review rate on real iOS/Android/headsets in a noisy gym. Preserve closed-microphone operation and deliberate commands.
- Existing DigitalOcean continuation authority remains active. Prior automatic approval review rejected publishing the standalone vulnerability audit to the public repository because publication authorization was unverified. No retry, alternate upload or production merge was attempted here.
