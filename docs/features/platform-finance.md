# Platform finance: costs and profit for the Super admin

Owner request (28 September 2026): "The Super admin should have a clear idea about the costs and
profit for everything, including AI costs, subscription payouts, domain payments and profit, and
everything else. Go ahead with the Super admin works."

This document is the plan (phases A to D) and the record of what phase A delivered. The audit
behind it read the code on `integrate/round2` (`bb80aa3`); its findings are summarised under
"Starting point".

Status (28 September 2026): phase A is merged into the PR #4 branch and was part of PR #4,
which the owner merged into `main`. Phases B-D and their review round 1 (`core/finance-bcd`,
stages 2026-09-28t to 28w, migrations 075-077) are merged into the PR #4 branch
(`integrate/round2`) after the domain margin track, stage 2026-09-28x, where the checks on the
merged tree are recorded; not deployed. Statements below that the branch is unmerged were true
when written. Seen at that merge and still open: the Stripe fee of a domain payment not read yet
is estimated with this page's Stripe fee settings (2.9% + AED 1.00), not the domain margin's
fuller USD estimate (+1% international card, +0.7% Stripe Billing, +1% conversion); and Stripe
Billing's 0.7% fee is neither read nor estimated here, for memberships or domains (it is
attributed to the invoice in Stripe's Fees report, not the charge's balance transaction, and
an account on standalone fees shows fee 0 there; to be reconciled against the Reporting API
once live charges exist, `payments-stripe.md` F9). Since 29 September 2026 (branch
`fix/stripe-payments`) a month close is no longer held by a failed invoice issued after the
month, nor by one Stripe stopped collecting (voided, uncollectible, or its subscription ended),
nor by a refused or failed refund or checkout; lost disputes and refunds returned by the bank
are posted as `payments-stripe.md` describes.

## Starting point (audit of 28 September)

- Money and cost data were already recorded in detail: every charge, refund, payout and domain
  sale is a journal in the trainer's ledger (by member, product and month), and every AI and voice
  call is a `cost_events` row (by workspace, member, feature and model).
- The Super admin screens showed only platform-wide monthly totals (`/admin/metrics`) or one
  trainer's statement at a time (`/admin/finance`). No profit figure existed anywhere.
- Hidden or missing: the revenue split by product (computed by the statement API, never shown),
  domain sales (in no total), card disputes (inside "other adjustments"), costs the platform
  absorbed, and each trainer's commission and cost on `/admin`.
- Voice cost showed as about zero: a successful speech, transcription, preview or clone call left
  its row `unknown` with no cost until someone priced it by hand, one row at a time. Unpriced rows
  stopped the monthly usage charge, the month close and automatic payouts.
- Every AI call was stored with the provider `configured-model` and one global price.
- Three different USD to AED rates were in use (a fixed 3.6725 in metrics, the operator's rate in
  usage statements, the quote's rate for registrar cost), so screens could disagree.
- The trainer's own analytics revenue table read the accounts `gross_revenue` and
  `commission_revenue`, which nothing writes.
- Suspected: a domain refund was journaled while Stripe still reported it `pending`, with no
  reversal if it later failed.

## Owner decisions (28 September 2026)

The owner decided the questions phase A left open ("Stripe fees paid by the
trainer with full understanding", "100% markup", "complimentary charged to
the trainer", "cash basis", "no budget limits: we pay only when we get paid",
the label "AI Coach Service Fee"; full list in `docs/PROJECT_MEMORY.md`):

| Decision | Behaviour | Where |
| --- | --- | --- |
| Who bears Stripe fees | The trainer, shown plainly: an estimate before they set a price (offer form, voice add-on price, paid sessions), the fees deducted each month beside every payout, and "Stripe fees (paid by you)" on the monthly statement and analytics | Settings → Platform finance: "Stripe card fee shown to trainers (%)" 2.9, "Stripe fixed fee per payment shown to trainers (AED)" 1.00, "Extra Stripe fee for cards issued outside the UAE (%)" 1 (Stripe's standard UAE pricing); the fee actually deducted is Stripe's own (settlement, and per payment from phase C) |
| AI and voice charged to trainers | Twice the provider cost (100% markup), named only "AI Coach Service Fee": one line with the amount, no provider, call, feature or markup detail anywhere a trainer looks (statement, analytics, workspace lists, CSV, the monthly notification) | Settings → Platform finance → "Markup on AI and voice usage charged to trainers (%)", default 100 (0 to 1000); an unset or blank value reads as 100 |
| AI and voice used by complimentary members | Charged to the trainer | Same settings, default the trainer |
| When income is recognised | When it is received (cash basis): a payment counts in the month it was journaled; upfront programmes and yearly domains are not spread; the AI Coach Service Fee counts when the trainer's earnings cover it (it is deducted from them; until then it is shown as owed) | Platform finance screen ("basis") |
| Budget limits | None ("we pay only when we get paid"); the screen and alerts show cost against income and flag costs without matching income instead | Platform finance → Cost against income; alerts in phase D |
| Charging calls whose outcome never came back | Not charged until reconciled from the invoice or estimated by an operator (unchanged) | Settings → Platform finance → "Automatic month close estimates unresolved provider usage", default off |
| Marketing | No marketing text changes; AI costs and the markup are never mentioned in marketing | — |

A setting change applies to usage statements posted after it; posted statements never change
(a statement posted at 0% keeps its charge; later corrections to its month use the markup it
was posted with, phase C).

## Phase A: show what is recorded, fix cost recording (delivered, branch `core/finance-a`)

### Database

- **072 `exchange_rates`**: one reviewed USD to AED rate per Asia/Dubai month, as append-only
  revisions (the current rate is the highest revision; rows cannot be changed or deleted).
  Platform reference data: row security `service_only`, `SELECT, INSERT` for `trainer_service`
  only (migration and `infra/runtime-role.sql`), no tenant access; classified in
  `scripts/verify-runtime-access.mjs` as a system table the tenant role cannot read.
- **073 cost accounting**:
  - `cost_events` gains `member_id` (the member the call served), `product` (`membership`,
    `programme`, `nutrition`, `voice_addon`, `trainer_setup`), `complimentary` (the member's only
    access was a trainer's grant) and `estimated_cost_usd` (the estimate the call was priced from).
  - New status `estimated`: priced at the stored estimate (`cost_usd = estimated_cost_usd`,
    checked by a constraint). Allowed transitions: `reserved` to `unknown`, `estimated`,
    `recorded` or `reconciled`; `unknown` to `estimated` or `reconciled`; `estimated` to
    `reconciled`. `recorded` and `reconciled` stay final. The member, product and complimentary
    tags are part of a row's identity, and a stored estimate cannot be changed once set.
  - Existing rows: estimates backfilled from the reserved estimate (voice) or the price-sheet cost
    (recorded model calls); products backfilled from the task. Rows written before 073 keep the
    provider `configured-model`.
  - `model_prices`: reviewed token prices per provider and model with an effective date,
    append-only, service role only (same classification as `exchange_rates`).
  - Indexes for date-range provider and unpriced queries.
  - The workspace voice budget (`voice_guidance_spent_today()`) now resets on the Asia/Dubai day,
    like the AI call limit (it used the database's day).
  - Additive for the release that keeps serving between migrate and restart: it writes none of
    the new columns and makes only transitions still allowed.

### Cost recording

- **Voice priced when made.** Speech (session clips, guided audio), transcription (and the
  supplement for extra provider-timed audio), previews and clones are reserved at their estimate
  from the provider's price settings (Trainer voice, Speech-to-text) and, once the provider
  answers, marked `estimated` at that estimate (`costEstimated` in
  `apps/api/src/cost-accounting.ts`). A call whose outcome is unknown (sent, no answer) stays
  `unknown` for the invoice; a call that failed before it was sent (still `reserved`: the send
  step marks a row `unknown` just before the request) is released at zero (`costNotSent`: status
  `recorded`, cost 0, `pricing.released = "not_sent"`), like a refused or unsent clone.
- **Unpriced rows no longer block the month.** An operator can estimate a workspace's unresolved
  rows (Finance operations → "Estimate unpriced usage",
  `POST /api/v1/admin/tenants/:tenantId/finance/usage/estimate`): the stored estimate, or for a
  model call whose answer was lost the average priced cost of the same task and model within 90
  days; rows with no basis stay and are listed. The approved finance automation does the same
  before its monthly usage charge and close only when Settings → Platform finance → "Automatic
  month close estimates unresolved provider usage" is on. It is off by default (review
  2026-09-28): an estimate is charged and later invoice corrections do not change a posted charge,
  so until the owner decides, unresolved calls keep blocking automatic close as before. Reserved
  rows count as unresolved only after 15 minutes, longer than any provider call may run.
- **Re-running month close.** When a month already has a usage statement, the automation reuses
  it (its rate and charge) and goes on to close and the payout; it never recalculates, so an
  invoice correction or a reviewed rate recorded after the charge cannot block a re-run (for
  example after a payout blocked by the cap or the bank contract). A reviewed rate other than the
  automation's approved rate is recorded in the job result (`rateOverride`) and as the event
  `finance.automation_rate_override`.
- **Invoice corrections.** A single `estimated` row can be reconciled from the invoice as before
  (the reconciliation keeps the previous status and cost). When the row's month was already
  charged, the charge does not change: the correction returns `correctionAfterCharge` and records
  the event `finance.usage_corrected_after_charge`, and Finance operations shows each statement
  beside what its month's priced usage now comes to at the statement's rate (difference not
  charged; correction entries are phase C). A provider's whole month can be priced from its usage
  or invoice total across all workspaces (Payments and payouts → Platform costs,
  `GET /api/v1/admin/finance/provider-usage/providers`, `GET .../provider-usage`,
  `POST .../provider-usage/price`): the total less the rows already final is spread over the
  adjustable rows in proportion to their estimates, each marked `reconciled` with the invoice
  reference. Shares are rounded cumulatively in one fixed order, so they add up exactly to the
  amount spread. Refused: a changed preview, a total below the priced rows, an open month, calls
  still running, the same reference with another total, any call of that provider and month with
  no estimate (`ROWS_WITHOUT_ESTIMATE`: the total covers it too, so reconcile it first or its cost
  would be counted twice), a total more than twice or less than half the estimates without an
  explicit confirmation (`FACTOR_REVIEW_REQUIRED`, `acknowledgeFactor`), and a resumed run whose
  set of calls changed since the reference was first used (`REFERENCE_SCOPE_CHANGED`). Re-running
  with the same reference and total continues an interrupted run (preview with the reference).
  The provider name is matched in lower case. Each run writes a platform audit row before it
  starts and one when it finishes (evidence, amounts, the workspaces changed and the charged
  workspaces' differences), and each changed workspace gets the event
  `finance.provider_usage_priced`. The screen shows a confirmation with the total, the amount
  already priced, the amount spread, the estimates and the factor (a strong warning outside 0.5-2)
  before it prices, then the result and each already-charged workspace's charged and current
  figures. Month filters use a created_at range over the Dubai month, so the
  (tenant, provider, created_at) index covers them.
- **Real provider and model.** Model calls record the provider from the new "Provider name for
  cost records" AI model setting, else from the API address (`api.openai.com` is `openai`), and
  are priced at the reviewed `model_prices` price in effect for that provider and model, else at
  the AI model settings' price. The price-sheet cost is also the row's estimate.
- **Tags.** Every call carries the workspace, the member it served (a subscriber's own calls; the
  member of a Brain plan or adaptation), the feature (task), the product (from the task and the
  member's billing: an upfront programme member's plans are `programme`) and the complimentary
  flag.
- **One rate per month.** Business metrics, statements (usage cost in AED) and usage statements
  use the month's reviewed rate; a month without one uses Settings → Platform finance → "Default
  USD to AED rate" (3.6725) and says so. Once a month has a reviewed rate, its usage statements
  must use it (`FX_RATE_MISMATCH`); the automation uses it instead of its own approved rate
  (recorded as an override). Without a reviewed rate, metrics use the default setting while the
  automation keeps its own approved rate; the usage-charge preview shows the rate the charge
  would use (`chargeRate`: reviewed, the automation's, or the default). Revising a month's rate
  after usage statements were posted at another rate is refused (`POSTED_STATEMENTS_DIFFER`)
  unless confirmed (`acknowledgePostedStatements`); those statements keep their rate, the audit
  row records the previous rate, source, revision and the count, and `/admin/metrics` flags the
  month ("N workspace(s) charged at another rate"). An unchanged rate is audited as
  `finance.exchange_rate_unchanged`. Rate and model-price audit rows are written in the same
  transaction as the change. Registrar costs are not
  converted: since migration 071 (`core/domain-pricing`, merged with this phase into the PR #4
  branch) a USD order journals its registrar cost in USD, and older AED orders keep their quote's
  rate.
- **Usage charge settings.** The markup and complimentary settings above are applied by one
  calculation (`periodUsage`) used by the manual statement, its preview and the automation; the
  statement's journal records the markup, who bore complimentary usage and the estimated rows.

### Screens and exports

- `/admin/metrics`: tiles for voice add-on MRR, current upfront programmes (collected and 30-day
  equivalent), AI cost with voice cost and each one's estimated part and the unpriced estimate,
  complimentary members' cost, domain net sales and card disputes; the monthly series adds
  platform revenue; a new "Products, costs and domains" table shows memberships, programmes,
  voice add-on, 1:1 sessions, disputes lost, usage charged back (posted, usually for the previous
  month), costs charged (posted) and absorbed (month they are for) in separate columns, AI and
  voice cost each with its estimated part, complimentary cost, unpriced calls ("about USD X, not
  included"), AED per USD (with charges at another rate flagged) and domain net sales. USD is
  shown to four decimals on every finance screen. Domain figures are kept in the currency they
  were journaled in and never added into AED (`domain…AedMinor` and `domain…UsdCents`), and every
  other figure reads only AED journals, so the USD web address journals of `core/domain-pricing`
  (migration 071) never reach an AED figure.
  The CSV adds every one of these columns. Voice is now only the `voice.*` tasks (the model call
  that suggests voice wording counts as AI).
- `/admin/finance`: a "Platform costs" section (monthly rates, model prices, pricing a provider's
  month); Finance operations shows usage by pricing status, the estimate action and a usage-charge
  preview that fills in the month's rate and charge; the monthly statement shows what members paid
  by product, disputes, domain payments and refunds (and registrar cost in the operator view) and
  usage cost with its estimated, unpriced and complimentary parts at the month's rate, plus usage
  by feature and product.
- `/admin`: each trainer's commission, costs charged back, and all-time AI and voice cost (with
  the estimated part and unpriced calls).
- Trainer analytics ("Revenue by month"): memberships, programmes, voice add-on, sessions,
  refunds, platform commission, earned, usage and fees, and paid out, by Dubai month from the
  journals payments actually post.

### Domain refund bug (confirmed and fixed)

`web-address-orders.ts` journals a domain refund when Stripe reports it `pending` (so the trainer
is shown the refund at once), and nothing reversed it if Stripe later reported the refund
`failed` or `canceled`: the ledger kept a refund that never paid out. Now a failed or canceled
refund posts `web-address-refund-reversal:<refund>` once, with the exact opposite lines of the
refund journal (whatever accounts it used), and asks an operator on the order to refund again. A
`pending` snapshot delivered after the failure is ignored (the failure is remembered as the event
`web_address.refund_failed`); after the failure no later snapshot (pending, succeeded, or a
`charge.refunded` payload listing it) and no order-failure refund posts the refund again. The
reversal is posted in the refund journal's own currency through `journal()`'s `currency` option
(from `core/domain-pricing`): USD for orders priced in dollars, AED for orders quoted before, so
it is allowed by the journal currency constraint of migration 071 (only `web-address-*` journals
may be in another currency than AED) and posts only to web address accounts. Statements
subtract reversals in the refund's currency and metrics in the journal's currency. Apart from
the reversal and the failure guard, no pricing, checkout or ledger posting code of the
web-address flow changed.

### Checks

See `docs/COMPLETION_STAGES.md`, stage 2026-09-28r (formerly recorded on `core/finance-a` as
2026-09-28p, renamed when it was merged because the light home page merge already uses 28p), for
the checks actually run. Phase A is merged into the PR #4 branch (`integrate/round2`), not
deployed.

## Owner decisions applied (branch `core/finance-bcd`, stage 2026-09-28t)

- **Markup.** `financeSettings()` reads "Markup on AI and voice usage charged to trainers (%)" with
  the default 100 (0 to 1000; blank or unset is 100). `periodUsage` (manual statement, preview and
  automation) charges `round(priced USD × rate × (100 + markup))` fils. Statements posted before
  keep their charge; each statement's journal records the markup it used.
- **"AI Coach Service Fee".** New usage journals are described "AI Coach Service Fee"
  (`AI_COACH_SERVICE_FEE`). Wherever a trainer looks the charge is one line with its amount:
  the monthly statement (`aiCoachServiceFeeMinor`; the trainer's statement no longer returns
  `usage`, `usageByFeature` or `usageCost`, and its ledger entries for `usage:` and
  `usage-adjustment:` carry only `{ period, amountMinor }`), the Payments card ("AI Coach Service
  Fee" by the month it is for, from `usageStatements` reduced to `period, charge_minor` plus
  `adjustments_minor`, the later adjustments of that month), the workspace journal list (same
  sanitising, `trainerEntry`, with a "Deducted from your earnings" column), the trainer
  analytics revenue table (columns "AI Coach Service Fee", "Stripe fees (paid by you)", "Other
  charges", in AED), the trainer ledger CSV (new `item` column, formula cells neutralised, and
  only the trainer's own line of each fee journal), the payout list and a new owner
  notification when the fee is posted ("AI Coach Service Fee for May 2026" / "AI Coach Service
  Fee: AED 12.00. It is deducted from your earnings and shown on your June 2026 statement.":
  a month's fee is posted after it ends, so the notice names the statement it is on; template
  `ai-coach-service-fee`, category account, in-app only). The workspace `costs` list now carries
  only `id, task, status, created_at` (no provider, model or cost), the "AI usage" card with
  provider costs was removed from the trainer's progress screen, the workspace events list
  leaves out the platform's pricing events and removes cost, provider and rate fields from the
  others (`trainerEvent`), and a personal data export lists each call's id, task and time only.
  Operators keep every detail.
- **Stripe fees, plainly.** `GET /api/v1/finance/fees` (owner and finance; staff too, without
  the commission bands, since they price paid sessions) returns the fee parameters, the
  commission bands and the booking fee in effect; the offer form and the voice add-on price show
  what each payment leaves the trainer (`paymentBreakdown` in `@trainer/domain`: AED 199 →
  Stripe about AED 6.77, abroad about AED 8.76, commission AED 49.75 at 25%, you receive about
  AED 142.48; one short summary is announced to screen readers once typing pauses), and the
  paid-session form states Stripe's fee terms and the platform's booking fee.
  `GET /api/v1/finance/deductions` gives Stripe fees and other charges per Dubai month and the
  AI Coach Service Fee by the month it is for (`aiCoachServiceFees`), shown beside each payout
  ("AI Coach Service Fee for August 2026", "Stripe fees (paid by you) settled in August 2026").
  The statement labels the settlement fees "Stripe fees (paid by you)", returns
  `stripeFeesMinor`, names each fee posted in the month by the month it is for
  (`aiCoachServiceFees`) and says for how many of the month's payments, refunds and disputes
  Stripe's fee has been read (`stripeFeesRead`).
- **Marketing** text is unchanged (`apps/web/components/marketing/*`, `packages/contracts`
  marketing content and the llms files are not touched).

## Phase B: the Platform finance screen (delivered, stage 2026-09-28t)

- **Screen** `/admin/platform-finance` (`apps/web/components/platform-finance.tsx`, linked from
  the governance links next to Business metrics): period picker (month, quarter, year to date,
  custom up to 36 months; Asia/Dubai), four tiles (income, costs with the estimated part, profit
  and margin, flags) and tabs: Profit and loss (every income and cost line per month and for the
  period, profit, margin, then a monthly summary with the change on the month before, the rate
  used, estimated cost, unpriced calls, the AI Coach Service Fee owed by trainers and when the
  month's summary was built, and notes; the month in progress is marked "to date"), Trainers
  (contribution per trainer,
  lowest first), Features, Providers (estimated, reconciled, unpriced, invoiced), Domains (per
  currency and per order, registrar charges and the registrar's balance with "Check registrar
  balance"), Payouts across trainers, and Cost against income. Every tab downloads as CSV, plus
  the full ledger and every cost row for the period. "Rebuild summary" rebuilds the period.
- **Income** (AED, cash basis): commission on subscriptions, upfront programmes, the voice
  add-on and 1:1 sessions (booking fee), affiliate settlements, trainers' domain payments for an
  order (USD converted at the month's rate; money paid for no open order is owed back and not
  counted), the AI Coach Service Fee as far as it was received (it is deducted from the
  trainer's earnings, so a fee their earnings do not cover is owed, shown apart, and counts in
  the month later earnings cover it), other costs charged to trainers and the Stripe fees
  trainers paid at settlement. **Costs**: AI provider, voice provider, Stripe fees (Stripe's fee
  on each payment, refund and dispute of the month, as read from Stripe; a payment not read yet
  is estimated at the Stripe fee settings and the note says for how many), payout bank fees and
  platform costs (phase C), domain registrar cost, provider plan and invoice charges (phase C),
  and refunds and disputes (commission returned, domain refunds and dispute losses). Each cost
  line shows its estimated part, and "estimated cost" adds them all (AI and voice priced at
  estimates, Stripe fees not read yet, platform costs awaiting their invoice). **Profit** is
  income less costs; unpriced calls are counted apart ("about AED X, not included"), and a month
  without a reviewed rate says so.
- **Per trainer**: gross, platform income (net commission, the AI Coach Service Fee received,
  costs charged, domain payments), the fee still owed, AI and voice cost, domain profit,
  contribution (income less commission returned, domain refunds, losses and registrar cost, and
  AI and voice cost), margin, cost per paying member-month, Stripe fees and payouts; flags for
  negative contribution, cost without income (a finished month's AI and voice cost with no AI
  Coach Service Fee charged for it and no other income from the trainer that month; the month in
  progress, and last month until its fee is posted, are not flagged), AI Coach Service Fee owed
  (earnings did not cover it), usage not yet charged (a finished month other than the last with
  usage and no AI Coach Service Fee posted), unpriced usage and domains below cost. No budget
  limits.
- **Summary** (migration 075): `platform_finance_months` holds each trainer workspace's figures
  per Dubai month (`workspaceMonths` in `apps/api/src/platform-pnl.ts`: ledger lines grouped by
  source and account, domain orders, cost rows by feature and provider, paying members, payouts,
  the usage statement, Stripe's fees read and estimated, the AI Coach Service Fee received and
  owed), rebuilt by the worker every hour for this and last month, once a day for the last 13
  months (the last 24 on its first daily pass), right after an operation changes a month's
  figures (an invoice import, pricing a provider's month, an estimate or reconciliation, a usage
  statement, adjustments, Stripe fees read) and by "Rebuild summary"; `platform_finance_runs`
  records every run with its scope (also the later phases' jobs). Months the summary has not
  covered are named on the screen, never shown as zero, and each month shows when it was built. Both tables are service-only (grants in the migration and
  `infra/runtime-role.sql`, classified in `scripts/verify-runtime-access.mjs`).
- **Access**: `/api/v1/admin/platform-finance` (GET), `/rebuild`, `/registrar-balance` (POST) and
  `/export/:tab.csv`: admin and finance platform roles with a fresh authenticator; every read,
  rebuild, balance check and export writes an `admin_operations_audit` row. Trainers get 403.

## Phase C: costs not recorded before (delivered, stage 2026-09-28u)

Migration 076 (service-only tables, grants in the migration and `infra/runtime-role.sql`,
classified in `scripts/verify-runtime-access.mjs`); screen: Platform finance → "Platform costs"
tab (`apps/web/components/platform-finance-costs.tsx`) and a bank-fee form on the Payouts tab.

- **Platform cost ledger** (`platform_costs`, `apps/api/src/platform-costs.ts`): costs that
  belong to no trainer, by the Dubai month they are for: servers, the email plan, provider plans,
  provider invoice charges not attributed to calls, registrar top-ups, payout bank fees, app store
  accounts, the platform domain, other. Amount in AED or USD with a receipt reference; append-only
  (a mistake is corrected by a reversal entry, `POST .../costs/:id/reverse`, once); every entry
  has an idempotency key (`manual:<intent>`, `recurring:<id>:<month>`,
  `payout-fee:<payout>` (then `:<n>` for a fee recorded after a reversal),
  `invoice:<provider>:<reference>:plan|remainder`, DigitalOcean's in phase D). Registrar top-ups
  are prepayments: the Domains tab shows USD top-ups less every registrar charge at its USD cost
  (orders quoted in AED journal the charge in AED but record the USD cost) as the registrar's
  book balance next to the balance the registrar reports; they are not costs in the profit and
  loss (each domain's registrar charge is).
- **Recurring costs** (`platform_recurring_costs`): a monthly amount from a first month, until a
  last month is set; the worker enters each month once (up to the last 12 months on its first
  pass).
- **Provider invoices** (`provider_invoices`, `apps/api/src/provider-invoices.ts`,
  `POST /api/v1/admin/platform-finance/invoices`): a CSV (`cost_usd`, optional `request_id`,
  `kind` usage or plan, `description`) or JSON (`{ "lines": [...] }`, optional `totalUsd` that
  must equal the lines) export, at most 1 MB and 10,000 lines, imported once per provider and
  reference (the same content again returns the recorded import; other content is refused).
  Lines naming a provider request reconcile that call; the usage total then prices the month's
  remaining estimated calls in proportion to their estimates (the phase A provider pricing, with
  its guards); with no calls left to price, usage the calls do not account for becomes a
  "provider invoice charges" platform cost; plan lines become a "provider plan" cost. The
  Providers tab compares each provider's call cost with the invoiced usage and plan fees.
- **Corrections for months already charged**: posted usage statements are never rewritten. For
  every workspace charged for the month, `postUsageCorrections` computes what its priced usage
  comes to now at that statement's own rate, markup and complimentary rule (a statement posted
  before markups existed was at cost; one that charged nothing, and so has no journal, follows
  today's settings), less what was charged (the statement plus earlier
  adjustments), and posts the difference once per reference as a journal
  `usage-adjustment:<month>:<hash of the reference>` (the key and the notification carry a hash,
  never the invoice reference, which may name the provider; the reference stays in the journal's
  data, which trainers never see; debit or credit of the trainer's payable balance against
  `platform_cost_recovery`), described "AI Coach Service Fee adjustment", with an owner
  notification ("AI Coach Service Fee adjustment: AED X more / back for <month>. … shown on your
  <month posted> statement."). It runs after
  every invoice import and on request ("Post adjustments", `POST .../usage-corrections`). The
  statement adds it to the AI Coach Service Fee of the month it posts (cash basis); months with
  unpriced calls are skipped.
- **Stripe's fee per payment** (`stripe_fees`, `apps/api/src/stripe-fees.ts`): each charge,
  refund and dispute's balance transaction (fee, fee details, net, exchange rate, settlement
  currency), keyed by balance transaction, read after every Stripe webhook for that workspace
  (best effort, not in the webhook's result) and by an hourly sweep of the last 90 days (at most
  50 Stripe reads a run; "Read Stripe fees now"). A dispute is read again once it closes as won
  (its second balance transaction reinstates the funds), and a dispute webhook reads that
  dispute whatever was recorded (a domain payment's dispute has no ledger entry unless lost).
  Read-only Stripe calls (`charges.retrieve`, `refunds.retrieve`, `disputes.retrieve`,
  `paymentIntents.retrieve` with `expand`). The profit and loss counts, per month, the fees read
  for the month's payments, refunds and disputes (domain payment fees included) and an estimate
  for payments not read yet (never a partial sum; see Phase B); the sweep rebuilds the months it
  read fees for. Trainers see Stripe's fee on their month's member payments, refunds and
  disputes on the statement (`stripeFeesOnPayments`, with `stripeFeesRead`; domain payment fees
  are the platform's). The Stripe mock (`tests/e2e/mocks/stripe.ts`) now gives charges, refunds and
  disputes balance transactions (2.9% + AED 1, +2% conversion, a mock AED 55 dispute fee).
- **Payout bank fees**: `POST .../payout-fees` (one per payout at a time, only for a payout
  sent to the bank; after its reversal the correct fee can be recorded), a platform cost shown
  against the payout (net of reversals, whatever month it was entered in); not charged to the
  trainer.
- **Email cost**: delivered email jobs per workspace and month are counted in the summary; the
  profit and loss prices them at "Email cost per delivered message (USD)" (Settings → Platform
  finance, default 0: only the email plan, entered as a recurring cost, counts).
- **Not done**: a suggested split of each Stripe payout by workspace (settlements stay entered by
  hand); per-provider voice price rows (voice prices stay in the provider settings).

## Phase D: automation (delivered, stage 2026-09-28v)

Migration 077 (service-only tables, grants in the migration and `infra/runtime-role.sql`,
classified in the runtime verifier).

- **DigitalOcean billing import** (`packages/providers/src/digitalocean-billing.ts`,
  `apps/api/src/digitalocean-costs.ts`). Settings → "DigitalOcean billing" (encrypted token,
  never in Git; project, default "GymMembership"; "Import daily", default on; a read-only
  connection check lists the team's projects and confirms the project). The owner approved using
  the existing DigitalOcean token (28 September 2026). The adapter sends GET only (no other
  method exists in it) to `/v2/customers/my/invoices`, `/v2/customers/my/invoices/{uuid}`,
  `/v2/projects`, `/v2/projects/{id}/resources`, `/v2/droplets/{id}`, `/v2/volumes/{id}`, and
  never echoes the token. The token is team-wide and other projects share the bill, so:
  - the configured project must exist in the team: otherwise the import fails (and raises the
    import alert) instead of importing every invoice as costing nothing;
  - each final monthly invoice is read once per project (`digitalocean_invoices`, keyed by
    invoice and project, recorded even with none of the project's items, so a changed project
    setting reads earlier invoices again) and only items whose `project_name` is the configured
    project become platform costs (`platform_costs`, category server, source `digitalocean`,
    keyed by invoice uuid, item position and a hash of the item; credits may be negative); the
    team's own total (other, unrelated projects) is never stored or shown;
  - the month without an invoice yet is estimated from the project's own resources
    (`digitalocean_estimates`, recomputed on every import): each droplet hourly from its creation
    or the month start to the month end, capped at its monthly price, +20% with weekly backups;
    volumes USD 0.10 per GiB-month; domains free; anything else listed as not estimated. The
    profit and loss shows the estimate (marked estimated) until the month's invoice is imported,
    then the invoice's items only; for the month in progress it counts the cost so far (the
    projection to the month end is in its description), beside income to date. DigitalOcean
    invoice periods are UTC months.
  - the worker imports once a day (a failed attempt is retried after an hour); Platform finance
    → Platform costs → "Import now" (`POST /api/v1/admin/platform-finance/digitalocean/import`,
    admin and finance, fresh MFA, audited) runs it at once; `GET .../digitalocean` shows the
    invoices read, the estimates and the last run.
- **Trends**: the Profit and loss tab shows each income and cost line's change on the month
  before (AED and %), and the monthly summary its profit change; the API returns `trends` per
  line.
- **Alerts** (`apps/api/src/platform-finance-alerts.ts`, through the platform alert engine,
  finance scope; no budget limits): `finance.cost_without_income` (a trainer's AI and voice cost
  in one of the last three finished months with no AI Coach Service Fee charged for it and no
  other platform income from them in that month; last month only once its fee is due),
  `finance.service_fee_owed` (a trainer owes AI Coach Service Fee their earnings did not
  cover),
  `finance.usage_unpriced_aging` (calls of an ended month still unpriced after "Alert on unpriced
  provider usage after (days)", default 7, critical after 30; estimated cost of months over 60
  days old not confirmed by an invoice, info), `finance.digitalocean_import` (the last import
  failed, or none succeeded for 48 hours while configured) and `finance.registrar_balance_low`
  (the registrar's last reported balance below "Alert when the registrar balance is below
  (USD)", default 20; critical below a quarter of it). The worker reads the registrar's balance
  once a day when a registrar is configured (read-only).
- **Mocks and tests**: the DigitalOcean double (`tests/e2e/mocks/digitalocean.ts`) now serves the
  billing routes with a seeded team (the platform project with one s-2vcpu-4gb droplet and a
  domain, an unrelated project with its own droplet, invoices carrying both); the e2e harness
  saves the billing settings against it and its Super admin scenario imports, sweeps Stripe fees,
  rebuilds and reads the profit and loss and exports the ledger.
- **Live read-only smoke (28 September 2026)**: the importer ran against DigitalOcean with the
  owner's token through a transport that refused anything but GET to the six read paths, writing
  only to a throwaway in-memory database. 14 requests, all GET, all 200; nothing written at
  DigitalOcean. The project GymMembership was found; the team's 10 final invoices (2025-06,
  2025-12 and 2026-01 to 2026-08) carry no GymMembership item, as expected before September
  2026, so nothing was imported from them. The September estimate, from the project's resources
  (the droplet `604067976`, s-2vcpu-4gb at USD 24 a month without the backups feature, and the
  free trainsyou.com domain), is USD 3.07 for the month (USD 1.10 so far), which the profit and
  loss would show as an estimated platform cost until September's invoice arrives.
- **Not done**: budgets (the owner decided against them); spreading upfront programme or yearly
  domain income (the owner chose cash basis); reserved IPs, load balancers, databases, Spaces and
  snapshots are listed as not estimated (none are in the project today).

## Review round 1 (stage 2026-09-28w, same branch)

Money, security and screen reviews of phases B-D found 30 issues (28 distinct); each was checked
against the code. All were fixed on `core/finance-bcd` with regression tests in
`tests/platform-finance-bcd.test.ts`, except where noted. Migration 077 changed in place (the
branch is unmerged and 077 was never applied outside test databases).

- **Cash basis for the AI Coach Service Fee.** The fee is deducted from the trainer's earnings,
  so the profit and loss counts it when earnings cover it. Month by month over the whole ledger
  (`workspaceMonths`): the fee owed at a month end is at most the fees owed before plus the
  month's fees, and at most the trainer's positive payable balance then (what they owe the
  platform); the fee received in a month is its fees less the growth of what is owed. A trainer
  with only complimentary members is charged but pays nothing until they earn: their fee is
  owed (a note on the month, a "Fee owed" column, the flag `service_fee_owed` and the alert
  `finance.service_fee_owed`), and becomes income in the month later earnings cover it. This is
  our reading of the owner's cash-basis decision, not a new owner decision.
- **Cost against income.** A month's own fee (posted after it ends) matches its usage, so
  `cost_without_income` fires only for a finished month whose usage was charged nothing and that
  brought no other income; the month in progress, and last month until its fee is posted, are
  not flagged. The alert looks at the last three finished months.
- **Stripe fees.** Never a partial sum: per month, the fees read from Stripe for the month's
  payments, refunds and disputes plus an estimate (the Stripe fee settings) for payments not
  read yet, with a note "read from Stripe for X of Y"; refunds and disputes not read yet count
  as nothing and are counted in the note. Settlement fees are income (recovered from trainers),
  no longer a fallback cost. A dispute closed as won is read again for its reinstatement, a
  dispute webhook reads that dispute whatever was recorded, and fees of a domain dispute with
  no ledger entry are counted. The trainer's statement says "payments, refunds and disputes"
  and how many were read.
- **Summary freshness.** Operations that change a past month rebuild it at once (invoice
  import, provider month pricing, estimate, reconciliation, usage statement, adjustments,
  Stripe fees read; `refreshSummary`, best effort after the operation's transaction); the
  worker adds a daily pass over the last 13 months; each month shows when it was built.
- **Estimates and the month in progress.** Every cost line carries its estimated part (AI and
  voice at estimates, Stripe fees not read, platform costs awaiting their invoice, including
  DigitalOcean's estimate), and "estimated cost" adds them. The month in progress is labelled
  "to date", counts DigitalOcean's cost so far (not the month-end projection), and raises no
  cost-without-income warning (platform costs without income that month are a note).
  Declined: recurring monthly costs stay in full from the first day of the month (plans are
  billed in full up front); the in-progress note says so.
- **Domains and payouts.** A domain payment for no open order (booked to the refund liability)
  and its refund are not domain income or cost. A payout's bank fee can be recorded again after
  its reversal, and the Payouts tab shows the fee net of reversals. The registrar book is in
  USD: AED-quoted orders count at their recorded USD cost.
- **Trainer data.** Events: the platform's pricing and reconciliation events are not listed to
  the workspace and cost, provider and rate fields are removed from the others. Adjustment
  source keys and notification keys carry a hash of the invoice reference. The trainer ledger
  CSV has only the trainer's line of each fee journal (no `platform_cost_recovery`). A personal
  export's usage rows carry id, task and time only (migration 061's helper unchanged).
- **DigitalOcean.** A project missing from the team fails the import (and raises the import
  alert); invoices are recorded per project, so a changed project setting reads earlier
  invoices again; the team's total is neither stored nor shown.
- **Invoice import.** At most 50 CSV columns; a row wider than the header is refused (trailing
  empty fields allowed); rows are read by column position.
- **Trainer screens.** Fees are named by the month they are for: the statement lists "Fee for
  July 2026", the notice names the statement it is on, the payout shows "AI Coach Service Fee
  for August 2026" (the fee deducted from that month's payout) and "Stripe fees (paid by you)
  settled in August 2026", and the Payments card includes later adjustments of each month. The
  Financial activity table has a "Deducted from your earnings" column (the fee, its adjustments,
  Stripe's fee at settlement, other charges); the settlement row no longer shows the settled
  gross. Analytics revenue shows AED amounts. Staff see the fee terms and the booking fee on the
  paid-session form (not the commission bands); a failed fee-terms read is retried. The offer
  estimate announces one short summary to screen readers once typing pauses. The complimentary
  access form says their usage is included in the AI Coach Service Fee.
- **Platform finance screen.** Tables scroll inside their region at 390 px (`.table-scroll`
  in `globals.css`, which also fixes the older users); tabs have one tab stop with arrow keys,
  Home and End and one panel id; income and costs are separate row groups; money has the
  currency code everywhere ("USD 24.00", "AED 12.30"; provider costs keep four decimals); the
  income tile lists its lines; the flags tile says "N warnings, M notes"; the payout bank-fee
  form has visible labels; a rejected reversal reason or last month says why.
