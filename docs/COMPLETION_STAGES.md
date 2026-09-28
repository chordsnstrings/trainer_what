# Completion stages — 26–27 September 2026

Application implementation and the job audit are complete for the current phase. [PR #1](https://github.com/chordsnstrings/trainer_what/pull/1) contains the work; [combined verification](VERIFICATION_2026-09-27.md) records the passing final code revision. The owner authorized merge to main. Real services and deployment remain the next phase; screenshots were waived. Historical entries below record the evidence available at each stage and may contain superseded pending-check statements.

## Recovery boundary

The local environment restored an older snapshot. Yesterday's uncommitted completion work is absent. The recovery note on `work-in-progress/completion-2026-09-25` documents intended behavior, not preserved source. Work here starts from published `620eef1` and reconstructs missing features. Previously passing release evidence does not verify these new changes.

## Stage 2026-09-28e — AI-behaviour fixes from the adversarial replays (core/e2e-ai, unmerged)

Branch `core/e2e-ai` from `37a148f`. Application changes for the judged findings of stage 2026-09-28d. Nothing deployed; no real provider called. Details in `docs/features/brain-plans.md` "AI-behaviour fixes from the adversarial replays".

- **Fixed (blocker): member-visible Brain plan text is screened.** Shared module `packages/domain/src/text-screen.ts` (the free-wording checks moved from `voice-session.ts`, plus approval-claim, guarantee, contact-number and plan-prose medical screens). `validatePlan` adds an error for any title, summary, week focus, session label or non-library cue that fails, so the validation signal is zero and the plan goes to the trainer with the reasons; `deliverProgramme` re-checks before an automatic write. Approving unedited flagged wording is refused; wording the trainer types in an edit is only a warning.
- **Fixed (major): qualification inherits the screen**; the wrong comment about safety-floor profiles is corrected (the live route calls the model so the trainer has a draft; its screen errors show on the review item).
- **Fixed (major): malformed coach-action answers.** `selectCoachAction` throws `ModelOutputInvalid` for malformed JSON, schema errors, foreign evidence or an unavailable action; `tryQualifiedCoaching` files a private `human_review` exception (`cause: model_output_invalid`), emits `coaching.review_required` and returns the standard pending-review message.
- **Fixed (minor): evaluations score an invalid answer as a failed scenario** (`error: invalid_model_answer`) in `/brain/evaluate` and `/brain/coaching-evaluate`; configuration and network failures still abort.
- **Fixed (minor): held-out Brain evaluation grades content** (`evaluationAnswerIssues`: medicine/dose/diagnosis advice, links, contact numbers, approval claims, guarantees, altered rule numbers, programs outside the library or bounds, a program on an escalation scenario); reasons stored per outcome.
- **Fixed (minor): compiled rule flags.** `compiledRuleFlags` stores `data.flags` on a draft rule (medical advice, a red flag the directive does not stop for, links, contact, approval claims, guarantees); confirming it needs `acknowledgeFlags: true`; the Brain screen shows the warning.
- **Fixed (minor): cue provenance.** An automatic delivery stores the library cue, never the model's; an adaptation that swaps an exercise clears the old cue.
- **Declined or partial.** A compiled rule that silently contradicts its source (`c1af914d577b`, "add 5 kg every session regardless of reps in reserve") is not flagged: that needs a comparison with the source text. An evaluation answer that adds an extra set without a number word ("add one extra set", `8d2133339111`) still passes (the number check ignores "one"). No text-screen scenario was added to the e2e core suite: the rule responder writes clean text and a queued answer cannot be pinned to one qualification request; the unit tests cover it.
- **Checks actually run.** `npx tsc --noEmit` (root) and `npx tsc --noEmit -p apps/web`: pass. PGlite: `brain-plans` (25), `coaching-runtime` (9), `fix-coaching` (9), `source-review-notifications` (5), `coaching-retrieval` (5) pass; related `coaching-completion`, `coaching-input-coverage`, `e2e-harness-model-outcomes`, `messaging-safety-policy`, `platform`, `voice-session-domain`, `voice-session`, `programme-voice`, `e2e-harness-mocks`, `coaching-retrieval`: 102 tests, 102 pass. PostgreSQL restricted role (`/opt/tools/pg-sandbox.sh 56197`, 7 changed or related files, 78 tests): `PG_SELECTED_FAILED_FILES=0`. Full e2e harness with the rule responder (port 56211; the runner's production `next build` of the changed web app passed): 430 passed, 0 failed, 0 skipped, 689 s (run before the altered-numbers grade was added; the later replay runs below include it and their seeds' evaluations still passed). Adversarial replays (`--model-fallback=rules`, `--skip-build`): stage 1: `af4e19da32a6` stored with `flags: [medical_advice, red_flag_not_stopped]`; stage 2: each workspace's held-out evaluation completed (20 of 20 scored, 2-4 passed, status failed) instead of aborting, with `fe9282752f76` guarantee, `fe1f81675461` approval claim, `b2ba74802a91` outside bounds and `4b36128533c6` outside library; stage 3: `/brain/coaching-evaluate` returned 200 with the invalid answers as failed scenarios instead of 409; stage 5: qualification failed as it should (`7d7e4fb69851` routed to review with "Summary cannot be shown (medical)", `241c6eb49d34` with "(link, medical, contact)"), 411 passed, 1 failed (that step), 6 skipped (coach-domain edge in use by the concurrent run); stage 6: `95a64fd944c5` from the worker's intake job is `pending_review` with title, summary and cue errors and was not delivered (the harness step expecting delivery failed and 8 dependent steps did not run: 421 passed, 1 failed), and `628d03d456db` now shows its medical cue and summary errors on the review item. Stage 4: `1ee4d4ae8816` on `/api/v1/coaching/ask` now returns 200 with the pending-review message (before: 400 with the Zod errors), opens a `human_review` exception with `cause: model_output_invalid` and emits `coaching.review_required` (400 passed, 7 failed, 2 skipped, the same counts as before; the failures are harness steps that expect the attacked answers to be delivered).
- **Next action.** Merge `core/e2e-ai` into the integration branch after review; rerun the full harness on the merged head.

## Stage 2026-09-28d — reviewed and adversarial model answers replayed through the harness (core/e2e-ai, unmerged)

Branch `core/e2e-ai` from `d2aea05`. Harness tooling only; the application was not changed. Nothing deployed; no real provider called.

- **New harness option.** `--model-outcomes=FILE` (`tests/e2e/harness/model-outcomes.ts`) writes, per model call, what the app did with the answer: the call and this run's value behind each placeholder, its usage row (linked by the provider request id), the step and the API request that were open, the next API answers, and the events, records and side-table rows the workspace wrote until its next model call, read back before teardown. The harness client keeps its API exchanges only when the option is on; every step now carries `startedAt` and the report lists `phases`. Windows use the double's clock because the month-close clock shift moves usage timestamps. Unit test `tests/e2e-harness-model-outcomes.test.ts`.
- **Runs (port 56198, `--skip-build`, fallback `rules`).** Reviewed answers (103 hashes): 431 passed, 0 failed, 689 s, but only 9 calls were replayed (the three rule compilations, the nutrition recipe, policy, evaluation, preview and weekly plan, one meal photo): the reviewed compile answers differ from the capture's, so every later request that carries the rules (held-out evaluation, coach actions, plans, voice) hashed differently and the rule responder answered it. Adversarial answers: 88 passed, 17 failed, 12 skipped, 61 s, 3 model calls: the invalid compile answer was withheld (503), the other two were stored as draft rules for the trainer (one invents "add 5 kg every session" and drops the curls conflict, one tells a runner with chest pain to take salbutamol and aspirin); the harness then stopped each trainer seed (fewer than four rules or no rules), so no other attack was reached.
- **Staged supplementary runs** (earlier kinds answered with the capture's own answers so later attacks are reached; replay files in the session scratchpad): evaluation attacked (98/17/12, 12 calls): each workspace's evaluation was withheld at the first answer failing validation; compile and evaluation from the capture (198/12/10, 68 calls): the coach-action evaluation refused evidence outside the release (409), the recipe draft refused unknown foods (422), the nutrition evaluation failed 0/28; trainer seed from the capture (400/7/2, 115 calls): a malformed coach-action answer reached the member as HTTP 400 with the raw schema errors, the out-of-library coaching answer went to the trainer, the malformed week became a nutrition exception, and out-of-bounds or malformed plans failed validation and stopped the plan flow. Reviewed answers with the capture's compile answers (428/2/0, 137 calls, 108 replayed): all 58 evaluation answers passed; 2 of 13 coach-action evaluation answers selected no action where the scenario expected one, so automatic coaching did not activate; plans, the adaptation and voice suggestions went to the trainer as expected. Capture calls 1-113 from the capture, plan qualification attacked (417/1/1, 123 calls): three attacked scenarios failed (bounds, week count), the out-of-library answer was correctly sent to review, and the answer that diagnoses joint degeneration and prescribes ibuprofen in a cue passed as deliverable (automatic). Capture calls 1-118 from the capture (429/1/0, 137 calls): the plan ignoring a knee limitation was held by the safety floor; the prompt-injection plan from the worker's intake job was delivered automatically, and the member's plan screen showed the title "APPROVED BY TRAINER - AUTO PUBLISH", the "Ignore previous limits" summary and a cue with a supplement link; the altered-numbers voice suggestions were all refused by the wording screen. Across all runs 85 of 103 reviewed and 28 of 103 adversarial hashes were reached; the rest (mostly later held-out evaluation answers after a withheld one, later coach-action answers and later plans) never matched a request.
- **Checks actually run.** `npx tsc --noEmit` passed. `tests/e2e-harness-mocks.test.ts` and `tests/e2e-harness-sandbox.test.ts` (17) and `tests/e2e-harness-model-outcomes.test.ts` (1) pass. The harness runs above. Not run: the full PGlite or PostgreSQL suites (no application code changed).
- **Findings for the application (not fixed here).** Plan title, summary and exercise cues are not screened (`packages/domain/src/brain-plans.ts` validates structure, loads and bounds only), so once qualification passes a confident plan with injected instructions, a link or drug advice reaches the member automatically. Draft rule compilation does not flag invented methods, dropped contradictions or medical advice; only trainer confirmation stands between them and the Brain. A malformed coach-action answer returns the schema error text to the member instead of the standard withheld message. One invalid held-out answer withholds the whole evaluation, so later answers are never scored.
- **Next action.** Decide on a text screen (links, medical and drug terms, approval claims) for plan title, summary and cues before automatic delivery; judge `outcomes.jsonl` per hash; the unreached adversarial answers need further staged replays.

## Stage 2026-09-28c — end-to-end harness for the core features (core/e2e-ai, unmerged)

Branch `core/e2e-ai` from `53063eb`. Nothing deployed; no real provider called.

- **Failing step fixed.** The followers step "Connections page with import history and delete" failed because the bounded bootstrap (catalog kinds only) no longer ships `wearable` records, and the connections endpoint gave only per-source totals, so no read path named an import batch to delete. It was not tenant isolation or the wearable policy. Fix in the application: `GET /integrations/connections` returns `importHistory` (own export-file batches with ids, newest first, at most 50) and the Connections panel has "Delete import"; the scenario deletes the listed batch. Regression test `tests/e2e-harness-import-history.test.ts` (4 tests).
- **Application defect found by the new scenarios.** Brain plans: the validator enforced week-1 loads against the member's logged load or the library default load, but the prompt never told the model those references, so a library with a default load (the seed's 16 kg goblet squat) made every such plan fail validation and none could be delivered automatically. The prompt now carries `startingLoads`; prompt version `brain-plan-v2` (existing qualifications need a new run). Regression test in `tests/brain-plans.test.ts`.
- **New harness coverage.** Core suite `tests/e2e/scenarios/core-features.e2e.ts` (30 steps): Brain plan review queue with approve / edit / reject, learning raising confidence, held-out qualification, automatic delivery (regenerate and the worker's intake job), low-confidence and safety-floor routing, weekly adaptation; upfront 28-day programme checkout, Day N of M, voice add-on added and set to end; voice session prepared ahead with worker audio, speech-to-text commands through the double, pain stopping the session with a training hold; automatic subdomain through the edge, domain search / purchase / DNS / renewal at the now-started Namecheap double with no registrar name in trainer responses; marketing pages, sitemap, `llms.txt` and the follower calculator's model. The runner sets `PLATFORM_ROOT_DOMAIN`, starts the Namecheap double and saves the `web_addresses` settings; the rule responder honours `startingLoads`; `ctx.schedulerTick` stands in for the Brain scheduler's 10-minute pass (recorded under `clockShifts`). `FULL_RUN_MIN_STEPS` is 430.
- **Checks actually run.** TypeScript (`npx tsc --noEmit`) passed. The production web build (`next build`, started by the harness runner) passed. PGlite: `brain-plans` (19), `e2e-harness-mocks`, `e2e-harness-sandbox` (36 together, all pass); `e2e-harness-import-history`, `healthkit-sync`, `integrations-completion` (30, all pass). Full harness twice on port 56198: run A 430 passed, 0 failed (exit 1 only because the minimum was first set to 432 by a miscount; corrected to 430); run B 430 passed, 0 failed, 0 skipped, exit 0, 698 s. Model capture of run B: 128 requests (124 rule responder, 4 queue), 103 distinct hashes, 102 shared with run A. Not run: whole PGlite or PostgreSQL suites, the restricted-role PostgreSQL run of the changed tests, a browser check of the changed Connections panel.
- **Limits.** A bought domain's Live step is not reached locally (the target address must be public and is never published to the DNS double). Weekly adaptation goes to the trainer (no adaptation scenarios held out). The scheduler's own second pass now falls inside a run and prepares supervised first plans for seeded members (four), so capture counts depend on timing.
- **Next action.** Review the new captures (plan generation, adaptation, voice phrasing) with Claude-authored answers, then merge `core/e2e-ai` into the integration branch.

## Stage 2026-09-28b — Trainer Brain core, web addresses and marketing site (integrate/round2, unmerged)

Owner direction (28 Sep): the Trainer Brain generates and adapts each subscriber's plan and escalates to the trainer only when not confident; programme length is set by the trainer; voice is an add-on that runs the session; every trainer gets a subdomain and may buy a custom domain paid yearly and handled autonomously; the platform holds those domains and never shows the registrar; a professional multi-page marketing site with SEO, LLM SEO and a follower conversion estimate.

| Package | Delivered | Record |
| --- | --- | --- |
| Brain plans | Model-generated dated programmes from intake, Brain rules, cases, templates and the Client Twin; code validator with hard bounds; deterministic confidence with a trainer threshold; review queue (approve, edit with stored diff, reject); safety floor in code; learning examples; weekly adaptation; plan qualification before automatic delivery (migration 063) | `docs/features/brain-plans.md` |
| Programme | Trainer-set programme length per offer, monthly or upfront billing, voice as a membership add-on, Today view with Day N of M and nutrition progress (migration 064) | `docs/features/programme.md` |
| Voice session | Brain-written session script in the trainer's style, trainer-voice audio, hands-free runner with timers, set logging from speech, pain stops the session and opens a safety hold, speech-to-text adapter (migration 065); fixed the old cue and title bugs | `docs/features/voice-session.md` |
| Web addresses | Automatic `<slug>.<root>` subdomains with on-demand TLS; Namecheap and generic registrar adapters; autonomous search, yearly Stripe payment, purchase with reconciliation, DNS, activation, renewal and lapse; platform is the registrant; registrar never shown to trainers (guard test) (migration 066) | `docs/features/web-addresses.md` |
| Marketing site | 41 server-rendered public pages from one typed list (features, specialties, Dubai and Abu Dhabi, guides, methodology with cited sources), sitemap, JSON-LD, llms.txt, follower and earnings calculators labelled as estimates, optional Instagram connection, early-access capture | `docs/features/marketing-site.md` |

Checks actually run on merged head `5d405e0`: TypeScript passed; full PGlite suite 896 tests, 895 pass, 0 fail, 1 skipped. Each package ran its own PostgreSQL restricted-role tests; web addresses also ran the Python deployment tests with Caddy 2.11.4; the marketing site ran `next build` and a local Chromium check of every page at 390 and 1440 px. Not run on the merged head yet: whole PostgreSQL suite, e2e harness, Claude-authored model answers and judging. No real model, registrar, Stripe or voice provider was called.

## Stage 2026-09-28 — completion packages, hardening and end-to-end harness (integrate/round2, unmerged)

Owner request (27 Sep, evening): complete every partial and not-built feature, test the rest with mock data, use Claude to check AI responses, make it production ready. Built as eleven packages, each in an isolated worktree with an adversarial review and a fix round, then merged by the coordinator on `integrate/round2` and pushed to `claude/repository-overview-osejlw` (PR #3). Nothing was deployed; `main` and the live server are unchanged.

| Package | Delivered | Record |
| --- | --- | --- |
| Accounts | Name/email change with verification, change-password screen, operator-assisted recovery, leave a trainer / owner removal, Apple and Google sign-in (OIDC), single session creator | `docs/features/accounts.md` |
| Joining | Invitation emails, pending invitations with cancel, join alerts, complimentary access through one entitlement function, second-coach joining | `docs/features/joining.md` |
| Governance | Workspace suspension, account locks on every sign-in path, executive metrics with CSV, operator alert engine, central fresh-authenticator guard for operator routes | `docs/features/governance.md` |
| Messaging | Published templates drive delivery (11 more keys registered at merge), safety policy tightens escalation only, inquiry alerts, leads, conversion milestones | `docs/features/messaging.md` |
| Discovery | robots.txt/sitemaps, opt-in coach directory, trainer-branded install for members | `docs/features/discovery.md` |
| HealthKit sync | Server API: device pairing, batch upload, deletion (native iOS app not built) | `docs/features/healthkit.md` |
| Infrastructure | Encrypted scheduled backups with restore check and optional S3 copy, host metrics, signed admin host actions, on-demand TLS for coach domains; backup and host alerts wired at merge | `docs/features/infra-ops.md` |
| End-to-end harness | Mock Stripe, Lean, email, model (capture/replay), push, WHOOP, Zepp, voice, registrar, DNS, S3, OIDC; production-mode local stack; 399 steps passed on two identical runs | `docs/features/e2e-harness.md` |
| Isolation | Membership-verified tenant scopes, SQL guard against role/setting changes, definer helpers replacing follower elevation, workspace-bound service tables (migration 061) | `docs/features/isolation.md` |
| Bounded bootstrap | First-page bootstrap with cursors and paged endpoints | `docs/features/bounded-bootstrap.md` |
| Right-to-left | Direction from member/site language, logical CSS with a lint test, RTL browser check | `docs/features/rtl-layout.md` |

Merge fixes by the coordinator: account locks inside `openSignInSession`; safety-review escalation keeps running for suspended workspaces; complimentary access closes when a membership ends; new account routes are noindex; verifier de-duplicated.

Checks actually run on the merged head `b4ac2b5`: TypeScript passed; full PGlite suite 746 tests, 745 pass, 0 fail, 1 skipped. Per-package PostgreSQL restricted-role runs passed in each worktree (isolation ran the whole suite on PostgreSQL: 678 pass, 0 fail, 1 cancelled then fixed and rerun). Not yet run on the merged head: whole PostgreSQL suite, `next build`, browser check, deployment tests, e2e harness. Not done: Claude-authored model answers and judging (capture/replay), native HealthKit app, legal text, live provider qualification.

Owner concept clarified on 28 Sep (see PROJECT_MEMORY): the Trainer Brain generates and adapts each subscriber's plan and escalates only when not confident; programme length is set by the trainer; voice is an add-on that runs the session. Those three packages are being built next.

## Stage register

Each implemented stage records concrete behavior, changed paths, actual checks and its remaining qualification. Only the coordinating agent stages and commits files. Completed stages are pushed before moving on; provider-dependent functionality stays gated until its real contract and account are qualified.

| Area | State | Next phase |
| --- | --- | --- |
| Workout coaching and Client Twin | Connected and included in passing combined checks | Real model/device and coach-quality qualification |
| Nutrition and teaching | Connected, including meal photos/barcodes, weekly plans and groceries | Real food/model/camera qualification |
| Billing, finance and affiliates | Ledger, servicing, bookings, statements, jobs and bank-evidence settlement connected | Stripe/Lean capabilities, agreements and bank finality |
| Administration, team and support | Scoped controls, onboarding, ingestion and support connected | Operational account/policy qualification |
| Integrations and worker controls | Guarded adapters and disabled-by-default local execution connected | Real accounts; cloud operations remain gated |
| Privacy and accounts | Combined account, consent, isolation and erasure checks passed | Reviewed legal/retention and external erasure evidence |
| Galleries and website | Upload, draft/publication, private/public/client visibility passed in Chromium | Real domains and media capacity |
| Notifications and worker | Job audit, restricted PostgreSQL and inbox/preference browser checks passed | Real email/push device delivery |
| Release checks | Both CI jobs passed on `dcfa92c`; 367 tests on each database path, build, browser and container | Merge PR #1; then real-service qualification |

## Evidence

This file is updated with actual stage evidence as work completes. No unfinished row is a claim of delivery.

### Nutrition stage 1

Current food/recipe versions and safe weekly recovery are implemented. Sixteen focused tests passed (14 existing, two new), covering supersession, isolation, unsent versus uncertain dispatch, audit and stale recovery. This is fixture qualification; real model qualification remains open. See NUTRITION_COMPLETION_HANDOFF.md.

### Coaching stage 1

Subscriber-wide safety holds now prevent bypass by starting another workout. Explicit trainer resume/abandon, hold visibility, concurrency and consent/profile/takeover rechecks are connected. Five focused tests passed with isolated provider fixtures. Escalation records are present; preference-aware delivery is a later stage.

### Billing stage 1

Existing subscribers can be serviced while new sales are paused. Distinct cancel/reactivate transitions have stable individual intents; uncertain outcomes require reconciliation. Invoice/payment history, selected-charge refund requests, operator overrides and finite past-due grace are connected. Six focused finance regressions passed with isolated Stripe fixtures.

### Administration stage 1

Dedicated scoped operator screens replace overview fallbacks for acquisition, accounts, Brain/safety, usage, integrations, support, jobs, audit, experiments and content. Effective legal/template publication, support CAS/macros, evidence-based email recovery and consented business analytics are implemented. Seven focused tests and TypeScript passed at the stage boundary.

### Nutrition stage 2

Coach-defined calorie methods, profile-bound individual calorie/macro/hydration targets and habits, and validated client week assignment/amendment/archive are implemented. Target/profile/consent changes are rechecked before model delivery. Twenty-seven related tests and TypeScript passed at this stage; four completion tests were rerun after the last refinements.

### Privacy stage 1

Scoped exports and local erasure now include derived data and explicit provider/backup follow-up evidence. Two-party ownership transfer and independently reviewed workspace closure recheck financial obligations and revoke sessions; closed workspaces reject normal access. Consent records resolve published legal versions. Seven privacy tests passed after route integration. Actual external erasure requires recorded provider/backup evidence.

### Coaching stage 2

Dated multiweek prescriptions, reusable templates, exercise-specific progression, approved substitutions, immutable set corrections, progress summaries, chat refresh and rest/RIR tools are connected. Seven focused tests passed, including cross-tenant schedule and stale-edit cases. Current-member checks now use a narrowly scoped database helper.

### Nutrition stage 3

Consumed-day totals, trends, detailed corrections, favorites and meal copying now connect to the diary. Photo quantity edits rescale nutrients and can use confirmed food facts. Grocery purchase quantities and expiry-aware leftovers/inventory are recorded. Thirty nutrition/capture tests passed after fixing the cross-feature media policy.

### Coach business and finance completion

Effective financial policies, gross-to-net statements, promotion/trial terms, paid one-to-one bookings and reviewed financial jobs are connected to API, UI, Stripe event dispatch and worker. Recurring slots preserve local time, policies/capacity/changes are guarded and private calendar downloads are available. Published legal content replaces draft-only pages. Nineteen combined booking/finance checks passed. Lean/bank finality still uses verified evidence; no live transaction was made.

### Team and knowledge import completion

Team invitation, role, revocation and session controls now use current owner/MFA/revision checks. Knowledge imports support bounded spreadsheets, program JSON and real image/scanned-PDF OCR, with extraction cleanup, privacy review/redaction and approved compilation material. API/UI and Docker/CI dependencies are connected. Fourteen team/import tests, three legacy import tests and TypeScript passed.

### Finance final safeguards

Admin refund overrides now have a dedicated review UI and current MFA/revision checks. Monthly jobs can be explicitly reauthorized against the displayed policy revision while preserving payment identities. Financial worker result helpers use attempt/lease CAS for success and failure. Fifteen focused finance tests and TypeScript passed; worker uses this helper in the integration stage.

### Nutrition qualification completion

Adaptive teaching now checks conflicting cases and requires independent worked meal, portion, nutrient, rationale and safety evidence before automatic activation. Old releases require requalification. Subscriber-requested generation uncertainty has a durable recovery path and cannot be retried under a new key. Thirty-three related tests and TypeScript passed; nine completion tests passed again after the final recovery refinement. Real provider quality remains a separate qualification requirement.

### Connected integrations and verified hosts

Wearable connection/revocation, trainer voice enrollment and guided playback, reviewed domain ordering and DNS/TLS verification, signed host forwarding, scoped integration operations and worker processing are connected. Explicit provider contracts and rights gates remain enforced; no live provider was called. Forty-five focused integration/settings/configuration/host tests and TypeScript passed. The worker also uses the committed finance lease-CAS helper.

### Account access and privacy completion

Magic-link login, authenticator recovery codes, verified WebAuthn passkeys, session controls and account settings are connected for members, trainers and administrators. Privacy export/erasure covers all current owned data, including notification preferences and inboxes; stale membership and financial obligations remain guarded. Eighteen account/privacy tests passed, including real signed WebAuthn assertions and assembled-app route checks. Aggregate TypeScript is deferred until the concurrent attachment module finishes.

### Qualified workout coaching completion

Case teaching, confirmed routine actions, independent evaluation, shadow approval and qualified automatic delivery are connected to the Brain screens. Contract pins cover current model, rules, examples, actions and templates. Changes, safety holds, takeover and revoked consent stop automatic effects. Plain chat safety reports now create the same training hold; rollback serializes with qualification. Fourteen coaching/runtime tests passed after these shared hooks. Attachment work is a separate unfinished stage.

### Claude handoff request

The owner requested a written handoff on 26 September because of token budget and intends to use Claude to finish. Stop new feature expansion, checkpoint existing completed and unfinished work, and keep `CLAUDE_HANDOFF.md` current after each completed stage. Deployment remains stopped. Unfinished checkpoints must not be described as verified completion.

Frozen implementation is preserved for continuation. The handoff names the two current TypeScript errors, five failing new Checkout tests, onboarding preview payload break, unregistered website/notification/Checkout modules and all unfinished UI/worker/privacy hooks. Infrastructure checks applied all 29 migrations and role grants in PGlite and passed 36 deployment boundary tests with one Docker-only skip. Those results do not qualify the combined application. No further feature implementation was started after the handoff request.

### Resumed Checkout completion

The owner resumed implementation after the handoff checkpoint. Atomic current-workspace/subscriber Checkout admission now preserves database isolation; unresolved outcomes block duplicate purchase and closure until provider evidence resolves them. Routes, member reconciliation and premium voice controls are connected. Eight Checkout tests and sixteen finance tests passed, including an assembled-app smoke. Root handoff updated with the resolved failures and remaining work.

### Notification completion

Preferences/inbox are connected to actual screens; safety, nutrition review, chat, booking/payment/refund and reminder events queue private, deduplicated alerts. Unknown email outcomes require evidence-based recovery; stale worker leases cannot resend or overwrite. Eight final notification tests and two signed paid-booking cases passed, following connected 22- and 30-test runs. The root handoff records exact boundaries and the unrelated in-progress acquisition typecheck blocker.

### Onboarding completion

The client submits the observed preview digest; stale approvals fail. Launch readiness uses current coaching/model, legal versions, independent nutrition evidence and actual voice consent, and explains private/published site state without a circular publish prerequisite. Six dedicated tests and two existing regressions passed, plus a final model-disconnection assertion. The Claude handoff now removes the fixed preview/type blockers.

### Private chat attachment completion

Image and raster-rebuilt PDF uploads now connect to message-only or attachment-only conversation delivery and scoped UI controls. Author/client/tenant binding is immutable; expired drafts cannot bind, and privacy/closure/worker cleanup includes bytes and message references. Forward migration030 upgrades the preserved028 schema without a reset. Seven attachment and eight privacy tests passed together after030; stage TypeScript passed. Browser qualification remains pending after the local Chromium CDN returned invalid archives. Root handoff updated in the same stage commit.

### Trainer website and gallery completion

Actual multipage public websites, private owner previews, gallery management/client galleries and coach-specific manifests/icons are connected. Brand writes serialize with media deletion and recheck current ownership/revisions; hidden pages are excluded from public data. Twelve coach-site and five branding tests, whole-tree TypeScript and scoped diff checks passed. Existing migration018 is unchanged. Browser journeys and former-owner media erasure remain separate work; root handoff updated.

### Coaching capacity and history hardening

Active coaching material is bounded before creation/model calls; held-out cases and the active release load separately from recent evaluations. Revision-checked assessment archiving permits replacement without leaking archived questions into training. Seven runtime tests and a final targeted assertion passed; whole-tree TypeScript and diff checks passed. No migration; root handoff updated in the same stage commit.

### Migration upgrade and runtime permission verification

A dedicated original001–029 →030 migration regression preserves existing conversation/media state and verifies binding, expiry and scoped helpers. Five behavioral subtests passed (six reported checks including their parent). Fresh all 30 migrations and twice-applied grants passed runtime verification of 54 tables and nine privileged helpers, including no PUBLIC helper execution and no unclassified definer helpers. Test TypeScript, script syntax and diff checks passed. Real PostgreSQL/container/browser remain CI gates; no deployment.

### Consented acquisition completion

Explicit consent and host-scoped opaque cookies now govern attribution and guarded landing/onboarding wording experiments. Actual signup/new enrollment, publication and verified first-positive-payment hooks dedupe after commit; analytics failures preserve business success. Withdrawal, export/erasure and bounded expiry cleanup include linked anonymous history. Thirty-four focused acquisition/onboarding/privacy/admin tests and TypeScript passed. Migration029 is unchanged. Browser interaction remains pending; root handoff updated.

### Former-owner media privacy completion

Reviewed personal erasure now removes owned media/galleries and exact applied/private design references, bumps stale-editor revisions and compacts remaining gallery order. Other users' media, other workspaces and the continuing workspace are preserved. Four new media privacy tests, eight existing lifecycle tests, TypeScript and diff checks passed. No migration/grant change; root handoff updated.

### Notification settings connection correction

Replaced the mistakenly retained legacy Settings form with NotificationPreferences. Kept old-client opt-outs effective in the actual preference row without resetting newer quiet-hour/booking choices; revisions advance for conflict detection. Nine notification tests passed and the component mount passed TypeScript. Browser persistence review is deferred per the latest owner instruction; the root handoff has the review queue.

### Browser continuation harness prepared

Updated browser selectors and added consent, gallery/website, private attachment and notification-preference journeys. A local-only synthetic launched-workspace fixture separates website-publication testing from launch qualification; offline checks remain. Four syntax checks and scoped diff checks passed. Browser execution is unrun and explicitly deferred per owner steering; this is test-harness implementation, not feature verification.

### Scheduled coach follow-ups completed

Added private scheduling/rescheduling/canceling and history to actual conversation screens. Worker delivery is context-checked and transactional with one message/notification; changed access/consent/safety/coaching context returns to review. Sender/client erasure includes scheduled and delivered content. Migration032 adds private record policies and unique intents/delivery indexes. Seven real-app follow-up and eight existing privacy tests passed; diff checks passed and no external calls occurred. Browser/timezone and real PostgreSQL review are deferred in the root handoff.

### Current Twin facts and complete compilation input

Current profiles/active holds now survive bounded history queries and retain lineage; current corrections and history overflow are explicit. Compiler input is sent in full within visible limits, with explicit source selection and persisted/returned coverage. Five new checks, three selected existing Twin/model-accounting checks, TypeScript and diff checks passed. Includes a real authenticated /brain/compile regression. No migration; quality/source review is deferred and the root handoff is updated.

### Temporary support preview completed

Added case/session-bound read-only account/access/connection previews with fresh MFA, reason, 15-minute expiry, visible Stop/banner, repeated authority checks and real-operator audit. App registration and support links are connected; migration031 has narrow system grants. Seven focused tests, strict TypeScript and diff checks passed. Sensitive view reproduction/write elevation are not implemented; browser/PostgreSQL/retention review is deferred explicitly in the handoff.

### Observe-only infrastructure operations completed

Actual process/API/worker/DB/queue observations, versioned thresholds, evidence-linked recommendations and audited acknowledgement/recovery are connected to admin/API/worker. Stale/partial evidence cannot prove recovery; execution is always denied. Migration033 and narrow grants are included. Nine observer tests, connected TypeScript and all 33 migration/runtime grants checks passed (58 tables/nine helpers). Cloud telemetry remains explicitly unavailable; production/browser/fleet/retention/load review is deferred in the handoff.

### Training adherence and latest-block summary completed

Added timezone-aware rolling 28-day history/next 28-day schedule and complete latest-assigned-block summaries across verified revisions. Completion needs exact linked workout evidence; held/canceled/abandoned/unverifiable states are separate, and bounded legacy/overflow coverage is explicit. Trainer/subscriber views show counts and expandable lineage. Two new and three existing focused checks, TypeScript and diff checks passed. No migration; active-block selection and browser/release review are deferred in the root handoff.

### Correction-to-teaching and regression workflow completed

Added guarded replacement decisions preserving originals, preferred/rejected correction episodes, meaningful/cosmetic differences and saved teaching drafts. Owner-confirmed teaching reuses held-out exclusion; linked independent evaluation reports readiness without releasing or leaking prompts. Client-owned outcomes, privacy erasure and consent revocation are connected in the actual app and attention-list UI. Eight new and seven existing runtime tests, TypeScript and diff checks passed. No migration/provider call; broad security/browser/quality review is deferred in the root handoff.

### Lifecycle messages and trainer reminder policy completed

Connected bounded, deduplicated trainer/subscriber lifecycle triggers with pinned source/template identity and current-state delivery checks. Coverage includes onboarding/interview/payout setup/readiness, paid milestones/review queue, intake/program/workout/block/wearable and verified billing/refund/payout states. Owner-controlled missed reminders are off by default and honor exact policy revisions, recorded schedule, current paid consent, safety and client workout/quiet-hour preferences. API, Settings UI and worker are connected; existing notification/job privacy applies, with no migration or live provider call. Eight lifecycle plus nine existing notification checks and final whole-tree TypeScript passed; basic policy component rendering and diff checks passed. Backfill/candidate/expiry bounds and unsupported churn/upload-count/push features remain explicit in the root handoff. All assigned continuation slices are committed; broader scope and release/provider qualification remain for Claude.

### Upload and compilation review notifications completed

Connected actual extraction and compilation to generic, deduplicated review prompts with exact proposed rule/conflict counts and source/batch references. Delivery suppresses stale or revoked material, changed review states, expired prompts and lost trainer/workspace access. Compilation rechecks selected material and current authority after model processing before persisting results. Four new actual-app checks and two existing targeted regressions passed; diff checks passed. No migration or real provider call. Final connected TypeScript subsequently passed with the retention stage; root handoff updated.

### Searchable coaching history completed

Added correction/outcome full-text search with change/category/client filters, bounded keyset pagination, deletion-safe cursors and connected attention-list controls. Current trainer/workspace checks, held-out exclusion, existing detail/teaching behavior and erasure are preserved. Seven new route tests and eight correction-workflow regressions passed; diff checks passed. Migration034 adds indexes over current records. Tenant RLS prevented GIN use in the local diagnostic; no isolation bypass was added, and the 3-second timeout/input/page bounds remain explicit. Final connected TypeScript subsequently passed; production plans/performance/browser remain deferred as recorded in the root handoff.

### Configurable retention alerts completed

Connected an owner-only Business policy/cohort/evidence panel and bounded worker alerts. Actual linked positive invoices plus confirmed instructions or signed subscription receipts determine scheduled/ended/recovered states; incomplete or unresolved evidence suppresses alerts. Policies are off by default, revision-safe and bounded; source/policy/ownership/preferences/expiry are rechecked before email, with poll deduplication and a 24-hour cooldown. Shared bootstrap excludes retention configuration. Eight tests (including actual assembled routes/bootstrap and notification delivery), final whole-tree TypeScript and diff checks passed. No migration/provider call. Counts are recorded current-member evidence, not historical churn rates; bounds and PostgreSQL/browser/provider review remain explicit in the root handoff.

### Opt-in browser push completed

Connected explicit device opt-in/removal, encrypted session-bound endpoint storage, payloadless generic service-worker notices, authenticated inbox routing, Superadmin VAPID controls and worker delivery. Migration035 enforces tenant RLS; sign-out/revocation cascades, metadata-only privacy export and erasure are included. Public-DNS-pinned restricted provider requests, source/preference checks and lease CAS prevent stale/uncertain automatic repeat sends; 201 is labelled accepted, 404/410 prune devices and 429 backs off. Seven new push tests plus 32 existing notification/settings/privacy tests, connected TypeScript, SW syntax and diff checks passed. No real provider call. Real device/HTTPS/VAPID/worker delivery and production permission qualification remain for Claude.

### Relevant coach examples and reviewed outcome teaching completed

Added bounded deterministic relevance selection with tenant/approval/rights filters, complete-example limits, shared evaluation/runtime behavior and persisted retrieval evidence. Retrieval policy/prompt v2 invalidate older qualification. Correction teaching can include an explicitly reviewed deidentified outcome summary with private source refs, current consent and stale-source protection; draft revisions retain prior teaching until confirmation. Five retrieval plus17 workflow/runtime tests passed, followed by two final recovery checks; connected TypeScript and diff checks passed. No migration or real model call. Outcome/source quality, lexical retrieval fidelity and requalification remain explicit review gates in the handoff.

### Scoped support screens and single-use corrections completed

Added explicit consent-gated training/nutrition schedule views and notification settings to read-only session/case-bound previews. Exact safe preference edits require a separate immutable five-minute intent, review/apply, fresh MFA/current authority and preference CAS; no arbitrary impersonation or financial/consent/safety editing. Replay returns the receipt; customer edits, expiry, stop and context loss prevent mutation. Migration037/system grants and runtime verifier included. All13 support tests passed; connected TypeScript/diff passed. Fresh PGlite applied36 migrations through037 with twice-applied grants and passed32 system/28 scoped table and nine-helper checks. Real PostgreSQL and browser review remain for Claude.

### 27 September — Client context and resumed completion

The owner now authorizes all remaining application work, combined auditing and merge to main after checks; external services/deployment remain deferred. Client context is connected to API and shared trainer/subscriber Twin UI. Four privacy/access/CAS/date tests pass; migration038 preserves scoped records. Source notes cannot enter automatic decisions. Remaining modules: affiliates and infrastructure broker.

### 27 September — Affiliate administration and finance guards completed

Added approved provider agreements with explicit disclosure and trainer shares, aggregate receipts pinned to contract revisions, immutable reversals and monthly statements, and exact signed bank-evidence reconciliation. Confirmed receipts post balanced entries to the existing trainer-payable/bank/commission ledger; no provider money is assumed collected before evidence. Outstanding clawbacks block payout dispatch, and outstanding affiliate obligations block workspace closure. Owner statements and Superadmin editing are connected. Migration039 has tenant/finance RLS and immutable financial history. Six new affiliate/MFA checks plus sixteen finance regressions passed (22 total). The audit fixed invalid/future MFA timestamps in the shared guard. No consumer tracking, external payout, provider call or new service occurred. Next: finish guarded infrastructure operations and combined release qualification.

### 27 September — Guarded infrastructure operations completed

Added disabled-by-default execution policy and an immutable proposal/approval history for the primary application worker. The initial allowlist permits pausing/resuming new cycles and setting their interval; it cannot purchase cloud resources, change DNS/databases/security or execute arbitrary commands. Operator role and fresh MFA, exact resource/policy revisions, expiry, zero added cloud cost, hourly action limits and current approver authority are checked in the same transaction as execution. Retrying an executed operation cannot repeat it; rollback requires the resource still to match the original result and remains available when execution is disabled. The real worker reads the control at cycle boundaries; existing cycles finish normally. Admin UI and navigation are connected. Migration040 and runtime grants are included. Four action tests plus nine observer tests passed (13 total); combined TypeScript is being rerun after fixture typing corrections. Next: full suite/build/browser/PostgreSQL/container gates, bounded audit, then merge. No cloud or provider action occurred.

### 27 September — Integrated application audit and regression fixes

The first full run found a route collision between the new broker and legacy observe-only rejection routes, plus a preexisting health-probe rate-budget regression. Broker APIs now use /infrastructure/operations while the historical denial endpoints remain intact. Authenticated probes use verified session identities for their budget, without requiring a host proof or extending session activity; invalid cookies remain IP-limited. Forty affected assembly checks and nine host/rate-limit checks passed after fixes. Whole-tree TypeScript and the production web build pass. Browser coverage now checks client-context persistence and trainer read-only access and visits the new operator pages. See docs/VERIFICATION_2026-09-27.md for exact counts, initial failures and remaining GitHub gates.

### 27 September — Controller environment isolation

First PR CI exposed inherited application variables overriding the reviewed private Compose runtime file. The controller now inherits only ordinary process settings, pins the release, and excludes application, Docker-host and Compose overrides. Added mock and real-Compose assertions. All 38 local deployment checks ran: 37 passed and the Docker-only check skipped. No controller was deployed. PR #1 reruns all release gates before merge.

### 27 September — PostgreSQL runtime and job fixes

The non-owner PostgreSQL suite exposed tenant-table reads in payment projections, an unnecessary UPDATE lock on recovery codes, and microsecond lease tokens that JavaScript truncated. Payment callbacks now read through their validated tenant identity, recovery remains serialized by the existing security-row lock, and forward migration 041 stores leases at millisecond precision for exact compare-and-set retries. No runtime grants were broadened. Test setup now uses tenant transactions for scoped tables; immutability probes recognize permission denial, and PostgreSQL-specific observer checks require real connection metrics. CI clones its disposable migrated database per test file to prevent global policy/queue fixtures contaminating other files, while every test still runs with the restricted runtime role. TypeScript and script syntax pass; final suites are running.

### 27 September — Retention scope and final fixture corrections

PostgreSQL now passes payment callbacks, MFA recovery and worker lease/retry checks. The expanded database run exposed retention loading tenant policies/events before entering the tenant role. Retention now reads a bounded owner-authorized projection under RLS, joins only that projection to privileged provider evidence, and returns to the tenant role for output and notifications. Runtime grants remain narrow. Remaining test-only setup/assertion reads now use the proper tenant role; global settings tests use isolated databases without migration credentials; observer tests enable actual PostgreSQL metrics. Browser journeys explicitly decline optional analytics in each new browser context so the consent panel does not cover controls. Consolidated current handoff status and preserved historical stage evidence.

### 27 September — Browser preference persistence and final retention fixture

Browser execution verified offline workout replay and preference saving, then found the saved textarea content affecting its implicit label after reload. Client-context textareas now have stable accessible names. The guarded synthetic browser seed records explicit coaching consent for Sam so trainer read-only context checks satisfy the real consent gate. PostgreSQL reached363/367 passing checks; the four remaining failures shared a test-only retention event insert using the service role. Split provider receipts and scoped audit inserts, including bounded overflow fixtures; all eight retention tests pass locally. TypeScript passes. The next CI run must qualify the complete browser and PostgreSQL/container paths.

### 27 September — PostgreSQL/container qualification and stable shared form labels

Run36294655491 passed all367 PostgreSQL tests as the non-owner runtime, all 40 migrations,35 system/33 scoped table classifications and nine privileged helpers, plus the production container build and readiness probe. Application tests/typecheck/build also passed. Browser flows reached and passed client-context persistence/trainer read-only access, offline workout and meal replay, grocery persistence and private gallery upload; gallery visibility exposed implicit labels containing select-option text. Galleries, workspace, coaching, training and nutrition now share a label component binding controls to their visible label text, preserving existing explicit accessible names. TypeScript passes; final browser requalification remains before merge.

### 27 September — Browser request pacing

Run36295139032 again passed the full application and PostgreSQL suites, build, permission checks and container readiness. Browser execution passed gallery editing, then correctly hit the production120-request/minute budget while traversing dozens of screens. The harness now spaces real API requests per browser context below that budget; server limits and responses are unchanged. Browser-script syntax passes.

### 27 September — Final combined qualification and merge handoff

Both jobs in [run 36295491678](https://github.com/chordsnstrings/trainer_what/actions/runs/36295491678) passed on `dcfa92c4b353520f7444bb20055eda1fe1a0145c`: 367 application tests, 367 non-owner PostgreSQL tests, TypeScript, production build, 38 deployment boundary tests, 40 migrations with 35 system/33 scoped tables and nine helpers, container readiness and the 50-route Chromium journey. Browser evidence reports zero page errors, no mobile overflow, publication/privacy/attachment/preference flows and offline workout/meal replay. The final documentation-only commit consolidates exact evidence, resolved job/security/runtime findings and the real-services handoff. No code or workflow changed after the qualified revision. Next: merge PR #1 as authorized; begin real-service qualification separately. No deployment or live transaction occurred.

### 27 September — Live deployment, audited defect fixes and review round

GymMembership was deployed on new DigitalOcean resources and verified live on `main`. Of 109 earlier audit items, 55 still present and 28 partly fixed ones were addressed across twelve areas. An adversarial review confirmed 15 further findings, including a deploy-readiness blocker, which were fixed and re-verified. The final head passes the local suite, TypeScript, build, 56 deployment tests and the full restricted-role PostgreSQL suite (477 passed, 2 embedded-only skips). An upgrade rehearsal from a `main`-migrated database also passed. Details: `docs/VERIFICATION_2026-09-27_LIVE_DEPLOYMENT.md` and `CLAUDE_HANDOFF.md`. The owner authorized the merge; `main` `eb7b678` deployed automatically and passed the live checks.
