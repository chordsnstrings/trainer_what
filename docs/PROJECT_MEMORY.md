# Project memory

Updated: 27 September 2026. This is durable project context for future build sessions. It records decisions, not credentials or a claim about account capabilities.

## Owner decisions

| Topic | Current decision |
| --- | --- |
| Project | `chordsnstrings/trainer_what`; Trainer Brain Platform |
| Current request | 27 September: finish all remaining application work autonomously, audit and run combined release checks, fix failures, then merge to main. Be cautious with tokens. Real services and deployment are deferred until after completion. Continue stage commits and handoff updates; screenshots remain waived. |
| Astra | Available for difficult design, implementation and review; use tokens wisely; do not use it for browsing |
| Execution | Use bounded tasks, targeted context, deterministic tooling and useful verification. On 25 September at 13:44 Asia/Dubai, the owner explicitly requested multiple agents for speed; split nonoverlapping implementation/review work and keep cloud writes with the coordinating agent. Avoid repeated planning/research and unnecessary confirmation. |
| Collections | Existing operator Stripe account for subscriber subscriptions, refunds and disputes |
| Trainer payouts | Lean Technologies initiates monthly payouts from the company's bank account to eligible verified personal/business UAE IBANs, after reconciliation |
| Payment history | The earlier Stripe Connect payout direction is superseded by Stripe collection + Lean payout |
| Finance | One immutable ledger, marginal 25%/20%/15%/10% commission bands, transparent AI/voice charges and gross-to-net statements |
| Product | Trainer Brain Compiler + Client Twin + governed first-person Coach Runtime; trainer identity and control are central |
| Nutrition product | Two subscriber tiers: workout only and higher-priced workout + nutrition. Coach supplies diet and approximate calorie guidance; AI delivers daily meals, recipes, portions, cooking options and consolidated weekly groceries. No nutrition-only subscriber tier in current scope. Nutrition core is implemented with stage checks; consult CLAUDE_HANDOFF.md and COMPLETION_STAGES.md for the current branch evidence. Historical CI does not qualify this expanded branch. |
| Meal photos and barcodes | Required features of workout + nutrition, confirmed by the owner on 25 September 2026. Photo → editable food/portion/calorie estimate → subscriber confirmation → diary. Barcode → sourced product/serving details → subscriber confirmation → diary. No routine coach approval or third subscriber tier. Both flows are implemented in the current app slice; local fixture verification passes, while provider/device qualification remains open. |
| Nutrition teaching and autonomy | Case-based onboarding captures what the coach recommends, why, alternatives, conditions and limits. Routine in-scope plans/changes should run automatically; human attention goes to exceptions, not every output. Implemented mechanism: private versioned cases/rules with independent held-out evaluation and explicit action policies; no per-coach model-weight training is claimed. |
| Market/design | UAE, AED, English first with Arabic-ready layout; restrained Swedish-minimal design |
| Infrastructure | Deployment stopped; Claude will handle it. Any later setup must create a new GymMembership project and new resources only, leaving every existing project/resource untouched. The earlier single-server selection and controller remain a separate unverified handoff. |
| Credentials | Operator expects to supply API access during implementation; availability and permissions must be verified without retaining values here |
| Git deployment | The later Claude deployment should automatically deploy successful checked `main` commits only to the new owned environment. Prepared controller code is preserved; this app task does not launch it. Provisioning is manual-only and live deployment remains unverified. |
| Access preference | NEVER USE CLOUD BROWSER. Use local Playwright for app screenshots. Any later authorized DigitalOcean work must use direct API access; the owner stopped this deployment attempt and assigned it to Claude. Do not repeat sign-in, network-toggle, admin-status or deployment-secret requests. |

## Current state

- Active completion PR: [#1](https://github.com/chordsnstrings/trainer_what/pull/1), branch `work/completion-2026-09-27`. The owner authorized merge after successful checks; no production deployment or real-provider transaction is authorized in this phase.
- All remaining application modules are connected, including voluntary client context, affiliate agreement/receipt/statement settlement and approved reversible local-worker controls. Prior stages cover accounts/privacy, trainer onboarding/teaching, qualified coaching, training/nutrition, websites/media, subscriptions/bookings/finance, notifications, acquisition, support and governed integrations.
- The authoritative combined evidence is `docs/VERIFICATION_2026-09-27.md`; older stage counts are historical and must not be added together. `CLAUDE_HANDOFF.md` and `docs/COMPLETION_STAGES.md` retain stage-level details.
- Combined qualification found and fixed assembled-route conflicts, verified-user probe budgets, controller environment overrides, payment callback tenant scoping, recovery-code locking and job lease timestamp precision. No runtime table grants were broadened. Migration041 stores millisecond lease tokens.
- CI run36293529458 passed all367 application tests, TypeScript, the production build and all38 deployment checks. Its non-owner database and browser checks exposed issues subsequently fixed. The latest tree is undergoing the complete PostgreSQL/container/browser gates before merge.
- PostgreSQL fixtures now use scoped transactions and disposable per-file database clones with the same restricted runtime role. Local account/payment/email/push regression checks passed50 tests after the latest runtime fixes. Screenshots remain waived; cloud-browser use is prohibited.
- Connector publication verifies each remote tree against the local committed tree; hashes differ, so use the GitHub branch in a fresh checkout. Next action: resolve any final CI failures, record exact passing evidence, and merge PR#1 to main.
- Real Stripe/Lean and bank finality, model/voice/food/wearable rights and quality, actual devices/push, domain/email services, legal/retention/residency approval, hosted restoration and load/canary qualification remain the next real-services phase. Infrastructure execution is disabled by default and limited to local worker pause/resume/interval; no cloud adapter or purchase is enabled. Native HealthKit/BLE remains separately approved platform scope.

## Historical deployment handoff

- No DigitalOcean resources were created. Existing account projects/resources remain untouched. The owner stopped deployment after direct API access returned Site Unavailable HTML and asked Claude to handle it. Do not repeat sign-in, network-toggle, workspace-admin or secret-entry requests.
- Prepared controller at `224b893` targets only a wholly new project named GymMembership and new owned server (blr1, 2 vCPU/4 GB, USD 24/month initial compute cap). It records owned create IDs and only updates a pinned successful checked `main` commit. These are implementation intentions, not live infrastructure evidence.
- Historical CI runs `36121575880` and `36121575906` passed setup/controller and application checks; setup skipped resource creation because its provisioning secret was absent. The current provisioning workflow is manual-only. See VERIFICATION_2026-09-25_DEPLOYMENT.md and DIGITALOCEAN_DEPLOYMENT.md for the separate handoff. Do not launch setup from this application task.

## Handoff format

At the end of an implementation slice, replace the current-state bullets with a short factual checkpoint: active/completed issue IDs; code commit; migration/deployment state; checks actually run and evidence paths; unresolved blocker with owner; next executable action. Preserve the owner decisions until explicitly changed. Do not mark a requirement complete because its plan or UI exists.
