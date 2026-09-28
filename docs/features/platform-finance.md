# Platform finance: costs and profit for the Super admin

Owner request (28 September 2026): "The Super admin should have a clear idea about the costs and
profit for everything, including AI costs, subscription payouts, domain payments and profit, and
everything else. Go ahead with the Super admin works."

This document is the plan (phases A to D) and the record of what phase A delivered. The audit
behind it read the code on `integrate/round2` (`bb80aa3`); its findings are summarised under
"Starting point".

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

## Owner decisions still open (current behaviour kept)

| Decision | Current behaviour | Where it can change |
| --- | --- | --- |
| Who bears Stripe fees | The trainer bears the whole fee of each settlement (`stripe-settlement:` debits `trainer_payable`) | Not a setting yet: splitting a settlement's fee by commission share needs Stripe's per-charge fee (phase C) |
| AI and voice charged to trainers | At cost, no markup | Settings → Platform finance → "Markup on AI and voice usage charged to trainers (%)", default 0 |
| AI and voice used by complimentary members | Charged to the trainer | Settings → Platform finance → "Who pays for AI and voice used by complimentary members", default the trainer |
| When income is recognised | When paid (upfront programmes and yearly domains are not spread) | Phase D |
| Budget limits | None beyond the daily AI call limit and the daily voice USD limit | Phase D |
| Charging calls whose outcome never came back | Not charged until reconciled from the invoice or estimated by an operator | Settings → Platform finance → "Automatic month close estimates unresolved provider usage", default off |

A setting change applies to usage statements posted after it; posted statements never change.

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
  transaction as the change. Registrar costs keep the
  quote's rate (web-address code belongs to the domain-pricing job).
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
  other figure reads only AED journals, ready for USD domain journals from `core/domain-pricing`.
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
reversal is posted in the refund journal's own currency (the `currency` option is passed through
to whatever `journal()` it merges with; on this branch every journal is AED). Statements and
metrics subtract reversals. No pricing, checkout or ledger posting code of the web-address flow
changed.

### Checks

See `docs/COMPLETION_STAGES.md`, stage 2026-09-28p, for the checks actually run.

## Phase B: the Platform finance screen and domain profit

After `core/domain-pricing` (migration 071, web-address pricing and ledger in USD) merges:

- One screen at `/admin/platform-finance` (admin and finance roles, fresh MFA, audited) with a
  period picker (month, quarter, year to date, custom; Dubai time) and a CSV per tab:
  profit and loss (platform revenue by product, direct costs by feature and provider, gross
  profit and margin; each cost line priced, estimated or unpriced, "incomplete" when a source has
  no data), trainers (one row each: payments, commission, domain profit, costs charged back, AI
  and voice cost, contribution and margin, cost per paying member; flags for negative
  contribution), features and products, providers (estimate against invoice), domains (price
  paid, registrar cost, profit per order, renewals below cost), payouts across trainers.
- Domain profit from the USD web-address ledger, and the registrar prepaid balance.
- A monthly summary table rebuilt by the worker so the screen does not read every workspace per
  request.
- Full ledger export across trainers and a cost export for any date range.

## Phase C: costs not recorded yet

- A platform ledger for costs that belong to no trainer (servers, email plan, provider plans, app
  store accounts, registrar top-ups, the main domain), also closing the two known ledger gaps
  (domain receivable never settled, no registrar top-up entry).
- Provider invoices and correction entries per trainer and feature (priced rows stay immutable;
  corrections are new entries), including the difference for months already charged.
- Stripe fee per charge, refund and dispute (domain sales and dispute fees included), and a
  suggested split of each Stripe payout; then the Stripe fee decision can become a setting.
- Bank fee per trainer payout; email cost per message and the plan fee.
- Per-provider voice price rows in the price table (phase A keeps voice rates in the provider
  settings).
- Migration numbers are allocated when built (072 and 073 are used; 071 belongs to domain
  pricing).

## Phase D: automation

- DigitalOcean billing import with a new read-only billing token the owner creates and stores as a
  secret (the credentials pasted in earlier chat must not be used; the job changes no
  DigitalOcean resource; depends on the separately assigned deployment work).
- Budgets per platform or trainer, per category and month, and alerts: spend spikes, budgets
  reached, negative contribution two months running, costs unpriced too long, domain renewals
  below cost, low registrar balance, invoice differences over 5%, daily limits hit.
- Trends, and optionally spreading programme and yearly domain income over their term (owner
  decision).
