# Project memory

Updated: 26 September 2026. This is durable project context for future build sessions. It records decisions, not credentials or a claim about account capabilities.

## Owner decisions

| Topic | Current decision |
| --- | --- |
| Project | `chordsnstrings/trainer_what`; Trainer Brain Platform |
| Current request | Focus on completing the app; defer broad reviews/release qualification and list them in the Claude handoff. Preserve completed and unfinished work for Claude because of token budget. Maintain `CLAUDE_HANDOFF.md` and the completion register after every completed stage. Continue on the work branch one checked, committed stage at a time. Agent fan-out is authorized; screenshots waived. Include trainer uploads, unlimited galleries and actual website. Deployment remains stopped. No cloud browser. |
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

- Active branch: `work/completion-2026-09-26`; GitHub `main` is unchanged. Read `../CLAUDE_HANDOFF.md` and `COMPLETION_STAGES.md` for exact scope. Update both after every completed stage; root coordinates shared files, commits and publication.
- The preserved completion checkpoint has now been followed by finished Checkout, notifications, onboarding readiness, private chat attachments, trainer website/gallery and consented acquisition stages. Earlier stages cover training/qualified coaching, personalized nutrition, finance/bookings, administration, team/import/OCR, privacy/accounts and governed integrations.
- Current bounded work: complete case-bound read-only support access, observe-only infrastructure, structured correction feedback and lifecycle messages. Twin/compiler source coverage is connected, with five new and three existing checks plus TypeScript. Scheduled coaching follow-ups are wired and passed seven real-app tests plus eight privacy checks; migration032 is included. Acquisition shared hooks passed 34 related tests and TypeScript; former-owner media erasure passed four new and eight existing privacy checks. Notification settings now use the persisted preference controls; nine related checks passed. Browser harness updates are saved with four passing syntax checks; execution and comprehensive review are deferred per owner steering; no cloud browser.
- Attachment stage: seven attachment and eight privacy tests passed together. Migration028 remains unchanged; forward030 applies the upgrade safely. Image/PDF sanitization, conversation binding, privacy and orphan expiry are connected. Whole-tree TypeScript passed after the temporary acquisition syntax error was fixed.
- All30 migrations and twice-applied runtime grants passed in fresh PGlite (54 tables/nine helpers); a separate028→030 upgrade with existing data passed five behavioral subtests. Final combined suite, production build, browser and PostgreSQL/container CI have not run. Local Chromium installation failed because CDN archives were invalid/truncated. Functional browser verification remains a release gate; screenshots are waived.
- Stage commits are published through the GitHub connector because direct Git transport was unreliable. Remote/local commit hashes differ, with identical trees verified. Use GitHub history from a fresh checkout. No merge or deployment is authorized by this continuation.
- No live payment/provider/cloud action occurred. Actual provider rights, account capabilities, model/coach quality, device behavior and operational qualification remain external gates. Existing DigitalOcean resources remain untouched.
- Next: finish these bounded follow-ups in separate checked commits, then run aggregate gates and reconcile remaining source requirements.

## Historical deployment handoff

- No DigitalOcean resources were created. Existing account projects/resources remain untouched. The owner stopped deployment after direct API access returned Site Unavailable HTML and asked Claude to handle it. Do not repeat sign-in, network-toggle, workspace-admin or secret-entry requests.
- Prepared controller at `224b893` targets only a wholly new project named GymMembership and new owned server (blr1, 2 vCPU/4 GB, USD 24/month initial compute cap). It records owned create IDs and only updates a pinned successful checked `main` commit. These are implementation intentions, not live infrastructure evidence.
- Historical CI runs `36121575880` and `36121575906` passed setup/controller and application checks; setup skipped resource creation because its provisioning secret was absent. The current provisioning workflow is manual-only. See VERIFICATION_2026-09-25_DEPLOYMENT.md and DIGITALOCEAN_DEPLOYMENT.md for the separate handoff. Do not launch setup from this application task.

## Handoff format

At the end of an implementation slice, replace the current-state bullets with a short factual checkpoint: active/completed issue IDs; code commit; migration/deployment state; checks actually run and evidence paths; unresolved blocker with owner; next executable action. Preserve the owner decisions until explicitly changed. Do not mark a requirement complete because its plan or UI exists.
