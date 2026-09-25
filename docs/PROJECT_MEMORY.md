# Project memory

Updated: 25 September 2026. This is durable project context for future build sessions. It records decisions, not credentials or a claim about account capabilities.

## Owner decisions

| Topic | Current decision |
| --- | --- |
| Project | `chordsnstrings/trainer_what`; Trainer Brain Platform |
| Current request | Refine the nutrition integration plan and coach onboarding. Latest clarification: question the coach about realistic cases to capture recommendations; do not require review of every generated output. |
| Astra | Available for difficult design, implementation and review; use tokens wisely; do not use it for browsing |
| Execution | Use bounded tasks, targeted context, deterministic tooling and useful verification; avoid repeated planning/research and unnecessary confirmation |
| Collections | Existing operator Stripe account for subscriber subscriptions, refunds and disputes |
| Trainer payouts | Lean Technologies initiates monthly payouts from the company's bank account to eligible verified personal/business UAE IBANs, after reconciliation |
| Payment history | The earlier Stripe Connect payout direction is superseded by Stripe collection + Lean payout |
| Finance | One immutable ledger, marginal 25%/20%/15%/10% commission bands, transparent AI/voice charges and gross-to-net statements |
| Product | Trainer Brain Compiler + Client Twin + governed first-person Coach Runtime; trainer identity and control are central |
| Nutrition product | Two subscriber tiers: workout only and higher-priced workout + nutrition. Coach supplies diet and approximate calorie guidance; AI delivers daily meals, recipes, portions, cooking options and consolidated weekly groceries. No nutrition-only subscriber tier in current scope. Not implemented. |
| Nutrition teaching and autonomy | Case-based onboarding captures what the coach recommends, why, alternatives, conditions and limits. Routine in-scope plans/changes should run automatically; human attention goes to exceptions, not every output. Planned mechanism: private versioned cases/rules with independent held-out evaluation and explicit action policies; no per-coach model-weight training is claimed. |
| Market/design | UAE, AED, English first with Arabic-ready layout; restrained Swedish-minimal design |
| Infrastructure | DigitalOcean is the source-spec preference; region, residency, configuration and spend are gated before production |
| Credentials | Operator expects to supply API access during implementation; availability and permissions must be verified without retaining values here |

## Current state

- Implemented code checkpoint: `e6a539e50146049f2b30da08149a8bb79ac106c9` on `main`. Next.js web, Fastify API, PostgreSQL/PGlite, worker, nine migrations; trainer onboarding, Brain/coaching/subscriber, privacy and finance workflows. This is a runnable development implementation, not the completed 34-package product.
- Verified in [CI run 36030720270](https://github.com/chordsnstrings/trainer_what/actions/runs/36030720270): TypeScript, 37 tests with PGlite and again with PostgreSQL 17.6/non-owner runtime role, production web/container build, API readiness and 22 browser routes. Offline workout reload/replay/completion, 16-step onboarding identity save/resume and Client Twin display passed. Mobile onboarding/Twin and desktop/mobile trainer screenshots were visually reviewed. Evidence: `VERIFICATION_2026-09-24.md` and the run's browser-evidence artifact.
- No secret was copied from chat into code; no live provider call, charge, refund, payout, purchase or DigitalOcean deployment occurred. Stripe credentials were previously supplied in chat but are not configured or verified in this environment. Lean, model, email and infrastructure access remain unavailable.
- Stripe → company bank → Lean → verified trainer IBAN remains the selected flow. Account-specific Lean transport, personal/business recipient eligibility, bank authorization and finality remain unverified and execution-gated. Usage accounting now reserves before sending; invalid outputs retain usage, unknown cost blocks close, finance can reconcile evidence, and a configurable daily request cap defaults to 100 per workspace.
- New core scope: all 16 onboarding steps have a persisted registry with computed readiness; identity autosave uses optimistic concurrency, preview changes invalidate review, publish gates run on the server. Client Twin snapshots retain source/freshness/coverage, deduplicate imported observations for baselines, remain scoped/versioned, and keep wearable-derived data out of model prompts. Dedicated public how-it-works/demo/pricing/FAQ pages are implemented.
- Full product remains unfinished. `BUILD_STATUS.md` distinguishes engineering gaps from access/approval blockers: acquisition attribution, brand/exercise media, broader ingestion/retrieval/Twin domains, automatic provider reconciliation, legal/provider/backup erasure operations, WHOOP/Zepp, domains, voice, native companion, campaigns/experiments/full admin views and infra Governor remain open. No group of the 75-screen source contract is declared complete from route coverage alone.
- Next work: use the build-status gap list for further engineering; configure separate nonproduction provider secrets when available, verify exact bank/payment contracts, and deploy approved staging only after region, budget, domain and legal/financial decisions exist. Production is not ready. Owner preferences above remain in force.

## Nutrition planning checkpoint — 25 September 2026

- Checked local and remote main at `0a778524`; the last verified runtime code remains `e6a539e`. This revision updates planning only. No nutrition runtime, new runtime test or live-provider result is claimed.
- `NUTRITION_INTEGRATION_PLAN.md` defines work IDs 035–044 and now incorporates the confirmed two-tier product, connected weekly/daily delivery and case-based coach onboarding. It supersedes the earlier nutrition-only tier and blanket supervised-output proposals. The source screen/technical baselines link the new requirements explicitly.
- Planned onboarding: choose combined capability; answer realistic and counterfactual client cases; extract and confirm rules, reasons, accepted/rejected choices and autonomy limits; resolve coverage gaps; inspect a sample week; pass separate held-out nutrition cases; qualify a versioned release. Workflow progress is dynamic, persisted and independent of workout-only readiness.
- Planned runtime: complete in-scope intake leads to automatic validated meal/recipe/portion/cooking/grocery delivery. Missing client facts prompt the client; unsupported methodology, conflicting information, unsafe requests or changes beyond explicit policy enter an exception queue. Model confidence alone cannot authorize an action. Coach corrections become draft teaching candidates, not silent changes to released behavior.
- Manual diet/recipe entry and calculations are an internal foundation, not completion of the requested AI product. Case teaching and automatic delivery with exception handling are part of the core combined-tier release; diaries/check-ins and later food/photo conveniences build on that. Training runtime supervision remains as implemented until separately changed. The existing Stripe/company-bank/Lean flow is retained; no exact price or provider was selected.
- Clinical permissions, nutrient thresholds, catalogue licensing, media storage/residency and commercial changes need the corresponding review before launch. No current medical/legal/provider claims were researched or validated in this planning pass; respect the owner's no-Astra-browsing preference when arranging later research.

## Handoff format

At the end of an implementation slice, replace the current-state bullets with a short factual checkpoint: active/completed issue IDs; code commit; migration/deployment state; checks actually run and evidence paths; unresolved blocker with owner; next executable action. Preserve the owner decisions until explicitly changed. Do not mark a requirement complete because its plan or UI exists.
