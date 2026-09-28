# Trainer-set programme length, voice add-on billing and the day-by-day view (work package `core/programme`)

Status: implemented on branch `core/programme` (base `b4ac2b5`, migration 064). Test runs are
recorded below exactly as run; limits are listed at the end. Nothing was deployed and no live
provider was called.

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
- `POST /api/v1/products`: the workout + nutrition offer must use the same billing (and, for
  upfront, the same length) as its workout-only pair (`OFFER_PAIR_BILLING`), besides costing
  more (unchanged).
- `POST /api/v1/products/:id/activate`: a monthly offer gets a recurring monthly price (as
  before); an upfront offer gets a one-time price for the whole programme. When the offer has a
  voice add-on price, a separate Stripe product "… · premium voice" and a monthly price are
  created (`voiceStripeProductId`, `voiceStripePriceId`, `voicePriceIds`).
- `POST /api/v1/products/:id/voice-addon` `{ priceMinor }` (owner): sets or changes the add-on
  price of an offer. A published offer gets a new provider price; earlier prices stay in
  `voicePriceIds`, so members keep the price they bought and their events still verify. Refused
  (`VOICE_INCLUDED`) on an older offer that already includes voice.
- `POST /api/v1/membership/change-plan` refuses an upfront target (`UPFRONT_PLAN`).
- Monthly offers renew exactly as before; their `programmeDays` is the block length.

### Upfront programme payment (`finance-checkout.ts`, `programme-billing.ts`, `stripe-events.ts`)

- `POST /api/v1/payments/checkout` on an upfront offer reserves the same `records.kind='checkout'`
  intent (`data.billing='upfront'`, `purpose: programme`, list price, `programmeDays`), with the
  same workspace/membership admission, then creates a Checkout Session in `payment` mode with the
  one-time price, `payment_intent_data.metadata` and no trial (a promotion code's coupon still
  applies). Idempotency key `checkout:<intent>` as for memberships.
- Admission: an active upfront programme blocks another purchase until its final 7 days
  (`RENEWAL_WINDOW_DAYS`); in that window only another upfront programme may be bought, and a
  monthly membership can start once the programme ended.
- A signed `checkout.session.completed` / `async_payment_succeeded` in payment mode with
  `purpose: programme` is verified (intent, tenant, member and provider identity; status
  `complete`; `payment_status` paid or no payment required; currency AED; amount equal to the
  list price, or at most it when the intent carried a coupon), the charge is resolved from the
  PaymentIntent's `latest_charge` (the event is retained for reconciliation when it cannot be),
  provider objects are mapped to the member, and in one transaction:
  - the subscriptions row becomes `provider_id NULL`, `status active`,
    `period_end = paid + programmeDays` (plus the unused days of a programme renewed early),
    `data.billing='upfront'`, the offer's tier/modules, `programmeDays`, `programmeStartsAt`,
    `data.upfront` (intent, checkout, payment intent, charge, amount, window) and a bounded
    `programmeHistory`; the stable commission rank, first-paid time and any voice add-on are kept;
  - an immutable `stripe-programme:<intent>` journal "Programme payment" posts gross,
    commission at the member's stable rank (assigned at the first positive charge by the shared
    `assignCommissionRank`, which now also counts programme payers) and trainer payable;
  - the intent is completed; `programme.paid` is recorded; first-paid acquisition is recorded.
  A replayed event posts nothing twice. `async_payment_failed` closes the intent; `expired`
  expires it. A payment that arrives while a monthly membership is current still posts the
  money, does not replace access and opens a `reconciliation` record for finance.
- Refunds use the existing request → owner decision → provider → ledger path. Migration 064
  widens the member charge helpers, and the refund/dispute/admin/close queries read
  `stripe-programme:` charges. A refund journal is "Programme refund". A **full** refund of a
  programme ends its access (`status canceled`, `endedReason refunded`); a full refund of an
  early renewal returns the member to the programme it renewed (its remaining days). Partial
  refunds keep access.
- Statements: `financialStatement()` counts programme gross/commission and returns
  `revenue { membershipMinor, programmeMinor, voiceAddOnMinor, sessionsMinor }` (the bridge is
  unchanged). Business metrics count programme charges as paid membership revenue; acquisition
  counts them as a first payment; payout close eligibility treats later refunds of programme
  charges like invoice refunds; an uncertain (`unknown`) programme checkout blocks the monthly
  close.
- Reconciliation: the member's `POST /api/v1/payments/checkout/reconcile` resolves an upfront
  intent (retrieve/list → the same verified projection); the finance obligations job
  (`finance-automation.ts`) resolves programme and voice add-on checkouts left `creating` /
  `unknown` for over two minutes from provider evidence, and its subscription sync also syncs the
  voice add-on subscription.
- A late event of an older monthly membership never replaces a current upfront programme
  (terminal events are history; an active one is retained for reconciliation). A new monthly
  membership after an ended programme maps its own price and starts a new programme.
- A paid upfront intent is settled for privacy (`settlementBlockers`); the subscription row
  itself blocks while access is current, as for memberships.

### Voice add-on (`apps/api/src/voice-addon.ts`, `entitlements.ts`)

- Its own Stripe subscription at the member's offer's add-on price, tied to the membership.
  Routes (subscriber only):
  - `GET /api/v1/membership/voice-addon`: included (older offer) / available / active / status /
    period end / end-at-period-end flag / pending purchase.
  - `POST /api/v1/membership/voice-addon`: requires current paid access, refuses when voice is
    included (`VOICE_INCLUDED`) or already on (`VOICE_ACTIVE`); reserves a
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
  refund"). The membership row's status, period and price are untouched.
- `memberAccess(...).premiumVoice` = paid access and (an older offer that included voice, or an
  active verified add-on whose period has not ended); `voiceSource` is `included` | `add_on` |
  `null`. Complimentary access never has voice.
- Migration of existing offers: 064 marks offers with `premiumVoice` as `voiceIncluded`; their
  members keep voice with no add-on; projection of those offers is unchanged.
- The worker ends add-on subscriptions whose membership has no paid access (idempotency key
  `voice-addon-end:<subscription>`); entitlement already stops at once.

### Programme length (`apps/api/src/programme-length.ts`)

`programmeLengthDays(tx, userId): Promise<number>` — the `programmeDays` snapshotted on the
member's paid membership (monthly: from the offer at each provider projection; upfront: from
the paid intent), else the offer's, else `BRAIN_DEFAULT_PROGRAMME_DAYS` (28) for rolling offers,
complimentary access or no paid access. Works in the member's own scope and in coaching team
scopes (row security limits both reads).

### Day by day (`packages/domain/src/programme.ts`, `apps/api/src/programme-today.ts`)

- Calendar rules (pure): `programmePosition` (Day N of M from the programme start's calendar day
  in the member's time zone, arithmetic at UTC noon so DST never shifts a day; upfront clamps to
  M and completes at the paid access end; monthly/complimentary run in consecutive blocks),
  `programmeTimeline`, `adherence` (streak and 28-day adherence; rest days and coach-canceled
  sessions neither break nor extend a streak; today's session counts once done),
  `endOfProgramme` (next block / renews / ends with renew window / ended).
- `GET /api/v1/programme/today?timezone=` (subscriber): programme position, today's session (or
  rest day), what's next, streak/adherence, today's nutrition target and diary progress
  (permission / set-up states when missing; review-due flag), and the end-of-programme state
  with the offer to renew when it is still published. Time zone: the device's (validated), else
  the member's notification preference, else the latest planned session's, else Asia/Dubai.
- `GET /api/v1/programme/timeline?timezone=`: one entry per day of the current programme
  (upfront) or block (monthly): session or rest, done / missed / today / planned / canceled.
- Worker `sweepProgrammes` (new `programmes` step of the tenant cycle, skipped while suspended):
  closes upfront programmes whose access ended once (`programme.ended`, notice
  `programme-ended`), sends `programme-ending` 3 days before the end (programmes longer than 3
  days), marks each new monthly block once (`programme.block_started` for the Brain, notice
  `programme-next-block`), and ends orphaned voice add-ons. The three template keys are
  registered in `message-templates.ts`.

### UI (new components; `workspace.tsx` only mounts them)

- `programme-today.tsx`: `ProgrammeToday` on the member's Today screen (Day N of M with a
  progress bar, block badge for rolling offers, today's session or rest day with a start link,
  what's next, streak/adherence, nutrition card with calories and macros, end-of-programme notice
  with renew), `ProgrammeTimeline` at the new `/app/timeline` route (nav: "Programme timeline").
- `programme-offers.tsx`: the trainer's offer form (billing, programme length or rolling, price
  label by billing, optional voice add-on price), `OfferTerms`/`offerTermsText` used on the
  member membership page, trainer offer cards, the storefront, the public website offer cards and
  the onboarding preview, `OfferVoicePrice` to price/change an offer's add-on.
- `programme-membership.tsx`: `UpfrontMembership` (paid in full, access until, no renewal
  control) and `VoiceAddOnCard` (add, remove at period end, keep, check purchase).
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

## Limits

- Upfront programmes renew only by a new purchase (in the final week or after the end); there
  is no automatic renewal or instalment plan.
- A voice add-on for an upfront member renews monthly until the worker ends it after the
  programme ends; the last period is not prorated. A failed add-on payment removes voice at once
  (no grace).
- Only one queued programme is modelled: an early renewal starts now and carries the unused
  days, instead of queuing a second programme.
- The block-start notice is sent on day 1 or 2 of a block; a worker outage longer than that
  skips it (the `programme.block_started` event is then not recorded for that block).
- Merge note for the coordinator: `apps/api/src/programme-length.ts` is shared with the `plans`
  package (same signature); keep this package's logic. `TenantSchedulers` gained a `programmes`
  step (tests/governance-suspension.test.ts updated). Stripe-event routing order: bookings →
  voice add-on → membership/programme checkout → generic.
- Lifecycle, retention and first-payment messages still key on membership invoices; programme
  payments are not yet part of those message triggers.
