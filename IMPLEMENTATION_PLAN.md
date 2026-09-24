# Trainer Brain Platform — implementation and launch plan

**Status:** planning baseline, 24 September 2026. **Repository:** `chordsnstrings/trainer_what` was empty when this plan was written. **Source:** `Trainer_Brain_Platform_Astra6_Master_Build_Spec_v1.1(1).docx`, including its 24 September addendum. Section references below refer to that specification. This plan is meant to direct implementation; the source specification remains the detailed product contract and should be supplied to the implementation team as well. Record changes in ADRs rather than quietly deviating from either document.

## Execution documents

This phase-level baseline is complemented by an executable planning package. Start with [project memory](docs/PROJECT_MEMORY.md) and [agent instructions](AGENTS.md), then use the [delivery roadmap](docs/DELIVERY_ROADMAP.md), [technical blueprint](docs/TECHNICAL_BLUEPRINT.md), [75-screen and source coverage matrix](docs/SCREEN_AND_REQUIREMENTS.md), and [operations/release plan](docs/OPERATIONS_AND_RELEASE.md). All application work and production evidence remain pending. The roadmap preserves the 34 issue IDs below and adds concrete outputs and acceptance checks.

**Owner model preference:** reserve Astra for difficult design, implementation and focused review; use tokens efficiently and do not use Astra for browsing. Use bounded context, deterministic tools and reusable checkpoints. These instructions are retained in project memory for future build sessions.

## 1. Executive direction

Build a UAE-first, trainer-branded subscription platform whose defensible function is a **Trainer Brain Compiler** plus a **Client Twin** and governed **Coach Runtime**. A trainer teaches the system their real coaching decisions, reviews its proposed rules, passes a held-out evaluation, publishes a storefront, and serves paid subscribers through programs, a workout logger, and first-person digital coaching. The trainer can see exceptions, interventions, money, costs and the evidence behind each decision. This is a production software program with finance, safety, privacy and operations; a polished interface alone is not completion.

**Latest owner decision:** use the operator's existing **Stripe account for subscriber collection** and **Lean Technologies for monthly trainer payouts to UAE IBANs**. Stripe settles collected funds into the company's own bank account; Lean initiates outgoing payments from that account to verified trainer beneficiaries. This selects Lean for the attachment's separate `PayoutProvider` role and supersedes the earlier Stripe-only payout plan. Keep `PaymentProvider` and `PayoutProvider` independent behind one reconciled ledger. Provider selection is decided; Phase 0 must confirm the actual Stripe business model, Lean/source-bank access, recipient requirements and reliable payment confirmation. See Decision D-01.

**Delivery strategy:** build one end-to-end paid coaching path first, then expand it to all required screens, integrations and admin capabilities. Every phase leaves a working staging deployment, real persisted data, test evidence and a short release note. External approvals, credentials and counsel opinions are explicit gates. Independent work continues while a gate is pending. No production user is charged, no trainer is paid, and no sensitive production data is placed in a selected region before the relevant gates pass.

### What is in scope

- Public trainer acquisition, calculator/demo, pricing and attribution; trainer signup, themed storefront, subdomain and optional paid custom domain.
- Resumable trainer interview and upload ingestion; structured Constitution, scenarios, corrections, held-out evaluation, shadow/supervised modes, Brain versioning and rollback.
- Client Twin, programs, workouts, offline set logging, safe adaptation, coaching chat, human takeover, subscriber billing and self-service cancellation/refund request.
- Stripe collection and **Lean bank payouts**, monthly reconciliation, immutable financial ledger, marginal commission, AI/voice cost accounting and trainer/admin finance views.
- WHOOP approved integration and rights controls; Apple Health export import and native companion architecture; approved Amazfit/Zepp path or honest import fallback; premium voice with separate consent; one-to-one booking and affiliate attribution where supported.
- Operational admin, audit/event analytics, privacy/legal flows, support, infrastructure, monitoring, backups, incident response and autonomous infrastructure actions through a narrow policy broker.

### What does not delay the first paid pilot

Native per-trainer App Store apps, a social network, a public trainer marketplace, computer-vision form correction, model fine-tuning, permanent GPUs, autonomous medical decisions and a gym ERP are outside launch scope (§1.7). The native HealthKit companion, public WHOOP approval, commercial Zepp approval and voice production rights can be feature-flagged until approved, while the relevant interfaces, states and safe fallbacks are built. Do not advertise unavailable features as live.

## 2. Source-of-truth and execution rules

1. Product behavior and screen inventory: source spec §§1–12 and Appendix J. Business, safety and privacy controls: §§13–17 and Appendices K–N. This plan sets build order, ownership, deliverables and evidence.
2. The latest owner instruction selects Stripe as `PaymentProvider` and Lean Technologies as `PayoutProvider`, preserving the attachment's separate collection/payout roles in the opening table, §§3.2, 10, 16–17 and Appendices A/C/F/G/I/J/L/M/N. Update the master spec when an editable canonical version is established. Record the approved business relationship, bank funding path and exact provider capabilities in the money-flow ADR.
3. Implement small reversible technical choices autonomously and record material choices as ADRs containing context, decision, alternatives, risks and migration path (§16.6). No secrets, raw bank data or sensitive production records in Git, prompts, analytics or screenshots.
4. A feature is complete only when UI, API, migration, authorization, event trace, empty/loading/error/offline states where applicable, monitoring, documentation and a meaningful test path are complete. Mock providers belong in isolated test fixtures only (§16.2).
5. Use a versioned requirements-to-evidence matrix. Every release candidate must map each source-spec acceptance criterion (§17 and Appendix I) to a test, URL, report, recording or signed review; a checkbox without evidence does not count.

## 3. Architecture and repository blueprint

**Deployable shape:** a TypeScript monorepo with a Next.js web/PWA, a modular API service, queue workers and scheduler, and an optional realtime service when guided sessions require it. Keep a separate high-privilege infrastructure broker. Use PostgreSQL with RLS and pgvector, Valkey/BullMQ-compatible jobs, object storage, OpenAPI, an event/outbox pattern, OpenTelemetry and IaC for DigitalOcean. The attachment prefers pnpm/Turborepo, Next.js, Fastify/NestJS-equivalent, DO Managed PostgreSQL/Valkey/Spaces/DOKS and OpenTofu/Helm (§5, §13). Validate package and regional availability at implementation time; do not create dozens of microservices.

```text
apps/web                    public, trainer, subscriber, platform-admin routes
apps/api                    modular domain API and provider webhook entrypoints
apps/worker                 ingestion, coaching, finance, sync, exports, notifications
apps/realtime               guided-session gateway only when justified
apps/infra-broker           narrow privileged infrastructure operations
packages/contracts         API schemas, event schemas, typed domain contracts
packages/ui                Swedish-minimal tokens and accessible components
packages/domain            pure commission, safety, entitlement, decision logic
packages/providers         Stripe, Lean, model, wearable, voice, email, domain, storage
packages/db                migrations, RLS policies, seed data, query layer
infra/                     OpenTofu, Helm, environment configuration
docs/                      ADRs, threat model, data-flow, runbooks, test evidence
tests/                     integration, e2e, adversarial tenant/AI/finance suites
```

**Boundaries:** resolve tenant from verified hostname or authenticated session, never an arbitrary client header. Set tenant context per DB transaction, enforce RLS, namespace cache/objects/vectors/jobs, and keep privileged admin roles separate. All external mutations have stable business-intent idempotency keys; webhook receipts are stored and deduplicated before asynchronous processing. Use the same Brain version, Client Twin snapshot, safety policy, evidence references and decision ID through program generation, workout adaptation, chat and voice. Persist a validated structured `CoachingDecision` before any first-person copy is shown (§§5–8, 12, Appendix M).

**Financial records:** use integer AED minor units, an immutable balanced ledger or equivalent auditable postings, source object references and compensating entries. Separate subscriber payment state, customer entitlements, trainer liability, platform revenue, Stripe settlement, company bank cash and trainer bank payout state. Stripe and Lean events are evidence of external state; reconcile them with bank records into the internal accounting ledger. Stripe collection success does not mean cash is available in the company bank, and Lean initiation or bank acceptance does not mean the trainer has been paid. Record fee schedule and allocation algorithm versions for every charge and adjustment. Finance sign-off must settle the mixed-price marginal-band algorithm before live charging (§10.3, §10.11).

**Payment responsibilities:**

| Step | Responsible component | Evidence |
| --- | --- | --- |
| Collect subscriptions and process refunds/disputes | Stripe `PaymentProvider` | Subscription, invoice, charge, refund and balance transaction IDs |
| Settle collections to the company bank | Stripe and the company's bank | Stripe settlement/payout record matched to a bank credit |
| Calculate monthly trainer earnings and deductions | Platform ledger and close process | Versioned gross-to-net statement, holds and payable allocation |
| Pay verified personal/business UAE IBANs | Lean `PayoutProvider`, using the company bank as source | Beneficiary ID, payment instruction ID and enabled authorization flow |
| Confirm payment and reconcile exceptions | Platform finance worker with Lean and bank evidence | Confirmed final outcome, bank reference and any failure/return adjustment |

The company bank connection is platform configuration. Trainer onboarding supplies a verified Lean beneficiary destination. Store provider references and masked bank details in ordinary application records; any required full bank data belongs in a restricted encrypted store.

**Data-rights firewall:** tag every uploaded, wearable and generated record with origin, consent/rights version, allowed-use mask, retention and lineage. The model gateway rejects a prompt if any attached record lacks `model_prompt`; the training compiler rejects data lacking `fine_tune`. Keep trainer-private IP tenant-scoped. Do not feed WHOOP data or derived features to an LLM without documented permission; use only permitted display/deterministic features meanwhile. Apple Health data never enters marketing targeting. Provider rights survive broad privacy-policy language (Appendix K).

**Design:** calm Swedish-minimal system on warm white, ink/navy typography and restrained ice/blue/sand accents; accessible controlled trainer branding rather than arbitrary CSS (§4). English at launch with externalized strings and RTL-ready layout; WCAG 2.2 AA target. Public pages sell the trainer's ownership and economics; trainer UI surfaces exceptions; subscriber workout logging minimizes taps; admin UI gives evidence and drill-down.

## 4. Delivery sequence and gates

Durations are **planning ranges for a dedicated multidisciplinary team**, not a promise from one agent. Workstreams overlap only after the shared schema, access and event contracts settle. Expect roughly **4–6 months to a controlled paid pilot** and **9–15+ months for the full specified production scope** with approximately 4–6 experienced engineers plus design, QA and fractional security/finance/legal support. External provider approvals, Stripe/Lean account review, source-bank access, counsel and asset production can extend the calendar. Astra can accelerate implementation but cannot waive external gates or create evidence that was never tested.

| Phase | Indicative effort | Main output | Exit gate |
| --- | --- | --- | --- |
| 0 — Prove feasibility | 1–3 weeks | Stripe collection and Lean payout feasibility, money-flow ADR, legal/data-rights/residency review queue, provider/credential register, budget caps | Stripe/Lean sandbox evidence and documented source-bank, beneficiary and payment-confirmation capabilities; unsupported steps remain explicit blockers |
| 1 — Foundation | 3–5 weeks | Monorepo, CI, staging, design tokens, auth/MFA, tenant resolver/RLS, schema, events/outbox, provider contracts, IaC, secrets/alerts | Two isolated test tenants; migration/restore and deployment smoke tests; no cross-tenant reads/writes |
| 2 — Trainer acquisition and Brain capture | 4–7 weeks | Public funnel, calculator/demo, attribution, resumable onboarding, tenant provisioning, upload/interview/rule review, brand preview | Real trainer can register, teach, confirm/reject rules and resume after interruption; no invented testimonials/earnings |
| 3 — Brain evaluation and coaching core | 6–10 weeks | Scenario lab, versioned Brain, shadow/supervised release, Client Twin, safety governor, structured decisions, programs, workout PWA, first-person chat | Golden trainer suite, safety and provenance tests pass; complete trainer/subscriber nonpayment path in staging |
| 4 — Stripe collection, Lean payouts and paid pilot | 4–8 weeks, starts with Phase 0 | Checkout/renewal, Lean beneficiary onboarding and IBAN verification, ledger, commission, refunds/cancellation, monthly bank payouts, reconciliation, finance views | Full sandbox cycle and approval; tightly controlled live canary only after finance/legal/security gates |
| 5 — Wearables and data rights | 4–8 weeks | WHOOP OAuth/webhooks, import fallback, permitted deterministic features, Apple export import, Zepp approved route/fallback | Reconciliation and revocation pass; public WHOOP/Zepp and native HealthKit remain off until approved |
| 6 — Domains, bookings and lifecycle | 3–6 weeks | Wildcard tenant routing, optional paid domain workflow, human bookings, notification journeys, conversion experiments | DNS/TLS/renewal and paid purchase tests; subscription exit and lifecycle messages truthful and usable |
| 7 — Premium voice and native companion | 6–12 weeks | Voice consent/enrollment, guided Session Director, metering/fallback, native HealthKit/BLE companion if approved | Consent and revocation enforced; latency/cost/load tests; store review and payment policy checked for companion |
| 8 — Full operations and launch hardening | 4–8 weeks, overlaps earlier phases | Super-admin/support/FinOps, infra policy broker, penetration and load tests, restore exercise, runbooks, canary/rollback | All §17 gates evidenced, counsel/accounting sign-off, reconciliation and alerts working, operator handoff accepted |

### Phase 0 — decisions and evidence before architecture locks

**P0-01 Stripe and Lean feasibility, owner: finance/backend.** Validate Stripe Checkout/Billing collection on the existing account and settlement to the company's own UAE bank account. Obtain provider acceptance of the actual platform/trainer relationship and money flow; document the merchant of record and responsibilities for refunds/disputes. With Lean, confirm the company's source bank/account is supported, payout access is enabled, fees/limits/cutoffs are known, and the required automatic or manual authorization flow is available. Confirm destination requirements for individual trainers using personal UAE IBANs and businesses using business IBANs, including account ownership and required identity/business information.

Exercise subscription collection, Stripe settlement records, bank-credit matching, monthly earnings allocation, Lean beneficiary creation/verification, payout initiation and final outcome in the available test environments. Record any cross-provider/bank step the sandboxes cannot demonstrate as a live-canary gate. Test insufficient cash, rejected/returned payouts, duplicate requests/events, timeouts with unknown outcomes, missed callbacks, refund after payout and a dispute. Capture provider IDs, fees, timing and supported reconciliation queries. Lean's `ACCEPTED_BY_BANK` is not final payment confirmation: verify the enabled final-status feed for the chosen bank/account, its meaning, and a bank-record reconciliation fallback. Confirm automatic authorization and payment-finality availability for this account rather than assuming documentation features are enabled. Conduct any required small live bank proof only within the separately authorized pilot controls.

**P0-02 Legal, privacy and tax, owner: counsel/accountant/product.** Document the actual platform/trainer commercial relationship, merchant of record, UAE VAT/invoicing, licensing and insurance policy, cancellation/refunds, data processing/cross-border transfers and health-data residency. The specification deliberately defers licence upload as a product signup gate; verified Stripe, Lean, bank and legal requirements can still gate live selling or payout. Individual payout support does not determine the permission needed to provide paid coaching. Produce a written decision table by trainer type and financial state, aligned with provider acceptance of the collection model. Prepare counsel-ready Subscriber Terms, Trainer Agreement, assumption-of-risk, AI disclosure, Privacy Policy, wearable consent and voice consent; publish only reviewed versions (§14, Appendix E). Absolute injury immunity and hidden sensitive-data/model use are not viable product assumptions.

**P0-03 Infrastructure/provider feasibility, owner: platform.** Select a DO candidate region only after UAE mobile latency measurement and legal residency review; price a small staging and a production baseline and obtain spend caps. Check managed Postgres PITR/RPO support, pgvector, Kubernetes/Valkey availability and backup restore. Register WHOOP early because development access is limited and wider use needs approval. Check current WHOOP terms at build and launch time, approved Zepp commercial access, Apple native program/store requirements, domain registrar API coverage and voice provider consent rules. Record exact feature flags and fallbacks for each unavailable provider.

**P0-04 Contracts, owner: tech lead.** Decide tenant context, OpenAPI conventions, `CoachingDecision`, Brain/Client snapshots, event envelope, webhook inbox/outbox, data-rights labels, ledger posting model, fee-band allocation and provider adapter contracts. Produce ADRs and risk/assumption register. Define golden trainer fixture and a realistic but de-identified test subscriber cohort. Confirm exact authority and thresholds for paid domains, infrastructure spend, destructive operations, live charging and payouts.

### Phase 1 — platform foundation

**F-01 Repo and delivery:** README, workspace/build scripts, code owners, lint/type/test jobs, dependency/secret/SBOM scans, migration validation, preview/staging environments, immutable image build, canary/rollback. Separate staging and production DB, secrets, Stripe modes, Lean environments, bank connections, webhooks and buckets. Keep live bank credentials and destinations unavailable to test jobs. Provision with IaC; document costs and state location.

**F-02 Identity/tenancy:** magic-link/password/passkey selection; MFA and re-auth for privileged actions; roles for owner, staff, subscriber, support, finance, safety, admin and service. Tenant creation is an idempotent orchestration job. Wildcard subdomain reservation, reserved names and homoglyph controls, verified hostname resolution, RLS, signed job context, scoped storage/pgvector/cache. Adversarial cross-tenant tests cover API, DB, retrieval, jobs, analytics and signed files.

**F-03 Contracts and operations:** append-only event ledger, transactional outbox, schema registry, job envelopes/dead letters, consent/version ledger, feature flags/kill switch, correlated logs and traces, initial admin/support audit view, support-safe error IDs. Sensitive raw workout, health and message bodies are referenced rather than copied into funnel telemetry.

**F-04 UI system:** tokenized typography/colors/spacing, brand validation, shared accessible controls, error/loading/empty/denied/disconnected/offline states, responsive and RTL-safe layout. Add visual review on representative iPhone, Android and desktop widths.

### Phase 2 — trainer activation and the Brain Compiler

**T-01 Acquisition:** `/`, `/how-it-works`, `/demo`, `/pricing`, `/faq`, `/signup`, `/login`, legal routes; live-feeling correction-to-rule demo, marginal-fee calculator with explicitly illustrative results, honest proof, one primary CTA. Version experiments and preserve first/last attribution through first paid subscriber; report activation quality rather than signup alone (§2, Appendix J).

**T-02 Onboarding:** persisted state machine for business identity, brand, Brain intro, interview, uploads, knowledge review, scenario lab, readiness, offer/pricing, Lean payout beneficiary and bank verification, wearables/voice options, subdomain, preview and publish. The trainer can resume on another device. No licence upload blocks tenant or Brain creation by default; live commerce status follows Phase 0 policy. Automatic provisioning has retry/status/compensation instead of a permanently spinning wizard.

**B-01 Ingestion:** virus/type/size validation, tenant object isolation, extraction from PDF/Word/CSV/XLSX/text/audio/video transcripts as applicable, dedupe/hash, PII flags, rights attestation, historical active-client vs de-identified-example classification, human review for uncertain material, source/evidence links. Uploaded instructions are untrusted data and never override platform prompts.

**B-02 Brain representation:** identity, Constitution, preferences, knowledge, episodes, trainer corrections/preference pairs, evaluation set, autonomy policy and versioned releases. Candidate rules require explicit trainer confirmation; conflicts are presented for resolution. Trainer A's private material never trains Trainer B. A new version passes held-out and safety regression, then shadow/supervised rollout and monitored promotion/rollback. Fine-tuning is an optional later optimization only if it wins blind preference, fidelity, safety, latency and cost tests (§6).

### Phase 3 — subscriber experience and safe runtime

**C-01 Intake and Twin:** 18+ gate, goals, experience, equipment, schedule, limitations, baseline and consent; distinguish unknown, denied and missing data. Version the Client Twin, source lineage, coverage and rolling features. Give trainer/subscriber privacy and correction controls. No medical diagnosis.

**C-02 Decision pipeline:** input a pinned Brain version and Twin snapshot; enforce safety > Constitution > approved block > client constraints > episodes > generic reasoning > tone. Generate structured JSON, validate schema and constraints, apply autonomy, store evidence and cost, then render first-person text without new facts. Low confidence routes to conservative non-action/human review. Never imply the trainer personally observed form or typed a synthetic message; use compact truthful digital disclosure (§7).

**C-03 Training loop:** validated program/block, exercise library, substitutions, sessions, local-first set logging with idempotent replay/conflict UI, timers, progress, limited in-session/between-session/block adaptation. Pain/issue button interrupts normal flow; red flags stop workout and escalate without diagnosis. Trainer gets an exception queue and can take over chat, approve/edit decisions and teach the Brain through meaningful corrections (§8, §14).

**C-04 Evaluation:** golden trainer scenarios, held-out coach agreement, fabricated-evidence detection, first-person regression, prompt injection, partial wearables, out-of-scope medical prompts and cross-tenant probes. After retry/fallback, structured decision validity must exceed 99.9% in the defined evaluation set; critical red-flag bypasses and cross-tenant leaks are zero tolerance (§17.2). Version dataset, prompts, schema, models and safety policy with each result.

### Phase 4 — Stripe billing, Lean payouts and finance

**M-01 Checkout/entitlements:** platform Stripe product/price and recurring Checkout/Billing flow under the approved commercial model, with tenant/storefront metadata. Map subscriptions/invoices/charges to internal IDs and track settlement to the company bank separately from subscriber payment success. Preserve attributions, handle payment failure, renewal, grace, upgrade/downgrade, period-end cancellation and reactivation. Subscriber can cancel renewal without trainer/support permission, keeps access until the displayed period end and gets immediate confirmation; refund is a separate action (§10.4–10.6).

**M-02 Lean beneficiaries and UAE IBAN:** connect the company's approved source bank through Lean's supported business onboarding. For each trainer, collect the required personal/business identity and destination details, verify UAE IBAN and account ownership through the approved flow, create the Lean beneficiary, and wait for confirmation before enabling payouts. Store provider IDs, verification evidence references and masked IBAN; restrict and encrypt any required raw bank data. Show required information, verification status, holds and actionable failure reasons. Internal trainer financial status is `not_started`, `onboarding`, `requirements_due`, `verified`, `restricted` or `held`, mapped from actual provider and policy evidence. A checksum alone cannot establish ownership or payout readiness. Re-authenticate and audit bank-detail changes, reverify the destination and apply the agreed payout hold.

**M-03 Immutable money flow:** implement minor-unit balanced postings for customer charges, taxes if applicable, processor fees, platform fee, trainer payable, AI/voice/domain charges, refunds/disputes/reserves, Stripe settlement to the company bank, bank cash, Lean payout in transit, confirmed payment, payout fees and failed/returned corrections. Preserve the effective fee schedule and deterministic mixed-price allocation, including the 25%/20%/15%/10% **marginal** subscriber bands (§1.4). Reconcile Stripe balance transactions and settlements, company bank credits/debits, Lean payment records and internal statements. Preserve the obligation while a payout is pending; discharge it only on proven payment. Test cutoffs, proration, currency, fees, reversals and negative future balances.

**M-04 Monthly settlement:** close an eligible period once and compute payable by trainer after holds/adjustments. Produce a dry run showing verified beneficiaries, amounts, fees, available bank cash and required reserves; run only approved instructions through Lean from the funded company bank. Use a stable payout-intent ID tied to allocated ledger liabilities, a database uniqueness constraint and the provider's supported duplicate controls. Statement revisions must not pay liabilities already allocated to an in-flight or completed instruction. A timeout or unknown result enters reconciliation; query the existing instruction before considering a retry. Retry a confirmed failed instruction only after remediation and under a controlled attempt linked to the same obligation. Map initiation, authorization, bank acceptance, final payment, rejection and return into explicit internal states. Keep bank-accepted payments pending until supported final evidence arrives; returns reopen the payable through compensating entries. Keep trainer-visible gross-to-net statements and an admin exception queue. No live payout until a dry run, negative-path tests and finance sign-off (§10.7, §17.3).

**M-05 Refund/dispute:** specific charge refund request within seven calendar days, trainer approve/decline with notification and audit, exceptional admin override, Stripe refund outcome and offset to current or future payable. A pending request never silently cancels renewal; a cancellation never silently issues a refund. A refund or dispute after a Lean bank payment is funded through the agreed reserves/recovery policy; issuing a Stripe refund does not reverse that bank payment. Track future-payable offsets or other contractually approved recovery separately. Verify Stripe webhook signatures and Lean callbacks using each provider's documented authentication mechanism; persist and deduplicate receipts, acknowledge promptly and process asynchronously. Recover missed events through supported queries and bank reconciliation, keeping uncertain payouts in the exception queue.

### Phase 5 — integrations and product expansion

**W-01 WHOOP:** OAuth/scopes, encrypted rotating tokens, v2 webhooks, dedupe and periodic reconciliation, scoped display and deterministic fitness features. Record provider policy version and data permissions. Public rollout waits for WHOOP approval; no WHOOP-to-LLM path without documented approval. Cloud API data is not live continuous heart rate; BLE is a separate companion path (§9, Appendix K).

**W-02 Apple/Amazfit:** launch Apple Health export ZIP/XML import with exactly reported categories/date range and delete/re-import. Architect native iOS HealthKit/BLE sync with fine-grained consent, idempotent records and partial-access semantics; validate App Store purchase/link rules before shipping a consumer companion. For Amazfit/Zepp, use an approved cloud/device/BLE integration if available, otherwise label and ship a manual import; no undocumented credential scraping or unsupported promise.

**DOM-01 Domains:** automatic wildcard subdomains, tenant routing/TLS and safe slug changes. For paid custom domains: availability + final quoted price + registrant/terms confirmation, Stripe charge, registrar purchase, DNS/TLS/route checks, renewals and support status. Non-refundable purchase above the approved price threshold requires explicit confirmation; failed purchase/provisioning retains the working subdomain (§10.13–10.14).

**P-01 Premium/lifecycle:** versioned notifications for trainer activation, stuck onboarding, subscriber intake/workout/payment, human escalation and payout. Add one-to-one booking/upsell with availability, price, cancellation policy and ledger allocation. Affiliate recommendations require provider permission and disclosure; do not link Amazon sub-tags to individual users in a prohibited manner (Appendix F.8).

**V-01 Guided voice:** separate trainer identity/voice rights verification and revocable consent, trainer-scoped cached cues, dynamic Session Director, voice/text/timer fallback, metering and premium entitlements. Do not expose provider voice ID in browser; disable future generation immediately on revocation. Test a 30–45 minute session for latency, interruption, partial connectivity, consent race and variable cost (§8.6–8.8).

### Phase 8 — operation, security and production launch

**O-01 Admin and support:** role-appropriate overview, trainer/subscriber 360, Brain evaluation, safety, financial reconciliations, refunds/payout holds, integration health, conversion cohorts, AI cost, domains, support cases, experiments and feature policies. Admin impersonation needs MFA, explicit reason, read-only default, visible banner, expiry and audit (§11, Appendix J).

**O-02 Infrastructure:** DOKS HPA/cluster autoscaling for routine load. Infrastructure Governor observes metrics and proposes actions; a deterministic broker enforces identity, action allowlist, resource scope, cost cap, rate limit, approvals and rollback. Begin in observe-only mode; enable narrow reversible operations after chaos/rollback tests. Never send secrets to a model or let it authorize destructive DB/DNS/security changes (§13).

**O-03 Release evidence:** security/privacy review, penetration tests, accessibility, UAE mobile performance, load/webhook bursts, migration rollback, key rotation, restore exercise, reconciliation and on-call drill. Targets from §15: core availability 99.9%; set-log API p95 <400 ms on defined UAE path; database RPO <=15 minutes and critical service RTO <=60 minutes **only if demonstrated with selected provider configuration**. Canary with small consented pilot, monitor and roll back on safety/finance/tenant isolation regressions.

## 5. Explicit production and provider gates

| Gate | Required proof | If pending |
| --- | --- | --- |
| Stripe collection + Lean UAE payouts | Approved platform/trainer funds flow, Stripe settlement to the company bank, supported Lean source account, personal/business beneficiary requirements, authorization, fees, final outcomes and negative/failure cases tested | Continue Brain/product work; keep selling or payout for affected trainer types off |
| Money/tax | Merchant-of-record, invoices/VAT, commission allocation, balances/holds and refund policy signed by finance and UAE counsel | Sandbox only; no real charge/payout |
| Data residency | UAE counsel approves chosen region and transfers/health classification; latency and restore proven | No sensitive production data in unapproved region; consider UAE-resident sensitive-data plane |
| Legal and safety | Versioned counsel-reviewed documents and consents, injury escalation copy, emergency guidance, insurance/licence policy | No public paid launch |
| Trainer Brain | Held-out eval, zero critical safety bypass, provenance, tenant isolation, shadow/supervised evidence and rollback | Keep in shadow or trainer approval mode |
| WHOOP | Current terms/rights matrix and public app approval; written permission for any restricted model use | WHOOP off or limited to approved deterministic use, other input paths work |
| Apple/Zepp/voice | Provider/store approval and scoped consent where needed | Flag off and show honest import/text fallback |
| Domains/infra automation | Live purchase price/registrant confirmation; broker spend/privilege limits and rollback | Use subdomain; governor observe-only |

The WHOOP API terms currently published on its developer site show an **effective date of 6 October 2026**, later than this plan's date, and restrict AI/model-related uses and caching. Treat them as a forward launch constraint, recheck both the terms presently in force and the terms effective at go-live, and get explicit provider/legal guidance before any model use. DigitalOcean's published region list as checked for this plan has no UAE region. Apple App Review restricts use of HealthKit data for advertising and marketing. See official references at the end; provider wording and entitlements may change.

## 6. Initial issue-ready backlog and ordering

Create GitHub milestones/issues from this table. Each issue carries a design/API contract, owner, acceptance checks, screenshots or trace evidence when relevant, and dependency IDs. `P0` is a blocker to the core paid path; `P1` completes the specified product; `P2` is an approved later optimization. The phase descriptions above define the detailed acceptance conditions.

| ID | Priority | Issue | Depends on |
| --- | --- | --- | --- |
| 001 | P0 | Prove Stripe collection/settlement and Lean UAE bank payouts with individual and business beneficiaries | Stripe/Lean access, source-bank access |
| 002 | P0 | Approve collection model, company-bank funds flow, beneficiary requirements and merchant of record in ADR | 001, counsel |
| 003 | P0 | Region, cross-border and health-data legal gate | counsel |
| 004 | P0 | Agree budget caps, credentials, live-charge/payout release controls | operator |
| 005 | P0 | Initialize monorepo, CI, staging, IaC and separate secrets | 003 for production region |
| 006 | P0 | Authentication, MFA, roles, tenant provisioning and hostname resolution | 005 |
| 007 | P0 | PostgreSQL schema/RLS, signed jobs, storage/vector/cache isolation tests | 006 |
| 008 | P0 | Event/outbox, consent, provider interfaces and feature flags | 005–007 |
| 009 | P0 | Swedish-minimal accessible design system and responsive shells | 005 |
| 010 | P0 | Acquisition funnel, calculator, demo and attribution | 008–009 |
| 011 | P0 | Resumable trainer onboarding, tenant/brand/storefront draft | 006, 009 |
| 012 | P0 | Safe file ingestion, source rights, PII and knowledge review | 007–008, 011 |
| 013 | P0 | Interview, Constitution, conflicts, scenario lab and corrections | 012 |
| 014 | P0 | Versioned Brain, golden eval, shadow/supervised promotion/rollback | 013 |
| 015 | P0 | Client Twin intake, snapshots, provenance and consent | 007–008 |
| 016 | P0 | Structured Coach Runtime, safety governor and model rights firewall | 014–015 |
| 017 | P0 | Programs, workout PWA/offline sync, chat and trainer exceptions | 016 |
| 018 | P0 | Stripe checkout, recurring subscriptions and entitlements | 001–002, 007–008 |
| 019 | P0 | Lean source-bank setup, beneficiary onboarding and UAE IBAN ownership/status | 001–002, 011 |
| 020 | P0 | Immutable ledger, marginal fees, AI metering, Stripe/Lean/bank reconciliation | 018–019 |
| 021 | P0 | Self-service cancellation, refund approval/override and disputes | 018, 020 |
| 022 | P0 | Monthly Lean payouts, duplicate prevention and unknown/failed/returned payment recovery | 019–021 |
| 023 | P0 | Versioned legal pages, consent flows, export/delete, safety incident workflow | 003, 008, counsel |
| 024 | P0 | Full trainer → paid subscriber → workout → payout staging E2E | 010–023 |
| 025 | P0 | Security, accessibility, load, backup/restore, canary and on-call evidence | 024 |
| 026 | P1 | WHOOP OAuth/webhooks/reconciliation/rights and app approval | 008, 015–016 |
| 027 | P1 | Apple Health import and Zepp approved adapter/fallback | 008, 015–016 |
| 028 | P1 | Custom domain quote/purchase/DNS/TLS/renewal | 008, 011, 018 |
| 029 | P1 | Guided voice consent, Session Director, usage/entitlements/fallback | 016–017, 020, 023 |
| 030 | P1 | Human bookings, lifecycle messages and attribution experiments | 010–011, 018–020 |
| 031 | P1 | Trainer/admin/support/finance/FinOps dashboards and event drill-down | 008, 020, 024 |
| 032 | P1 | Infrastructure policy broker and observe-only Governor then safe actions | 005, 025 |
| 033 | P1 | Native HealthKit/BLE companion and app review | 027, 023, Apple account |
| 034 | P2 | Bespoke model training only if evaluation/economics justify it | 014–017, data rights |

**First working sprint:** resolve 001–004 and author the cross-cutting contracts/ADRs; in parallel create 005, the golden trainer test fixture and initial design primitives. Establish Stripe/Lean/bank feasibility and residency requirements before committing to production financial or infrastructure choices.

## 7. Pilot and full release acceptance

**Controlled paid pilot:** an approved UAE trainer signs up, teaches and approves a Brain, passes evaluation, registers a verified Lean beneficiary with an eligible UAE IBAN, publishes a branded subdomain, creates a recurring product and enrolls a real subscriber. The subscriber understands the automated service, pays through Stripe, completes intake, receives a validated program, logs workouts, gets truthful first-person guidance, cancels renewal independently, and can request a charge-specific refund for trainer review. The trainer sees exceptions, Brain evidence, charges, fees and expected payout. Confirm Stripe settlement into the company bank, perform a monthly dry run, then execute an approved Lean payout. Match the ledger, Stripe records, bank credits/debits and Lean final outcome, including fees and the trainer's receipt. Cross-tenant and red-flag safety tests pass. Counsel signs relevant data, finance and legal gates.

**Full specification release:** finish every applicable screen/state in Appendix J; audited platform admin/support; wearable provider/rights and import paths; domain lifecycle; booking, lifecycle experiments and optional voice/native companion when approved; AI/infra cost drill-down and guarded Infrastructure Governor; GDPR-like/UAE applicable access/export/delete workflows; restoration, rollback, secret rotation, alerting and incident runbooks. Feature flags may hide capabilities awaiting third-party approval only when the source spec explicitly allows it and customers are told the truth. The handoff includes README/setup, ADRs, OpenAPI, migrations, provider inventory, prompt/eval registry, test reports, legal versions, Finance/DSR/incident/payout runbooks, production URLs, monitoring and known limitations (Appendix I).

**Business gates are measured, not promised:** activated trainer = 10 paying subscribers within 45 days (configurable); initial targets are activated-trainer CAC <= AED 1,000, payback at 10 subscribers <=3 months, core non-voice COGS <= AED 10 per active subscriber/month, and contribution margin >=70% (§1.5). Record acquisition, Brain bootstrap, Stripe collection, Lean/bank payout, model, support, storage, domain and voice costs separately. Do not manufacture positive pilot metrics or conflate the platform's recognized revenue with GMV.

## 8. Decisions and unresolved facts

| ID | Current instruction / recommendation | Evidence needed before irreversible implementation |
| --- | --- | --- |
| D-01 | **Stripe collects subscriber payments; Lean pays eligible trainers' personal/business UAE IBANs monthly from the company bank** | Existing Stripe account supports the approved collection model; Lean supports the source bank/account, beneficiary types, required authorization and confirmed outcomes. Verify limits, timing, cost, liquidity and failure handling. |
| D-02 | Platform-side subscriber collection with an explicit trainer/platform relationship and separate payout provider | UAE counsel and accountant approve merchant-of-record, VAT, invoice and liability wording; Stripe and Lean accept the actual business model and funds flow. |
| D-03 | Trainer signup and Brain setup are open before licence upload | Counsel and verified Stripe/Lean/bank requirements determine which commerce/payout actions must wait for documents; policy lives centrally, with a truthful status shown to trainer. |
| D-04 | DO remains preferred compute, region not selected | Benchmark latency and receive health-data/residency and cross-border sign-off; preserve a sensitive-data residency adapter. |
| D-05 | WHOOP AI path off until permissions established | Terms in force at launch, approval and written authorization for any use that touches AI systems; no model-prompt use by default. |
| D-06 | Apple export import first; native companion later | Developer account, HealthKit permissions and App Review/IAP policy for digital subscription flows. |
| D-07 | Voice is a premium consent-gated capability | Provider terms, verified trainer authorization, revocation, cost and latency evidence. |
| D-08 | Fee bands are marginal, with a documented mixed-price allocation | Finance-approved worked examples covering 99/100/101/300/301/1000/1001 users, different prices, churn and refunds. |
| D-09 | No fixed hardcoded provider costs or services | Provider price catalog with effective dates, budget cap, per-tenant limits and usage reconciliation. |

## 9. Official references to recheck at implementation and launch

- [Stripe UAE Services Agreement](https://stripe.com/legal/ssa/ae) and [merchant-of-record guidance](https://docs.stripe.com/connect/merchant-of-record) inform the collection model, ownership of the settlement bank account and customer-facing responsibilities. Confirm the actual platform/trainer arrangement with Stripe before live collection.
- [Lean UAE Payouts](https://leantech.me/uae/en/products/payments/payouts) describes business payouts to third parties, including freelancers and creators. [Account verification](https://docs.leantech.me/v2.0-UAE/reference/internationalavsverification) includes personal and business UAE account types; confirm requirements for the actual trainer category and source bank.
- [Lean single-payment mechanism](https://docs.leantech.me/v2.0-UAE/docs/single-payment-mechanism) covers beneficiary creation, initiation and asynchronous outcomes. [Authorization flows](https://docs.leantech.me/v2.0-UAE/docs/payouts-authorization-flows-overview) describes automatic/manual authorization and availability qualifications; verify the enabled final-status capability before treating a payment as complete.
- [WHOOP app approval](https://developer.whoop.com/docs/developing/app-approval/) limits immediate development use and requires approval for a wider launch; [WHOOP API terms](https://developer.whoop.com/api-terms-of-use/) contain restrictions and an effective date to verify.
- [DigitalOcean regional availability](https://docs.digitalocean.com/platform/regional-availability/) currently lists no UAE region; [Apple App Review guidelines](https://developer.apple.com/app-store/review/guidelines/) restrict HealthKit data use and digital purchase flows.
