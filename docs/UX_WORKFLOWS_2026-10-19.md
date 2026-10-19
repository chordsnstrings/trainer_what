# Daily workflows — implementation, 19 October 2026

Owner instruction: “complete all.” Baseline: `686e158` (application `15de319`). Branch: `codex/daily-workflows-2026-10-19`.

Implement the expanded audit as complete user journeys. Keep existing coaching qualification, consent, membership, tenant isolation and unknown-paid-outcome reconciliation. No cloud browser, production test account mutations or paid provider calls. Normal CI, merge and exact serving verification are required before claiming completion.

## Status

Implementation is in review. No application changes have been released from this task yet. Focused regression checks: 14/14 (including database isolation), then 22/22 UI/model checks. Root and web TypeScript checks both passed, as did a clean production build. Fresh CI/browser evidence remains the release gate. Local Chromium is unavailable; the normal CI browser runners remain authoritative.

## Original findings

| ID | Change | Status |
| --- | --- | --- |
| F01 | Website completion card clips its content and actions | Implemented; release checks pending |
| F02 | Subscriber setup uses the platform assistant identity and English controls | Implemented; release checks pending |
| F03 | Prepaid checkout still displays monthly renewal copy | Implemented; release checks pending |
| F04 | Nutrition Today opens the first day of the plan | Implemented; release checks pending |
| F05 | A successful save can be reported as a failure after refresh | Implemented; release checks pending |
| F06 | Loading and retry behavior is inconsistent | Implemented; release checks pending |
| F07 | Draft a plan loses the selected client | Implemented; release checks pending |
| F08 | Approved assisted replies can be missing from the unread badge | Implemented; release checks pending |
| F09 | One failed music plan pauses the whole library | Already shipped in PR77; library complete per latest handoff |
| F10 | Phone clients need compact cards instead of a sideways table | Implemented; release checks pending |
| F11 | Change meal opens its controls away from the selected meal | Implemented; release checks pending |
| F12 | Brain teaching needs a visible next action | Implemented; release checks pending |
| F13 | Show short answers at the question, and label conversation mode | Implemented; release checks pending |
| F14 | Bookings leads with creation instead of the working schedule | Implemented; release checks pending |
| F15 | Booking decisions need safer cancellation and failure handling | Implemented; release checks pending |
| F16 | Offer a small mobile website-editing surface | Implemented; release checks pending |
| F17 | Keep music controls compact during a workout | Implemented; release checks pending |
| F18 | Separate connection status from fresh connection consent | Implemented; release checks pending |
| F19 | Selected states must be available to assistive technology | Implemented; release checks pending |
| F20 | Recover a password without losing the joining context | Implemented; release checks pending |
| F21 | Support submission should become a visible conversation | Implemented; release checks pending |
| F22 | Membership offer setup asks for too much unrelated detail | Implemented; release checks pending |
| F23 | Bring the first useful coaching result earlier in activation | Implemented; release checks pending |
| F24 | Meal capture can prioritize confirmation over editing every field | Implemented; release checks pending |
| F25 | Turn progress totals into a small, useful weekly explanation | Implemented; release checks pending |

## Page coverage and acceptance

### P01 — Discovery and coach directory

- Scope: Public landing / coach directory
- Acceptance: A visitor can explain whose coaching they receive, what is assisted and what the next step costs before creating an account.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained public browsing, real-coach identity and explicit assistance/offer disclosures; no invented specialties or prices.

### P02 — Coach website and offer choice

- Scope: Coach website / pricing sections
- Acceptance: Coach, offer, period and language survive authentication; changed terms are never silently accepted.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Pricing CTAs carry offer intent. Join/recovery show current published terms; membership validates and highlights the current offer before checkout.

### P03 — Join, sign-in and recovery

- Scope: Join / sign-in / forgot-password / authentication verification
- Acceptance: Recovery resumes the task; invalid or external return paths cannot redirect the user outside the permitted app.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Allowlisted, expiring, coach-scoped joining continuity; password recovery and existing-account password rules corrected.

### T01 — Initial account and About setup

- Scope: /setup account and about steps
- Acceptance: No public or generated identity is accepted without review; optional polish does not block a private preview.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained persisted identity/import review; private preview reachable during teaching without weakening launch gates.

### T02 — Website onboarding conversation

- Scope: Setup Page / website conversation
- Acceptance: Both completion actions remain visible at phone widths; the trainer knows the site is not published yet.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Completion card no longer clips; suggested answers visible; draft and publish remain distinct.

### T03 — First teaching and qualification

- Scope: Setup Brain / My Brain teaching
- Acceptance: Eight quiz cases, three own cases and applicable evaluation gates remain enforced; the trainer can see the source and current status of each learned rule.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Resumable next teaching/review action and early private preview; existing quiz, own-case and qualification gates retained.

### T04 — Plan selection and launch

- Scope: Setup Plan / Live
- Acceptance: No completion message claims a capability is live until its authoritative status confirms it; the first client invitation uses the published destination.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained authoritative launch checklist and publication controls. Preview is explicitly private.

### T05 — Daily dashboard

- Scope: /trainer; /trainer/summary is a separate overview
- Acceptance: Every displayed count leads to the corresponding authorized items; primary actions preserve client, draft and return position.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: New Today uses the shared urgency queue, real update time, upcoming bookings and conditional setup/business actions.

### T06 — Inbox and review queue

- Scope: /trainer current inbox; proposed dedicated Inbox destination
- Acceptance: No blanket approval of safety or financial decisions; one accepted action cannot reappear as a new unsent action after refresh failure.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Dedicated Inbox retains inline approval/edit/rejection, saved composers and queue-specific authority; retry added.

### T07 — Client list

- Scope: /trainer/subscribers
- Acceptance: Common client tasks fit without sideways scrolling at 320 px; search and position survive a round trip.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Phone cards, server-side task filters, saved query/filter context and explicit read recovery.

### T08 — Client workspace

- Scope: /trainer/subscribers/:id and plan / notes / membership
- Acceptance: A trainer can handle a client’s training and nutrition without reselecting them; private Brain material never leaks into subscriber-facing context.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Client Overview, Plan, Nutrition, Message, Context and Membership retain the selected identity.

### T09 — Client conversations

- Scope: /trainer/messages and /trainer/messages/:id
- Acceptance: Read state is consistent across Today, Inbox and thread; sender/source is understandable without technical internal labels.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Conversation includes expandable client context; sent-message recovery and sender identities retained.

### T10 — My Brain home

- Scope: /trainer/brain
- Acceptance: The trainer can explain what the Brain can currently do and what still needs review, without reading technical evaluation logs.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Visible next teaching action and private preview; existing operating/readiness authority retained.

### T11 — Teaching, suggestions and corrections

- Scope: /trainer/brain/teaching
- Acceptance: Teaching is explicit and reviewable; editing a message never silently changes the trainer’s general coaching rules.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained versioned teaching/correction review and source evidence; accepted saves survive refresh failure.

### T12 — Training plan composer

- Scope: /trainer/brain/plans
- Acceptance: The final review names the client and dates; no regenerated draft is mistaken for an already approved plan.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Client selection carries into preparation; current goals and constraints available before generation; review gates retained.

### T13 — Checks, action history and autonomy

- Scope: /trainer/brain/checks / actions / autonomy
- Acceptance: No optimistic “ready” state before the authoritative result; held-out cases remain held out and autonomy does not bypass qualification.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained checks, corrections and deliberate autonomy gates with explicit read recovery.

### T14 — Nutrition home and capability setup

- Scope: /trainer/nutrition
- Acceptance: A trainer looking for a client meal plan does not need to understand catalog versions, calorie methods or recovery tooling.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Nutrition grouped by Overview, Client work, Teach & check, Food library and Advanced.

### T15 — Client nutrition plan and review

- Scope: /trainer/nutrition/clients/:id; client plan section
- Acceptance: Every action names the client and effective week; allergy and permission checks remain authoritative.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Nutrition opens inside the selected client hub; current plan/version/constraints and release checks retained.

### T16 — Nutrition knowledge and advanced tools

- Scope: Nutrition recipes / rules / tests / methods / catalogs / recovery
- Acceptance: All advanced capabilities remain reachable; the ordinary path exposes only the decisions needed for the current task.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Advanced catalog/recovery tools remain available in task groups instead of fourteen equal tabs.

### T17 — Working day and booking management

- Scope: /trainer/bookings
- Acceptance: Routine attendance never requires scrolling through session creation; destructive changes have a clear review and confirmed result.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Reservations/attendance precede available slots; creation collapsed; cancellation confirms consequences.

### T18 — Website editor and preview

- Scope: /trainer/website / preview
- Acceptance: Small phone edits do not require operating a full desktop canvas; unpublished changes never appear as already live.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Phone quick editor saves/version-checks the actual draft and previews it before explicit publication; full desktop studio retained.

### T19 — Website settings, directory and inquiries

- Scope: /trainer/website/settings
- Acceptance: An inquiry is visible where trainers work daily; a settings visit is not required to discover it.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Owner-only website inquiries join the daily queue and notifications open the inquiry section.

### T20 — Brand and subscriber appearance

- Scope: /trainer/design and brand settings
- Acceptance: A subscriber recognizes their coach throughout onboarding, Today, chat and workouts; custom labels remain consistent and accessible.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained actual subscriber preview, brand presets and full design controls; updated Today inherits coach branding.

### T21 — Photo studio and client galleries

- Scope: Photo Studio / /trainer/galleries
- Acceptance: No generated image or client photo becomes public as a side effect of selecting it; progress and retry use the original job.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained photo source review and explicit gallery audience/publication controls.

### T22 — Growth, sharing and affiliates

- Scope: /trainer/growth / affiliates
- Acceptance: The primary action produces the correct live destination; observed and estimated performance cannot be confused.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Published share link leads; modeled follower estimates move into a disclosure.

### T23 — Offers and promotions

- Scope: /trainer/products / finance offer views
- Acceptance: The preview, checkout request and receipt describe the same selected purchase; promotions are not hidden under payout administration.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Conditional offer fields, current purchase preview and promotions alongside offers.

### T24 — Payouts, statements and financial activity

- Scope: /trainer/finance / payouts
- Acceptance: “Earned”, “available” and “paid out” have distinct labels and periods; all amounts use currency formatting and authoritative records.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained confirmed ledger/payout/statement authority and intentional refund review; accepted finance changes survive refresh failure.

### T25 — Business performance

- Scope: /trainer/analytics / trainer summary business links
- Acceptance: No raw _minor keys or unformatted monetary values reach the trainer view; every metric exposes its meaning and period.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Currency fields display formatted amounts; existing defined cohorts and retention controls retained.

### T26 — Connections and voice enrollment

- Scope: /trainer/integrations / voice
- Acceptance: “Connected” never implies that voice is qualified or usable; subscriber text-guided fallback remains available where permitted.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained service/voice permission steps; WHOOP connection/read freshness/training consent separated; write/read recovery improved.

### T27 — Custom domain setup

- Scope: /trainer/domains
- Acceptance: The working platform URL stays available throughout; a request is never labeled connected before verification.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained exact DNS-copy, verification/retry and domain consequence controls; existing domain browser gate required.

### T28 — Team access

- Scope: /trainer/team
- Acceptance: Owner-only controls stay enforced; finance staff never receive coaching/health context through the redesigned dashboard.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Role comparison, persisted invitation draft and retained accepted invitation link on refresh failure; explicit manual sharing.

### T29 — Workspace and account settings

- Scope: /trainer/settings
- Acceptance: Settings changes do not reset client/workspace context; routine account editing is separated from irreversible or permission-changing actions.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained task-based settings, protected role boundaries, verification return routes and saved workspace context.

### T30 — Notifications and support

- Scope: /trainer/notifications / support
- Acceptance: One event produces coherent read state across surfaces; accepted support text is not left looking unsent.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Accepted support request opens its thread; actionable inquiry deep links and existing notification preferences retained.

### S01 — First coaching profile and permissions

- Scope: /app/intake and member onboarding
- Acceptance: No repeated collection of known facts; required health facts and permissions are not silently assumed. First plan access has a clear next action.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Coach identity and Arabic interface/voice permission copy, visible answer chips, profile review and conditional nutrition consent.

### S02 — Today dashboard

- Scope: /app
- Acceptance: The member can identify the next action immediately; dashboard states match the server’s plan, permission and session state.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Existing priority/hold/resume logic leads; compact dated WHOOP guidance below it, contextual meal actions and retained progress.

### S03 — Plan, calendar and timeline

- Scope: /app/program / app/timeline
- Acceptance: A change preserves session identity and updates Today consistently; no silent duplication of missed workouts.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Week and Full timeline presented as two views of the same plan; existing reschedule/skip and session controls retained.

### S04 — Workout and set logging

- Scope: /app/workouts/:id
- Acceptance: Core controls work with one hand and keyboard/screen reader; connection recovery cannot double-log a set or change an active prescription.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained stable active prescription, set/rest controls, offline replay and pain/hold behavior.

### S05 — Guided workout, coach voice and music

- Scope: /app/voice-session/* / app/guided/*
- Acceptance: No compulsory configuration before ordinary training; hidden controls remain reachable; provider failures never trigger blind paid retries.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Persistent music play/pause and track summary; detailed playlist controls collapsed; voice/text fallback gates retained.

### S06 — Coach chat

- Scope: /app/chat
- Acceptance: Unread counts include all intended subscriber-visible reply types; sending and reading states agree across devices as designed.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Reviewed assisted messages count as unread; existing persistent thread, source labels and change links retained.

### S07 — Nutrition Today and meal swaps

- Scope: /app/nutrition Today / week
- Acceptance: Every action names the date and meal; a manual historical selection survives refresh.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Current plan day selected; meal-scoped swap sheet opens immediately with loading/retry and versioned save.

### S08 — Meal capture and review

- Scope: /app/nutrition/log
- Acceptance: No estimated nutrition is presented as exact; repeat taps cannot create duplicate meals; the most important corrections do not require reading long explanations.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Portion/date/food confirmation stays primary; nutrient editing folded; capture uncertainty and editable receipt retained.

### S09 — Grocery list and shopping

- Scope: Nutrition → Groceries; household grocery view
- Acceptance: Checks persist according to the real storage contract; changes do not silently uncheck purchased items or mix households.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Remaining groceries lead, purchased/pantry ingredients folded and recoverable; existing change explanation/save retained.

### S10 — Food preferences and kitchen setup

- Scope: Nutrition profile / kitchen / household settings
- Acceptance: Changes apply through existing safety rules; old plans are not silently treated as compliant with newly changed constraints.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained explicit safety facts, scoped preferences and direct profile/kitchen editing.

### S11 — Progress and reflection

- Scope: /app/progress
- Acceptance: Every summary can be traced to recorded data and a defined time window; no causal claim is inferred from a simple correlation.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Factual weekly completed/scheduled counts and next approved scheduled step; full history retained without invented trends.

### S12 — What my coach knows

- Scope: /app/twin coaching context
- Acceptance: The member can correct user-owned facts; trainer-private notes, evaluation drafts and internal source IDs stay out of the member view.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained consent-aware profile/connected observations, dates, source evidence and correction paths.

### S13 — WHOOP and connected data

- Scope: /app/wearables / connections
- Acceptance: No UI says an adjustment was applied before the start response confirms it; do not fabricate WHOOP strain/readiness metrics or imply unsupported real-time streaming.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Compact recovery/sleep guidance with dated explanation; connection, consent, stale/no-data and actual workout receipt remain distinct.

### S14 — Book a session

- Scope: /app/bookings
- Acceptance: A displayed booking confirmation reflects a confirmed reservation; no blind retry duplicates a payment or booking.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Reservations lead; failed cancellation retains the sheet and error; existing time/price/entitlement checks retained.

### S15 — Membership, checkout and cancellation

- Scope: /app/membership
- Acceptance: Header, payment request and receipt agree; cancellation does not misrepresent refund eligibility or immediate loss of access.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Selected period drives total/renewal wording; failed cancellation retains review; accepted checkout survives read failure.

### S16 — More, profile, security and privacy

- Scope: /app/more / profile / profile#security / profile#privacy
- Acceptance: Security remains discoverable and collapsed by default; destructive or permission-changing actions require a clear deliberate choice.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained task-based More, profile/security/privacy distinctions and verification return behavior.

### S17 — Notifications and help

- Scope: /app/notifications / support
- Acceptance: Unread counts and destinations agree; quiet-time/channel controls, if added, describe their actual supported behavior.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Support opens the accepted conversation; retained contextual notification permission and exact task destinations.

### S18 — Coach identity, switching and galleries

- Scope: Coach switcher / /app/galleries
- Acceptance: Messages, plans, metrics, branding and cached views change together under verified tenant scope; cross-coach data is never merged.
- Status: Implemented or retained as described below; release validation pending.
- Delivery: Retained active coach/switch confirmation and gallery audience controls; member onboarding uses the active coach identity.


## Validation boundaries

The 51 page reviews are a coverage map, not 51 new screens. Existing working flows and safety/authorization/payment gates are retained where the audit called for simplification around them. No retention, activation-time or conversion improvement is claimed without post-release measurements. Real WHOOP account connection and fresh-member training validation still require the member’s own authorization; synthetic WHOOP cases run in CI. Music remains the already-completed 240-track library.
