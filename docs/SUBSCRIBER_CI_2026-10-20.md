# Subscriber CI and functional polish — 20 October 2026

The owner approved the light subscriber concept and asked to implement it. The newer request for package upgrades supersedes the 30 September no-switch decision. Base: `526c0fbb61832a9b4a3445bb4de8b20cd38aa30f`. Branch: `work/subscriber-polish-2026-10-20`.

## Delivered source

- Subscriber palette now uses CI White `#FFFFFF`, Ink `#171917`, Paper `#F3F4F0`, muted `#616660`, divider `#D9DDD5` and Pace `#D5F24A`. Pace highlights primary actions and active details. Controls use 6px corners, panels 8px, 24px phone gutters and visible field borders. Inter Display Medium is bundled locally under the existing Inter OFL license; body copy keeps local Inter. Coach identity leads; trainsyou endorsement remains secondary. Explicit dark and reduced-motion preferences are preserved.
- Motion uses 120ms presses, 180ms switches, 200ms arrivals, 220ms sheets and 240ms metric/progress changes, with at most 36ms stagger. Overshooting success keyframes were removed. Meaningful loading/listening indicators retain their existing behavior. All new motion respects device and saved reduced-motion settings.
- Today has a compact dated WHOOP summary linking to `/app/recovery`. The recovery destination groups sleep, HRV and resting heart rate, explains the training effect, exposes a native stable switch for separate workout permission, and links to `/app/recovery/rules` and connection management. Sync time comes from the actual server connection. Missing readings remain unknown. Existing workout prescriptions and their adjustment receipts stay immutable.
- `/app/voice` explains paid guidance separately from ordinary training and timers, shows provider/coach readiness and actual inclusion/add-on state, exposes recurring voice acquisition that was previously hidden, and retains one-month voice passes. Voice gates link to this view. No voice provider generation or music regeneration is part of this work.
- Ordinary workout edits are restored by tenant, member, workout and prescription. Drafts expire after seven days, clear on sign-out/completed or held workouts, and never count as logged sets. Blank required inputs cannot become zero-valued logs. The queue is persisted before success appears. Rest timers retain their deadline; paused timers retain remaining time and resume deliberately. Workout tools and the action bar share one clock.
- Membership shows published upgrade options and an explicit quote review. Existing nutrition, bookings, chat, progress, offline queues and music remain available through their real components.

## Upgrade contract

The existing monthly subscription is updated, rather than replaced by a second subscription. Eligible upgrades add capabilities, preserve existing included features and programme length, use the published coach price, and retain the renewal date. Trial/unpaid/ended memberships, unknown prices, scheduled changes, unsupported billing configurations, unqualified modules and overlapping voice/pass purchases fail closed.

`POST /api/v1/membership/change-plan` creates a five-minute quote using the provider’s current subscription and invoice preview. It does not charge. The review states amount due today, new monthly price and renewal date. `POST /membership/upgrades/confirm` revalidates the quote and writes a stable `subscription_transition` intent before dispatching one `pending_if_incomplete` update. Price changes require a fresh review. The saved payment method may be charged only after the subscriber’s explicit confirmation.

Payment/authentication failure leaves the current package in place and can provide the provider’s hosted invoice. Uncertain responses block another purchase. Reconciliation reads provider evidence and never repeats the paid update. Renewal and add-on mutations share the pending-intent fence. The existing finance reconciler handles upgrade intents; verified provider state drives entitlement projection. No browser return parameter grants access.

Prepaid members retain their term and discount and can add nutrition/voice through the existing one-month passes when the paid training period covers the pass. This release does not reprice prepaid terms or offer downgrades. A separate recurring voice subscription or active pass must end before an upgrade includes the same capability, avoiding duplicate billing. Different programme lengths need coach arrangement. These restrictions are explained in the UI rather than hidden behind a failing button.

Current primary references used for the implementation: [Stripe pending updates](https://docs.stripe.com/billing/subscriptions/pending-updates) and [invoice preview API](https://docs.stripe.com/api/invoices/create_preview). Tests use injected synthetic providers only; no live charges or provider qualification are claimed.

## Verification checkpoint

- Production build and TypeScript pass at the initial implementation checkpoint.
- Targeted tests cover quote isolation, no payment during review, changed and expired quotes, one charge on repeated confirmation, failed-payment access retention, unknown-outcome reconciliation add-on/pass overlap, closed workspace/lost membership, and a provider read refusal after dispatch. A read failure never marks a potentially paid upgrade as failed. Paid evidence must match the quoted amount, currency, customer and subscription. Workout restoration covers expiry, missing values and prescription/account separation.
- Real local browser journeys cover trainer recovery rules, subscriber consent and reload, actual adjusted-workout receipts in standard/guided sessions, draft and paused-timer restoration, and Arabic permission revocation.
- Rendered recovery text contrast: minimum 5.31:1 at 320px, 390px and desktop; voice: 5.87:1. Large-text layout and both reduced-motion settings are checked. The browser pass caught and corrected inherited checkbox sizing and the old grey canvas; screenshots were inspected.
- The initial full local run found seven failures during implementation; corrected translation, RTL, timing and payment fixtures pass targeted reruns. Final exact-commit CI and serving verification will be recorded in the pull request/release receipt. This checkpoint is not a deployment claim. Physical-device WHOOP authorization, real-money charging and iOS/Android hardware acceptance remain distinct from isolated browser evidence.

### Release tracking

[PR #84](https://github.com/chordsnstrings/trainer_what/pull/84) contains the final release receipt and exact CI/serving evidence. The first PR run passed all subscriber and layout journeys; PostgreSQL caught a bigint string/number difference in upgrade eligibility. The correction validates a numeric conversion before comparison and tests both database representations and unsafe amounts. No gate was bypassed. This source checkpoint is intentionally separate from the receipt, so deployment evidence can identify its own final commit without a recursive documentation release.
