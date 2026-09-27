# Nutrition completion stages — 26 September 2026

## Stage 1: current facts and blocked-week recovery

- New generation catalogs exclude superseded and explicitly archived foods/recipes. Recipes using retired ingredient facts are withheld until replaced. Catalog history remains available, and delivered plans keep their fact snapshots.
- Coach Catalog versions view provides ingredient/recipe replacement forms and reasoned archive/restore controls. Concurrent replacement of an already superseded version conflicts.
- Weekly generation records `not_sent` before provider dispatch, `uncertain` immediately before the request, and `responded` after recorded response evidence. Stable requests cannot be retried under another key while an uncertain request is outstanding. The scheduler also holds subsequent jobs in that situation.
- Week recovery view handles retry of unsent jobs, provider-confirmed not-processed retries, explicit processed closure, and closure preserving an uncertainty hold. All actions check job attempt/revision, lease, owner and recent MFA (production), retain reason/provider trace and emit an audit event. An obsolete profile/week cannot be replayed.
- Provider evidence is manually supplied by the authorized coach; this is not a claim of a verified provider reconciliation adapter.

Integration: `nutritionRoutes()` registers `nutritionCompletionRoutes()` itself. No app.ts or worker hook required. NutritionCoach has `versions` and `recovery` sections. Migration `014_nutrition_completion.sql` adds indexes only; no new table grants.

Stage 1 files: `apps/api/src/nutrition.ts`, `nutrition-schedule.ts`, `nutrition-completion.ts`; `apps/web/components/nutrition.tsx`; migration 014; `tests/nutrition-completion.test.ts`.

Checks: original 14 nutrition tests passed during implementation; two new focused tests cover catalog supersession/archive/isolation and unsent-versus-uncertain recovery/audit/CAS. Final stage check result will be reported to coordinator.

Next: individual targets/methods/habits and coach plan intervention, then tracker/capture/groceries and stronger adaptive teaching.

## Stage 2: individual nutrition and coach intervention

- Coach Methods view records explicit fixed or body-weight/activity calculations tied to confirmed teaching cases; no default clinical method is invented. An individual target records the actual calculation inputs or coach override, reason, macro goals/tolerance, hydration/habits, review date and whether policy-bounded automatic adjustments are permitted.
- Targets are immutable and bound to the client's intake version; revision conflicts, changed case evidence, policy limits, expired review dates and missing inputs stop unsafe reuse. Generation includes these targets and rechecks the target at delivery. Macro limits also apply to automatic swaps.
- Client nutrition page now has target controls and a seven-day recipe/cooking/portion editor. Assign, amend and archive preserve historical plans and record reasons. Full weekly ingredient/allergen/scope/calorie/macro validation still applies to coach delivery; human action does not bypass it.
- Existing combined-tier checks and weekly scheduling now use finance `currentPaidSubscription()` so signed persisted payment-grace rules are consistent.

Integration: all routes remain registered by nutritionRoutes; target and meal-editor controls are embedded in NutritionSubscriber's existing coach view. New NutritionCoach sections `methods` and `clients`. New migration `024_nutrition_personalization.sql` adds immutable decision protection and active-target uniqueness; no table grants. Privacy record kinds: `nutrition_target`, `nutrition_plan_edit`, `nutrition_recovery` (already present in privacy agent's current list).

Checks: full TypeScript passed; 27 focused tests passed (four nutrition completion, fourteen baseline nutrition, nine meal-capture). No external provider, deployment or screenshot used.

## Stage 3: nutrition tracking, capture and shopping

- Consumed calories/macros and plan comparison show seven days plus a 28-day history and recorded weight trends. Missing entries/unknown values stay unknown. Corrections replace earlier entries in totals, with source IDs and bounded-input disclosure. Routine week generation now receives this consented intake context.
- Diary forms support macro and per-food portion corrections. Favorites and explicitly confirmed copying produce immutable new diary entries with stable event-key deduplication; deleted/superseded sources cannot be copied.
- Meal-photo amount edits scale known nutrients within the same unit. Unknown bases or unit changes clear values requiring review. Clients can match measured gram portions to current coach food facts; server-side lookup preserves the original vision estimate and actual fact snapshot. Separate photo-permission withdrawal is exposed in capture UI.
- Coach Grocery conversions view records explicit purchase-weight ratios, pack sizes and source evidence. Client available portions/leftovers retain prepared-state identity, use-by date and storage confirmation. Only portions usable by a planned meal date reduce purchasing. Packs round upward, and CSV includes purchase/available quantities. Inventory never changes meal quantities or counts as eaten.
- Nutrition/profile/model/photo permissions now stamp the published legal bundle using root legalAcceptanceVersion outside tenant transactions. Locked write/delivery paths recheck subscriber membership to prevent in-flight work recreating erased client data.

New personal record kinds: nutrition_favorite, nutrition_leftover. Coach-only nonpersonal kind: nutrition_purchase_spec. No new migration/table grants for this stage.

Checks: 30/30 focused tests passed after root fixed brand-media policy privileges (seven completion, fourteen nutrition, nine capture); full TypeScript passed earlier in this stage. Fixtures only, no live provider/device qualification, deployment or screenshots.

Next: adaptive teaching/contradiction coverage and deeper held-out recipe/portion evaluation, then remaining stage-specific review.

## Stage 4: adaptive teaching and independent qualification

- Next teaching questions use missing structured conditions, contrasting cases, confirmed-case conflicts and recurring de-identified exception codes. Coach forms capture conditions, plan/clarify/refer decisions, worked target/portion ranges and reasoning principles. Overlapping contradictory decisions block qualification and current readiness; ambiguous free-text meaning still requires coach judgement.
- Qualification version 2 requires twenty held-out cases including eight worked meal expectations spanning portions/substitutions/cooking/budget, plus four independently added scope/allergy/diet/goal boundary checks. Model output must supply a compatible recipe/option, exact portion-to-ingredient arithmetic, matching sourced nutrients, and a real quoted teaching principle. Expected recipes/portions remain hidden. Fabricated rationale and inconsistent food weights fail persisted evaluation.
- Evaluation stores structured decisions and independent safety scenarios. Release activation requires the current version and passing current evidence. Archiving or adding a held-out check pauses existing automatic qualification. Old releases need re-evaluation. Synthetic demo seeding explicitly uses qualification version 0; its pre-rendered illustrative meals do not qualify automation.
- Provider nutrition prompt identity bumped to nutrition-cases-v2. Pure schema definitions live in nutrition-learning-schema.ts to avoid cyclic initialization.
- Final recovery review connected subscriber-requested generations to durable manual recovery jobs. A dispatched timeout records uncertainty before the request, appears to the coach, and cannot repeat through a fresh key. Expired manual leases become blocked, never auto-resubmitted. Unsent retries and deliberately accepted retries of a known response are distinct; uncertain outcomes still require evidence. Both processed and not-processed obsolete outcomes can be explicitly closed.
- Provider dispatch now rechecks current membership/permission/profile under the nutrition lock; an aborted unsent reservation records zero provider usage. Late generation failures do not recreate an exception for an erased membership.

Checks: 33/33 focused tests passed (nine completion, fifteen nutrition, nine capture), including a simulated transport timeout that asserts the uncertainty tombstone exists before outbound dispatch. No live providers were used. The final small known-response retry branch has an additional focused assertion. Root handles aggregate type/build/release checks and commits.

All assigned nutrition engineering stages are now implemented. Remaining external boundaries: actual provider-output fidelity, real device camera/barcode acceptance, account contracts, clinical scope/coach qualification and deployment remain unperformed. UI reflects governed autonomy and approximate food facts; no separately trained per-coach model weights are claimed.
