# Coach workflow audit — 6 October 2026

Audit only. No application fixes, deployment, paid provider calls or production writes.

**Verdict:** substantial functionality exists, but the complete coach-to-subscriber journey is not yet reliably joined up. Three defects were reproduced. Nine further gaps need delivery, UX or qualification work.

Seed 2.0 is the frontier model in this workflow. The application teaches the coach's method through confirmed rules, examples, retrieval and versioned evaluations; it does not fine-tune Seed's weights. The findings concern the application and its workflows, not model nationality or general benchmark rankings.

## Baseline and evidence

- Audited deployed application commit `0773411314bb31765f748dbeaeec58ae76bbeded`. Readiness returned HTTP 200, `ready`, and that exact release at **05:05:25 UTC, 6 October**.
- Checkout includes the final 5 October handoff checkpoint `1a50aa9`. Application paths match main. Local audit branch: `audit/coach-workflow-2026-10-06`. GitHub sync was blocked by automatic approval review because publication authorization was not verified. The authenticated owner matches the repository owner; the repository is public. No retry or alternative publication was attempted.
- Reused exact-release CI: five checks passed; PGlite 1,681 passed/5 skipped, restricted PostgreSQL 1,680 passed/6 skipped, zero failures. Eight guided browser journeys passed. See [release evidence](evidence/guided-session-release-2026-10-05.json).
- New isolated tests: three defect reproductions plus their nutrition qualification prerequisite passed. Providers were mocked. No external AI, speech, music or payment request was made.
- Source inspection covers coach setup/teaching, checkout/access, intake, plan generation/review/scheduling, nutrition, guided voice/music, learning, reminders and recovery. This was not a fresh signed-in production or physical-device test.
- Evidence and exact temporary probe bodies: [results](evidence/coach-workflow-audit-2026-10-06.json), [probes](evidence/coach-workflow-audit-2026-10-06-probes.txt). Temporary test files were removed.

## Workflow coverage

| Stage | Existing behavior | Audit result |
| --- | --- | --- |
| Coach setup | Verified account, page, offer, Brain and launch checks | Delivery readiness incomplete: F03–F05 |
| Teach Seed 2.0 | Sources/cases → rules → conflicts → approval → held-out checks → release | Implemented; percentage needs clearer meaning: F05 |
| Automation qualification | Separate replies, actions, plans/adaptations and nutrition checks; version/model pins | Good separation internally; explain it in onboarding: F05, F12 |
| Join and pay | Invitations/signup, published offers, durable checkout, verified entitlements | Nutrition sale has a readiness gate; audio lacks equivalent preflight: F04 |
| Subscriber intake | Training profile; separate food profile and consent; separate voice consent | Fragmented; safety changes are not propagated reliably: F01, F02, F05 |
| Workout plan | Library-constrained generation, equipment/load/volume checks, review, dated blocks | First-plan recovery and member availability gaps: F03, F06 |
| Nutrition | Confirmed foods/recipes/policy, allergen checks, weekly planning, swaps, diary, targets | Individualization and workout coordination incomplete: F02, F07 |
| Guided session | Plan-derived clips, narration, Ready/Done, rest/timers, recovery, pain stop | Authoring, structure, language and physical qualification gaps: F08–F10, F12 |
| Music | Shared bank, approval, shuffle and voice ducking | Catalogue unfinished in last saved evidence: F11 |
| Daily coaching | Logs, bounded adaptations, review notifications, follow-ups, safety escalation, learning checks | Implemented; F01/F02/F08 weaken the evidence entering these systems |

## Prioritized findings

**P1 = fix before relying on unattended delivery. P2 = completeness, usability or qualification gap.** “Reproduced” means an isolated fixture demonstrated the behavior, not that a real subscriber was affected.

### F01 · P1 · Intake updates bypass existing-workout safety checks — reproduced

A member with an assigned programme saved “I feel chest pain during exercise” in their intake. No active hold was created; starting the existing workout returned **200**. Intake saving only stores the profile/consent. Workout start checks existing holds, not the latest intake. Screening during a future plan generation is too late.

**Needed:** apply the existing safety policy when intake changes; create the appropriate review/hold and invalidate affected prepared guidance. Preserve history. Verify both new starts and resumed sessions after an update.

Evidence: `apps/api/src/app.ts:1712`, `apps/api/src/coaching-completion.ts:77,368`.

### F02 · P1 · Training health disclosures do not reach nutrition — reproduced

“I have diabetes and take insulin” in training intake was absent from nutrition's member context; a meal week was delivered. The identical statement in the food profile correctly returned **SCOPE_REVIEW**. Both relevant consents were present in the fixture. Nutrition checks its own profile/logs/check-ins. Training does read some nutrition check-ins, so the separation is asymmetric.

**Needed:** a consent-aware shared safety/review state across intake, chat, food and exercise. Recheck it before generation and delivery. Do not require members to repeat a disclosure in every module or bypass existing consent boundaries.

Evidence: `apps/api/src/nutrition.ts:148,748,2369`, `apps/api/src/brain-plans.ts:421`.

### F03 · P1 · Missing exercises can permanently consume the first-plan job — reproduced

With a published Brain but no active exercise library, generation returns `no_library`. The worker marks the job completed without creating a generation record. Adding exercises later schedules **zero** replacement jobs because the same intake intent already exists. The member still has no plan.

**Needed:** persist a visible prerequisite-blocked state; safely resume the same unsent intent after prerequisites change. Show the coach the missing action and the member an accurate status. Preserve the existing protection against retrying an unknown paid request.

Evidence: `apps/api/src/brain-plans.ts:870,1057,2297`, `apps/worker/src/dispatch.ts:126`.

### F04 · P1 · Selling a service does not prove it can be delivered — source

Go-live checks do not require an exercise library or qualified automatic-plan path. Voice add-on availability/purchase checks payment state and price, without checking the consented voice/provider contract used by session playback. A priced voice offer can therefore lead to text fallback. Combined nutrition already has a release-readiness gate.

**Needed:** validate the selected offer's promises at publication and checkout. For supervised coaching, make the coach's review responsibility explicit. For audio, check provider/voice readiness before purchase and explain later outages/budget fallback.

Evidence: `apps/api/src/onboarding.ts:660`, `apps/api/src/voice-addon.ts:635,685`, `apps/api/src/voice-session.ts:197`, `apps/api/src/finance-checkout.ts:554`.

### F05 · P2 · No single completion checklist for the promised service — source

Training intake returns to Today. Nutrition preferences/consents and voice preparation remain separate. “Brain trained” combines teaching activity and check scores; it does not mean workout, nutrition and voice are all ready. Replies passing does not qualify plans automatically.

**Needed:** offer-aware coach and subscriber checklists, one next action, distinct readiness states and a sample complete journey. Label the meter as teaching progress and show evaluated capability separately. Explain inclusions before payment: the existing owner policy intentionally prevents changing a paid membership; preserve it.

Evidence: `apps/web/components/member-intake.tsx:163`, `apps/web/components/member-today-model.ts:149,193`, `apps/api/src/coach-setup.ts:314`, `packages/domain/src/brain-teach.ts:264`, `apps/web/components/setup-brain.tsx:760`, `apps/api/src/app.ts:1903`.

### F06 · P2 · Plans lack the member's actual schedule constraints — source

Intake captures days per week, but not available weekdays or session-minute limits. The model chooses weekdays. Duration validation uses the coach's global bound and an estimated work/rest formula, not the member's time budget.

**Needed:** capture preferred days, maximum duration and schedule exceptions; validate and preview the resulting calendar. Distinguish estimated duration from measured workout time.

Evidence: `packages/contracts/src/index.ts:44`, `packages/domain/src/brain-plans.ts:125,271,307,601,721`.

### F07 · P2 · Nutrition is not coordinated with the actual workout plan — source + fixture

Without an individual target, calories fall back to the coach's goal-level policy. The reproduction delivered with `targetId: null`. Nutrition context contains food history/check-ins, not the assigned training calendar or measured workload. Coach-set individual targets/macro ranges and review dates exist, but are optional.

**Needed:** make target provenance clear; collect the inputs required by the coach's chosen method and review individual targets. Coordinate training/rest days and schedule changes under explicit coach rules. Do not invent calorie adjustments merely because activity is logged.

Evidence: `apps/api/src/nutrition-completion.ts:42`, `packages/domain/src/nutrition.ts:116,499`, `apps/api/src/nutrition.ts:748,2627`.

### F08 · P2 · Timed/distance workouts lack authoring and correction parity — source

Generated plans and the guided runner support reps, seconds and distance. Manual exercise/template schemas still require reps. Set corrections accept reps/load/RIR but reject actual seconds or distance. Guided distance completion records the prescribed distance when Done is pressed.

**Needed:** one prescription contract across library, manual plans, editing, guidance and correction. Let members correct actual duration/distance; mark confirmed prescribed values distinctly from measurements. Adaptations must use corrected outcomes.

Evidence: `packages/domain/src/coaching-completion.ts:3`, `packages/domain/src/brain-plans.ts:101`, `apps/api/src/training-programs.ts:156`, `packages/domain/src/voice-runner.ts:1135`.

### F09 · P2 · Session structure remains simpler than personal training — source

Warm-up/cool-down are generic phrases, not prescribed blocks. Exercises follow a flat sequence. There are no typed superset/circuit/side-switch structures; repeated exercise names are restricted. Personal narration cannot add the missing prescription safely.

**Needed:** coach-authored structured warm-up, main blocks, supersets/circuits, unilateral transitions and cool-down; stable exercise-instance IDs; matching timing, logging and review. Keep counts and loads owned by the validated plan.

Evidence: `packages/domain/src/brain-plans.ts:125`, `packages/domain/src/voice-session.ts:175,525`, `packages/domain/src/voice-runner.ts:1041,1307`.

### F10 · P2 · Arabic UI does not provide fully Arabic guided instructions — source

Code-owned setup, set, rest and safety clips are English, even with Arabic exercise names. Coach phrases can be Arabic. This produces mixed-language guidance.

**Needed:** localized deterministic templates, numbers/units, matching voice capability and equivalent safety/recovery tests.

Evidence: `packages/domain/src/voice-session.ts:53`.

### F11 · P2 · Complete workout playlists are not evidenced — saved checkpoint

Last saved checkpoint: **38 of 240** tracks downloaded; none of eight genres has 30. Listening review/import remained pending. Member discovery requires 30 approved tracks per playlist. Production inventory was not queried today.

**Needed:** reconcile the existing known/unknown provider intents; finish generation, import and review; verify all eight 30-track playlists and shuffle/ducking. Reuse paid outputs. No regeneration was attempted during this audit.

Evidence: `docs/GUIDED_SESSION_IMPLEMENTATION_2026-10-05.md:21`, `apps/api/src/workout-music.ts:92`.

### F12 · P2 · Complete real-service/device qualification remains open — evidence gap

Existing Seed 2.0 tests are real evidence: the 1 October model-switch worker check scored **17/18**, with valid JSON 18/18 and no safety failures under its documented definitions. That check is not proof of the complete paid subscriber journey. Browser fixtures do not establish physical lock-screen/headset behavior, real-gym command accuracy or current provider latency.

**Needed:** a small bounded release matrix: fresh coach → teaching/checks → combined offer → member intake → workout/nutrition → Cartesia/Kamran preparation → guided session/music → logging/adaptation. Include English/Arabic, noisy speech, provider failure, consent withdrawal, stale-plan recovery and real iOS/Android/headset use. Measure wrong transitions, latency, cost and review rate. Avoid broad repeated AI trials.

Evidence: `docs/features/model-profiles.md:157`, `docs/GUIDED_SESSION_IMPLEMENTATION_2026-10-05.md:44`.

## Controls worth preserving

- Held-out qualification, version/model pins, guarded fallback and separate review routes.
- Deterministic equipment, load, progression, allergen and nutrient checks; untrusted model output stays bounded.
- Durable payment/generation intents, accounting, caps and unknown-outcome reconciliation. Current long-model job leases are already fixed.
- Deliberate Ready/Done, timers beginning after cues, pause/reload recovery, explicit pain holds and coach review.
- Closed microphone, bounded talk capture, local speech filtering and explicit Ask Coach. No need for continuous ambient AI calls; local filtering alone does not prove gym accuracy.
- Tenant isolation, permission/consent gates, review notifications, lifecycle reminders and bounded learning from corrections.

## Recommended sequence

1. Close F01–F04 with focused regression coverage.
2. Join onboarding/readiness and member constraints: F05–F07.
3. Unify workout authoring, outcomes and session structure; localize guidance: F08–F10.
4. Complete the existing music bank and bounded real-service/device qualification: F11–F12.

No fixes or deployment were performed in this audit. Existing Claude authority for DigitalOcean and previously approved continuation work is unchanged.
