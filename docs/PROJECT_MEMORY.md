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
| Nutrition product | Two subscriber tiers: workout only and higher-priced workout + nutrition. Coach supplies diet and approximate calorie guidance; AI delivers daily meals, recipes, portions, cooking options and consolidated weekly groceries. No nutrition-only subscriber tier in current scope. Nutrition core is implemented with stage checks; consult CLAUDE_HANDOFF.md and COMPLETION_STAGES.md for the current branch evidence. The September 27 combined CI run qualifies the assembled engineering paths; real services remain open. |
| Meal photos and barcodes | Required features of workout + nutrition, confirmed by the owner on 25 September 2026. Photo → editable food/portion/calorie estimate → subscriber confirmation → diary. Barcode → sourced product/serving details → subscriber confirmation → diary. No routine coach approval or third subscriber tier. Both flows are implemented in the current app slice; local fixture verification passes, while provider/device qualification remains open. |
| Nutrition teaching and autonomy | Case-based onboarding captures what the coach recommends, why, alternatives, conditions and limits. Routine in-scope plans/changes should run automatically; human attention goes to exceptions, not every output. Implemented mechanism: private versioned cases/rules with independent held-out evaluation and explicit action policies; no per-coach model-weight training is claimed. |
| Market/design | UAE, AED, English first with Arabic-ready layout; restrained Swedish-minimal design |
| Infrastructure | Deployment stopped; Claude will handle it. Any later setup must create a new GymMembership project and new resources only, leaving every existing project/resource untouched. The earlier single-server selection and controller remain a separate unverified handoff. |
| Credentials | Operator expects to supply API access during implementation; availability and permissions must be verified without retaining values here |
| Git deployment | The later Claude deployment should automatically deploy successful checked `main` commits only to the new owned environment. Prepared controller code is preserved; this app task does not launch it. Provisioning is manual-only and live deployment remains unverified. |
| Access preference | NEVER USE CLOUD BROWSER. Use local Playwright for app screenshots. Any later authorized DigitalOcean work must use direct API access; the owner stopped this deployment attempt and assigned it to Claude. Do not repeat sign-in, network-toggle, admin-status or deployment-secret requests. |

## Current state

- Application completion is qualified in [PR #1](https://github.com/chordsnstrings/trainer_what/pull/1). GitHub records the merge state; the next real-service phase starts from `main` after this PR is merged. No deployment or real-provider transaction occurred.
- All remaining application modules are connected, including voluntary client context, affiliate agreements/receipts/statements and guarded reversible local-worker controls. Earlier stages cover accounts/privacy, onboarding/teaching, qualified coaching, training/nutrition, websites/media, subscriptions/bookings/finance, notifications, acquisition, support and integrations.
- [CI run 36295491678](https://github.com/chordsnstrings/trainer_what/actions/runs/36295491678) passed on code commit `dcfa92c4b353520f7444bb20055eda1fe1a0145c`: 367 application tests, 367 restricted-role PostgreSQL tests, TypeScript/build, 38 deployment checks, all 40 migrations, the permission gate, container readiness and a 50-route browser journey. The final handoff commit changes documentation only.
- `docs/VERIFICATION_2026-09-27.md` records exact evidence and audit fixes. Older stage counts and deferred-check statements are historical and must not be added together. The root handoff and stage register retain implementation details.
- Job audit fixes include millisecond lease tokens in migration 041, validated tenant scope for payment callbacks and retention, recovery-code locking, controller environment isolation, route assembly and stable form labels. Runtime table grants were not broadened; unknown external outcomes still require reconciliation.
- Browser checks cover publication, private downloads, consent/preferences and offline replay. Screenshots remain waived; cloud-browser use is prohibited. CI uses isolated PostgreSQL databases with the non-owner runtime role.
- Connector publication verifies each remote tree against the local committed tree; commit hashes differ. Prefer a fresh GitHub checkout. No application implementation or engineering check remains open for this phase.
- Next: qualify real Stripe/Lean and bank finality, providers/models/devices/push, domains/email, legal/retention/residency and hosted restoration/load/canary behavior. Infrastructure execution remains disabled by default and limited to worker pause/resume/interval; cloud adapters require separate qualification. Native HealthKit/BLE remains separate platform scope. Deployment stays stopped and separately owned.

## Historical deployment handoff

- No DigitalOcean resources were created. Existing account projects/resources remain untouched. The owner stopped deployment after direct API access returned Site Unavailable HTML and asked Claude to handle it. Do not repeat sign-in, network-toggle, workspace-admin or secret-entry requests.
- Prepared controller at `224b893` targets only a wholly new project named GymMembership and new owned server (blr1, 2 vCPU/4 GB, USD 24/month initial compute cap). It records owned create IDs and only updates a pinned successful checked `main` commit. These are implementation intentions, not live infrastructure evidence.
- Historical CI runs `36121575880` and `36121575906` passed setup/controller and application checks; setup skipped resource creation because its provisioning secret was absent. The current provisioning workflow is manual-only. See VERIFICATION_2026-09-25_DEPLOYMENT.md and DIGITALOCEAN_DEPLOYMENT.md for the separate handoff. Do not launch setup from this application task.

## Handoff format

At the end of an implementation slice, replace the current-state bullets with a short factual checkpoint: active/completed issue IDs; code commit; migration/deployment state; checks actually run and evidence paths; unresolved blocker with owner; next executable action. Preserve the owner decisions until explicitly changed. Do not mark a requirement complete because its plan or UI exists.
