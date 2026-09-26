# Finance completion integration handoff

## Stage 1 — billing servicing

Files ready: `finance-billing.ts`, `stripe-events.ts`, `finance-completion.tsx`, migration `015_finance_completion.sql`, `tests/finance-completion.test.ts`.

Root integration:

1. Import `registerFinanceBilling, currentPaidSubscription` from `./finance-billing.ts` in app.ts; call `registerFinanceBilling(app, db)` alongside other route registration.
2. Remove old route block beginning `app.post("/api/v1/membership/cancel"` through the entire `/api/v1/refund-requests/:id/reconcile` route, ending immediately before `app.post("/api/v1/payout-beneficiaries"`. These routes now live in the module with compatible URLs.
3. Existing app `requirePaid` query should use `await currentPaidSubscription(tx, a.userId)` (preserve subsequent rejection if absent). Equivalent paid gate in operations.ts and nutrition.ts needs the same helper; agent ownership applies. Signed events pin a finite first-failure grace deadline; repeated failure cannot extend it. Plan changes may remain active/trialing only.
4. Import `BillingHistory` in workspace.tsx. Render in the subscriber Finance branch. Remove the old free-text charge-id refund request form (new UI provides eligible payment selection).
5. Existing membership/change-plan Stripe initialization is servicing: change `requireCommerce()` to `stripeClient()` for that route only. Keep explicit reviewed plan-change policy guard and new checkout/product gates.

Five focused finance regressions passed (isolated providers, no network): distinct same-period cancellation identities; no resubmission after uncertain renewal; billing privacy/replayed invoice/safe download links; bounded uncertain refunds; finite grace and cancellation revocation. TypeScript and baseline platform suite results reported separately to root.

## Boundaries

No live Stripe/Lean calls, no deployment. Invoice links become available when a signed invoice event includes provider-hosted URLs. Existing past invoices lacking snapshots still appear as charge history. Uncertain provider outcomes remain held until a read confirms them.

## Stage 2 — policies, statements, offers

Register `registerFinanceCompletion(app, db)` from `finance-completion.ts` alongside billing. New `finance-policy.ts`, `finance-statements.ts`, `finance-promotions.ts`; migration025 makes fee and allocation history immutable.

Render `TrainerFinanceTools` in trainer Finance (owner only; includes statements, trial configuration and product-specific promotions). Render `FinancePolicyConsole({tenants})` on the actual `/admin/finance/controls` view for admin/finance operators. Both exports are in `finance-completion.tsx`.

Checkout integration in existing `/payments/checkout`:

- Import `checkoutOfferTerms` from `./finance-promotions.ts`.
- Parse optional `promotionCode: z.string().trim().max(40)` along with productId.
- Inside the locked new-intent branch (after the existing intent lookup), resolve `const offerTerms = await checkoutOfferTerms(tx, a, product, b.promotionCode)` and persist `offerTerms` inside checkout record data. On existing intent, reject a changed requested promo code before returning it; use stored terms on all retries.
- In `checkout.sessions.create` add `discounts: intent.data.offerTerms?.couponId ? [{coupon: intent.data.offerTerms.couponId}] : undefined`.
- In `subscription_data`, add `trial_period_days: intent.data.offerTerms?.trialDays || undefined` (existing metadata retained).
- Subscriber checkout form needs an optional discount-code field sent as `promotionCode`; trial offer text should show `product.data.trialDays` when nonzero. Access remains signed-event projected.

Policies apply prospectively at actual charge time, with original journal fee policy pinned. Statement reconciles opening payable + collections - refunds - net commission - fees - costs - payouts + returns/adjustments to ending ledger payable; provider usage and absorbed/charged infrastructure allocations are visible. No presumed FX conversion or automatic bank finality.

## Stage 3 — paid session bookings

New `finance-bookings.ts`; uses columns from admin-owned migration019. Root inject `{ prepare: preparePaidBooking, checkout: startBookingCheckout, refund: refundCanceledBooking }` into `registerBookingSchedule` using its declared hooks interface (check exact property names there). These exports now exist. Call `registerBookingPayments(app,db)` for checkout and reconciliation routes.

At the start of `processStripeEvent`, before generic supported-event filtering:

```ts
if (await processBookingStripeEvent(db, e)) return { processed: true };
```

Import the helper from `./finance-bookings.ts`. This handles only booking-tagged checkout/refund events. Booking payments are one-time card Checkout payments with exact amount/currency/purpose checks; they never create subscription access. Slots remain held35 minutes. Capacity is rechecked under the slot lock when payment confirms. A late payment that cannot claim its original seat receives one compensating refund instruction; uncertain outcomes remain held and never dispatch twice. Unknown Checkout can be reconciled by a provider list/read that matches the original client-reference and tenant/user metadata. Refund reconciliation reads the original provider intent. Ordinary unsubmitted expired holds may expire locally.

The booking hook temporarily elevates only its narrowly scoped financial storage operation from the booking route's staff transaction and restores its original role. Coaching staff still cannot directly read financial payment records. Finance month-close now blocks outstanding invoice and unresolved booking payment/refund obligations.

Ten focused finance tests pass through this stage, including paid booking replay, wrong amount rejection, reversal and a full-seat late payment with uncertain refund/no repeat call. Subsequent hold-recovery changes need the final root rerun. No provider calls occurred outside isolated test clients.

## Stage 4 — reviewed finance jobs

New `finance-automation.ts` exports `registerFinanceAutomation(app,db)`, `scheduleFinance(db,tenantId)` and `executeFinanceJob(db,tenantId,job)`. Migration **027_finance_automation** creates one configuration per workspace. UI export `FinanceAutomationConsole({tenants})` belongs on `/admin/finance/controls`, alongside `FinancePolicyConsole`.

Worker integration: call `scheduleFinance` for each active tenant with scheduler errors isolated from nutrition/email. Before the generic email handler, handle `job.kind.startsWith("finance_")` with `executeFinanceJob`. It returns `{status:"completed"|"blocked",code?}`. Persist that status/code, clear the lease and continue. Retain the existing attempt/lease CAS when completing the job. Thrown provider/precondition errors should be recorded as blocked (operator recheck exists in the finance console); do not reset financial intent status or invent a new payment intent.

Jobs are stable per tenant/day/subscriber or month. They replay only previously signature-verified durable Stripe receipts, read actual Stripe subscription/invoice state, reconcile original renewal/refund/booking identities, and optionally post already-priced usage with a reviewed FX value, close reconciled months, prepare funded payouts and execute only within an explicit cap plus existing live bank gates. The payment boundary rechecks the exact automation revision and cap inside its transaction. Unknown payouts remain reserved, with no automatic replacement revision. Configuration and job rechecks require platform finance/admin authorization, recent MFA and CAS; disabled or closed workspaces cannot run jobs.

**No fabricated Lean/bank status adapter.** There is no verified account-specific read/finality contract available in this session. Bank settlement/finality remains the existing audited evidence workflow. A provider acknowledgment never means paid. No live provider actions were run.

Final local focused result through stages1–4: **12/12 passed** in `tests/finance-completion.test.ts`, including stable scheduler/replay effects and payout approval recheck before dispatch. Full shared TypeScript result is reported to root after concurrent file edits settle. Baseline finance, webhook, payout and isolation cases passed in the prior platform run; that run had one unrelated coaching RLS failure subsequently owned by the coaching agent.
