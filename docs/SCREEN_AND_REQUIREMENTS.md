# Screen and requirements coverage

Status: this table is the source coverage baseline; implementation is now underway. See [BUILD_STATUS.md](BUILD_STATUS.md) for delivered behavior, observed checks and remaining boundaries. No group is declared complete merely because a route exists. This is a complete group-level mapping of source Appendix J, plus all main sections and appendices. Each implementation issue must expand its group into field/state-level checks and attach evidence. Passing a group requires every applicable source behavior, not just the route.

## Route and release conventions

Public marketing routes use the platform host. Subscriber routes use the verified trainer host, so the two `/` entries serve different audiences. `/trainer` and `/admin` require their own authorized sessions. Paths are proposed implementation routes; the source capability and access rules are binding.

R1 foundation; R2 trainer activation; R3 coaching; R4 paid pilot; R5 launch expansion; R6 premium/scale. A slash-separated release means the minimum usable view arrives first and the complete view later. A feature awaiting provider approval has a truthful unavailable state and is not counted as enabled. Pilot-essential safety, support, billing and finance views are present by R4.

## Screen groups

### J.1 — Public acquisition and authentication (8)

| ID | Route | Capability and required content | Release | Work IDs |
| --- | --- | --- | --- | --- |
| P01 | `/` | Trainer acquisition: Hero, live Brain demo, economic calculator, proof, objection handling, pricing logic, primary CTA | R2 | 010 |
| P02 | `/how-it-works` | Explain product: Trainer Brain → Client Twin → Runtime narrative, ownership, control, wearable/voice examples | R2 | 010 |
| P03 | `/demo` | Make value tangible: Interactive sample trainer Brain, subscriber conversation, program adaptation example | R2 | 010, 013 |
| P04 | `/pricing` | Remove fee anxiety: Marginal commission visualizer, fee examples, AI/voice cost explanation, no-success/no-platform-fee framing | R2 | 010, 020 |
| P05 | `/faq` | Resolve objections: Ownership, AI accuracy, data, payments/payouts, domains, wearables, cancellation/refunds, human control | R2 | 010, 023 |
| P06 | `/login` | Authenticate: Email magic link/passkey/password; Apple/Google only if configured | R1 | 006 |
| P07 | `/signup` | Create trainer tenant: Minimal fields: name, email, business/trade name, country, source; no long form | R1 | 006, 011 |
| P08 | `/terms; /privacy; /ai-disclosure` | Trust/compliance: Versioned published legal documents, effective date, contact, previous-version access if policy requires | R4 | 023 |

### J.2 — Trainer onboarding (16)

| ID | Route | Capability and required content | Release | Work IDs |
| --- | --- | --- | --- | --- |
| O01 | `/trainer/onboarding/account` | Account + tenant: Verify email; create tenant; referral attribution; timezone/currency defaults. Exit: Identity established; reserved subdomain | R1 | 006, 011 |
| O02 | `/trainer/onboarding/identity` | Business identity: Business/public coach name, location, category, target audience; licence status starts deferred/NOT_REQUESTED and is collected later. Exit: Brand/business context captured; no licence gate | R2 | 011 |
| O03 | `/trainer/onboarding/brand` | Brand studio: Logo/avatar, hero media, typography choice within system, constrained colors, public bio, social links. Exit: Storefront can render | R2 | 009, 011 |
| O04 | `/trainer/onboarding/brain-intro` | Brain introduction: Explain Brain, first-person identity, autonomy, corrections, privacy/IP boundaries. Exit: Trainer understands the asset | R2 | 011 |
| O05 | `/trainer/onboarding/interview` | Interview: Adaptive voice/text interview; save transcript; extract candidate Constitution rules. Exit: Capture explicit methodology | R2 | 013 |
| O06 | `/trainer/onboarding/uploads` | Uploads/imports: PDF/CSV/XLSX/docs/program exports; de-identification checks; ingestion status/review queue. Exit: Capture historical evidence | R2 | 012 |
| O07 | `/trainer/onboarding/knowledge` | Knowledge review: Sources, exercise preferences, rules, uncertain/conflicting items, approve/reject/edit. Exit: Trainer can inspect extracted knowledge | R2 | 012, 013 |
| O08 | `/trainer/onboarding/scenarios` | Scenario lab: Counterfactual client scenarios; trainer chooses/edits answers; disagreement reasons captured. Exit: Measure trainer fidelity | R2 | 013, 014 |
| O09 | `/trainer/onboarding/readiness` | Brain readiness: Fidelity by domain, confidence, insufficient-evidence areas, shadow-mode recommendation. Exit: Show what is known/unknown | R3 | 014 |
| O10 | `/trainer/onboarding/offer` | Offer/pricing: Digital plan price, human session price, optional premium tiers, trial/coupon policy. Exit: Business model ready | R4 | 018 |
| O11 | `/trainer/onboarding/payout` | Money + payout: Stripe collection readiness; Lean beneficiary creation and UAE IBAN/ownership verification; masked status, required information and explicit holds. Live selling follows the approved financial policy. | R4 | 019 |
| O12 | `/trainer/onboarding/wearables` | Wearables: WHOOP / Amazfit / Apple options, trainer recommendation, provider-data rights warning. Exit: Choose coaching data policy | R5 | 026, 027 |
| O13 | `/trainer/onboarding/voice` | Voice: Separate explicit synthetic voice consent; sample recording/verification; disabled by default. Exit: Optional premium setup | R6 | 029 |
| O14 | `/trainer/onboarding/domain` | Domain: reserve default subdomain for draft/preview; public launch follows publish gates; optional paid custom-domain workflow. | R2/R5 | 011, 028 |
| O15 | `/trainer/onboarding/preview` | Preview: Desktop/mobile preview, checkout preview, public copy, legal disclosure preview. Exit: Trainer sees exact subscriber experience | R2/R4 | 011, 024 |
| O16 | `/trainer/onboarding/publish` | Publish: All required product/safety/legal/payment gates; valid payout setup or clearly explained payout hold state; final URL; event tracking. Exit: Launch only when gates pass | R4 | 014, 018, 019, 023, 024 |

### Nutrition onboarding addendum — implemented core, 25 September 2026

The [nutrition integration plan](NUTRITION_INTEGRATION_PLAN.md) extends O02 and O05–O10/O15–O16 with a conditional teaching branch. The development runtime adds six conditional nutrition steps to the original 16-step path; browser release evidence is tracked in BUILD_STATUS.md. Existing coaches retain their workout setup; displayed steps and progress come from the selected path. Workout-only setup does not require nutrition. The subscription choices are workout only and higher-priced workout + nutrition.

| Area | Required addition | Acceptance / work IDs |
| --- | --- | --- |
| Offer and scope | Enable the combined tier; describe supported clients/diets and limits | Saved capability does not itself grant subscriber access or qualify automation; 035 |
| Case interview | Ask realistic client cases and changed-condition follow-ups; capture recommendations, reasons, accepted/rejected choices, missing inputs and limits in text/voice when available | Adaptive questions fill coverage gaps without repeating known answers; no real client identifiers required; 035, 040 |
| Knowledge review | Show extracted diet/target/portion/substitution/cooking rules, source evidence and contradictions | Coach confirms intended rules and automatic-action boundaries; incomplete evidence stays visible; 037, 040 |
| Calibration | Present unfamiliar cases and a complete sample week with daily recipes, portions, estimated calories and groceries | Corrections recorded with reasons; teaching cases kept separate from held-out evaluation; 038, 040 |
| Readiness and activation | Show supported/unsupported capabilities and actionable gaps; evaluate the configured model and qualify the release | Independent nutrition gates enforced server-side; changed inputs invalidate affected approval; no per-plan approval requirement; 035, 040, 042 |
| Ongoing coach workspace | Delivered-plan history, optional sampled audit, exceptions with reasons and proposed resolution | Routine in-scope output is automatic; exceptions and coach takeover are visible; 040, 041 |

Core subscriber additions are today's meals, recipes/cooking variants, portions and approximate calories plus full-week and grocery views; plan changes update the connected quantities. They are required combined-tier features, not optional diary screens. Complete field/state and journey acceptance is defined in work IDs 035–044.

### J.3 — Trainer command center (23)

| ID | Route | Capability and required content | Release | Work IDs |
| --- | --- | --- | --- | --- |
| T01 | `/trainer` | Overview: Revenue, active members, conversion, churn, payout, exceptions, Brain health; exception-first queue | R4/R5 | 031 |
| T02 | `/trainer/exceptions` | Exceptions: Subscriber, severity, reason, Brain confidence, relevant evidence, suggested action, approve/edit/escalate | R3 | 017, 031 |
| T03 | `/trainer/subscribers` | Subscribers: Search/filter/status, plan, source, adherence, last workout, risk/safety flags, LTV | R3 | 015, 031 |
| T04 | `/trainer/subscribers/:id` | Subscriber detail: Timeline, Client Twin, program, sessions, wearable features, messages, billing, interventions, audit | R3 | 015, 017, 031 |
| T05 | `/trainer/brain` | Brain: Version, fidelity by domain, autonomy matrix, training examples, corrections, unknown areas | R2/R3 | 013, 014 |
| T06 | `/trainer/brain/constitution` | Brain / Constitution: Rules with provenance, conflicts, versions, conditions, approve/edit/archive, diff | R2 | 013 |
| T07 | `/trainer/brain/knowledge` | Brain / Knowledge: Sources, ingestion status, extracted entities, source preview, delete/replace/re-index | R2 | 012 |
| T08 | `/trainer/brain/scenarios` | Brain / Scenario Lab: Scenario queue, predicted answer, trainer answer, reason capture, eval impact | R2/R3 | 013, 014 |
| T09 | `/trainer/brain/releases` | Brain / Releases: Version notes, eval delta, deployment/rollback, current prod vs shadow | R3 | 014 |
| T10 | `/trainer/programs` | Programs: Templates, blocks, program drafts, constraints, duplication, publishing controls | R3 | 017 |
| T11 | `/trainer/messages` | Messages: Unified conversations, digital/human provenance, takeover, scheduled follow-up, escalation | R3 | 017 |
| T12 | `/trainer/voice` | Voice: Consent status, voice asset status, test playback, usage, premium-product link, revoke | R6 | 029 |
| T13 | `/trainer/wearables` | Wearables: Connection status, last sync, source-specific permissions, provider-use restrictions, data-quality issues | R5 | 026, 027 |
| T14 | `/trainer/products` | Products + Pricing: Subscription products, prices, tiers, coupons/trials, voice tier, 1:1 offer, status | R4 | 018 |
| T15 | `/trainer/bookings` | Bookings: Availability, duration, price, capacity, booking list, cancellation/no-show policy | R5 | 030 |
| T16 | `/trainer/analytics` | Analytics: Funnel, source attribution, cohort retention, revenue, product mix, trial-to-paid, LTV | R4/R5 | 010, 030, 031 |
| T17 | `/trainer/finance` | Finance + Refunds: Gross, pending 7-day refund requests with Approve/Decline, approved refunds, processor fees, platform fee, AI/voice charges, reserve/adjustments, available/pending, payout forecast | R4 | 020, 021 |
| T18 | `/trainer/payouts` | Payouts: Monthly UAE IBAN payouts, bank account masked, beneficiary status, payout/bank reference IDs, status, failures/returns, reconciliation statement | R4 | 019, 022 |
| T19 | `/trainer/domains` | Domains: Subdomain, custom search/purchase, DNS/TLS state, renewal status, redirect/canonical | R5 | 028 |
| T20 | `/trainer/brand` | Brand: Brand tokens, assets, copy, preview, accessibility/contrast validation | R2 | 009, 011 |
| T21 | `/trainer/team` | Team: Invite/revoke, role scopes, MFA status, last active, audit trail | R1 | 006 |
| T22 | `/trainer/integrations` | Integrations: platform Stripe/Lean status, own payout destination, WHOOP, approved Zepp, Apple import/companion and allowed email/calendar settings. Platform credentials stay in privileged configuration. | R4/R5 | 019, 026, 027 |
| T23 | `/trainer/settings` | Settings + Export: Business settings, notifications, legal consents, data export, account closure workflow | R4/R5 | 023, 030 |

### J.4 — Subscriber application (13)

| ID | Route | Capability and required content | Release | Work IDs |
| --- | --- | --- | --- | --- |
| S01 | `/` | Trainer storefront: Coach-specific promise, proof, program, pricing, disclosure, CTA | R2 | 010, 011 |
| S02 | `/checkout` | Checkout: Plan, price/renewal, required terms/assumption-of-risk, Stripe checkout/payment state | R4 | 018, 023 |
| S03 | `/app/intake` | Intake: Goals, experience, schedule, equipment, limitations, baseline, dynamic follow-ups | R3 | 015, 023 |
| S04 | `/app/wearables` | Wearable connect: WHOOP OAuth; Amazfit route; Apple import/companion; clear permissions and source limits | R5 | 026, 027 |
| S05 | `/app` | Home: Next workout, progress, coach note, recovery/readiness context where allowed, streak/adherence without shame | R3 | 015, 017 |
| S06 | `/app/program` | Program: Block objective, weekly structure, upcoming sessions, progressions, changes and reasons | R3 | 017 |
| S07 | `/app/workouts/:id` | Workout: Exercise, demonstration/cues, set/rep/load/RIR/rest, logging, substitutions, notes, pain/safety interrupt | R3 | 017 |
| S08 | `/app/guided/:id` | Guided session: Timer, audio state, live/estimated physiology where available, speech controls, fallback if voice fails | R6 | 029 |
| S09 | `/app/chat` | Coach chat: First-person digital coach, message provenance metadata, attachments, human review option | R3 | 016, 017 |
| S10 | `/app/progress` | Progress: Strength, adherence, measurements, photos if enabled, personal baselines, block summaries | R3 | 015, 017 |
| S11 | `/app/book` | Book coach: Available sessions, price, payment/booking, cancellation terms | R5 | 030 |
| S12 | `/app/membership` | Billing: Current plan, renewal date, invoices/receipts, upgrade/downgrade, one-click cancel renewal at period end, separate 7-day refund-request action and request status | R4 | 018, 021 |
| S13 | `/app/profile` | Profile + privacy: Personal details, wearable permissions, consents, export/deletion requests, notification preferences | R4/R5 | 023, 027, 030 |

### J.5 — Platform administration (15)

| ID | Route | Capability and required content | Release | Work IDs |
| --- | --- | --- | --- | --- |
| A01 | `/admin` | Executive overview: GMV, recognized platform revenue, COGS, contribution, EBITDA proxy, coaches/subscribers, CAC/payback, churn, system health; label overhead coverage and exclusions in any EBITDA proxy | R4/R5 | 020, 031 |
| A02 | `/admin/acquisition` | Acquisition: Campaign/source funnel, trainer signup→IBAN→Brain→publish→5/10/25 paid member activation, cohort CAC | R4/R5 | 010, 031 |
| A03 | `/admin/trainers/:id` | Trainer 360: Tenant status, owner, payout beneficiary/IBAN status, domain, Brain, subscribers, revenue, COGS, support, safety, audit, compliance status | R4/R5 | 019, 031 |
| A04 | `/admin/subscribers/:id` | Subscriber 360: Scoped support view, tenant, program, billing, events, consents, provider connections; sensitive fields protected | R4/R5 | 015, 031 |
| A05 | `/admin/brains` | Brain operations: All Brain versions/releases, eval trends, regression flags, shadow queues, model/provider performance | R3/R5 | 014, 031 |
| A06 | `/admin/safety` | Safety: Escalations, categories, resolution, response time, repeated trainer/user patterns, policy version | R3/R5 | 023, 031 |
| A07 | `/admin/finance` | Payments + payouts: Charges, invoices, refund requests/approvals/overrides, disputes, trainer balances, UAE IBAN payouts, reconciliation gaps, reserves/holds | R4 | 020, 021, 022 |
| A08 | `/admin/finops` | COGS + FinOps: LLM/TTS/STT/storage/messaging/Stripe/DO cost by tenant/product/model/provider; margin anomalies | R4/R5 | 020, 031 |
| A09 | `/admin/wearables` | Wearables: Connections, sync health, stale tokens, webhook failures, provider data-use flags, consent status | R5 | 026, 027, 031 |
| A10 | `/admin/domains` | Domains: Search/purchases, provisioning, DNS/TLS, expiry/renewal, billing, failures, provider limitations | R5 | 028, 031 |
| A11 | `/admin/infrastructure` | Infrastructure: Cluster/db/queue/storage health, deploys, alerts, cost, capacity, governor recommendations/actions | R1/R6 | 025, 032 |
| A12 | `/admin/support` | Support: Tickets, user search, timeline, macros, escalation, redacted sensitive views | R4/R5 | 031 |
| A13 | `/admin/security` | Security + audit: Privileged access, MFA, impersonation, secret rotations, suspicious auth, data exports, admin actions | R1/R5 | 006, 023, 025, 031 |
| A14 | `/admin/experiments` | Experiments: Landing/onboarding experiments, allocation, metric, guardrail, result, rollback | R5 | 030 |
| A15 | `/admin/configuration` | Configuration: Feature flags, fee schedules, provider routing, safety policies, legal versions, notification templates | R1/R5 | 008, 020, 023, 031 |

## Universal state checklist — J.6

Each screen group carries the following checklist; record a justified not-applicable result where the state cannot occur. Do not build dead navigation or a cosmetic success state for an unavailable integration.

| State | Required behavior |
| --- | --- |
| Loading/saving | Visible progress; preserve entered work; duplicate submission prevented |
| Empty | Explain absence and provide one useful next action |
| Error | Human-readable cause, retry/recovery and safe support reference |
| Permission denied | Correct role boundary and access guidance; no protected payload leak |
| Provider disconnected | Accurate connection state, permitted history and reconnect path |
| Offline workout | Persist local events and synchronize idempotently; display unresolved conflicts |
| Partial/stale data | Source, measurement time, coverage and uncertainty visible |
| Suspended/held commerce | Policy-based access and truthful payment/payout state |
| Mobile | Core subscriber journeys and trainer exceptions usable on common phones |
| Accessibility | Keyboard, focus, semantics, contrast, reduced motion and RTL-ready layout |

Additional concurrency checks: stale form version, session expiry during mutation, duplicate/replayed action, revoked consent during background work and switched tenant/account.

## Source-to-work coverage

These 31 entries cover the source document structure. They establish ownership and traceability; implementation must retain the detailed requirements within each source section. Evidence is being recorded in BUILD_STATUS.md; full source-level release acceptance remains pending.

| Source | Coverage / evidence | Work IDs |
| --- | --- | --- |
| 01 Product/economics | Core product, commission, measured viability and launch scope | 002, 010, 020, 031 |
| 02 Conversion | Demo/calculator, funnel, attribution and experiment guardrails; P01–P05 | 010, 030, 031 |
| 03 Roles/journeys | Trainer/subscriber lifecycle, tenant permissions and departure; O/T/S groups | 006, 011, 017, 021, 023, 024 |
| 04 Design | Tokens, controlled themes, mobile, accessibility and localization; J.6 | 009, 025 |
| 05 Architecture | Monorepo, tenancy, auth and flags; technical blueprint §§1–4 | 005–008 |
| 06 Brain | Interview, rules, evidence, scenarios, evaluation, autonomy and versions | 012–014, 034 |
| 07 Twin/runtime | Snapshot/provenance, precedence, structured decisions and confidence | 015–016 |
| 08 Training/chat/voice | Programs, offline workouts, takeover, consent and Session Director | 017, 029 |
| 09 Wearables | WHOOP, Apple, Zepp, canonical samples/features and live/BLE distinctions | 026–027, 033 |
| 10 Commerce/domains | Stripe + Lean flow, fees, billing, refunds, close, tax and domains | 001–002, 018–022, 028 |
| 11 Analytics/admin | Event ledger, cost ledger, 360 views, cohorts and impersonation | 008, 020, 030–031 |
| 12 Data/APIs | Entities, identifiers, API/error/event contracts and jobs | 005, 007–008; domain tasks |
| 13 Infrastructure | IaC, region, scaling, broker, secrets, backups and deployment | 003–005, 025, 032 |
| 14 Privacy/safety/legal | Policy, consent, data rights, safety incidents, security and deletion | 003, 007, 016, 023, 025 |
| 15 QA/operations | Evaluation, SLO evidence, observability, cost control and support | 014, 020, 024–025, 031 |
| 16 Autonomous execution | AGENTS.md, bounded tasks, provider register, ADRs and release authority | 001–005; all work |
| 17 Acceptance | Evidence gates and enabled-scope release checks | 024–025; all work |
| Appendix A Schema | Domain records/invariants in technical blueprint §2; detailed migration work | 007, 012–022 |
| Appendix B Events | Canonical taxonomy, versioned envelope and audit trail | 008; all event-producing tasks |
| Appendix C Providers | Operations dependency register and replaceable adapters | 001, 004, 008, 026–029, 033 |
| Appendix D AI contracts | Prompt registry, structured program/correction contracts and runtime checks | 013–017 |
| Appendix E Legal drafting | Reviewed terms, trainer agreement, privacy, risk disclosure and consent | 023 |
| Appendix F External constraints | Official-reference rechecks, account-specific proof and approved fallbacks | 001–004, 026–029, 033 |
| Appendix G Risks/gates | Provider/legal/residency and release exception register | 001–004, 023–025 |
| Appendix H Economics | CAC/bootstrap, revenue, COGS, contribution and cohort definitions | 010, 020, 031 |
| Appendix I Handoff | Operations §6 operator checklist and reproducibility drill | 005, 025, 031–032 |
| Appendix J Screens | 75 groups above plus universal states, implementation evidence per group | 006–033 as mapped above |
| Appendix K Rights firewall | Allowed-use/lineage enforcement and revocation/deletion of derivatives | 008, 012, 016, 023, 026–027, 033 |
| Appendix L Lifecycle | All trainer/subscriber triggers, preferences, suppression and outcome tracking | 030 |
| Appendix M Database operations | RLS, indexes, idempotency, retention, reconciliation and restore tombstones | 007–008, 020, 022–023, 025 |
| Appendix N Addendum | Provider evidence refresh; Lean selected as the operator payout rail | 001–004, 026–027, 033 |

## Interpretation decisions

- Latest owner payment choice governs ambiguous payment language in §10: Stripe collection, company-bank settlement, Lean beneficiary/payout integration; see decision D-01 in the implementation plan.
- A reserved/routable draft subdomain is distinct from a publicly published paid storefront. The publish gate applies even if infrastructure provisioning completes earlier.
- Deferred licence upload does not imply unconditional live-selling or bank eligibility. Central policy represents verified requirements without blocking independent Brain setup.
- Full-spec completion includes every applicable capability above. Provider-pending features may remain disabled only with explicit release-scope disclosure.

Source extraction fingerprint (SHA-256): `16bd4f074e794b0b055587f8f35d0fb248613ca42f42a5f7bca706b1eac02aa7`. This fingerprints the reviewed local text extraction; the named master DOCX remains the source contract.
