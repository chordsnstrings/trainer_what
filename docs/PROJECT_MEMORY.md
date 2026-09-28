# Project memory

Updated: 27 September 2026. This is durable project context for future build sessions. It records decisions, not credentials or a claim about account capabilities.

## Owner decisions

| Topic | Current decision |
| --- | --- |
| Project | `chordsnstrings/trainer_what`; Trainer Brain Platform |
| Current request | 27 September (latest): fix the audited errors, test everything, and deploy everything under a new DigitalOcean project without touching existing projects. The owner supplied a DO token in the session and said they will rotate it. Delivered in [PR #2](https://github.com/chordsnstrings/trainer_what/pull/2), merged with the owner's authorization and deployed automatically. |
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
| Trainer Brain concept (28 Sep 2026) | Subscribers subscribe to a trainer. The Trainer Brain learns from the trainer and generates bespoke, dated training plans for each subscriber from their input, keeps learning from trainer corrections and subscriber outcomes, delivers automatically and hands a plan to the trainer only when not confident. Programme length is set by the trainer per offer (not a fixed menu). The subscriber UI guides day by day; nutrition tracks progress. One-to-one sessions are extra. Voice is an add-on; when bought, the voice runs the workout session. Code-enforced safety still routes medical limitations, pain and red flags to the trainer. Supersedes the earlier 'AI only selects trainer-authored actions' design. |
| Web addresses (28 Sep 2026) | Every trainer gets `<slug>.trainsyou.com`. Trainers may buy a custom domain paid yearly; purchase, DNS, HTTPS and renewal run autonomously. The platform company is always the registrant and holds the domains as a moat; trainers see only the first-year and renewal price, never the registrar (Namecheap preferred). |
| Market/design | UAE, AED, English first with Arabic-ready layout; restrained Swedish-minimal design |
| Infrastructure | Live since 27 September: new project GymMembership (`0edd5213-c97c-4d27-9429-ddc878854ddc`), SSH key `59625985`, Droplet `604067976` (blr1, s-2vcpu-4gb, quoted USD 24/month) at `https://gymmembership.64.227.151.196.sslip.io`. Existing projects/resources were only listed, never changed. Any further resources must again be new and owned. |
| Credentials | Operator expects to supply API access during implementation; availability and permissions must be verified without retaining values here |
| Git deployment | The server's controller deploys only the current `main` SHA whose push run of `check.yml` succeeded, every five minutes. Merging to `main` is the release action; never deploy branches directly. |
| Access preference | NEVER USE CLOUD BROWSER. Use local Playwright. DigitalOcean work uses the direct API from the coordinating session only; the token is never written to Git, docs, logs or cloud-init. Outbound SSH is unavailable from the automation environment, so host actions go through cloud-init and the controller. |

## Current state

- **Live deployment.** Unchanged: `main` at `eb7b678` runs on GymMembership; registration closed; placeholder legal documents; synthetic test accounts. Evidence: `docs/VERIFICATION_2026-09-27_LIVE_DEPLOYMENT.md`.
- **Branch work (unmerged, PR #3).** Eleven completion and hardening packages merged on `integrate/round2` and pushed to `claude/repository-overview-osejlw`: see `docs/COMPLETION_STAGES.md` stage 2026-09-28 and `docs/features/`. Migrations 054–062. Full PGlite suite on `b4ac2b5`: 745 pass, 0 fail, 1 skipped.
- **Also merged (stage 2026-09-28b).** Brain-generated plans with confidence escalation and learning, trainer-set programme length, voice add-on and day-by-day view, voice-led sessions, automatic subdomains and autonomous domains, and the multi-page marketing site (migrations 063–066). Full PGlite suite on `5d405e0`: 895 pass, 0 fail, 1 skipped.
- **E2E harness (stage 2026-09-28c, branch `core/e2e-ai`, unmerged).** Core suite for the 28 September features; 430 of 430 steps passed on two full runs; fixes: connections `importHistory` (delete an import after the bounded bootstrap) and Brain plan prompt `startingLoads` (`brain-plan-v2`).
- **AI answer replay (stage 2026-09-28d, same branch).** Harness option `--model-outcomes`; reviewed and adversarial answers replayed (full and staged runs). Open application findings: plan title, summary and cues are not screened before automatic delivery (an injected title, summary and link reached a member); rule compilation accepts invented or medical draft rules for trainer confirmation; malformed coach-action output shows the member raw schema errors.
- **Not done.** Whole PostgreSQL suite, build and browser runs on the merged head; Claude-authored model answers and judging of the new captures; native HealthKit app; legal text; real provider qualification; Lean status reads; commission sign-off.
- **Next action.** CI on the pushed head, the AI capture/replay review of plan generation, then ask the owner before merging to `main` (merging deploys). Owner go-live actions: DNS for trainsyou.com, Namecheap API access, provider credentials, reviewed legal text.

## Handoff format

At the end of an implementation slice, replace the current-state bullets with a short factual checkpoint: active/completed issue IDs; code commit; migration/deployment state; checks actually run and evidence paths; unresolved blocker with owner; next executable action. Preserve the owner decisions until explicitly changed. Do not mark a requirement complete because its plan or UI exists.
