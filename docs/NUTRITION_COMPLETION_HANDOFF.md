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
