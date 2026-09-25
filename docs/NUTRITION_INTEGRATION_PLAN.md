# Nutrition integration plan

Date: 25 September 2026. Status: **EXISTING CORE CI VERIFIED; REQUIRED PHOTO/BARCODE BUILD AND LIVE QUALIFICATION PENDING**. The owner specified two subscription tiers, coach-guided AI nutrition and case-based coach onboarding. The latest clarification rejects reviewing every output: learn the coach's decisions upfront, automate routine delivery within that scope, and route exceptions for human input. Detailed engineering defaults below are proposed implementation choices. This document adds scope to the original specification; it does not approve clinical practice, select providers, set live prices or enable live services.

**Owner scope decision — 25 September 2026, 12:27 Asia/Dubai:** meal-photo logging and packaged-food barcode scanning are now required parts of workout + nutrition. This supersedes their earlier optional status. Both remain unimplemented; 043 is committed scope and 044 must verify the expanded journeys. This decision does not add a third subscription tier or require coaches to approve routine food entries.

## 1. Current baseline and the gap

The pre-nutrition implementation was `e6a539e`; `2f0b33b` recorded its verification. The development platform has accounts/MFA, 16-step trainer setup, Brain teaching and supervised releases, Client Twin snapshots, programs/offline workouts, messaging, bookings, support, privacy controls and governed finance workflows. That baseline CI result was 37 tests on each of PGlite and PostgreSQL, production web/container checks and 22 browser routes. See [verification](VERIFICATION_2026-09-24.md).

Production deployment and real Stripe/Lean/model/email verification remain open. Broader engineering gaps remain in [build status](BUILD_STATUS.md). The nutrition core is implemented in `552d384`, with final client fixes in `2bf35fd`. Final CI passed 51 tests on each database engine, production web/container checks and 32 browser routes, including empty-queue reconnection. See the [nutrition verification record](VERIFICATION_2026-09-25_NUTRITION.md). The sections below retain the intended acceptance contract; provider qualification and optional extensions must not be inferred complete from this core checkpoint. The original source only explicitly excludes clinical nutrition prescribing outside trainer scope; it does not define a complete nutrition product.

## 2. Product shape

Offer exactly two subscriber tiers: **Workout only** and **Workout + nutrition**, with the combined tier priced higher. There is no nutrition-only subscriber tier in the current owner-approved scope. A coach can start with workouts and complete nutrition setup later. Reuse identity, tenant isolation, Brain governance, Client Twin, messaging, review queues, commerce and support.

The coach provides the diet and approximate calorie guidance. AI turns that guidance into a coherent week of daily meal plans, recipes, portions and cooking options, with one consolidated weekly grocery list. These outputs share the same validated plan revision: a meal, portion or cooking-method change updates affected ingredients, calorie estimates and shopping quantities. Nutrition is a practical extension of the coach's plan, not a free-standing diet generated without the coach's direction.

Separate three concepts:

| Concept | Controls |
| --- | --- |
| Workspace capabilities | Which coaching modules the coach offers; recorded scope and credentials where relevant |
| Product entitlements | Which modules a particular subscriber has purchased |
| Individual permissions | Which nutrition information may be stored, used for coaching or sent for optional image analysis |

Enabling a workspace module neither charges a subscriber nor grants access to every product. A claimed qualification does not become a verified professional credential automatically.

The proposed initial audience is adults, consistent with the existing intake. Start with general nutrition coaching, habits and plans following the coach's taught methodology within a reviewed scope. Clinical dietary management is a separately scoped future capability requiring appropriate professional and jurisdiction review. No clinical permission or nutrient prescription is established by this plan.

## 3. End-to-end experience

**Coach:** choose whether to offer the combined tier → answer realistic client cases → explain recommendations and boundaries → confirm the extracted decision rules → resolve knowledge gaps → evaluate unfamiliar cases and a sample week → activate the qualified nutrition release and combined offer → monitor outcomes and handle exceptions.

**Subscriber:** buy the appropriate tier → complete nutrition intake and permissions if included → automatically receive a validated week and grocery list within the coach's taught scope → open today's meals, portions, recipes and cooking options → request a permitted swap or log a meal → check in → receive in-scope adjustments or a clear exception status. In-app access is the initial delivery surface; optional reminders follow notification preferences and do not invent a new meal plan on every open.

**Operations:** manage provider readiness and professional-scope evidence, investigate safety exceptions, reconcile usage costs, and process privacy requests with the existing audit trail.

### Coach onboarding: teach, demonstrate and verify

Nutrition onboarding is a required branch for the combined tier, not a single extra text field. The current runtime has a fixed 16-step registry and training-biased readiness checks. Extend that registry with conditional nutrition steps, save/resume and version checks; derive the displayed step total from the active path. Existing coaches retain their workout setup and enter only the new branch. Workout-only selling must not depend on nutrition readiness.

| Stage | What the coach provides or reviews | Stored result / exit condition |
| --- | --- | --- |
| Offer and scope | Workout only or also workout + nutrition; audience, supported diets, scope, review responsibilities and cases needing referral | Enabled capabilities and declared scope; claims remain separate from verified credentials |
| Diet and calorie approach | Diet rules, foods to include/exclude, meal pattern, portion method, approximate daily/meal calories, optional macro guidance, flexibility and when targets change | Confirmed rules with applicability and precedence; distinguish reusable methodology from each client's policy-validated target |
| Client cases and supporting material | Answer representative client situations in text or voice: recommended diet/target or method, meal structure, portions, substitutions, reasons and what would change the answer; optionally supply permitted plans/recipes | Labelled case decisions, conditions, rationale, source references, units and rights; explicit gaps instead of invented missing values |
| Practical meal rules | Allowed substitutions, portion scaling, ingredients, cooking methods/equipment, time/budget constraints, batch cooking, repeats and leftover handling | Structured constraints plus recipe ingredients, quantities, preparation basis, yield and nutrient provenance |
| Adaptive follow-up and knowledge review | Focused questions about missing information or conflicting documents; approve/edit/reject extracted rules | Resolved critical gaps, approved source hierarchy and understandable review of what the system learned |
| Demonstration and correction | During setup, inspect a full sample week and unfamiliar case responses; correct choices that do not match the coach's approach | Coach corrections with reasons, an approved preview revision and evidence of connected calculations; not a recurring per-client approval task |
| Unseen scenarios and activation | Check held-out fidelity, supported/unsupported cases and allowed automatic actions; approve the nutrition release once its gates pass | Server-calculated readiness for the supported scope; combined offer activation follows nutrition plus existing commerce/publication gates |

Make source documents optional when an interview and structured entry supply the necessary evidence. Uploading a file is not equivalent to approving its extraction. Show the coach the exact missing answer, such as “Is this rice portion raw or cooked?” or “What replacements do you permit for this ingredient?” Keep questions relevant to the diets and clients the coach actually supports.

**Case-based teaching is the primary interview.** Begin with the coach's actual audience, using synthetic or properly de-identified profiles. Cover goals, activity/training pattern, schedule, food preferences/exclusions, budget, cooking access, meal pattern and progress/feedback where relevant. Present one realistic situation at a time. Ask what the coach would recommend, why, alternatives they would accept, what they would never suggest, what information is missing, and when they would change the recommendation or refer the case. Accept natural answers and extract structure for confirmation; do not make the coach fill technical data fields.

Vary one important condition in follow-up cases: less cooking time, different equipment, an excluded ingredient, a changed schedule, difficulty following the plan, or progress that differs from expectations. Ask how the recommendation changes. Offer comparison/correction tasks only alongside open responses, so the system does not merely reward agreement with its own drafts. Record recommended and rejected options, reasons, applicability, trigger conditions, allowed ranges/cadence and escalation conditions. Never treat a rejected option as a positive example.

Choose subsequent questions from uncovered capabilities and contradictions. A large set of nearly identical answers does not qualify a broad scope. Stop repeating well-covered questions; show remaining gaps and let the coach narrow the supported scope where appropriate. The resulting case set is reusable teaching evidence, separate from client data and from the held-out tests.

**What 'trained on the coach' means initially:** build a private, versioned nutrition knowledge package containing confirmed rules, source excerpts, worked examples, approved recipe facts and corrections. Supply relevant permitted evidence to the model at generation time. This is not a claim that onboarding retrains model weights or creates a bespoke model for every coach. Fine-tuning remains a separate, evidence-led future decision. Do not share one coach's material with another or use client records for separate model training without the corresponding rights and permission.

**Proposed evidence floor:** capture cases covering each supported decision category, a complete methodology and at least three reviewed example days derived from the cases, then one complete coach-approved generated week during setup. Existing structured plans may supply supporting evidence without duplicate typing. A single calorie number, generic philosophy or large upload count does not establish readiness. Counts are an engineering starting point, not proof of quality; uncovered supported cases need additional teaching. A new client's calorie target may be calculated automatically only through the coach's explicit, reviewed policy with its required inputs and allowed limits. A supplied client-specific coach target also works. Do not invent a target or infer unrestricted authority from one example.

**Readiness is coverage and behavior, not an AI confidence percentage.** Every required capability must have confirmed evidence and pass its applicable check: diet compliance; daily meal structure; portion and calorie basis; ingredients and yields; supported cooking options; substitutions; grocery aggregation; and handling missing information or unsupported requests. Missing values have explicit states. A plan with an unresolved required calorie/quantity estimate cannot be presented as a complete nutrition delivery. Approximate values remain labelled as estimates with their source; arithmetic is deterministic.

Keep demonstration examples separate from a held-out evaluation set. Start with at least 20 nutrition scenarios, consistent with the existing Brain evaluation floor, covering normal plans, ingredient exclusions, unknown facts, raw/cooked portions, scaled servings, cooking-method changes, swaps, weekly grocery quantities, source conflicts, missing client inputs and requests outside the coach's scope. Unsupported cases should ask or escalate. All hard constraint, privacy and calculation checks must pass; coach-fidelity expectations must be explicit before a run and unresolved deviations block activation. An average score cannot hide a critical failure. Corrected evaluation cases become teaching examples and need fresh held-out replacements before a new passing release is claimed.

The preview and evaluation pin the nutrition rules, cases, recipe facts, calculation and autonomy policies, prompt/model configuration and release version. Relevant edits invalidate dependent approval and require the affected checks again. Display **Draft / Needs answers / Needs calibration / Ready for automatic nutrition within scope** with concrete next actions. Production-model readiness additionally needs successful evaluation against the configured model; fixture output cannot qualify a live model. Existing valid plans remain available subject to current constraints, rights and entitlement; unsafe or revoked material is withheld and queued for review.

Coach-level readiness is separate from client-level readiness. Each real client still needs nutrition consent, current constraints and a diet/target that fits the released policy before a personalized plan is delivered. A complete in-scope intake does not require a coach signature. Ask the client for missing factual inputs when appropriate; involve the coach for missing methodology or judgment. Corrections improve a draft knowledge version and do not silently change other clients' plans or retrain a released model.

### Automatic delivery and exception handling

The coach approves the teaching interpretation and release during setup. Routine client outputs are validated and delivered automatically; mandatory review of every week, meal or swap is explicitly excluded from the intended product.

| Action | Automatic when | Exception behavior |
| --- | --- | --- |
| Initial diet/target application and weekly plan | Client matches the taught scope; required inputs exist; explicit target policy, evidence, ingredient facts and all constraints pass | Ask for missing client facts; queue unsupported decisions or policy gaps for the coach |
| Recipes, cooking options, portions and meal swaps | Allowed by the released rules, with compatible ingredients/units and validated recalculated totals | Hold the affected change; retain a still-valid current plan and explain the missing decision |
| Daily delivery and weekly groceries | Derived from the same current plan/recipe revision and entitlement | Rebuild inconsistent projections; never send a mismatched grocery list or silently regenerate meals |
| Progress-based adjustments | Explicit coach-taught trigger, sufficient permitted data, allowed range, cadence and limits are satisfied | Queue proposals outside the policy; no inference of automatic target-change authority from examples alone |
| New constraints, conflicts or unsupported/high-risk requests | Only an explicitly permitted clarification or safe fallback is available | Pause the affected recommendation and route to the appropriate coach/specialist path; do not block unrelated workouts |

A deterministic policy service decides whether an action is permitted; the model cannot declare itself confident enough to bypass a missing rule or constraint. Store the matched rules/cases, source facts, permission checks, calculations and release version with each delivered decision. Coach dashboards show exceptions with the reason, missing answer and proposed resolution, plus optional sampled audits and the full delivery history. Replies to reusable exceptions become new teaching candidates, pass regression/held-out checks and enter a new release, reducing repeat questions without silent self-modification. Individual plan edits stay individual unless explicitly promoted to general methodology. Coach takeover remains available.

### Coach workspace

- Nutrition interview and teaching branch above: diet/calorie approach, meal structure, recipe selection, preferences, flexibility, practical cooking rules, review cadence and escalation boundaries. Do not assume every coach prescribes macros.
- Nutrition source upload/review using the existing document pipeline. Tag sources and rules by domain; keep consent, ownership and allowed-use metadata.
- Food and recipe library, reusable meal templates, ingredient quantities, serving/yield definitions and substitutions.
- Versioned diet and calorie guidance, with optional macronutrient targets, habit goals and hydration goals. Values come from explicit coach input or the released target-setting policy with its required inputs; no target is invented to fill a gap.
- Plan editor delivering the required weekly meals, recipes, portions, cooking options and groceries, with optional habits alongside. Draft, review, assign, amend and archive; changes have an author, reason and effective date.
- Exception queue: unresolved client inputs, ingredient/allergen conflicts, unsupported cases, low data coverage, out-of-policy changes and safety concerns. Routine validated outputs do not enter the queue. Missing logs are not automatically treated as non-adherence.

### Subscriber experience

- Intake: goals, food preferences/exclusions, explicitly reported allergies/intolerances, usual meal pattern, cooking facilities, budget/time, and optional cultural or fasting preferences. Distinguish “not supplied,” “none reported” and “declined.” Do not infer beliefs from location or food choices.
- Nutrition home: today's validated meals, portions, recipes, cooking options and approximate calories; link to the full week and groceries. Optional habits and logging support the core delivery; display preferences do not remove the underlying plan/calculation requirements.
- Food diary: foods, portions, manual dishes, copy a previous meal, favorites, notes, correction and deletion. Label incomplete days and partial nutrient coverage.
- Meal plan: seven dated days, ingredient details, portion basis, approved swaps, recipes and a consolidated weekly grocery list. Aggregate compatible ingredient quantities, preserve raw/cooked and unit distinctions, and handle planned batch portions/leftovers without counting the same preparation twice. Pantry items are optional user confirmations, not assumed stock. Purchase pack rounding stays separate from quantities consumed. A swap rechecks constraints and updates the affected revision and grocery difference; completed meals retain their history.
- Check-ins: optional weight trend, hunger/energy/satiety self-reports, practical barriers and coach feedback. No single weigh-in automatically changes a target.
- Mobile/offline: save manual log drafts locally, replay once after reconnection, preserve corrections and expose sync conflicts. Photos are not silently retained or uploaded with a text entry.

## 4. Data and calculation rules

Use normalized tables for foods, quantities, recipe ingredients and log events. Versioned coach plans/reviews may use the existing records mechanism behind typed services. Do not put unrestricted nutrition payloads into generic coaching messages.

| Entity | Required properties |
| --- | --- |
| Nutrition profile versions | Tenant/user, reported constraints/preferences, source, captured time, consent references, unknown/declined states |
| Coach nutrition knowledge versions | Diet methodology, target-setting authority, scope, confirmed rules, labelled cases and rejected options/reasons, source IDs, gap coverage, rights, autonomy policy, review state and release digest |
| Food versions | Provider/manual origin, external reference, nutrient units/basis, preparation state, portion definition, provenance, allowed uses, quality/coverage |
| Recipe versions and ingredients | Exact food-version references, quantities, cooked/raw basis, declared yield, serving size and aggregate coverage |
| Target/plan revisions | Domain Brain release, Client Twin snapshot, author/origin, automatic-policy decision or human review reference, targets/habits/meals, constraints, effective dates and change reason |
| Weekly delivery and grocery revisions | Seven dated daily views pinned to one validated delivered plan, recipe/cooking-variant references, scaled portions, calorie provenance, batch/leftover allocation, derived shopping quantities and change diff |
| Food/habit log events | Stable event ID, tenant/user, local date/timezone and UTC time, food-version/portion snapshot, correction link, coverage and sync status |
| Nutrition check-ins | Explicit self-reports, reporting window, permission scope and review status |
| Nutrition decisions | Structured action, matched rules/cases and food evidence IDs, scope/safety/calculation results, consent/policy versions and automatic-delivery or exception state |
| Media references | Private storage key, owner, purpose, retention and optional image-analysis permission; separate from text logs |

Calculate nutrient totals in ordinary code using decimal quantities and explicit units. Never ask an LLM to be the arithmetic engine. Missing nutrient values remain unknown, not zero. Preserve source energy values and rounding metadata rather than silently forcing them to equal a macro-derived estimate.

Raw versus cooked food, edible weight, grams versus servings and recipe yield must be explicit. A cup cannot be converted to grams without an applicable portion definition. Preserve the consumed food/recipe version so later catalogue changes do not rewrite historical totals. Show recorded totals as partial unless the user and source coverage support a complete-day comparison.

Reuse tenant RLS, server-resolved identity, audit events and optimistic concurrency. Offline retries produce one logical entry; a changed payload with an existing event key is rejected. Corrections retain history and recompute totals without double counting. Apply configured retention and privacy deletion to logs, photos and derived snapshots.

## 5. Brain and Client Twin integration

Add a `training | nutrition` domain to sources, rules, evaluations, releases and decisions. Shared safety rules remain above both. Evaluate and release each domain independently: a strong training evaluation cannot qualify the nutrition Brain. A nutrition rollback must not unexpectedly roll back training.

Extend structured decisions with nutrition target proposals, meal-plan proposals, substitutions, habit feedback and escalations. Generations use confirmed coach sources, permitted client context and identified food/recipe facts. Do not invent nutrient values, ingredient safety or missing meals.

Extend the Client Twin with permitted nutrition facts, validated plan/target versions, log coverage and descriptive trends. Retain the source/time/window and calculation version. Keep partial records and permission-denied states visible. Training and nutrition summaries can share context only where rights and consent allow it; the existing wearable-to-model restriction remains in force. Do not automatically “eat back” exercise calories or compensate for meals through exercise.

Nutrition uses scope-bound automatic delivery after the coach qualifies its release, with human review for exceptions rather than every output. Store the structured decision and recheck the current profile, constraints, Brain release, entitlement and consent immediately before delivery. A material profile or policy change invalidates affected pending generations and causes a current-plan compatibility check. Food facts and calculations remain independent of model assertions. The existing training runtime remains supervised until separately changed and verified; planning nutrition autonomy does not change it.

## 6. Scope, safety and privacy controls

These are proposed product controls, not a clinical protocol or a statement of UAE licensing law. Thresholds, professional permissions and escalation wording require qualified review before launch.

- Run policy checks outside the model. Prompt text and coach tone cannot override them.
- Known allergy conflicts stop affected meal suggestions/substitutions. Incomplete ingredient/allergen metadata is uncertainty; absence of a listed allergen does not certify a food as safe.
- Explicit clinical-management requests, disclosed high-risk circumstances and unsafe restriction/purging requests enter a suitable human/specialist review path. Do not diagnose an eating disorder from a diary or photo.
- Avoid punitive restriction, compensatory exercise, aggressive automatic target changes or body-shaming feedback. No supplement/drug dosing or disease-treatment recommendations in the initial release.
- Use separate nutrition-processing/coaching and separately opt-in photo-analysis permissions. Offering the feature is required; using photos remains the subscriber's choice. Existing training consent is not silently expanded. Revoking nutrition permission must not automatically revoke unrelated training permission.
- Scope coach/staff access; financial and growth staff do not receive food diaries or health details. Analytics events contain identifiers/statuses, not meal content, allergy details or photos.
- Extend export, local erasure, derived-data invalidation, provider deletion requests and backup handling. Clearly retain the existing distinction between local deletion and verified provider/backup deletion.

## 7. Meal photos and barcode scanning — required scope

The owner confirmed both features on 25 September 2026. Include them in workout + nutrition alongside the existing coach-guided plans and diary. Meal photos are a committed delivery priority, not a later optional add-on. Coach-authored foods/recipes and manual logging remain available during provider outages and for users who choose not to use the camera.

### Meal-photo flow

1. The subscriber takes a photo or selects one from the device after giving separate photo-analysis permission. Show the image and allow replacement/removal before analysis. Do not silently upload a camera preview or unrelated image.
2. AI proposes visible foods, likely ingredients and approximate portions. Ask the subscriber about material unknowns such as quantities, oils, sauces and preparation; allow adding/removing foods and editing amounts. Use licensed food facts where available and calculate totals in ordinary code. Preserve the source and uncertainty of model-only estimates; missing nutrients stay unknown.
3. Show an editable draft with estimated calories and available nutrients. A photo cannot certify exact calories, hidden ingredients or allergen safety. The subscriber explicitly confirms before anything enters the diary; no automatic saved entry or routine coach approval.
4. Save the confirmed items, quantities, provenance, draft/correction lineage and nutrient coverage as one idempotent diary event. Corrections update the descriptive daily summary and nutrition Twin without double counting. Recording what someone ate does not imply the coach recommends it; any coaching response or plan adjustment still obeys the released policy.

### Barcode flow

1. Scan a supported packaged-food barcode with the camera or enter its digits. Normalize and validate the code before lookup; allow correction when scanning fails.
2. Retrieve the identified product from a permitted food-data source. Show product/brand, source, available ingredients/allergens, per-100g or serving basis and declared preparation state. The subscriber verifies the exact product and selects the amount consumed; package size is not assumed to be the amount eaten.
3. Recalculate using the confirmed quantity and save an idempotent diary event with the food-version/source snapshot. Regional variants and user corrections remain traceable; a barcode alone does not prove current ingredients or suitability for a user's restrictions.
4. For no match, incomplete/conflicting facts, camera denial or provider failure, show the actual state and offer manual entry. Never invent a product match or fill unknown nutrients with zero.

### Shared delivery requirements

- Use replaceable food-lookup and vision adapters. Select providers against UAE/regional coverage, portion/nutrient quality, languages, caching/redistribution and AI-use rights, privacy, rate limits, cost and observed account behavior. No provider has been chosen; no service or model choice is implied by locking the feature. Follow the owner's economical-research preference and do not use Astra for browsing.
- Keep images private and scoped to tenant/subscriber. Bound and validate uploads, remove unnecessary metadata, use time-limited authorized access, document image retention and support permission revocation, cancellation and deletion. Images and derived analyses join the existing export/erasure lifecycle; subscriber photos cannot enter coach training data without separate permission.
- Reuse usage reservation, measured provider costs, per-tenant limits and stable intent IDs. A retry cannot create duplicate diary entries or silently repeat a paid analysis with an unknown outcome. Camera capture, analysis, confirmation and logging have distinct states; unavailable analysis cannot masquerade as successful recognition.
- Respect entitlement and consent again before processing and confirmation. Do not silently cache photos with text diaries; local photo drafts require explicit user choice and must expose their retention/sync state. Existing manual and offline text logging remain usable.
- Preserve coach autonomy boundaries: confirmed nutrition entries may inform permitted descriptive trends and policy-bound actions. A single photo or scan never gives the model authority to change calorie targets or compensate with exercise.

| Work slice | Required acceptance |
| --- | --- |
| 043a — meal photos | Capture/upload, permission, editable estimates, missing-ingredient/portion clarification, explicit subscriber confirmation, one diary event, corrections, private media lifecycle and recorded analysis cost |
| 043b — food barcodes | Camera/manual code, real sourced product lookup, quantity/basis validation, user confirmation, versioned diary entry, no-match/outage/camera-denied fallbacks |
| 043c — shared integration | Entitlement/consent races, cross-tenant isolation, cancellation, retry/deduplication, partial nutrients, export/deletion, daily totals/Twin and unchanged workout-only access |
| 044 extension — verification | Both complete mobile journeys, uncertain/photo and missing-barcode cases, provider failure, changed consent and duplicate confirmation; separate fixture evidence from live-provider qualification |

## 8. Commerce and migration

Keep **Stripe → company bank → Lean → verified trainer destination**. Nutrition does not require a second payment stack.

Use versioned product module sets: `['training']` for workout only and `['training', 'nutrition']` for the higher-priced combined tier. A standalone `['nutrition']` offer is outside the current scope. Prefer one active package per subscriber/workspace, compatible with the existing subscription uniqueness constraint. A combined package is one paying subscriber for commission-band purposes; do not count its modules as separate people. Existing products initially retain training-only entitlements. Existing users are not opted into nutrition or automatically repriced.

A trainer can offer the combined tier after nutrition readiness and the existing launch gates pass. It must cost more than the comparable workout-only tier for the same billing period and currency; the actual uplift is not yet set. Upgrade/proration and partial-bundle refund policy require explicit decisions before activating those transitions. Preserve signed-event-driven access, paid-period cancellation and historical read/export access. Do not promise a live price or payout amount from this plan.

Separate AI text/image and food-data costs by task/provider/tenant. Reuse durable reservation, unknown-cost handling, reviewed usage statements and reconciliation; extend provider billable-unit contracts where token counts alone are insufficient. Deduplicate imports and cache permitted catalogue lookups before adding model calls. Set provider budgets once actual prices are verified.

Implementation choice: existing generic Brain kinds remain the training domain. Separate nutrition case/policy/evaluation/release kinds and a unique published-nutrition-release index isolate this domain without rewriting historical training digests. Add typed migrations and flags with nutrition disabled by default. Training-only regression coverage is a release requirement.

## 9. Screens and interfaces

| Audience | Proposed routes / changes |
| --- | --- |
| Public/onboarding | Explain the two tiers; conditional nutrition teaching, examples, practical rules, gap review, sample-week preview and independent nutrition readiness |
| Coach | `/trainer/nutrition`, `/trainer/nutrition/foods`, `/trainer/nutrition/recipes`, `/trainer/nutrition/plans`, `/trainer/nutrition/exceptions`; nutrition cases/coverage/autonomy/release tabs and client-detail timeline |
| Subscriber | `/app/nutrition`, `/app/nutrition/intake`, `/app/nutrition/log`, `/app/nutrition/plan`, `/app/nutrition/groceries`, `/app/nutrition/check-in`; recipe/cooking views, meal-photo capture/confirmation, barcode lookup/confirmation, permissions and tracking-display settings |
| Operations | Extend safety, support, scope/credential review and FinOps views with appropriate access boundaries |

API services: coach nutrition setup/cases/knowledge/gaps/readiness; nutrition profiles/consents; foods/recipes/cooking variants; weekly plan revisions/assignments and derived groceries; idempotent log events/corrections; check-ins; policy-validated decisions/delivery, exceptions/corrections and release approvals; and catalogue/media adapters. Derive tenant and subscriber scope server-side for every operation. Version and audit all externally meaningful changes.

## 10. Implementation sequence and acceptance

These ten work packages extend the original 001–034 baseline. The table retains the acceptance contract; implementation evidence and remaining provider limits are tracked in [build status](BUILD_STATUS.md). Core 035–042 is implemented and 044 engineering verification has passed; live-model and production qualification remain open. The owner has now made 043 required scope; it is not implemented, and the expanded 044 checks remain pending. IDs are internal work IDs, not existing GitHub issues.

| ID | Deliverable | Depends on | Acceptance |
| --- | --- | --- | --- |
| 035 | Two-tier entitlements, conditional coach nutrition setup and legacy backfill | Existing auth/commerce | Workout-only path remains usable; combined activation requires independent nutrition readiness; persisted dynamic steps resume; no duplicate subscriber counting or unintended access |
| 036 | Nutrition profile, scoped permissions and export/erasure contracts | 035 | Missing/none/declined distinct; revocation does not expose nutrition or disable unrelated training |
| 037 | Versioned manual food/recipe catalogue, cooking variants and nutrient calculations | 036 | Raw/cooked, serving/yield and partial-nutrient fixtures reconcile exactly; history survives catalogue edits |
| 038 | Coach diet/targets, weekly plan editor, daily delivery and groceries | 035–037, initial 042 | Validated week includes recipes/portions/cooking/calorie estimates; swaps and batches reconcile groceries; manual foundation supports the 040 automatic-delivery path |
| 039 | Subscriber diary, habit logging, corrections and offline queue | 036–038 | Disconnect/reload/replay works once; edits preserve history; partial days are not treated as complete |
| 040 | Case-based nutrition teaching, gap detection, compilation, sample week, evaluations, autonomy policy and exception handling | 035, 037–038, initial 042; 041 for progress-based changes | Covered cases deliver automatically without coach sign-off per output; unseen/invalid cases route correctly; held-out checks and setup preview pass; no invented facts or fixture-only production readiness; changes invalidate dependent approval; domain rollback isolated |
| 041 | Nutrition Twin, check-ins and policy-bound adjustment loop | 036–039, 040 for automation | Trends preserve coverage/source/rights; automatic changes obey explicit triggers/ranges/cadence; exceptions reach the coach |
| 042 | Reviewed scope/safety policy, role controls and escalation fixtures | Start alongside 036; qualified input for launch | Ingredient conflict, unsafe request, permission race and out-of-scope cases cannot bypass review |
| 043 | Required meal-photo logging and packaged-food barcode lookup with subscriber confirmation | 037, 039, 042; provider/storage access for activation | Complete 043a–c flows in section 7; private media, sourced facts, user corrections, one diary effect, manual fallbacks and real cost evidence |
| 044 | Complete journey, regression, privacy/finance and release evidence | 035–043 | Existing core evidence retained; photo and barcode journeys must also pass before expanded nutrition scope is complete; prior training journeys and each provider have evidence |

Delivery order:

1. **Design/contracts:** 035–036 and the initial 042 policy/scope work. Define two-tier entitlements, the conditional teaching branch, data model and readiness evidence.
2. **Working manual foundation:** 037–038. Coach enters diet/targets and recipes; a test subscriber receives a consistent week with daily meals and groceries. This is an internal milestone; the owner-requested AI experience is not complete at this point.
3. **Core automatic nutrition:** 040 plus expanded 042 evaluations. Finish adaptive case teaching, scope/authority rules and evidence gates; automatically deliver validated weeks from the confirmed diet, client inputs, deterministic totals and a pinned nutrition release. Only exceptions require human input. This is required for the planned combined-tier launch.
4. **Feedback and required capture:** 039 and 041 add logging/check-ins and policy-bound adaptation. Implement 043 meal photos and barcode scanning as committed scope, with manual fallbacks and provider/storage capability checks before activation.
5. **Release:** 044, existing deployment/provider gates and qualified nutrition review. A roadmap table is not evidence of a completed feature.

Required journeys include workout-only setup, an existing coach adding the combined tier without repeating training setup, insufficient or conflicting case evidence, onboarding save/resume, automatic in-scope week delivery without coach clicks, correct generalization to held-out cases, unsupported-case escalation, linked daily views/recipes/cooking/groceries, in-policy versus out-of-policy adjustments, stale preview invalidation, calorie/quantity gaps, an allergy-conflicting swap, batch cooking without duplicate shopping quantities, concurrent plan edits, offline corrections across timezones, revoked consent during generation, cancelled membership, tenant isolation, retained financial records after erasure, and food/model-provider failure. Track routine delivery, exception frequency/reason, coach handling time and post-delivery correction rates; lower queue volume must never bypass mandatory constraints.

## 11. Decisions and dependencies

Confirmed owner direction: two tiers, the combined tier at a higher price, coach-provided diet/calorie guidance, AI-generated practical nutrition delivery and case-based onboarding that captures what the coach would recommend. Meal-photo logging and food-barcode scanning are also confirmed required features, with explicit subscriber confirmation before diary entry. Routine outputs must not require individual coach review. Proposed engineering defaults: private versioned case/rule knowledge rather than per-coach model fine-tuning, coverage-based readiness, the example/evaluation floors above, explicit automatic-action policies with exception routing. Provider selection and private-media configuration for the required capture features remain open. No exact prices or legal permissions are assumed.

Inputs still needed before their affected release steps: representative coach diet material and review of generated examples; reviewed coaching/clinical boundary and safety policy; food-source licensing/coverage; private-media storage/residency; the price uplift and bundle-change/refund policy; configured model evaluation; and suitable pilot coaches for workout-only and combined journeys. Existing infrastructure and payment blockers remain as documented. These dependencies do not prevent schemas, manual workflows, deterministic calculations and synthetic acceptance fixtures from being built; synthetic fixtures do not establish real coach fidelity.
