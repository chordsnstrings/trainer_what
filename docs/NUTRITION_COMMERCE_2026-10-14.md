# Nutrition commerce — 14 October 2026

Owner request: gate nutrition on paid training; minimum monthly training AED 199, training/nutrition AED 299, training/nutrition/voice AED 399. Offer nutrition AED 150 and voice AED 100 passes; six-month prepayment saves 10%, twelve months 30%. Preserve revenue shares. Prepaid packs have a disclosed 15-day refund request window with used months charged at the full monthly rate, and no trainer payout of refundable funds.

## Audit and implementation plan

Base: `87ac739`. Recurring memberships, one-time upfront programmes, verified Stripe events, stable subscriber commission ranks and immutable compensating refund journals exist. Voice has an existing recurring add-on. Nutrition grants currently bypass payment; catalog prices have only Stripe's AED 2 floor. Upfront programmes have no calendar-month discounts or purchase acknowledgement. Refunds use seven days and the full remaining charge. Month close checks unresolved refunds, but payout execution needs a fresh reserve check after close.

1. Share deterministic price, discount, calendar-month and refund rules between API and UI; apply price floors on creation, activation and new checkout.
2. Retain existing paid agreements and financial history. New monthly offers expose 6/12-month one-time payment options. Snapshot the purchased price, modules and refund policy. No extra coupons on prepaid discounts; promotions cannot undercut the minimum.
3. Sell nonrenewing one-calendar-month nutrition/voice passes. Require active positively paid training, coach/provider readiness, verified payment, tenant isolation, stable purchase identities and reconciliation. Pass access stops whenever paid training stops. Existing recurring voice agreements remain serviceable.
4. Nutrition requires paid training plus included nutrition or a verified current pass. Private trainer preview stays available. Trial/complimentary training alone does not unlock nutrition.
5. Refund requests within 15 elapsed days freeze the calculation at request time. Each started Dubai calendar month costs the undiscounted monthly price; successful refunds shorten access to the end of the retained month. Queue renewals and unknown/failed provider outcomes remain auditable. Preserve statutory remedies through the existing administrative override.
6. Hold the remaining trainer share of prepaid charges for the full refund window and unresolved refunds. Recheck under the shared workspace lock during payout preparation and dispatch.
7. Disclose total charge, discount, duration, no automatic renewal, refund calculation and window before purchase, in English/Arabic, with explicit acknowledgement for packs. Publish an additive terms version without changing prior acceptances.
8. Verify domain boundaries, purchases/replay, payment evidence, access/expiry, partial refunds, revenue conservation and payout reserve races; production build and required release gates, merge, deploy and confirm serving SHA.

## Product assumptions

Passes mean one calendar month paid once, without automatic renewal or prepaid discounts. Passes cost AED 150/100; trainers can still service existing recurring voice add-ons. Training remains necessary throughout the pass. The first started prepaid month is charged in full on an ordinary refund, with access retained until that month's end. A queued pack refunded before it starts has no used month. Historical offers below the floor cannot accept new checkouts; existing provider subscriptions keep their agreed price. Custom day-based upfront programmes keep their duration, with a minimum of the monthly floor per started 30 days.

## Sources

- UAE official consumer protection overview: https://u.ae/en/information-and-services/justice-safety-and-the-law/consumer-protection
- Federal Law on Consumer Protection (official): https://uaelegislation.gov.ae/en/legislations/1455
- Stripe refunds: https://docs.stripe.com/refunds (pending refunds need available funds; failed/returned refunds require reconciliation; partial refunds supported).
- Stripe Checkout creation: https://docs.stripe.com/api/checkout/sessions/create (one-time payment prices and checkout disclosures).

This is implementation of the owner's commercial policy, not a claim of external legal review. Existing mandatory-rights wording remains; no production charge/refund/payout is used for testing.

## Verification and release

Implemented on `work/nutrition-commerce-2026-10-14`. Release pending ordinary GitHub gates; no live transaction was used.

Local TypeScript and production build pass. Financial/domain coverage includes 11 new cases: all bundle floors, exact 6/12-month totals, Dubai month ends and leap years, the exclusive 15-day boundary, purchase acknowledgement, delayed payment and replay, immutable purchased modules, proportional refund/commission reversal, queued-window promotion before partial refund, paid-training requirements, pass expiry/refund isolation, payout preparation and dispatch reserves, provider ownership, original payment dates on reconciliation and unknown-outcome deduplication. Targeted regression groups passed 56, 41, 36 and 13 tests (these groups overlap and are not a combined count). Translation and terms-publication checks pass; migration 098 publishes a separate terms version and preserves historical documents/acceptances.

The broad regression sweep exposed old fixtures that granted nutrition without payment, used prices below the new floors, or expected the old statement shape. Those fixtures now establish positive paid access and assert the new commercial rules; focused reruns pass. One old meal-capture race fixture waited for a provider call that the new paywall correctly prevented, so the initial broad run was stopped, that fixture was corrected, and remaining files were run separately. This is not claimed as a clean full-suite result; exact-head CI must pass before merge.

The production browser journey passes in English/Arabic at 390px and 1280px, covering prepaid prices, required acknowledgement and both pass purchase payloads. Screenshots were visually inspected; the initial narrow-column terms layout was corrected. The journey is included in the existing browser release gate and intercepts checkout so it cannot charge a provider.

New prepaid packs and passes use card Checkout. Authenticated reconciliation recovers the captured card charge time; missing timing evidence leaves the purchase held rather than extending access or restarting a refund window. Older programme payments keep their established reconciliation behavior. Sources and policy assumptions above apply; the new consolidated legal source is `docs/legal/uae-2026-10/terms-2026-10-14.en.md`.

Runtime model/token/cost totals were not exposed; no alternate-model or cost-saving claim is made.
