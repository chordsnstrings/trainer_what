# Technical blueprint

Implementation contract for issues 005–034. These are design decisions and proposed contracts, not implemented endpoints or verified provider capabilities. Source: master spec §§5–14 and Appendices A/B/D/K/M; current payment selection is Stripe + Lean.

The [nutrition integration plan](NUTRITION_INTEGRATION_PLAN.md) adds work IDs 035–044 and governs the two-tier, case-taught nutrition extension. The core nutrition implementation now has local verification; current release evidence and live-service limits are recorded in BUILD_STATUS.md.

## 1. Modules and deployables

Use a TypeScript modular application: Next.js web/PWA, Fastify API, queue workers and a scheduler. Keep domain logic independent of HTTP, queues and vendor SDKs. PostgreSQL is authoritative; Valkey-compatible queues/cache and object storage support it. Add realtime and the infrastructure broker as separately privileged deployables only when their work packages require them. DigitalOcean/DOKS remains the production reference; size and region are decided against actual budget/residency evidence. Pin dependency versions when implementation begins.

| Module | Owns | Depends on |
| --- | --- | --- |
| Identity/tenancy | Accounts, memberships, roles, verified hosts, onboarding | Authentication provider, database |
| Brain compiler | Sources, interviews, confirmed rules, conflicts, scenarios, evaluations, releases | Ingestion, object store, model/embedding adapters |
| Coaching | Client Twin, decisions, programs, workout events, messages, takeover | Released Brain, consent/rights, safety, entitlements |
| Commerce | Products, subscriptions, charges, refunds/disputes, entitlements | Stripe PaymentProvider |
| Finance | Ledger, fee policy, usage charges, close, trainer payable, payout intent | Commerce, Lean PayoutProvider, bank reconciliation |
| Integrations | Wearables/imports, voice, domains, bookings, notifications | Replaceable provider adapters and rights/consent |
| Operations | Audit, support, analytics, experiments, incidents, infra policy | Read models and narrowly scoped administrative commands |

No module writes another module's tables casually. Cross-module work uses domain commands and transactional outbox events. Start with shared database transactions where consistency is required; distribute services only for a measured operational reason.

## 2. Data contract

Use UUID identifiers, UTC timestamps, explicit business timezone, version counters and schema migrations. Every tenant-owned record includes `tenant_id`; relationships use tenant-aware foreign keys where possible. Provider IDs are separate and unique within provider/account/environment scope. Monetary amounts are integer minor units plus currency. Store raw provider status and internal normalized status separately.

| Domain | Main records | Required invariants |
| --- | --- | --- |
| Identity | users, identities, sessions, mfa_methods, memberships, roles, invitations | Server-bound identity; revocation enforced; email normalization; expiring single-use invites |
| Tenancy | tenants, trainer_profiles, domains, themes, onboarding_steps | Slug/verified-host uniqueness; provisioning idempotency; draft separate from published |
| Brain evidence | sources, ingestion_jobs, chunks, interviews, episodes, preference_pairs | Content hash, source location, rights, owner, redaction and extraction version |
| Brain rules/releases | constitution_rules, rule_conflicts, brain_versions, autonomy_policies, eval_scenarios/runs | Immutable release snapshots; one active version per release channel; learning/evaluation separation |
| Client | subscriber_memberships, intake_versions, twins, snapshots, goals, constraints, measurements | Subscriber may join multiple trainers with separate tenant relationships; private data not automatically shared |
| Training | exercises, programs/versions, planned_sessions, workout_sessions, sets, substitutions | Pinned program version; server revision + client event ID; audit corrections |
| Coaching/messages | decisions, conversations, messages, message_sources, takeover_leases | Pinned Brain/Twin/policy; evidence links; synthetic/human provenance; takeover ownership |
| Commerce | products, price_versions, subscriptions, invoices, charges, refunds, disputes, entitlements | Immutable historical price; provider-event dedupe; entitlements derived from verified state |
| Accounting | ledger_accounts, journals/lines, fee_schedules, reserves, statements, reconciliation_gaps | Balanced journal per currency; no destructive financial edits; unique source action; versioned formula |
| Payouts | beneficiaries, bank_connections, close_runs, payout_intents, liability_allocations, attempts | Verified destination; one active allocation per liability amount; unknown instruction never blindly resent |
| AI/costs | model_requests, token_usage, provider_price_versions, cost_adjustments, usage_charges | Trace/provider ID, task, tenant/client, raw units, price version; estimated vs actual distinguished |
| Wearables | connections, encrypted_tokens, samples, external_workouts, features, lineage | Deduped source IDs; measurement vs ingestion time; quality/coverage; propagated rights |
| Voice | voice_consents, profiles/assets, guided_sessions/events, generation_requests | Scoped consent checked at generation and playback access; revocation; metered units |
| Bookings/domains | availability, booking_holds/reservations, domain_quotes/orders/operations | Unique resource/time reservation; expiring quote/hold; external-operation idempotency |
| Governance | consent/doc_versions, audit/events, outbox/inbox, jobs, exports/deletions, incidents, experiments | Exact accepted document; restricted sensitive payloads; event sequence/trace; retention basis |

Use indexes from Appendix M: tenant/time timelines, tenant/status queues, unique provider references, subscriber/session history, active Brain release, due subscriptions/jobs, consent versions and payout allocation keys. Profile critical queries with realistic cardinality before adding broad indexes. Partition high-volume event/sample tables only when measured growth warrants it.

## 3. Authorization and isolation

Resolve tenant from verified hostname and authenticated membership. Never trust a caller-supplied tenant header. Set tenant/user context per transaction; test connection-pool reuse for context leakage. Enable and enforce RLS with an ordinary application role that cannot bypass it; migrations and platform administration use separate roles. Object URLs, vector queries, cache keys, jobs, exports and analytics obey the same tenant boundary.

Subscribers access their own relationship records; trainer owners access their tenant; staff permissions restrict finance/Brain/team actions. Finance, safety and support receive separate platform scopes. Admin elevation requires MFA, reason, time limit and audit. Support views redact bank, health and message details unless the case and role permit access. Webhook tenant mapping comes from verified provider-account/object references.

## 4. API and event conventions

Canonical prefix: `/api/v1`. Generate OpenAPI from validated schemas during implementation; this table defines families and acceptance scope. Mutations use explicit authorization, request IDs, stable idempotency keys where side effects occur, and expected versions for concurrent edits. Return `{code, message, request_id, details}` errors with safe field details, cursor pagination and consistent timestamps.

| API family | Commands/queries to implement | Critical protection |
| --- | --- | --- |
| `/auth`, `/me`, `/tenant`, `/team` | Login/session/MFA, tenant bootstrap, invites, roles | Verified email/session; anti-enumeration; revoke propagation |
| `/onboarding`, `/tenant/theme`, `/tenant/publish` | Save/resume steps, preview, publish/unpublish | Version checks; publish gate recomputed server-side |
| `/brain/interviews`, `/brain/sources` | Sessions, scoped uploads, processing/review/delete | File/size/type checks, job limits, source rights |
| `/brain/rules`, `/brain/scenarios` | Confirm/edit/reject, conflicts, trainer answers | Trainer authority; evidence retained; release isolation |
| `/brain/evaluations`, `/brain/releases` | Evaluate, compare, approve/promote/rollback | Evaluation gates and atomic active-version change |
| `/subscribers`, `/subscribers/:id/twin` | Roster, intake, snapshots, corrections, history | Own subscriber/authorized trainer scope |
| `/programs`, `/workouts/:id` | Generate/review/publish, start, batch set logs, finish, pain report | Pinned version, event replay protection, safety interrupt |
| `/coaching`, `/conversations` | Structured request, messages, evidence, human takeover | Rights/safety/entitlements; takeover lease; attachments scanned |
| `/products`, `/payments/checkout`, `/membership` | Products/prices, checkout, billing portal, plan change, cancel/reactivate | Price selected server-side; provider-state-driven access |
| `/refund-requests`, `/finance` | Request, approve/decline/override, statements, usage, export | Charge ownership; window; role separation; financial audit |
| `/payout-beneficiaries`, `/payout-runs` | Destination verification/change, dry run, execute, status/reconcile | Bank-change verification; immutable allocations; policy limits |
| `/wearables`, `/imports` | Connect/revoke/sync, upload, coverage and permissions | OAuth state, token protection, rights/lineage, partial data |
| `/voice`, `/guided-sessions` | Consent/enroll/revoke, begin/control/end, usage | Trainer voice rights and subscriber premium entitlement |
| `/bookings`, `/domains` | Availability/hold/book/cancel; search/quote/purchase/status | Concurrent reservation; exact-price confirmation; bounded retries |
| `/analytics`, `/admin` | Scoped reports, cases, policies, flags, audit, experiments | Separate aggregate/privileged roles; no broad product-role bypass |
| `/privacy`, `/notifications` | Consent, export/delete, preferences, message history | Identity verification; lawful retention; unsubscribe semantics |
| `/webhooks/:provider` | Provider event receipt | Provider-specific authenticity; durable receipt before acknowledgement |

Event envelope: `event_id`, `schema_version`, `event_name`, `tenant_id`, actor/subject IDs, `occurred_at`, `recorded_at`, `correlation_id`, `causation_id`, source provider/account/environment IDs, aggregate version and minimal typed payload. Reference sensitive bodies rather than copying them into analytics. Preserve Appendix B event names; new names are versioned contracts.

Jobs carry type/version, tenant/authorization intent, business-intent key, trace ID, schedule, attempt and retry policy. Workers claim with leases, limit concurrency and use backoff/dead letters. Assume at-least-once delivery; obtain one logical business effect through database constraints, transactional state transitions and provider reconciliation.

## 5. State and concurrency rules

| Workflow | State path / invariants |
| --- | --- |
| Onboarding | Each step has draft/saved/complete/blocked; later edits invalidate dependent readiness; publish is separate from subdomain reservation |
| Brain | draft → shadow → supervised → production; archived/rolled_back retain history; category-level autonomy cannot exceed platform safety limits |
| Workout | planned → active ↔ paused → completed/abandoned; pain may enter safety hold; corrections preserve original events |
| Subscription | Pending/active/past_due/grace/ended projection; renewal cancellation is a separate flag/effective date, not immediate loss of paid access |
| Refund | requested → trainer_review → approved/declined → submitted → succeeded/failed; admin override has explicit reason; pending never means refunded |
| Beneficiary | not_added → validating → verified, with failed/held/reverification branches; source-bank status is separate |
| Payout | draft → ready → submitted → processing → paid; held/failed/returned/canceled/unknown branches; bank acceptance remains processing |
| Domain | quoted → confirmed → payment/registration pending → purchased → DNS/TLS pending → active; failed/unknown/expired branches preserve fallback |
| Booking | temporary hold → paid/confirmed → completed/canceled/no_show; provider delay and hold expiry reconcile without overselling |

Offline workout events use device/event IDs and monotonic sequence; replay never duplicates sets. Server revisions and explicit conflict UI handle two-device edits. Human takeover sets a lease/owner and prevents background digital responses from racing. Concurrent Brain promotion uses compare-and-swap. For every external timeout, distinguish definitely failed from unknown; never use a new random retry key to bypass uncertain state.

## 6. Brain and runtime pipeline

Ingestion: validate → extract → classify/redact → attach provenance/rights → chunk/index → propose knowledge/rules → trainer review. Interview questions target uncertainty across the 20 methodology topics in §6.5. Rules capture conditions, directive, reason, priority, source references and trainer confirmation. Conflicts require explicit scope/precedence resolution.

Scenario learning varies one meaningful client variable, records predicted and preferred structured decisions, semantic differences and trainer reasons. Keep held-out tests separate from examples used to improve the Brain; evaluate structural agreement separately from style. Publish release snapshots containing Constitution, identity, retrieval, evaluation, model/prompt and autonomy versions.

Runtime: resolve entitlement/tenant → pin Brain and Twin → assemble only rights-permitted evidence → apply deterministic safety and constraints → request structured decision → validate actions/evidence → route by autonomy/confidence → persist → render first-person text/audio → emit outcome/usage events. Safety > confirmed rules > approved program intent > client constraints > episodes > generic knowledge > tone. A model cannot grant itself tool authority or data-use permission.

`CoachingDecision` includes ID/type, Brain version, client snapshot, policy/prompt/model versions, typed actions, evidence references, concise reason summary, fidelity/data confidence, safety/autonomy state and review requirement. Do not store hidden model reasoning; store decision explanations and auditable evidence. Validate evidence existence, tenant, source rights and relevance; syntactically valid JSON alone does not pass.

Model routing stays provider-agnostic. Evaluate extraction, interview, program generation, chat, voice text and evaluation tasks separately; choose the least expensive provider/model that passes that task's quality and latency gate. Cache approved static context by tenant/Brain version, dedupe retried work, bound retrieved context and output, enforce per-task/tenant quotas, and invalidate cache on rights revocation. Complex/uncertain coaching routes to the approved stronger path or human review. Expensive model calls cannot replace deterministic safety checks.

### Nutrition teaching and runtime addendum — planned

Onboarding captures labelled client cases, coach recommendations/rejected alternatives, reasons, conditions, target/portion rules, substitutions and automatic-action limits. Compile these into a private versioned nutrition knowledge package with confirmed provenance and coverage gaps. Retrieve relevant permitted evidence at runtime; no per-coach model-weight training is implied. Keep teaching cases separate from held-out nutrition evaluations. Backfill existing Brain records as training and qualify releases independently per tenant/domain. Recipe facts, quantities and arithmetic remain deterministic, with explicit unknown and approximate states.

After setup calibration and release qualification, nutrition automatically delivers in-scope plans and changes that pass the explicit authority policy, current client constraints, evidence/calculation checks, entitlement and consent. The model cannot authorize itself through a confidence score. Unsupported cases or changes outside the policy enter an exception queue; missing client facts can be requested directly. Every delivery records matched rules/cases, fact/calculation versions and policy outcome. Corrections enter a draft knowledge version with regression and held-out checks before release. Current training supervision remains unchanged until separately implemented and verified.

Daily meals, recipes/cooking options, portions/calorie estimates and consolidated weekly groceries must pin the same delivered plan revision; recalculate affected outputs on changes while preserving consumed-history snapshots. Batch/leftover allocation must not duplicate ingredients, and purchase rounding must not alter food-consumption arithmetic. Dynamic onboarding progress, nutrition readiness and combined-offer activation are calculated on the server; existing workout-only setup remains independent. Nutrition access is permitted only by the combined tier, not by workspace enablement alone.

## 7. Stripe, Lean and accounting

Stripe `PaymentProvider` owns subscriptions, payments, receipts, refunds and disputes. Lean `PayoutProvider` owns beneficiary creation/verification and company-bank payment initiation/status. Adapters declare actual capabilities, authorization modes, finality/status meaning, duplicate controls and cancellation support. Keep credentials and vendor payloads inside adapters.

Money has three separately reconciled movements: subscriber collection into Stripe; Stripe settlement into the company bank; Lean-instructed bank payment to the trainer. Track Stripe fees and settlement timing, bank balances/credits/debits, Lean fees and actual payment outcomes. Settlement and payout are cash movements; they must not recognize revenue a second time. Accountant-approved journals distinguish GMV, platform revenue, tax, liabilities, reserves and costs.

Commission bands remain 1–100 at 25%, 101–300 at 20%, 301–1,000 at 15%, then 10%. At an illustrative AED 100 per subscriber, commission must equal AED 2,475 / 2,500 / 2,520 / 6,500 / 6,515 / 17,000 / 17,010 for 99 / 100 / 101 / 300 / 301 / 1,000 / 1,001 subscribers, before separately accounted costs/tax. Verify with an independent reference calculation.

Before production, finance must approve the exact subscriber counting/cutoff, mixed-price allocation, discount/proration/refund treatment, tax base and rounding policy. A proposed deterministic mixed-price method is stable rank by first successful paid membership date with an ID tie-breaker, applying each band's rate to its allocated eligible revenue. Its handling of churn/re-entry and within-period changes needs worked approval; do not silently ship a blended-rate alternative. Store allocation inputs and policy version so historic statements reproduce exactly.

Monthly close uses an approved business timezone/cutoff (UAE default proposed), reconciling all eligible source entries and usage charges. Available payout equals opening payable plus eligible earnings, minus adjustments/reserves and amounts already allocated. Negative amounts carry forward; they never initiate an automatic bank debit. A unique liability allocation and stable intent ID survive close revisions. Database locks/constraints prevent overlapping close workers from paying the same obligation.

After the initial approved canary, scheduled monthly execution can be automatic within configured funding, beneficiary, reserve and amount limits. Exceptions enter holds. Lean bank acceptance is pending; reconcile enabled final evidence and bank reference before marking paid. Unknown outcomes are queried or reviewed without resending. Confirmed failed attempts retain the obligation; returns reopen it with compensating entries. Stripe refunds after payout use reserves/future offsets or separately agreed recovery; they do not reverse the bank transfer.

## 8. Rights, retention and observability

Every source and derivative carries origin, policy version, consent references, allowed-use mask, retention class, lineage, scope and deletion/export rules. Derived data inherits the intersection of source rights; de-identification does not automatically remove provider restrictions. Gate render, deterministic use, model prompts, trainer learning, fine-tuning, analytics and marketing separately. WHOOP-to-model remains disabled pending documented permission; HealthKit data is excluded from marketing systems.

Consent revocation/termination immediately stops new restricted use, revokes voice generation and schedules required provider/source/cache/vector/derived-data deletion. Retain only records with documented lawful basis, including required accounting/audit records; redact or separate unnecessary personal content. Track deletion results and failures. A backup restore must reapply deletion/consent tombstones before restored data is served.

Trace one user action through API, outbox, jobs, model/provider calls and ledger. Capture latency, error, queue age, safety escalation, reconciliation gap and cost events. Audit access to protected data. Never send bank credentials, health records or message bodies to generic growth telemetry.
