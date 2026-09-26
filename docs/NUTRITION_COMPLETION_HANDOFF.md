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
