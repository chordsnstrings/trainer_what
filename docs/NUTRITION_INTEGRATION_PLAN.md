# Nutrition integration proposal

Date: 25 September 2026. Status: **PROPOSED — NOT IMPLEMENTED**. The owner requested a current update and a nutrition integration plan. This document adds scope to the original specification; it does not approve clinical practice, select providers, change prices or enable live services.

## 1. Current baseline and the gap

The latest implementation is `e6a539e`; `2f0b33b` records its verification. The development platform has accounts/MFA, 16-step trainer setup, Brain teaching and supervised releases, Client Twin snapshots, programs/offline workouts, messaging, bookings, support, privacy controls and governed finance workflows. The recorded CI result is 37 tests on each of PGlite and PostgreSQL, production web/container checks and 22 browser routes. See [verification](VERIFICATION_2026-09-24.md).

Production deployment and real Stripe/Lean/model/email verification remain open. Broader engineering gaps remain in [build status](BUILD_STATUS.md). Nutrition intake, food/recipe data, nutrient targets, meal plans and food logging are absent. The original source only explicitly excludes clinical nutrition prescribing outside trainer scope; it does not define a complete nutrition product.

## 2. Product shape

Make **training-only, nutrition-only and combined coaching** first-class options within the existing platform. Reuse identity, tenant isolation, Brain governance, Client Twin, messaging, review queues, commerce and support. Nutrition coaches must be able to finish onboarding and serve subscribers without creating a workout program.

Separate three concepts:

| Concept | Controls |
| --- | --- |
| Workspace capabilities | Which coaching modules the coach offers; recorded scope and credentials where relevant |
| Product entitlements | Which modules a particular subscriber has purchased |
| Individual permissions | Which nutrition information may be stored, used for coaching or sent for optional image analysis |

Enabling a workspace module neither charges a subscriber nor grants access to every product. A claimed qualification does not become a verified professional credential automatically.

The proposed initial audience is adults, consistent with the existing intake. Start with general nutrition coaching, habits and coach-authored plans within a reviewed scope. Clinical dietary management is a separately scoped future capability requiring appropriate professional and jurisdiction review. No clinical permission or nutrient prescription is established by this plan.

## 3. End-to-end experience

**Coach:** choose modules → describe nutrition approach → add permitted sources and recipes → confirm nutrition rules → create a habits-based or targets-based offer → review subscriber intake → assign a versioned plan → review check-ins and propose adjustments.

**Subscriber:** buy the appropriate package → complete nutrition intake and permissions → see an approved plan → log meals/portions or habits → review descriptive progress → check in with the coach → receive approved changes with reasons.

**Operations:** manage provider readiness and professional-scope evidence, investigate safety exceptions, reconcile usage costs, and process privacy requests with the existing audit trail.

### Coach workspace

- Nutrition interview: coaching philosophy, use of habits versus tracking, meal structure, recipe selection, preferences, flexibility, review cadence and escalation boundaries. Do not assume every coach prescribes macros.
- Nutrition source upload/review using the existing document pipeline. Tag sources and rules by domain; keep consent, ownership and allowed-use metadata.
- Food and recipe library, reusable meal templates, ingredient quantities, serving/yield definitions and substitutions.
- Versioned targets: optional energy and macronutrient targets, habit goals and hydration goals. Values initially come from the coach; any later estimation method needs a reviewed, versioned policy.
- Plan editor supporting meal-based, target-based, habit-based and mixed plans. Draft, review, assign, amend and archive; changes have an author, reason and effective date.
- Review queue: incomplete intake, ingredient/allergen conflicts, low data coverage, requested changes and safety concerns. Missing logs are not automatically treated as non-adherence.

### Subscriber experience

- Intake: goals, food preferences/exclusions, explicitly reported allergies/intolerances, usual meal pattern, cooking facilities, budget/time, and optional cultural or fasting preferences. Distinguish “not supplied,” “none reported” and “declined.” Do not infer beliefs from location or food choices.
- Nutrition home: approved plan, today's optional targets/habits, recent feedback and a quick-add action. Offer a habits-only view without calorie tracking.
- Food diary: foods, portions, manual dishes, copy a previous meal, favorites, notes, correction and deletion. Label incomplete days and partial nutrient coverage.
- Meal plan: ingredient details, portion basis, swaps, recipes and a derived shopping list. A swap must recheck the current constraints and totals.
- Check-ins: optional weight trend, hunger/energy/satiety self-reports, practical barriers and coach feedback. No single weigh-in automatically changes a target.
- Mobile/offline: save manual log drafts locally, replay once after reconnection, preserve corrections and expose sync conflicts. Photos are not silently retained or uploaded with a text entry.

## 4. Data and calculation rules

Use normalized tables for foods, quantities, recipe ingredients and log events. Versioned coach plans/reviews may use the existing records mechanism behind typed services. Do not put unrestricted nutrition payloads into generic coaching messages.

| Entity | Required properties |
| --- | --- |
| Nutrition profile versions | Tenant/user, reported constraints/preferences, source, captured time, consent references, unknown/declined states |
| Food versions | Provider/manual origin, external reference, nutrient units/basis, preparation state, portion definition, provenance, allowed uses, quality/coverage |
| Recipe versions and ingredients | Exact food-version references, quantities, cooked/raw basis, declared yield, serving size and aggregate coverage |
| Target/plan revisions | Domain Brain release, Client Twin snapshot, author/reviewer, targets/habits/meals, constraints, effective dates and change reason |
| Food/habit log events | Stable event ID, tenant/user, local date/timezone and UTC time, food-version/portion snapshot, correction link, coverage and sync status |
| Nutrition check-ins | Explicit self-reports, reporting window, permission scope and review status |
| Nutrition decisions | Structured proposed action, evidence IDs, scope/safety result, consent/policy versions and approval state |
| Media references | Private storage key, owner, purpose, retention and optional image-analysis permission; separate from text logs |

Calculate nutrient totals in ordinary code using decimal quantities and explicit units. Never ask an LLM to be the arithmetic engine. Missing nutrient values remain unknown, not zero. Preserve source energy values and rounding metadata rather than silently forcing them to equal a macro-derived estimate.

Raw versus cooked food, edible weight, grams versus servings and recipe yield must be explicit. A cup cannot be converted to grams without an applicable portion definition. Preserve the consumed food/recipe version so later catalogue changes do not rewrite historical totals. Show recorded totals as partial unless the user and source coverage support a complete-day comparison.

Reuse tenant RLS, server-resolved identity, audit events and optimistic concurrency. Offline retries produce one logical entry; a changed payload with an existing event key is rejected. Corrections retain history and recompute totals without double counting. Apply configured retention and privacy deletion to logs, photos and derived snapshots.

## 5. Brain and Client Twin integration

Add a `training | nutrition` domain to sources, rules, evaluations, releases and decisions. Shared safety rules remain above both. Evaluate and release each domain independently: a strong training evaluation cannot qualify the nutrition Brain. A nutrition rollback must not unexpectedly roll back training.

Extend structured decisions with nutrition target proposals, meal-plan proposals, substitutions, habit feedback and escalations. Generations use confirmed coach sources, permitted client context and identified food/recipe facts. Do not invent nutrient values, ingredient safety or missing meals.

Extend the Client Twin with permitted nutrition facts, approved plan/target versions, log coverage and descriptive trends. Retain the source/time/window and calculation version. Keep partial records and permission-denied states visible. Training and nutrition summaries can share context only where rights and consent allow it; the existing wearable-to-model restriction remains in force. Do not automatically “eat back” exercise calories or compensate for meals through exercise.

The initial automation mode remains supervised. A proposed change is stored before copy is delivered, and approval rechecks the current profile, constraints, Brain release, entitlement and consent. A material profile change invalidates affected pending proposals.

## 6. Scope, safety and privacy controls

These are proposed product controls, not a clinical protocol or a statement of UAE licensing law. Thresholds, professional permissions and escalation wording require qualified review before launch.

- Run policy checks outside the model. Prompt text and coach tone cannot override them.
- Known allergy conflicts stop affected meal suggestions/substitutions. Incomplete ingredient/allergen metadata is uncertainty; absence of a listed allergen does not certify a food as safe.
- Explicit clinical-management requests, disclosed high-risk circumstances and unsafe restriction/purging requests enter a suitable human/specialist review path. Do not diagnose an eating disorder from a diary or photo.
- Avoid punitive restriction, compensatory exercise, aggressive automatic target changes or body-shaming feedback. No supplement/drug dosing or disease-treatment recommendations in the initial release.
- Use separate nutrition-processing/coaching and optional photo-analysis permissions. Existing training consent is not silently expanded. Revoking nutrition permission must not automatically revoke unrelated training permission.
- Scope coach/staff access; financial and growth staff do not receive food diaries or health details. Analytics events contain identifiers/statuses, not meal content, allergy details or photos.
- Extend export, local erasure, derived-data invalidation, provider deletion requests and backup handling. Clearly retain the existing distinction between local deletion and verified provider/backup deletion.

## 7. Food data and media integrations

The first useful slice works with coach-authored foods/recipes and subscriber manual entries with visible provenance. No fabricated catalogue or provider result is needed.

Choose a food-data provider only after checking nutrient/portion quality, regional and branded-food coverage, recipe support, languages, caching/redistribution rights, permitted AI use, privacy, rate limits, cost and outage handling against current primary documentation and the actual account. No provider has been selected or verified in this proposal. Follow the owner's economical-research preference; do not use Astra for browsing.

Then add search/import, barcode lookup and label parsing behind replaceable adapters. A barcode is a lookup key, not proof of current ingredients or portion size. Regional variants and user corrections need source/version tracking.

Optional meal-photo assistance comes later, after private storage, permission, quality and cost checks. Return a draft food/portion interpretation for confirmation; never present photograph-derived calories, hidden ingredients or allergens as exact. A model outage must leave manual logging and coach-authored plans usable.

## 8. Commerce and migration

Keep **Stripe → company bank → Lean → verified trainer destination**. Nutrition does not require a second payment stack.

Add versioned product module sets: `training`, `nutrition`, or both. Prefer one active package per subscriber/workspace, compatible with the existing subscription uniqueness constraint. A combined package is one paying subscriber for commission-band purposes; do not count its modules as separate people. Existing products initially retain training-only entitlements. Existing users are not opted into nutrition or automatically repriced.

A trainer can offer separate nutrition and combined packages. Pricing, upgrade/proration and partial-bundle refund policy require explicit decisions before activating those transitions. Preserve signed-event-driven access, paid-period cancellation and historical read/export access. Do not promise a live price or payout amount from this plan.

Separate AI text/image and food-data costs by task/provider/tenant. Reuse durable reservation, unknown-cost handling, reviewed usage statements and reconciliation; extend provider billable-unit contracts where token counts alone are insufficient. Deduplicate imports and cache permitted catalogue lookups before adding model calls. Set provider budgets once actual prices are verified.

Backfill old Brain records as training; change the single-published-release invariant to one per tenant/domain. Update all release/decision queries explicitly. Add typed migrations and flags with nutrition disabled by default. Training-only regression coverage is a release requirement.

## 9. Screens and interfaces

| Audience | Proposed routes / changes |
| --- | --- |
| Public/onboarding | Explain nutrition and combined offers; choose coaching modules; branch interview/intake/readiness without requiring workouts for nutrition-only coaches |
| Coach | `/trainer/nutrition`, `/trainer/nutrition/foods`, `/trainer/nutrition/recipes`, `/trainer/nutrition/plans`, `/trainer/nutrition/reviews`; nutrition Brain tabs and client-detail timeline |
| Subscriber | `/app/nutrition`, `/app/nutrition/intake`, `/app/nutrition/log`, `/app/nutrition/plan`, `/app/nutrition/check-in`; optional shopping list, permissions and tracking-display settings |
| Operations | Extend safety, support, scope/credential review and FinOps views with appropriate access boundaries |

API services: nutrition profiles/consents; foods/recipes; plan revisions/assignments; idempotent log events/corrections; check-ins; proposed decisions/approvals; and catalogue/media adapters. Derive tenant and subscriber scope server-side for every operation. Version and audit all externally meaningful changes.

## 10. Implementation sequence and acceptance

These ten proposed work packages extend the original 001–034 baseline. All start **PLANNED / NOT IMPLEMENTED**; issue numbers below are internal work IDs, not existing GitHub issues.

| ID | Deliverable | Depends on | Acceptance |
| --- | --- | --- | --- |
| 035 | Coaching modes, product modules, conditional onboarding and legacy backfill | Existing auth/commerce | Training-only, nutrition-only and combined paths work; no duplicate subscriber counting or unintended access |
| 036 | Nutrition profile, scoped permissions and export/erasure contracts | 035 | Missing/none/declined distinct; revocation does not expose nutrition or disable unrelated training |
| 037 | Versioned manual food/recipe catalogue and nutrient calculations | 036 | Raw/cooked, serving/yield and partial-nutrient fixtures reconcile exactly; history survives catalogue edits |
| 038 | Coach targets, habits and meal-plan editor/assignment | 035–037, initial 042 | Approved version reaches the correct subscriber; conflict or stale review blocks assignment |
| 039 | Subscriber diary, habit logging, corrections and offline queue | 036–038 | Disconnect/reload/replay works once; edits preserve history; partial days are not treated as complete |
| 040 | Nutrition Brain interview, compilation, evaluations and reviewed decisions | 038, 041–042 | Independent held-out coverage; no invented nutrients; generation remains supervised; domain rollback isolated |
| 041 | Nutrition Twin, check-ins and coach review loop | 036–039 | Trends preserve coverage/source/rights; no automatic target change from one measurement |
| 042 | Reviewed scope/safety policy, role controls and escalation fixtures | Start alongside 036; qualified input for launch | Ingredient conflict, unsafe request, permission race and out-of-scope cases cannot bypass review |
| 043 | Approved food lookup/barcodes, then optional photo assistance | 037, 039, 042; provider/storage access | Account contract, rights, outage/manual fallback, image confirmation and real cost evidence |
| 044 | Complete journey, regression, privacy/finance and release evidence | 035–042; 043 only if enabled | End-to-end trace; prior training journeys pass; each enabled integration has evidence |

Delivery order:

1. **Design/contracts:** 035–036 and the initial 042 policy/scope work. Define the module boundary, data model and reviewed inputs.
2. **Useful manual release:** 037–039 and 041. Nutrition-only coach assigns an approved plan; subscriber logs, checks in and receives a reviewed revision. No external food/model API dependency for this slice.
3. **Supervised intelligence:** 040 plus expanded 042 evaluations. AI drafts cite approved sources, deterministic totals and a pinned nutrition release.
4. **Convenience integrations:** 043 after capability/rights/cost verification. Preserve manual operation when unavailable.
5. **Release:** 044, existing deployment/provider gates and qualified nutrition review. A roadmap table is not evidence of a completed feature.

Required journeys include a nutrition-only coach, a combined package, habits-only coaching, a manual recipe with incomplete nutrient data, an allergy-conflicting swap, concurrent plan edits, offline corrections across timezones, revoked consent during generation, cancelled membership, tenant isolation, retained financial records after erasure, and food/model-provider failure.

## 11. Decisions and dependencies

Recommended planning defaults are nutrition as an optional first-class module, a manual coach-led release first, supervised AI second, and photo/barcode conveniences later. They remain proposals until accepted; no prices or legal permissions are assumed.

Inputs still needed before their affected release steps: reviewed coaching/clinical boundary and safety policy; food-source licensing/coverage; private-media storage/residency; pricing and bundle-change/refund policy; and suitable pilot coaches for nutrition-only and combined journeys. Existing infrastructure and payment blockers remain as documented. These dependencies do not prevent schemas, manual workflows, deterministic calculations and synthetic acceptance fixtures from being built.
