# Stripe payments: API contract and failure handling

Status (29 September 2026): branch `fix/stripe-payments` from `c856d9d`; not merged, not
deployed. It fixes the confirmed defects of the Stripe payment review of 29 September 2026
(contract findings F1-F9, review findings STATE-1 to STATE-9 and MONEY-1 to MONEY-5). **No
workflow here has run against real Stripe, in test or live mode**: there are no test-mode
keys, the live account cannot charge yet (`charges_enabled` false) and Commerce approved stays
off. Everything below is verified against Stripe's documentation, the official OpenAPI specs,
stripe-mock and the local Stripe doubles only. The regression tests are in
`tests/fix-stripe-payments.test.ts` (24 tests for the findings, each failing on `c856d9d`, and
3 tests for payment paths that had none and were already correct: Commerce approved off, a voice
add-on's failed renewal with the async Checkout events, a refund that arrives before its charge),
`tests/web-address-orders.test.ts` (F1) and `tests/e2e-harness-mocks.test.ts` (the double).

Checks on this branch (29 September 2026): `npx tsc --noEmit` and `npx tsc --noEmit -p
apps/web/tsconfig.json` pass; the 60 payment-related test files pass one by one with PGlite
(542 tests, 0 failures) and under `/opt/tools/pg-sandbox.sh` on PostgreSQL 16 with the
restricted runtime role (527 tests: 526 pass, 1 skipped by design; `platform-settings.test.ts`
15/15 in a sandbox that names databases as its assertion expects); the full e2e harness
(`scripts/e2e/run.mjs --rebuild`, run from an uncommitted copy that only spells the API entry
path differently, so another job's process cleanup on the same machine could not stop it)
passes 439 of 439 steps. On `c856d9d` the new
`tests/fix-stripe-payments.test.ts` fails 24 of its 27 tests (the 3 gap tests pass there too).

## API versions (F4)

- **Requests.** `stripeClient()` sends `apiVersion: STRIPE_API_VERSION` (`2026-08-26.dahlia`,
  `packages/providers/src/index.ts`), the version stripe-node 22.6.2 is generated for. It was
  the SDK default before; stating it means a new SDK major fails the type check instead of
  changing request shapes silently.
- **Webhooks.** An endpoint without its own API version receives the account default. The
  live endpoint `we_1UKeGU0rNBC3138PQ0GIF15a` has none, so it receives `2026-06-24.dahlia`
  today, and would change shape the day someone upgrades the account default. Both dahlia
  versions have the same shape for every field the app reads (spec diff of 29 September). The
  route still processes any version (every projection fails closed on shapes it does not
  know), logs a warning, and the operator alert `stripe.webhook_api_version` (critical,
  finance) opens while events of the last 7 days used a version outside
  `STRIPE_WEBHOOK_API_VERSIONS`.
- **Operator step (owner, live Stripe; not done by this change).** An endpoint's API version
  can be set only when it is created, so the live endpoint is replaced:
  1. Stripe Dashboard, live mode, Workbench → Webhooks → **Create an event destination**:
     events from *Your account*, API version **2026-08-26.dahlia**, destination *Webhook
     endpoint*, URL `https://trainsyou.com/api/v1/webhooks/stripe`, and these 16 events:
     `checkout.session.completed`, `checkout.session.expired`,
     `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
     `invoice.paid`, `invoice.payment_failed`, `invoice.voided`,
     `invoice.marked_uncollectible`, `customer.subscription.created`,
     `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`,
     `charge.dispute.created`, `charge.dispute.closed`, `refund.created`, `refund.updated`
     (the 14 of the current endpoint plus `invoice.voided` and
     `invoice.marked_uncollectible`). The equivalent API call is `POST /v1/webhook_endpoints`
     with `url`, `api_version=2026-08-26.dahlia` and `enabled_events[]` for each event.
  2. Reveal the new endpoint's signing secret and save it as **Webhook signing secret** in
     Super admin → Settings → Stripe (Test connection afterwards).
  3. Immediately disable, then delete, `we_1UKeGU0rNBC3138PQ0GIF15a` (after step 2 its
     deliveries fail the signature check). Between steps 1 and 3 both endpoints receive each
     event under the same event id; the receipt table makes the second copy a duplicate.
  Do this before Commerce approved is switched on (there are no live events yet).

## Webhook route (`app.ts`, F3, F7, F8)

- **Mode check (F7).** An event whose `livemode` differs from the configured key's mode
  (`sk_live_`/`rk_live_` versus test) is refused with 400 `STRIPE_MODE_MISMATCH` and not
  stored: a sandbox endpoint's secret beside a live key can never grant paid access.
- **Events for objects the platform did not create (F3).** A Payment Link, a Dashboard
  invoice or subscription, or a refund or dispute of someone else's charge used to fail with
  500/409 for three days. Such an event is now acknowledged (200 `{parked:true}`) and its
  receipt kept with status `parked`:
  - at once when the object's own shape proves it (a membership, add-on or web address
    invoice or subscription always carries the platform's metadata; a subscription Checkout
    always carries its intent, tenant and member);
  - otherwise after `UNMATCHED_RETRY_SECONDS` (1 hour), because the object it refers to (for
    example the charge of an invoice not yet processed) may still be arriving. Until then it
    fails as before, so Stripe retries.
  Parked receipts stay in the daily `finance_replay` job, so one that maps to a workspace
  later is still applied. The alert `stripe.events_parked` (warning, finance) lists them by
  type and id.
- **Invoice paid outside Stripe.** An app invoice marked paid with no identifiable Stripe
  payment (out of band, or several partial payments) used to fail forever. After the same hour
  it is applied: access follows the invoice, no Stripe charge is journaled, and a
  `reconciliation` record (which holds the month close) asks finance to record the money.
- **Synchronous processing (F8, declined).** The event is still processed before the 2xx.
  Idempotency makes Stripe's retries harmless; moving processing to the job queue changes every
  test's and the harness's timing contract and is left for a separate change.

## Event order (F5)

A subscription event that is not newer than the last event applied to the membership (an
invoice event may be newer than a plan change delivered late) is applied from Stripe's current
subscription (`subscriptions.retrieve`) instead of being dropped. The same holds for the voice
add-on. Without a Stripe client (tests) an older event is still dropped as before.

## Uncertain and refused instructions (STATE-1, `stripe-outcomes.ts`)

- `stripeRefused(error)`: an HTTP 400/401/402/403/404 answer from Stripe created nothing. An
  idempotency error, 409, 429, 5xx, timeouts and connection errors stay uncertain.
- A refused instruction is final at once, with the reason in `providerRefusal`:
  membership and upfront programme checkouts and voice add-on checkouts → `closed`; a paid
  session checkout → `canceled` (the seat is released); a renewal switch → `failed`; a member
  refund → `failed`; a session compensation refund → `refund_failed`. None of them holds the
  member's next purchase, exit or the month close. A refused checkout does not count as a used
  free trial.
- A genuinely uncertain instruction is settled by reconciliation evidence: a checkout Stripe
  never listed is `expired` once its own expiry plus 15 minutes has passed (it could no longer
  be paid); a renewal switch whose effect Stripe still does not show 10 minutes after it was
  sent is `failed`; a refund Stripe never listed after 10 minutes is `failed` (member) or
  `refund_failed` (session). A cancel request for a subscription Stripe already ended is
  satisfied by it.
- Not done: an audited operator action to close any intent by hand, and checking a coupon's
  remaining redemptions before reserving (a refused checkout now releases the intent instead).
  With `schedule_at_period_end` portal downgrades (bundle changes on), Stripe refuses
  `cancel_at_period_end` on the scheduled subscription: the switch now fails cleanly, but
  cancelling such a membership still needs the schedule released first (open).

## Invoices, month close and payouts (STATE-8, MONEY-1)

- `invoice.voided` → the `billing_invoice` is `void`; `invoice.marked_uncollectible` →
  `uncollectible` with `writtenOff`. A subscription that ends (canceled, unpaid,
  incomplete_expired) marks its open failed invoices `uncollectible` (`writtenOffReason:
  subscription_ended`), because Stripe stops collecting them. A later payment still arrives as
  `invoice.paid` and wins; an older failure never reopens a closed invoice. The same applies
  to voice add-on invoices, and the daily subscription sync applies void and uncollectible
  invoices it lists.
- `closeMonth` counts an open failed invoice only for months ending after it was issued, so a
  September failure no longer holds the August close (and with it payouts).

## Refunds (MONEY-2, MONEY-4, and the reversal gap)

- Member refunds: `canceled` maps to `failed` (it moved no money, like a failed one). A refund
  that fails after it succeeded (returned by the bank) posts `stripe-refund-reversal:<refund>`
  with negative `refundAmountMinor`/`commissionReversalMinor`, so the charge is refundable
  again. The one refund record per charge (index `one_refund_request`) starts a new attempt
  from `failed`, with a new idempotency key (`refund:<id>:<attempt>`), keeping the earlier
  attempts in `previousAttempts`. Access ended by a full refund is not restored by its
  reversal (open).
- Paid sessions: a failed or canceled refund moves the payment to `refund_failed` (no longer
  held at close; the member is still owed), and cancelling the booking again sends a new
  refund (`booking-refund:<payment>:<attempt>`) of what is still unrefunded. A refund made in
  the Stripe Dashboard is posted in full or in part (`booking-refund:<refund>`, commission
  reversed pro rata and never beyond what was earned); a posted refund that later fails is
  compensated (`booking-refund-reversal:<refund>`). Statements and the platform P&L count the
  reversals as negative refunds.

## Disputes (MONEY-3, STATE-4)

- A lost dispute posts what Stripe kept: at most the charge less its refunds and earlier losses,
  and no more than the dispute's own balance transactions withdrew net of reinstatement
  (Stripe reports a "partially won" dispute of a partly refunded charge as lost and returns the
  refunded part). Commission is reversed once across refunds and disputes. The journal carries
  `originalJournalId`, `disputeLossMinor` and `commissionReversalMinor`.
- A lost dispute of the whole remaining charge ends what it paid for, as a full refund does:
  an upfront programme ends, a voice add-on gets `endRequested`. Monthly memberships are
  unchanged by the app (a product decision not taken here); Stripe's "Manage disputed
  payments" setting can cancel the subscription, which the app then mirrors. No trainer alert
  on a new dispute yet (open).

## Memberships

- **Leaving with an unpaid renewal (STATE-3, STATE-5).** A past-due, incomplete or unpaid
  membership is ended at Stripe at once when the member leaves or is removed
  (`subscriptions.cancel`, which stops Stripe collecting the open invoice); the notice says
  so. Before, `cancel_at_period_end` let a later retry charge a former member. The member's own
  Cancel on an `unpaid` membership (Stripe's "mark as unpaid" setting) now ends it too,
  instead of `NO_SUBSCRIPTION`, so they can buy again.
- **Renewal gap (STATE-2).** A provider-billed membership that Stripe still bills (active,
  trialing, past due) no longer makes the worker cancel its voice add-on by the clock: Stripe
  renews at the stored period end, and the renewal reaches the app only with its webhook (and
  Smart Retries may recover a payment after the app's grace). A renewing provider-billed
  membership keeps access for `RENEWAL_WEBHOOK_TOLERANCE_MS` (24 hours) after its stored period
  end; a failed renewal is mirrored as past due and a scheduled end as not renewing.
- **cancel_at (F6).** An end scheduled with `cancel_at` (flexible billing mode: Dashboard or
  Customer Portal) shows as not renewing (`cancel_at_period_end` column true,
  `data.scheduledCancelAt`). Switching renewal back on then sends `cancel_at: ""`, since
  `cancel_at_period_end=false` alone leaves `cancel_at` in place. The voice add-on does the
  same.
- **Price (MONEY-5).** `subscriptions.price_minor` is the offer's list price (or the
  subscription item's price); an invoice amount (trial AED 0, discount, proration) is only
  the fallback for a membership whose price is not known yet.

- **No plan changes after payment (owner decision, 30 September 2026).** "There's no
  existing members. Once they pay they can't switch." `POST /api/v1/membership/change-plan`
  now refuses every member with `409 PLAN_CHANGE_NOT_ALLOWED` ("Your plan can't be changed
  after you've paid.") before any Stripe call, whatever `BUNDLE_CHANGES_APPROVED` says;
  anyone who is not a member still gets `403 SUBSCRIBER_REQUIRED`. The Stripe billing-portal
  confirmation flow it used to open (paired workout / workout + nutrition offers, prorated
  upgrades, period-end downgrades, event `subscription.change_confirmation_opened`) is removed,
  and the member app (`member-membership.tsx`, the older member view in `workspace.tsx`) has
  no switch buttons or their English and Arabic strings. `BUNDLE_CHANGES_APPROVED` stays in
  Settings but no longer opens anything. No trainer or operator tool called this route. This
  supersedes STATE-9 (plan changes while commerce is paused), which no longer arises.
  Test: `tests/fix-ledger.test.ts` (G4: every member request refused for both setting values,
  no portal call, no event).

## Minimum charge (F2)

Stripe cannot charge less than AED 2.00. Offer prices and voice add-on prices
(`productSchema`, `voiceAddOnPriceSchema`), paid session prices (0 or at least AED 2.00) and
the reservation check now use `STRIPE_MIN_CHARGE_AED_MINOR` (200); an older offer below it is
refused at checkout before any Stripe call (`PRICE_BELOW_MINIMUM`); a promotion whose
discounted first payment would be between AED 0.01 and 1.99 is refused
(`PROMOTION_BELOW_MINIMUM`). The offer form's price fields start at 2.

## Web address renewals (F1)

Checkout creates web address subscriptions with `subscription_data.billing_mode.type =
classic`. Charging a late renewal now resets the billing cycle anchor with
`proration_behavior=none`, which invoices the full year at once only in classic mode; in
flexible mode (the default for Checkout since 2025-09-30.clover) it creates no invoice and
moves the next charge a year out, so the domain would lapse unbilled. A subscription already
in flexible mode is charged through a trial ending five minutes later instead (a trial's end
starts the new yearly period with its full invoice in either mode). Not observed against real
Stripe; confirm with a test clock once test keys exist.

## Stripe fees (F9, declined for now)

Fees are read from each charge's, refund's and dispute's balance transaction. Stripe Billing's
volume fee on subscription invoices is attributed to the invoice in Stripe's Fees report, and
an account on standalone fees shows fee 0 on charge balance transactions; neither is read yet
(already noted in `platform-finance.md`). There are no live charges to reconcile against;
reading the Reporting API's itemized fees is left until there are.

## Test mode and live mode objects (STATE-6, declined for now)

Offer prices, add-on prices, coupons and subscriptions are stored as bare Stripe ids with no
mode. A test-mode rehearsal on the live database followed by the live key would leave offers
pointing at test-mode prices. With STATE-1 fixed, such a checkout is refused and released
instead of holding the member; offers must still be re-activated by hand. Rehearse on a
separate deployment or database until the mode is recorded with each id.

## Doubles

`tests/e2e/mocks/stripe.ts` now stamps events with the live account's `2026-06-24.dahlia`,
omits `payments` from invoices in events and lists (read from `/v1/invoice_payments`, as
basil and later require), gives subscriptions `billing_mode` (flexible unless Checkout asked
for classic), models an anchor reset per billing mode and proration behaviour, and handles
`cancel_at`. The unit-test fixtures in `tests/fix-stripe-payments.test.ts` use the dahlia
shape (no invoice charge, subscription under `parent.subscription_details`, item periods).
Older unit tests keep their pre-basil fixtures, which still exercise the legacy fallbacks.
