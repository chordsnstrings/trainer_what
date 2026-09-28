# Trainer-set programme length, voice add-on billing and the day-by-day view (work package `core/programme`)

Status: implemented on branch `core/programme` (base `b4ac2b5`, migration 064), with the review
fixes of 28 September 2026 (see "Review fixes" below). Test runs are recorded below exactly as
run; limits are listed at the end. Nothing was deployed and no live provider was called.

## Plan (written before implementation)

Owner decision of 28 September 2026: the trainer sets the programme length per offer, the
Trainer Brain plans for that length, and the subscriber follows it day by day. Voice runs the
session for members who add voice to their membership. Money rules are unchanged: Stripe
collects, the ledger is immutable, commission follows the member's stable rank, refunds
compensate.

1. **Offers**: `programmeDays` (7..365, `null` = rolling blocks of the Brain default) and
   `billing` (`monthly` | `upfront`; upfront needs a length). Activation creates a recurring
   monthly Stripe price (monthly) or a one-time price (upfront), plus a separate monthly voice
   add-on product/price when `voiceAddOnMinor` is set. The workout + nutrition pair must share
   billing and length. Plan changes stay monthly-only.
2. **Upfront payment**: the same checkout admission and business intent as memberships, a
   Stripe Checkout in `payment` mode, a `stripe-programme:<intent>` journal with the membership
   commission method and stable rank, and an access window on the member's `subscriptions` row.
   Refunds, disputes, statements, metrics, acquisition and close eligibility read programme
   charges; reconciliation resolves programme checkouts from provider evidence.
3. **Voice add-on**: its own Stripe subscription tied to the membership (works for monthly and
   upfront members), mirrored into the membership row, entitling only with paid access.
4. **Programme length**: `programmeLengthDays(tx, userId)`.
5. **Day by day**: Day N of M in the member's time zone, today's session or rest day, what is
   next, streak/adherence, nutrition target and diary progress, a timeline, end-of-programme
   handling, and a worker sweep.
6. **UI** in new components with minimal `workspace.tsx` edits; **tests** as listed below.

## What was built

### Offers (`packages/contracts/src/index.ts`, `apps/api/src/app.ts`, `apps/api/src/programme-billing.ts`)

- `productSchema` gains `programmeDays` (integer 7..365 or `null`, default `null`), `billing`
  (`monthly` default | `upfront`) and `voiceAddOnMinor` (100..100000 minor units or `null`). An
  upfront offer without a length is refused (400). `premiumVoice` is no longer accepted: voice is
  not sold as an offer of its own any more.
- `POST /api/v1/products`: the workout + nutrition offer must use the same billing and the same
  programme length (monthly block length too) as its workout-only pair (`OFFER_PAIR_BILLING`),
  besides costing more (unchanged).
- `POST /api/v1/products/:id/activate`: a monthly offer gets a recurring monthly price (as
  before); an upfront offer gets a one-time price for the whole programme. When the offer has a
  voice add-on price, a separate Stripe product "… · premium voice" and a monthly price are
  created (`voiceStripeProductId`, `voiceStripePriceId`, `voicePriceIds`).
- `POST /api/v1/products/:id/voice-addon` `{ priceMinor }` (owner): sets or changes the add-on
  price of an offer. A published offer gets a new provider price; earlier prices stay in
  `voicePriceIds`, so members keep the price they bought and their events still verify. Refused
  (`VOICE_INCLUDED`) on an older offer that already includes voice.
- `POST /api/v1/membership/change-plan` refuses an upfront target (`UPFRONT_PLAN`).
- Monthly offers renew exactly as before; their `programmeDays` is the block length. When a
  provider projection maps the membership to a different block length (an edited offer), a new
  block starts (Day 1) at that event instead of renumbering the current block.

### Upfront programme payment (`finance-checkout.ts`, `programme-billing.ts`, `stripe-events.ts`)

- `POST /api/v1/payments/checkout` on an upfront offer reserves the same `records.kind='checkout'`
  intent (`data.billing='upfront'`, `purpose: programme`, list price, `programmeDays`), with the
  same workspace/membership admission, then creates a Checkout Session in `payment` mode with the
  one-time price, `payment_intent_data.metadata` and no trial (a promotion code's coupon still
  applies). Idempotency key `checkout:<intent>` as for memberships.
- Admission: an active upfront programme blocks another purchase until its final 7 days
  (`RENEWAL_WINDOW_DAYS`); in that window only another upfront programme may be bought (it is
  queued, below; one queued programme at a time), and a monthly membership can start once the
  programme ended.
- A signed `checkout.session.completed` / `async_payment_succeeded` in payment mode with
  `purpose: programme` is verified (intent, tenant, member and provider identity; status
  `complete`; `payment_status` paid or no payment required; currency AED; amount equal to the
  list price, or at most it when the intent carried a coupon), the charge is resolved from the
  PaymentIntent's `latest_charge` (the event is retained for reconciliation when it cannot be),
  provider objects are mapped to the member, and in one transaction:
  - the subscriptions row becomes `provider_id NULL`, `status active`,
    `period_end = paid + programmeDays`, `data.billing='upfront'`, the offer's tier/modules,
    `programmeDays`, `programmeStartsAt`, `data.upfront` (intent, checkout, payment intent,
    charge, amount, window) and a bounded `programmeHistory`; the stable commission rank,
    first-paid time and any voice add-on are kept;
  - a renewal bought while the current programme is still running is **queued**: it is stored
    as `data.nextProgramme` (start = the current end, end = start + its length) and
    `period_end` moves to its end, while the current window, offer, length and Day 1 stay. When
    its start passes it applies at once in reads (`effectiveProgrammeWindow` in
    `packages/domain/src/programme.ts`, used by Today and `programmeLengthDays`) and the worker
    promotes it onto the row (`promoteQueuedProgramme`, event `programme.started`), moving the
    finished window to the history;
  - an immutable `stripe-programme:<intent>` journal "Programme payment" posts gross,
    commission at the member's stable rank (assigned at the first positive charge by the shared
    `assignCommissionRank`, which now also counts programme payers) and trainer payable;
  - the intent is completed; `programme.paid` is recorded; first-paid acquisition is recorded.
  A replayed event posts nothing twice. `async_payment_failed` closes the intent; `expired`
  expires it. A payment that arrives while a monthly membership is current still posts the
  money, does not replace access and opens a `reconciliation` record for finance.
- Refunds use the existing request → owner decision → provider → ledger path. Migration 064
  widens the member charge helpers, and the refund/dispute/admin/close queries read
  `stripe-programme:` charges. A refund journal is "Programme refund". A **full** refund of the
  current programme ends its access (`status canceled`, `endedReason refunded`), or, when a
  renewal is queued, starts the queued programme now for its full length; a full refund of a
  queued programme removes it and access returns to the end of the current one; a refund of a
  programme already over changes no access. Partial refunds keep access.
- Statements: `financialStatement()` counts programme gross/commission and returns
  `revenue { membershipMinor, programmeMinor, voiceAddOnMinor, sessionsMinor }` (the bridge is
  unchanged). Business metrics count programme charges in gross takings but **not in MRR**: the
  snapshot reports `upfrontProgrammes { active, pastDue, collectedMinor, monthlyEquivalentMinor }`
  (price × 30 ÷ programme days, current access only) apart, adds active verified voice add-ons
  to `mrrMinor` (`voiceAddOns { active, mrrMinor }`, from the mirrored price amount or the offer's
  add-on price), counts an upfront member as paying in every month the paid access covers, and
  counts `programme.ended` (an upfront programme that ended without a renewal, after a positive
  charge) as a cancellation for churn. The trainer's analytics report `recurring_minor` without
  upfront rows and `upfront_minor` apart. Acquisition counts programme payments as a first
  payment; payout close eligibility treats later refunds of programme charges like invoice
  refunds; an uncertain (`unknown`) programme checkout blocks the monthly close.
- Reconciliation: the member's `POST /api/v1/payments/checkout/reconcile` resolves an upfront
  intent (retrieve/list → the same verified projection); the finance obligations job
  (`finance-automation.ts`) resolves programme and voice add-on checkouts left `creating` /
  `unknown` for over two minutes from provider evidence, and its subscription sync also syncs the
  voice add-on subscription.
- A late event of an older monthly membership never replaces a current upfront programme
  (terminal events are history; an active one is retained for reconciliation). A new monthly
  membership after an ended programme maps its own price and starts a new programme, also
  before the worker sweep has closed the ended row (an upfront row whose paid access is over
  counts as terminal for a non-terminal event); the ended window moves to the history.
- A paid upfront intent is settled for privacy (`settlementBlockers`); the subscription row
  itself blocks while access is current, as for memberships.

### Voice add-on (`apps/api/src/voice-addon.ts`, `entitlements.ts`)

- Its own Stripe subscription at the member's offer's add-on price, tied to the membership.
  Routes (subscriber only):
  - `GET /api/v1/membership/voice-addon`: included (older offer) / available / active / status /
    period end / end-at-period-end flag / pending purchase.
  - `POST /api/v1/membership/voice-addon`: requires current paid access, refuses when voice is
    included (`VOICE_INCLUDED`), already on (`VOICE_ACTIVE`), or when a completed add-on
    checkout's subscription has not been mirrored yet (`VOICE_PENDING`; the status shows the
    purchase as `confirming` and not available, and "Check voice purchase" resolves it from the
    provider); reserves a
    `records.kind='checkout'` intent with `purpose: voice_addon` (never mixed with membership
    intents) and opens a subscription Checkout (`voice-addon:<intent>`); returns the open link on
    repeat; resumes an add-on set to end. New sales need approved commerce, checked before any
    intent is reserved.
  - `POST /api/v1/membership/voice-addon/cancel`: `cancel_at_period_end` (voice stays until the
    paid period ends); the idempotency key follows the mirrored provider state.
  - `POST /api/v1/membership/voice-addon/reconcile`: resolves a pending add-on checkout from the
    provider.
- Provider events route first in `processStripeEvent`: checkout/subscription/invoice events
  with `purpose: voice_addon` metadata or a stored `voice_addon_subscription` mapping. The
  subscription is mirrored into `subscriptions.data.voiceAddOn` under the workspace lock (a
  member cannot write it: migration 061 guard), with out-of-order and same-second protection and
  one current add-on at a time. Only a price that is (or was) one of the workspace's add-on
  prices sets `verified`; metadata never grants voice.
- Add-on invoices post `stripe-invoice:<id>` journals "Voice add-on payment" with
  `purpose: voice_addon`, commission at the member's stable rank, a `billing_invoice` record
  (`purpose: voice_addon`), and they are refundable through the normal path ("Voice add-on
  refund"). The membership row's status, period and price are untouched. A **full** refund of
  an add-on charge of the current add-on marks it `endRequested` (voice stops at once) and the
  worker cancels the add-on subscription; the mark survives later events of that subscription
  until the cancellation is mirrored.
- Membership exit (`endFollowerMembership`, leave or owner removal): before the membership ends,
  a renewing add-on is set to `cancel_at_period_end` at the provider (idempotency key per
  mirrored state); payments unavailable or an unconfirmed answer refuse the exit with nothing
  changed, and a re-enabled add-on found under the exit lock refuses it (`VOICE_ADDON_ACTIVE`).
  The preview reports `voiceAddOnRenewing`; the result and the `membership.left/removed` event
  carry `voiceAddOn: 'ends' | 'none'`. After the exit the worker cancels the add-on at once.
- `memberAccess(...).premiumVoice` = paid access and (an older offer that included voice, or an
  active verified add-on whose period has not ended); `voiceSource` is `included` | `add_on` |
  `null`. Complimentary access never has voice.
- Migration of existing offers: 064 marks offers with `premiumVoice` as `voiceIncluded`; their
  members keep voice with no add-on; projection of those offers is unchanged.
- The worker ends add-on subscriptions that must end now (idempotency key
  `voice-addon-end:<subscription>`): the member has no paid access, is no longer a member of
  the workspace, or the add-on was refunded in full. The test runs in SQL before the page limit
  (100 per page, `user_id` cursor, up to 20 pages per cycle), so healthy add-ons never crowd
  out the ones to end, and a failed cancel never blocks the rows after it. Entitlement already
  stops at once.

### Programme length (`apps/api/src/programme-length.ts`)

`programmeLengthDays(tx, userId): Promise<number>` — the `programmeDays` snapshotted on the
member's paid membership (monthly: from the offer at each provider projection; upfront: from
the paid intent, or the queued renewal's once its start has passed), else the offer's, else
`BRAIN_DEFAULT_PROGRAMME_DAYS` (28) for rolling offers, complimentary access or no paid access. Works in the member's own scope and in coaching team
scopes (row security limits both reads).

### Day by day (`packages/domain/src/programme.ts`, `apps/api/src/programme-today.ts`)

- Calendar rules (pure): `programmePosition` (Day N of M from the programme start's calendar day
  in the member's time zone, arithmetic at UTC noon so DST never shifts a day; upfront clamps to
  M and completes at the paid access end; monthly/complimentary run in consecutive blocks),
  `programmeTimeline`, `adherence` (streak and 28-day adherence; rest days and coach-canceled
  sessions neither break nor extend a streak; today's session counts once done),
  `endOfProgramme` (next block / renews / ends with renew window / ended).
- `GET /api/v1/programme/today?timezone=` (subscriber): programme position, `planState`
  (`none` | `awaiting_coach` | `ready` | `ended`), today's session (or rest day, only when the
  block has a plan), what's next, streak/adherence, today's nutrition target and diary progress
  (permission / set-up states when missing; review-due flag), and the end-of-programme state
  with the offer to renew when it is still published. Time zone: the device's (validated), else
  the member's notification preference, else the latest planned session's, else Asia/Dubai.
  `planState` is `awaiting_coach` while the member has access but the current block has no
  planned session (the coach or the Brain is still preparing it, or it waits for the coach's
  review), `ended` once access has ended or the programme is complete. With a queued renewal
  the end state is `next_block` at the queued start and `nextProgramme` gives its length.
- `GET /api/v1/programme/timeline?timezone=`: one entry per day of the current programme
  (upfront) or block (monthly): session or rest, done / missed / today / planned / canceled;
  without a plan for the block, days are `unplanned` (not rest) and `planState` is returned.
- Worker `sweepProgrammes` (new `programmes` step of the tenant cycle, skipped while suspended):
  promotes queued upfront programmes whose start passed, closes upfront programmes whose
  access ended once (`programme.ended`, notice `programme-ended`), sends `programme-ending` 3
  days before the end (programmes longer than 3 days), marks each new monthly block once
  (`programme.block_started` for the Brain, notice `programme-next-block`), and ends orphaned
  voice add-ons. The block sweep visits every monthly member (pages of 500 by id) and keeps
  `data.blockNotice { startsAt, block }` on the row, so a block missed during a worker outage
  is caught up within its first 7 days (a row with no notice history further into a block is
  marked without a late notice). The three template keys are registered in
  `message-templates.ts`; the registry default of `programme-next-block` is generic ("A new
  block of your programme has started"), because a published template replaces the sender's
  text, which names the block and its length.

### UI (new components; `workspace.tsx` only mounts them)

- `programme-today.tsx`: `ProgrammeToday` on the member's Today screen (Day N of M with a
  progress bar, block badge for rolling offers, today's session or rest day with a start link,
  "Your coach is preparing your plan" while `planState` is `awaiting_coach`, no day tiles once
  it is `ended`, "Choose your next plan" linking to `/app/membership#offers`,
  what's next, streak/adherence, nutrition card with calories and macros, end-of-programme notice
  with renew), `ProgrammeTimeline` at the new `/app/timeline` route (nav: "Programme timeline").
- `programme-offers.tsx`: the trainer's offer form (billing, programme length or rolling, price
  label by billing, optional voice add-on price), `OfferTerms`/`offerTermsText` used on the
  member membership page, trainer offer cards, the storefront, the public website offer cards and
  the onboarding preview, `OfferVoicePrice` to price/change an offer's add-on.
- `programme-membership.tsx`: `UpfrontMembership` (paid in full, access until, no renewal
  control, the queued next programme, and the offers the member may buy now, mirroring the
  API's admission: any published offer once the programme ended, upfront offers in its final
  week, none otherwise) and `VoiceAddOnCard` (add, remove at period end, keep, check purchase,
  "being confirmed").
- `apps/web/app/programme.css`: logical properties only; grids use `minmax(min(100%, …))` so
  cards and the timeline fit 390px.

### Migration 064 (`packages/db/migrations/064_programme_billing.sql`)

Replaces `member_charges()` / `member_charge(text)` (same signatures, definer attributes and
grants) to include `stripe-programme:` journals; backfills `billing: monthly` and
`programmeDays: null` on existing offers and `voiceIncluded: true` on offers with
`premiumVoice`; adds partial indexes for upfront access ends, voice add-on rows and journal
charge ids. No new table, grant or definer helper, so `infra/runtime-role.sql` and
`scripts/verify-runtime-access.mjs` are unchanged (the verifier passed, below).

### Isolation

Follower requests run in the member's own subscriber scope. Provider-confirmed projections use
the `provider-callback` elevation (added for `programme-billing.ts` and `voice-addon.ts` in
`packages/db/src/scope.ts`); the sweep uses `worker` (`programme-today.ts`). A member cannot
write its own access or voice state (subscription update guard); another follower sees none of
it; the coaching team gets no member Today view.

### Flags and configuration

No new flag. New sales (upfront checkout, voice add-on checkout) need `COMMERCE_APPROVED=true`
and a configured Stripe key, as memberships do; servicing (remove/keep voice, refunds, worker
add-on end) uses the configured Stripe client. Providers stay disabled until configured.

### E2E tooling

`tests/e2e/mocks/stripe.ts`: `DELETE /v1/subscriptions/:id` (`subscriptions.cancel`, sends
`customer.subscription.deleted`); payment-mode Checkout with a one-time price and add-on
subscription Checkouts already worked and are now covered by a test. Scenarios updated: the
trainer seed prices a voice add-on on the nutrition offer (`voiceAddOnMinor`) instead of
`premiumVoice`; the follower flow buys the add-on through the mock Checkout before the guided
voice step. **The e2e harness was not run** (it needs a production web build).

## Tests actually run

New files (`node --import tsx --test`, PGlite):

- `tests/programme-calendar.test.ts` (6): offer validation; Day N of M across Dubai/New York;
  DST (Europe/London); monthly and rolling blocks; timeline, streak and adherence; end of
  programme.
- `tests/programme-billing.test.ts` (7): offer activation (one-time vs recurring prices, add-on
  price, repricing, pair rule, commerce gate); upfront checkout to ledger, commission, access
  window, replay, admission, member charge list, statement; payment verification (amount,
  currency, unpaid, identity, async success); partial then full refund (commission reversal,
  access end, over-refund refused, buy again); early renewal carrying days and its refund;
  webhook-loss reconciliation and late older-membership events; ended programme → monthly
  membership replacement and privacy settlement.
- `tests/programme-voice.test.ts` (5): add-on checkout, mirror, entitlement, add-on invoice
  journal, statement, remove/keep, refund; price verification and out-of-order events; older
  included offers; membership end → entitlement off and worker cancel once; isolation.
- `tests/programme-today.test.ts` (4): Today payload (day, session, next, streak, nutrition),
  timeline, time-zone fallback; ending notice, end sweep and renew; monthly blocks, block notice
  once, rolling default; isolation (other follower, coach 403, anonymous 401, other workspace).
- `tests/programme-stripe-mock.test.ts` (1): the e2e Stripe double through the real SDK.

Runs:

- `npx tsc --noEmit`: no errors (final state).
- PGlite, the five new files: 23 tests, 23 pass.
- PGlite, related existing suites during development: 9 files / 68 tests pass (finance-checkout,
  finance-completion, fix-ledger, fix2-finance, governance-suspension, messaging-templates,
  isolation-elevation, logical-css, e2e-harness-mocks); 12 files / 105 tests pass (acquisition,
  governance-metrics, bookings-completion, integrations-completion, isolation-scope,
  isolation-follower, isolation-guard, privacy-lifecycle, lifecycle-messages, retention,
  joining-complimentary, rtl-layout). A later 15-file run found 1 failure
  (`finance-checkout` privacy settlement: a NULL comparison in the new settled-programme filter);
  it was fixed with `coalesce`, and the affected files were re-run: 7 files / 47 tests pass.
  Web-side suites (coach-site, onboarding-completion, fix-web, fix2-web, logical-css,
  bounded-bootstrap): 53 tests pass.
- PGlite, final consolidated run on the final code (`--test-concurrency=2`): 27 files (the five
  new files plus finance-checkout, finance-completion, fix-ledger, fix2-finance,
  governance-suspension, messaging-templates, isolation-elevation, isolation-scope,
  isolation-follower, isolation-guard, logical-css, rtl-layout, e2e-harness-mocks,
  privacy-lifecycle, acquisition, bookings-completion, integrations-completion,
  lifecycle-messages, retention, coach-site, onboarding-completion, governance-metrics):
  200 tests, 200 pass, 0 fail, 0 skipped.
- PostgreSQL: `/opt/tools/pg-sandbox.sh 56132 <worktree>` with 14 files (the five new files,
  finance-checkout, finance-completion, fix-ledger, privacy-lifecycle, governance-suspension,
  isolation-scope, isolation-follower, isolation-elevation, isolation-guard): verifier
  `{"runtimeAccess":"verified","migrations":55,…,"tenantScopeFixed":true}`, 93 tests, 93 pass,
  `PG_SELECTED_FAILED_FILES=0`. (An earlier PostgreSQL run caught two restricted-role issues
  that PGlite does not: the add-on membership check read `subscriptions` as the service role,
  and a test fixture wrote consent as the service role; both fixed before this run.)

Not run: the whole suite, `next build`, the e2e harness, a browser check at 390px (layout relies
on the logical-CSS lint test and responsive grid rules only).

### Review fixes (28 September 2026) and their runs

Fixed from the review of the first commit (findings in order):

1. **Voice add-on after an exit** (major): the exit stops the add-on renewing before the
   membership ends (uncertain outcome blocks the exit), and the orphan sweep treats a row with
   no subscriber membership as orphaned and cancels it (`membership-exit.ts`, `voice-addon.ts`).
2. **Orphan sweep starvation** (major): the "must end now" test moved into SQL before the page
   limit, with a `user_id` cursor (`voice-addon.ts`).
3. **Upfront revenue counted as MRR** (major): upfront rows are left out of MRR and reported
   apart with a 30-day equivalent; voice add-ons are added to MRR; paying members and churn
   cover upfront programmes (`business-metrics.ts`, `admin-operations.ts`).
4. **Monthly purchase after upfront access ended but before the sweep** threw: an upfront row
   whose access is over now counts as terminal for a non-terminal event (`stripe-events.ts`).
5. **Early renewal** now queues the next programme instead of carrying days (no "Day M of M"
   plateau, the Brain plans the right length, no mislabelled days); refunds of the current or
   the queued programme are handled (`programme-billing.ts`, `programme-today.ts`,
   `programme-length.ts`, `packages/domain/src/programme.ts`).
6. **Rest day without a plan**: `planState` (`awaiting_coach` / `ready` / `ended` / `none`);
   rest only when the block has a plan; UI messages and no tiles once ended.
7. **No way to buy from the upfront membership card**: it lists the offers the member may buy
   now; "Choose your next plan" links to them.
8. **Second add-on purchase while the first is being confirmed**: `VOICE_PENDING` and a
   `confirming` pending state; reconcile resolves it.
9. **Full add-on refund kept voice**: now ends voice and the worker cancels the add-on.
10. **Block sweep capped at 500 and day 1-2 window**: pages through every member and catches up
    a missed block within 7 days, remembered on the row.
11. **Pair block lengths**: monthly pairs must share the length; a length change starts a new
    block.
12. **Template default** of `programme-next-block` is generic.
13. **Lifecycle triggers** (paid milestone, intake reminder, refund notices) include
    `stripe-programme:` payments and never count a voice add-on invoice as a membership's first
    payment (`lifecycle-messages.ts`). No dedicated test for this one; the existing
    `lifecycle-messages` suite passes.

Missing requirement (no e2e path for an upfront purchase): the e2e harness still was **not run**
(it needs a production web build). Instead, `tests/programme-stripe-mock.test.ts` gained an
integration test that drives the real API and the real Stripe SDK against the e2e Stripe
double: the trainer creates and activates an upfront offer with a voice add-on price, a member
buys the programme and the add-on through mock Checkouts, the member leaves, and the worker
ends the add-on at the mock. No e2e scenario file was added (it could not be run here).

Tests added: `tests/programme-review.test.ts` (7), the queued-renewal test replacing the
carried-days test in `tests/programme-billing.test.ts`, the Stripe double integration test in
`tests/programme-stripe-mock.test.ts`, and an upfront/voice metrics test in
`tests/governance-metrics.test.ts`.

Runs on the final code:

- `npx tsc --noEmit`: exit 0.
- PGlite (`--test-concurrency=2`), 18 files: the six programme files (billing, voice, today,
  calendar, stripe-mock, review), finance-checkout, finance-completion, governance-suspension,
  governance-metrics, accounts-membership-exit, lifecycle-messages, messaging-templates,
  isolation-elevation, logical-css, privacy-lifecycle, retention, isolation-follower:
  113 tests, 113 pass, 0 fail, 0 skipped.
- PGlite, 13 more related files (acquisition, bounded-bootstrap, coach-site, e2e-harness-mocks,
  fix-ledger, fix-web, fix2-finance, fix2-web, governance-web, isolation-guard, isolation-scope,
  onboarding-completion, rtl-layout): 118 tests, 118 pass, 0 fail.
- PostgreSQL, `/opt/tools/pg-sandbox.sh 56132 <worktree>`, run 1 with 11 files (the six
  programme files, finance-checkout, finance-completion, governance-metrics,
  accounts-membership-exit, lifecycle-messages): verifier
  `{"runtimeAccess":"verified","migrations":55,…,"tenantScopeFixed":true}`, 73 tests, 73 pass,
  `PG_SELECTED_FAILED_FILES=0`.
- PostgreSQL, run 2 with 7 files (isolation-scope, isolation-follower, isolation-elevation,
  isolation-guard, governance-suspension, privacy-lifecycle, fix-ledger): verifier passed,
  46 tests, 46 pass, `PG_SELECTED_FAILED_FILES=0`.

Still not run: the whole suite, `next build`, the e2e harness, a browser check at 390px.

## Limits

- Upfront programmes renew only by a new purchase (in the final week or after the end); there
  is no automatic renewal or instalment plan.
- A voice add-on for an upfront member renews monthly until the worker ends it after the
  programme ends (or at once after an exit or a full add-on refund); the last period is not
  prorated or refunded. A failed add-on payment removes voice at once (no grace).
- One renewal can be queued at a time; a second purchase while one is queued is refused
  (a payment that still arrives is posted and opens a `reconciliation` record). The queued
  programme's offer modules apply from its start once the worker promotes it (reads of the
  day and length switch at its start already).
- If the exit is refused after the add-on was set to end (a blocker found under the exit
  lock), the member keeps the add-on until its period ends and can keep it from the membership
  page.
- A full refund of any charge of the current add-on subscription ends it, whichever month the
  charge paid for.
- The block-start notice is caught up within the first 7 days of a block; a worker outage
  longer than that skips the notice and the `programme.block_started` event for that block.
- `planState` reads only planned sessions the member can see; a plan held in the coach's
  private review queue (the `plans` package) shows as `awaiting_coach` until sessions exist.
- Upfront paying members are counted for every month their paid window covers even if the
  programme was later refunded in full.
- Merge note for the coordinator: `apps/api/src/programme-length.ts` is shared with the `plans`
  package (same signature); keep this package's logic. `TenantSchedulers` gained a `programmes`
  step (tests/governance-suspension.test.ts updated). Stripe-event routing order: bookings →
  voice add-on → membership/programme checkout → generic.
- Retention messages were not changed in this package; lifecycle triggers (paid milestone,
  intake reminder, refund notices) now include programme payments.
