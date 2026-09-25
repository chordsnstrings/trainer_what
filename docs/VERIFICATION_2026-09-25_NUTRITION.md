# Nutrition implementation verification — 25 September 2026

Core implementation: `552d3843d0faea09d28633a1ac84816701994d36`.
Final client fixes: `2bf35fda06c3fc58bcfd8f23837095057e911972`.

The [core CI run 36093982661](https://github.com/chordsnstrings/trainer_what/actions/runs/36093982661) passed both application and PostgreSQL/container jobs. Its browser artifact is `browser-evidence` (artifact `10846940703`). The [final client-fix run 36094669632](https://github.com/chordsnstrings/trainer_what/actions/runs/36094669632) also passed both jobs: application `107944294788` and PostgreSQL/container `107944294427`. Its final browser artifact is `10846757453` (available until 24 December 2026). The checks below apply to final code `2bf35fd`. All data and model responses used for these checks are synthetic fixtures; this is engineering evidence, not live coach/model qualification.

## Observed checks

| Gate | Evidence |
| --- | --- |
| TypeScript / production web build | Passed |
| PGlite | 51 tests passed, zero failed |
| PostgreSQL | Same 51 tests passed on PostgreSQL 17.6 with a non-owner, non-BYPASSRLS runtime role |
| Database schema | Ten additive migrations, including immutable nutrition food/recipe/ingredient versions, tenant policies and stable business-intent indexes |
| Production container | Image built and API/database readiness passed |
| Browser | 32 concrete paths, 390px mobile layout checks, no overflow and zero browser page errors |
| Coach setup | Cases, recipes, policy, held-out scenarios, sample week, activation, exception screens and the conditional nutrition onboarding branch rendered |
| Subscriber nutrition | Daily meals, recipe instructions, cooking details, weekly groceries and pantry save passed |
| Offline nutrition | Opt-in plan cache survives offline reload; queued meal replays once after reconnection and appears in the diary |
| Empty-queue reconnection | Passed: offline reload with no queued entry reconnects, refetches the full profile and restores the recorded diary |
| Existing regressions | Public pages, 16-step identity save/resume, Client Twin, offline workout reload/replay and completion passed |
| Visual review | Desktop coach cases and mobile nutrition setup, meals and groceries captures inspected |

The browser artifact includes the report, screenshots and server logs. Route counts describe exercised paths, not completion of all 75 screen groups in the original product specification.

## Delivered behavior

- Exactly two offer tiers: workout only and higher-priced workout + nutrition. Combined access derives from signed Stripe price mappings; workspace enablement, browser return URLs and unsigned metadata cannot grant it. Existing offers remain workout only.
- Six conditional onboarding steps teach nutrition from client cases: recommendations, reasons, alternatives, rejected choices, change conditions and referral limits. Confirmed diet/target rules, ingredient facts and recipe versions stay private to the coach's tenant.
- Nutrition qualification is independent from the existing training Brain. A confirmed policy, at least 20 held-out checks covering all required categories, and a reviewed sample week pin the current material/model configuration. Edits invalidate readiness. Fixture evaluation cannot qualify production.
- First and subsequent meal weeks are prepared through durable worker jobs. Qualified, in-scope results are delivered automatically after current entitlement, consent, profile, release and constraint checks. Unsupported or invalid results enter the coach exception queue; a prior valid plan is retained.
- Daily meals, portions, recipe instructions, cooking variants, estimated nutrients and consolidated weekly groceries share one plan revision. Ordinary code calculates quantities and validates restrictions, equipment/time, calories, portions and repeats. Meal changes preserve consumed history and recalculate grocery differences.
- Subscriber food preferences and separate processing/model permissions, immutable diary events/corrections, check-ins, descriptive nutrition Twin, export/erasure and an explicit private offline cache are integrated. The final client fixes make synthetic plans explicit, prevent offline reloads from extending cache expiry, and refresh on reconnection even with an empty replay queue.
- The paired-tier billing-portal confirmation flow is implemented behind `BUNDLE_CHANGES_APPROVED`; real account behavior and the proposed proration/downgrade policy remain unverified.

The 14 new nutrition tests cover arithmetic/unknown nutrients, restrictions and scope, allergy aliases, two-tier access, dynamic setup, immutable food/recipe facts, policy provenance, independent qualification, automatic delivery and swaps, diary corrections, scheduler deduplication, consent/profile/release races, exception handling, cost retention and signed price changes. The original 37 tests continue to pass on both engines.

## Verified boundary and remaining inputs

No real model, food provider, Stripe, Lean or email call was made. No money moved, infrastructure was purchased or production deployment performed. Previously supplied Stripe credentials are not configured or verified here, and their values are absent from code and evidence.

Production nutrition needs actual coach cases and food facts, a configured model with explicit usage prices, successful real-model evaluation/sample-week qualification, qualified scope review, PostgreSQL worker operation and the deployment gates in [DEPLOYMENT.md](DEPLOYMENT.md). Keep `NUTRITION_ENABLED`, `NUTRITION_SCOPE_APPROVED` and `BUNDLE_CHANGES_APPROVED` disabled until their respective evidence exists. The Stripe → company bank → Lean payout choice is unchanged.

Optional food catalogue/barcode/photo integration (043), voice teaching, broader convenience/editor features and the platform gaps in [BUILD_STATUS.md](BUILD_STATUS.md) are not completed by this release. Local privacy deletion is implemented; provider/backup erasure and real-device/accessibility/load/restore evidence remain open. Counts and fixture success do not establish clinical or professional qualification.

Core work 035–042 and engineering checks for 044 are delivered. Live-model, provider-account, staging and production qualification remain pending.
