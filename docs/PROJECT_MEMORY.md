# Project memory

Updated: 26 September 2026. This is durable project context for future build sessions. It records decisions, not credentials or a claim about account capabilities.

## Owner decisions

| Topic | Current decision |
| --- | --- |
| Project | `chordsnstrings/trainer_what`; Trainer Brain Platform |
| Current request | Preserve completed and unfinished work for Claude because of token budget. Maintain `CLAUDE_HANDOFF.md` and the completion register after every completed stage. Continue on the work branch one checked, committed stage at a time. Agent fan-out is authorized; screenshots waived. Include trainer uploads, unlimited galleries and actual website. Deployment remains stopped. No cloud browser. |
| Astra | Available for difficult design, implementation and review; use tokens wisely; do not use it for browsing |
| Execution | Use bounded tasks, targeted context, deterministic tooling and useful verification. On 25 September at 13:44 Asia/Dubai, the owner explicitly requested multiple agents for speed; split nonoverlapping implementation/review work and keep cloud writes with the coordinating agent. Avoid repeated planning/research and unnecessary confirmation. |
| Collections | Existing operator Stripe account for subscriber subscriptions, refunds and disputes |
| Trainer payouts | Lean Technologies initiates monthly payouts from the company's bank account to eligible verified personal/business UAE IBANs, after reconciliation |
| Payment history | The earlier Stripe Connect payout direction is superseded by Stripe collection + Lean payout |
| Finance | One immutable ledger, marginal 25%/20%/15%/10% commission bands, transparent AI/voice charges and gross-to-net statements |
| Product | Trainer Brain Compiler + Client Twin + governed first-person Coach Runtime; trainer identity and control are central |
| Nutrition product | Two subscriber tiers: workout only and higher-priced workout + nutrition. Coach supplies diet and approximate calorie guidance; AI delivers daily meals, recipes, portions, cooking options and consolidated weekly groceries. No nutrition-only subscriber tier in current scope. Nutrition core is implemented and CI-verified; consult BUILD_STATUS.md for the exact scope and production gates. |
| Meal photos and barcodes | Required features of workout + nutrition, confirmed by the owner on 25 September 2026. Photo → editable food/portion/calorie estimate → subscriber confirmation → diary. Barcode → sourced product/serving details → subscriber confirmation → diary. No routine coach approval or third subscriber tier. Both flows are implemented in the current app slice; local fixture verification passes, while provider/device qualification remains open. |
| Nutrition teaching and autonomy | Case-based onboarding captures what the coach recommends, why, alternatives, conditions and limits. Routine in-scope plans/changes should run automatically; human attention goes to exceptions, not every output. Implemented mechanism: private versioned cases/rules with independent held-out evaluation and explicit action policies; no per-coach model-weight training is claimed. |
| Market/design | UAE, AED, English first with Arabic-ready layout; restrained Swedish-minimal design |
| Infrastructure | Deployment stopped; Claude will handle it. Any later setup must create a new GymMembership project and new resources only, leaving every existing project/resource untouched. The earlier single-server selection and controller remain a separate unverified handoff. |
| Credentials | Operator expects to supply API access during implementation; availability and permissions must be verified without retaining values here |
| Git deployment | The later Claude deployment should automatically deploy successful checked `main` commits only to the new owned environment. Prepared controller code is preserved; this app task does not launch it. Provisioning is manual-only and live deployment remains unverified. |
| Access preference | NEVER USE CLOUD BROWSER. Use local Playwright for app screenshots. Any later authorized DigitalOcean work must use direct API access; the owner stopped this deployment attempt and assigned it to Claude. Do not repeat sign-in, network-toggle, admin-status or deployment-secret requests. |

## Current state

- Continuation resumed at the owner's instruction on 26 September after checkpoint local `4cb743f` / GitHub `844fd7b`. Current bounded work: subscription Checkout is now connected and checked; complete onboarding readiness and private chat attachments, and connect notifications. Maintain the root handoff after every completed stage; deployment remains stopped.

- The owner requested a Claude continuation file on 26 September because of token budget. Read `../CLAUDE_HANDOFF.md` first. Update it and `COMPLETION_STAGES.md` after every completed stage with actual checks, commit, remaining work and next action.
- Active branch: `work/completion-2026-09-26`. GitHub `main` is unchanged. Recovery restored the real baseline `620eef1`; the lost earlier uncommitted implementation was rebuilt in stages. Verified source checkpoints have been saved to GitHub; remote hashes differ from local hashes because connector commits were used, with identical trees verified.
- Completed stages cover workout safety and qualified routine autonomy, dated training/corrections/chat, personalized nutrition and stronger qualification, billing servicing/history/refunds/grace, finance policies/statements/promotions/paid bookings/reviewed jobs, specialist admin/publication, team/import/OCR review, privacy closure/transfer/erasure, passkeys/recovery/sessions, and governed wearables/voice/domains/host routing. Stage-level results and area handoffs are in `COMPLETION_STAGES.md`; do not reuse the historical 91-test result as evidence for this branch.
- Latest completed coaching stage: local `249df91`, published `e9e083c77b42d8c605b65e714833e77e29187851`; fourteen coaching/runtime tests passed. Subsequent checkpoint preserves unfinished modules and the Claude handoff, not a completed product.
- Frozen work: photo/gallery/website API and UI need registration/navigation/brand locks/client manifest; notification routes, preferences/inbox and safety/chat/nutrition/booking/payment/reminder hooks are now completed and tested; subscription Checkout replacement is now fixed and connected; onboarding now submits and validates the observed preview digest with eight passing related checks and current capability readiness; attachments and acquisition consent/experiments remain incomplete. Exact files and next steps are in the root handoff.
- Checkout completion passed eight Checkout tests plus sixteen finance tests. Its permission/type failures are fixed, app/UI wiring is complete and unresolved checkout now blocks unsafe closure. Onboarding test callback types are fixed. The latest whole-worktree TypeScript run is blocked by an unfinished closing brace in acquisition.ts; its stage is in progress. Final notification checks pass eight cases plus two paid-booking cases. Final whole-app suite, build, browser and PostgreSQL/container CI have not run. Runtime configuration work passed all 29 migrations/role checks in PGlite and 36 Python deployment boundary tests, with one Docker-only skip.
- No live Stripe/Lean/model/email/voice/wearable/domain or cloud action was performed. No deployment took place. Actual provider contracts/rights, coach quality, approved legal content, device behavior and operational qualification remain external gates. Existing DigitalOcean resources are untouched.
- Next executable action: fetch the work branch, read `CLAUDE_HANDOFF.md`, fix the named compile/preview/Checkout blockers, finish the missing module hooks one checked stage at a time, then run exact-tree release checks. Screenshots are waived. Deployment remains stopped; no cloud browser.

## Historical deployment handoff

- No DigitalOcean resources were created. Existing account projects/resources remain untouched. The owner stopped deployment after direct API access returned Site Unavailable HTML and asked Claude to handle it. Do not repeat sign-in, network-toggle, workspace-admin or secret-entry requests.
- Prepared controller at `224b893` targets only a wholly new project named GymMembership and new owned server (blr1, 2 vCPU/4 GB, USD 24/month initial compute cap). It records owned create IDs and only updates a pinned successful checked `main` commit. These are implementation intentions, not live infrastructure evidence.
- Historical CI runs `36121575880` and `36121575906` passed setup/controller and application checks; setup skipped resource creation because its provisioning secret was absent. The current provisioning workflow is manual-only. See VERIFICATION_2026-09-25_DEPLOYMENT.md and DIGITALOCEAN_DEPLOYMENT.md for the separate handoff. Do not launch setup from this application task.

## Handoff format

At the end of an implementation slice, replace the current-state bullets with a short factual checkpoint: active/completed issue IDs; code commit; migration/deployment state; checks actually run and evidence paths; unresolved blocker with owner; next executable action. Preserve the owner decisions until explicitly changed. Do not mark a requirement complete because its plan or UI exists.
