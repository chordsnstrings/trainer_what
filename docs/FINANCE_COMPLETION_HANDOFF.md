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
