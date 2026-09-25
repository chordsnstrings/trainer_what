# Operations, costs and release

Status: planned; credentials, infrastructure and production evidence have not been validated in this planning task. This document completes the operational work packages in the [roadmap](DELIVERY_ROADMAP.md).

## 1. Dependency register

Record owner, test/live environment, granted scopes, expiry/rotation, capability evidence, cost schedule and last verification date for each integration. Store references to secrets, never values. No connection attempt is required merely to finish this plan.

| Dependency | Required input/evidence | What can proceed while pending |
| --- | --- | --- |
| Stripe | Secure test/live credentials and signing secret; accepted commercial model; Billing/settlement/refund/dispute capability | Domain rules, contract fixtures, entitlement and ledger implementation; live charging disabled |
| Lean + company bank | Business/source-bank approval, API access, beneficiary/ownership requirements, fees/limits, authorization, status/finality and bank evidence | Beneficiary UI, payout state machine, reconciliation and duplicate/timeout fixtures; live payouts disabled |
| DigitalOcean | Owner authorized wholly new resources; existing resources must remain untouched. App account/region/size reads succeeded on 25 September. Project/VPC/firewall and host setup remain unavailable; direct shell HTTPS and browser project access fail. No resource created or restore/deployment verification | Use DIGITALOCEAN_DEPLOYMENT.md and create-response ownership IDs; implement the required Git-triggered release workflow. Customer-data placement remains separately reviewed |
| DNS/platform identity | Platform domain, DNS control, legal company details, approved brand/assets | Reserved-slug and tenant-theme work with nonpublic test hosts |
| Authentication/email | Selected provider/config, sending-domain verification, callback URLs and delivery evidence | Provider contract and isolated auth/message fixtures; real login/email tests await configuration |
| Models/embeddings/STT | Supplied provider access, approved privacy/region/retention terms, quality results and price catalog | Prompt/schema registry, rights firewall, deterministic fixtures and evaluation harness |
| WHOOP | Developer app/scopes, test access, production approval, current use/retention permission | Adapter, flags, manual inputs, approved deterministic fallback; AI path remains gated |
| Zepp/Amazfit | Approved commercial/API route and terms | Labelled import/manual path; no undocumented credential scraping |
| Apple | Export fixtures; developer/store account and HealthKit/BLE entitlements for companion | Export import and native architecture; public app waits for review |
| Voice | Identity/voice consent, provider rights, credentials, usage units/cost and deletion behavior | Session Director/text/timer fallback and metering fixtures; generation disabled |
| Domains | Registrar API/purchase support, registrant/billing details, actual quote and renewal terms | Free subdomain; custom-domain state machine and sandbox where available |
| Legal/finance | Reviewed agreements, safety/age scope, privacy/residency, tax/commission/refund/reserve policies | Draft workflows and policy configuration; gated production actions remain unavailable |
| Operations/pilot | Named support/safety/finance contacts, alert destination, pilot consent and release authority | Runbooks, synthetic drills and evidence collection |

Provider prices, bank coverage, app rules and legal requirements are time-sensitive. Recheck official sources through the permitted economical research route at implementation and before launch. The planning package does not turn prior research into an account-specific approval.

## 2. Deployment path

1. **Local:** reproducible containers/services, synthetic fixtures, two tenants, deterministic provider simulators isolated from production; documented setup and environment schema.
2. **CI:** lint/type/build, changed-domain checks, RLS/finance/safety contracts when affected, migration validation, dependency/secret scan, immutable image with commit/digest. No production secrets in pull-request jobs.
3. **Staging:** separate DB/storage/queues/provider modes and credentials; deploy backward-compatible migrations, API/workers then web; seed only synthetic/de-identified approved fixtures. Run core browser smoke and provider sandbox checks.
4. **Release candidate:** capture evidence against a fixed commit and configuration. Confirm access, backup/restore, DNS/TLS, webhook routes, policy versions, source-bank funding, feature flags and operator ownership for enabled scope.
5. **Canary:** approved small cohort, conservative Brain autonomy and amount/capacity limits. Observe safety, financial differences, support load, latency and costs. Expand only after thresholds and enabled-feature evidence pass.
6. **Rollback:** disable the affected feature/provider, restore last healthy image/config/Brain version, pause unsafe jobs and reconcile pending external effects. Database changes use expand/migrate/contract sequencing; do not erase financial state to roll back code.

Infrastructure is reproducible IaC with secured, locked state. Staging and production have separate primary stores and secrets. Set minimum/maximum replicas, worker concurrency, DB connection limits, backup retention and spend alerts from measured load and approved budget. Avoid permanent GPUs and extra services until justified by evidence.

## 3. Evidence gates

All entries below begin **PENDING**. Future evidence belongs under `docs/evidence/<issue-or-release>/` or an access-controlled artifact location when sensitive. Each record includes commit, environment, date, fixture size, result, limitations and responsible reviewer. Links to planned tests do not count as passing results.

| Gate | Required evidence before enabled production use | Work IDs |
| --- | --- | --- |
| Tenant boundary | API/DB/object/vector/cache/job/export probes across two tenants; connection-pool and webhook mapping cases | 006–008, 025 |
| Identity/access | Signup/resume, session/MFA, role invite/revoke, host mismatch, privileged elevation and expiry | 006, 011, 031 |
| Conversion | Mobile performance budget, attribution persistence, all CTAs, calculator bands, accessible responsive review | 009–011, 030 |
| Brain | Sources/rights/conflicts, held-out metrics, no fabricated evidence, version promotion/rollback and shadow evidence | 012–014 |
| Runtime/safety | >99.9% structured validity after allowed fallback on the defined suite; zero critical safety bypass or tenant leak; pinned evidence; injection tests | 015–017, 023 |
| Workout/chat | Offline replay, two-device conflict, pain interrupt, human takeover, safe provider-failure behavior | 017 |
| Subscription | Create/renew/change/fail/grace/cancel/reactivate; verified access projection; replay and out-of-order events | 018, 024 |
| Refund/dispute | Seven-day request, approval/decline/override, provider result, aging escalation and post-payout adjustment | 021, 024 |
| Ledger/fees | Balanced journals; independent band/rounding/mixed-price cases; reconciliation and explainable statement exports | 002, 020 |
| Lean payout | Beneficiary verification; funded source; authorization; duplicate/timeout/missed-event/failure/return; proven final outcome | 001, 019, 022 |
| Full financial cycle | Stripe charge → company-bank settlement → monthly close → Lean bank payment; matched fee/amount/reference evidence | 024 |
| Wearable rights | Scope/refresh/revoke/partial/stale data, allowed-use inheritance, restricted model inputs rejected | 026–027, 033 |
| Voice | Explicit trainer consent/identity; revocation race; 30–45 minute session; interruption, fallback and actual metering | 029 |
| Domains/bookings | Exact-price and quote-expiry handling; unknown purchase outcome; DNS/TLS/renewal; concurrent booking/cancel/no-show | 028, 030 |
| Privacy/legal | Reviewed versioned documents; adult eligibility; consent/export/deletion and restore-tombstone tests; residency decision | 003, 023 |
| Operations | Secrets/config separation, representative rotation, restore/rollback/autoscaling drills, working operator alerts and support escalation | 004–005, 025, 031–032 |
| Product completeness | Every enabled screen/capability has real data and required states; no dead links; flagged dependencies have truthful UI | 024–031, screen matrix |

Safety failure, tenant leak, duplicate payout, unexplained ledger imbalance or invalid consent blocks release. A feature with external approval pending stays disabled; the release record states the resulting scope. A smaller pilot can ship only the complete approved pilot scope, and is not described as full-spec completion.

## 4. Observability and support

Source targets remain **99.9% core availability**, set-log API **p95 <400 ms** on a defined UAE path, transactional **RPO ≤15 minutes** and critical-service **RTO ≤60 minutes**. Measure under a documented workload and actual provider configuration; fallback or unmet results must be explicit. Do not label a target achieved without evidence.

Dashboards: signup/Brain/publish/activation funnel; subscriptions/GMV/platform revenue/refunds; trainer liability/bank liquidity/payout backlog; per-task model quality/latency/cost; queue age/retries; data freshness/rights failures; safety/override rate; infrastructure usage/spend. Health/fitness data stays out of marketing attribution. Admin financial aggregates reconcile to ledger totals and preserve period/currency definitions.

Every alert has severity, threshold/window, destination, owner and action. Proposed priorities: P0 for active safety harm, tenant exposure or duplicate/unauthorized money movement; P1 for core checkout/coaching/logging outage or stuck financial close; P2 for localized integration/UI degradation. Operator coverage and response commitments must be staffed before launch, not inferred from an automated dashboard.

| Runbook | Immediate response | Recovery proof |
| --- | --- | --- |
| Unknown/duplicate payout | Pause affected intent/run, preserve references and prevent resend; inspect provider/bank evidence | One obligation paid at most once; ledger and trainer communication reconciled |
| Reconciliation gap | Hold affected financial close; compare source versions/fees/amounts | Explained adjustment or resolved missing event; balanced books |
| Safety/Brain regression | Lock affected autonomy, route to human review, restore approved Brain | Golden safety suite and impacted-case review; release approval |
| Tenant/security incident | Restrict affected access, revoke exposed sessions/credentials, preserve audit | Scope established; fix and isolation evidence; required communication workflow |
| Model/wearable/voice outage | Activate allowed fallback; show stale/limited state; throttle retries | Queue drained safely; rights/consent and costs checked |
| Database/deployment failure | Stop incompatible writers; restore/roll back per tested procedure | RPO/RTO measured, pending external effects reconciled, deletion tombstones reapplied |
| Domain/booking failure | Preserve working subdomain or held reservation state; reconcile provider operation | No double purchase/booking; payment and customer status correct |
| Cost anomaly | Cap optional work/concurrency; inspect task/provider pricing and repeated requests | Cause fixed, corrected usage ledger, service/safety preserved |

Schedule daily provider/ledger, usage-cost, wearable freshness and domain checks, plus monthly financial close. Restore exercises occur before launch and at least quarterly thereafter. Keep evidence of delivered alerts and successful recovery.

## 5. Cost controls

### Building with Astra

Use [AGENTS.md](../AGENTS.md) as the execution policy. One task packet contains issue/acceptance criteria, relevant files and a short prior checkpoint. Reuse extracted source, contract decisions and prior research. Use deterministic tools for extraction and comparisons. Use Astra for hard design/code/review; route routine research through an economical available path. Do not promise automatic model routing when the environment does not expose it.

Track request/task, model, available token counts, cache use and actual cost where exposed. Treat estimates separately. Avoid repeated full-document reviews, duplicate parallel work and large unchanged-file outputs. Batch independent reads and conclude a review when the concrete risks are resolved. No fixed currency budget has been approved; record one before new paid infrastructure or separate model-provider spending.

### Running the platform

| Cost category | Unit record | Control |
| --- | --- | --- |
| LLM/embeddings | Task/model/provider, input/cached/output tokens or actual provider units, price version, FX | Per-task/context/output limits, request dedupe, evaluated model routing, tenant caps |
| STT/TTS/voice | Audio duration/characters/provider billable units and session ID | Premium entitlement, session ceiling, cached permitted cues, text/timer fallback |
| Payment/bank | Stripe charge/settlement fees, Lean/bank instruction fees, returns/FX if applicable | Effective fee catalog, reconciliation, payout batching only where supported and economical |
| Infrastructure | Compute/DB/cache/storage/egress/backup/messaging by environment | Approved spend caps, bounded scaling/concurrency, storage lifecycle and capacity alerts |
| Acquisition/onboarding | Media, outreach, support, ingestion/interview/evaluation bootstrap | Activated-trainer cohort ledger; bootstrap cost classified in CAC |
| Support/compliance | Case effort and service/provider charges where available | Exception rate, aging queues and repeat-cause fixes |

`Provider cost = sum(actual billable units × effective unit price)`, with explicit currency conversion where needed. Unpriced calls create exceptions rather than zero-cost entries. `Trainer AI charge = actual recoverable cost × (1 + configured markup)`; a 100% markup means twice cost and 50% gross margin on that charge, subject to approved policy. Show voice separately.

Separate GMV, accountant-defined recognized revenue, variable costs and contribution. Track activated-trainer CAC, payback, subscriber LTV/cohort retention and core COGS. Source targets: activated trainer = 10 paying subscribers within 45 days; CAC ≤AED 1,000; payback ≤3 months at 10 subscribers; core non-voice COGS ≤AED 10/subscriber/month; contribution margin ≥70%. These are hypotheses to measure, not forecasts. Vendor price quotes and a cohort usage forecast are required to produce a credible total budget.

## 6. Lifecycle and handoff

Implement all Appendix L triggers through versioned templates: trainer signup/interview reminders, upload review, payout setup, publish readiness, first subscriber/milestones, exception queue, monthly payout and churn; subscriber incomplete intake, program ready, due/missed/completed workout, disconnected wearable, block complete, failed payment, cancellation, human review and refund updates. Deduplicate sends, obey channel preferences/timezone/quiet hours, suppress obsolete reminders and record trigger/template/delivery/outcome. Necessary security/transactional messages and optional marketing have separate consent semantics.

Operator handoff includes: setup README; architecture/ADRs; migrations and schema; generated OpenAPI; environment and provider register; legal/consent versions; model/prompt/evaluation registry; source-to-evidence matrix; monitoring and alert contacts; finance/payout/refund runbooks; backup/restore/rollback/rotation instructions; production/staging URLs; feature flags and known limitations; accurate cost catalog. Verify another operator can perform one support lookup, one financial reconciliation and one recovery drill using the handoff.
