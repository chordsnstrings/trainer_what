# Joining a trainer and complimentary access

Branch `feat/joining`, based on `6fa8aba`. Migration `packages/db/migrations/055_joining_complimentary_access.sql`.

## Plan (written before implementation)

Existing code read first: `apps/api/src/app.ts` (invitation create/accept, public enroll, workspace switch, bootstrap), `team.ts` (team invitations, `lockActiveInvitation`), `notifications.ts` (in-app + email + push fan-out, worker delivery decision), `apps/worker/src/email-delivery.ts`, `security.ts` (queued account links), `finance-billing.ts` (`currentPaidSubscription`) and every caller of it, `privacy-lifecycle.ts`/`privacy-hooks.ts` (erasure and closure), `admin-operations.ts` (operator scopes, audit), `platform-settings.ts` with `packages/providers/src/configuration.ts` (Superadmin-configurable values), and the web shell `apps/web/components/workspace.tsx`.

1. **Invitation email.** Follower invitations stay single-use `one_time_tokens` rows (hash only). The owner may tick "email this invitation"; the link is queued as a `jobs` email with `sensitive:true` and `expiresAt`, using the existing worker. A new branch in `notificationDeliveryDecision` suppresses a queued invitation email once the invitation is accepted, cancelled, expired or re-sent. Resend rotates the link (the plain token is never stored), subject to a cooldown, a per-address daily cap and a per-workspace daily cap. When email is not configured the invitation is still created and the copy-link result is returned with an explicit email status.
2. **Pending invitations.** Outcome is recorded in the token payload (`accepted`, `cancelled`, `replaced`); status is derived as pending / accepted / expired / cancelled. The owner can list, cancel and resend. Cancelled and expired tokens are refused by the existing `lockActiveInvitation`.
3. **Coach alert.** A shared `announceFollowerJoined` sends an in-app notification (email and push through the existing preferences and channels) to the owner and coaching staff when an invitation is accepted or a public self-join creates a membership.
4. **Complimentary access.** New tenant table `complimentary_access` with RLS, an immutability guard and no delete grant. One shared entitlement module replaces the scattered paid-subscription checks. Grants create no subscription, Stripe object or journal. The nutrition tier requires the nutrition approval flags. Limits are Superadmin settings.
5. **Second coach.** A signed-in follower accepts another trainer's invitation with one click; a signed-out existing account signs in with its password on the same page (no new account). Switching coaches is surfaced with a "Your coaches" card and a top-bar switcher.

## What was built, per audience

### Trainer (workspace owner, coaching staff)

- **Invite by link or email** (`/trainer/subscribers`, `FollowerInvitations`). The owner enters the follower's email and optionally ticks "Email the invitation link". The response always contains the single-use link (7 days) to copy; the email status is shown (`queued`, `unavailable` when email is not configured, `verify_email_first` when the owner's own address is not confirmed, `rate_limited`).
- **Confirmed sender only.** Invitation emails go out from the platform's sender, so they are queued only for an owner whose own email address is confirmed (`users.email_verified`). An unconfirmed owner still gets the copy link; the email checkbox is disabled with a link to Account security, and resend returns `409 EMAIL_VERIFICATION_REQUIRED`. (In production, `/auth/register` creates owners unconfirmed; in local development and tests owners are confirmed at registration.)
- **Invitation list** with a status filter: pending, accepted, expired, cancelled (including "replaced" when a newer invitation to the same address superseded it), expiry/acceptance dates, and delivery state (link only, email queued, waiting for email setup, sent, not sent, failed, delivery unconfirmed, email not configured, email limit reached). Actions on pending invitations: **Cancel invitation** (link stops working immediately; an unsent email is withdrawn) and **Resend email / Send by email** (issues a fresh link, retires the old one, restarts the 7-day window; confirmation dialog says so).
- **De-duplication.** One pending invitation per address: a new invitation to the same address replaces the earlier pending link and withdraws its unsent email. An invitation that had already expired keeps its `expired` status and is not relabelled as replaced. Every email job has a unique intent key `invite-email:<invitationId>:<send>`, and the worker sends only the invitation's current send while it is pending and unexpired. Inviting someone who already belongs to the workspace returns `409 ALREADY_MEMBER`.
- **Join alerts.** When a follower accepts an invitation or self-joins from the published coach page, the owner and every coaching staff member (not finance) get a `coaching` notification "A new follower joined" linking to `/trainer/subscribers/<id>`. Email and push copies follow each person's notification preferences and quiet hours through the existing channels.
- **Complimentary access** (`ComplimentaryAccessManager` on `/trainer/subscribers`). The owner chooses a follower, tier (Workout, or Workout + nutrition when nutrition is approved and set up), a fixed number of days or "until I revoke it" (when allowed), and a reason. Granting and ending require a fresh authenticator check (`MFA_STEP_UP` shows a link to Account security). One open grant per follower; granting over an active grant asks to replace it. Ended grants can be shown. Coaching staff see the list read-only. The subscriber table's membership badge shows "Complimentary" for such members (and "No plan" instead of the former misleading "Invited" for joined members without any plan).

### Follower (subscriber)

- **Joining page** `/join/<link>` (`InvitationJoin`) first previews the invitation (coach name, masked invited address, expiry, status). Closed invitations explain why (used, expired, cancelled, replaced by a newer link).
  - Signed in with the invited address: one click "Join <coach>" after accepting the terms. No password, no new account; the browser session moves to the new coach and the account keeps its other coaches.
  - Signed in with a different address: explained, with "Sign out and continue".
  - Signed out: "I'm new here" (name, email, password) or "I already have an account" (email, password; the authenticator code only once the API answers `MFA_REQUIRED`; no name, no new account).
  - Since the phone-first pass (`ui/public`) `/join/<link>` and a coach's join page `/join-coach/<name>` share `AccountJoinForm`: "Join <coach>" with the coach's header, the choice as two full-width cards, one column of fields, the terms checkbox for published documents only (`GET /api/v1/public/legal-status`), and "Join <coach>" in a sticky bar on phones. No "Welcome back", no forgotten-password link and no trainer copy. See docs/features/phone-first.md, "Public, joining and sign-in pages".
- **Switching coaches**: a "Your coaches" card on the Today page lists every coach with "Switch to …" buttons, a compact "Coach" switcher sits in the top bar (visible on phones where the sidebar is collapsed), and the sidebar label reads "Switch coach" for followers. After a one-click join the Today page confirms "You joined …". Switching replays offline workout/meal queues first, like the existing sidebar switcher.
- **Membership page** shows a "Your coach has given you access" card with the tier and end date (or "until your coach ends it"). The trainer's free-text reason is not shown to the follower. Paid plans remain available.
- Notifications when complimentary access is granted, three days before a fixed end date (only for grants longer than three days), and when it ends — whether the coach or an operator ended it or the period ran out. Dates in these notices use the member's saved time zone (notification preferences), otherwise Asia/Dubai; invitation emails use Asia/Dubai because the invitee has no saved zone yet.
- **Intake prompt.** A complimentary member without a completed intake gets "Complete your coaching intake" (initially and again after 24 hours) from the lifecycle scheduler, the same prompt paid members get after their first payment. The prompt is withdrawn at delivery if the grant ends or the intake is completed.
- **Leaving the current session from `/join/<link>`** ("Sign out and continue", and the one-click join that moves the browser to the new coach) uses the shared `leaveSession` flow, like the sidebar sign-out and the coach switcher: this device's offline workout and meal entries replay first, unsynced entries need confirmation, and cached app data is cleared afterwards.

### Super admin (platform operators)

- `/admin/subscribers` shows a **Complimentary access** panel (`AdminComplimentaryAccess`) listing grants across every workspace, newest first, 25 grants per page with Newer/Older paging (keyset cursor on `created_at`, grant id). Filters: status (active, ended, all), workspace address (slug) and follower email. Each row shows follower, workspace, tier, who granted it, dates and reason. Visible to `admin`, `finance` and `support` operators with a fresh authenticator; every read is written to `admin_operations_audit` with the filters used (a follower filter is recorded as used, not the address).
- Only a platform `admin` can **End access** (reason required). This closes the grant as `platform_revoked`, writes `admin_operations_audit` and a workspace event, and notifies the follower and the coaching team. If the grant's period had already run out, it is closed as `expired` instead, without a second notice to the follower (audit action `complimentary.closed_expired`); the same applies to an owner ending a lapsed grant.
- **Limits** are application settings in Settings & API connections (`packages/providers/src/configuration.ts`, application group):

| Setting | Default | Meaning |
| --- | --- | --- |
| `FOLLOWER_INVITE_EMAILS_PER_DAY` | 50 | Invitation emails per workspace per 24 h (0–10000, includes resends) |
| `FOLLOWER_INVITE_EMAILS_PER_ADDRESS` | 3 | Invitation emails to one address per 24 h, counted across all workspaces (1–20) |
| `FOLLOWER_INVITE_EMAILS_PLATFORM_PER_DAY` | 1000 | Invitation emails per 24 h for the whole platform (0–100000; 0 pauses invitation emails, copy links keep working) |
| `COMPLIMENTARY_ACCESS_MAX_DAYS` | 365 | Longest fixed complimentary period (1–3650) |
| `COMPLIMENTARY_ACCESS_OPEN_ENDED` | true | Whether "until revoked" grants are allowed |
| `COMPLIMENTARY_ACCESS_MAX_ACTIVE` | 25 | Active complimentary members per workspace (0–100000); 0 switches the feature off |

Saving a value that is not a whole number in the listed range is refused (`validateIntegrationValues`, ranges in `INTEGER_SETTING_RANGES`), so the saved value is the value in force. A blank value, or an out-of-range value supplied through the environment, uses the default. The resend cooldown is fixed at 5 minutes and links last 7 days (constants in `joining.ts`).

The three email caps are counted from each invitation's own send log (`sentAt` in the `one_time_tokens` payload, a system table), so they cover every workspace; a transaction lock per address keeps concurrent workspaces from overrunning the per-address cap. The platform cap is a volume brake and can be exceeded by at most the number of concurrent sends to different addresses.

## Entitlement: one shared function

`apps/api/src/entitlements.ts` exports `memberAccess(tx, userId, { grace? })`, `hasMemberAccess`, `hasNutritionAccess`, `activeComplimentaryGrant`, `complimentaryNutritionApproved` and `tierModules`. Access is active when the paid subscription is active/trialing (or past due inside its grace period) **or** an open, unexpired complimentary grant exists. Modules are the union: paid modules plus `training`; a complimentary `workout` grant adds `training`, `workout_nutrition` adds `nutrition` only when `complimentaryNutritionApproved()` (in production, `NUTRITION_ENABLED` and `NUTRITION_SCOPE_APPROVED` must be `true`). Premium voice stays a paid capability.

Every check that required an active paid membership now uses it:

| Area | File | Change |
| --- | --- | --- |
| Workouts start/log/finish/abandon, digital coach request and reply | `coaching-completion.ts` (`activeMembership`, red-flag note path) | `hasMemberAccess` |
| Digital coach qualified runtime | `coaching-runtime.ts` | `hasMemberAccess` |
| Exercise substitution | `training-programs.ts` | `hasMemberAccess` |
| Guided sessions | `integrations-completion.ts` | `memberAccess`; premium from `premiumVoice` |
| Bookings | `booking-schedule.ts` | `hasMemberAccess(..., { grace: false })` (booking kept its existing no-grace rule) |
| Workout reminders (schedule + delivery check) | `notifications.ts` | `hasMemberAccess` |
| Scheduled follow-ups | `coaching-followups.ts` | `memberAccess`; complimentary-only access pins the grant id |
| Program-ready and missed-workout nudges | `lifecycle-messages.ts` | `hasMemberAccess` |
| Intake prompt | `lifecycle-messages.ts` | Paid prompt unchanged (after the first charge); new complimentary prompt keyed by grant id, withdrawn when the grant ends |
| Nutrition (API, meal capture, nutrition completion) | `nutrition.ts` `nutritionEntitlement` | `hasNutritionAccess` |
| Weekly nutrition scheduler | `nutrition-schedule.ts` | `hasNutritionAccess` |
| Unused legacy helper | `app.ts` `activeMembership` | `hasMemberAccess` |

Deliberately left paid-only: billing/renewal/refunds/plan change (`finance-billing.ts`, `app.ts` change-plan), checkout, retention/cancellation reporting, the lifecycle "paid milestone" trigger, commission ranking, business analytics — these are about money, and complimentary access creates none. (The intake prompt is a coaching reminder, so complimentary members now get it too.)

Grants create no `subscriptions` row, no Stripe object and no journal, so revenue, commission bands, payouts and statements are unaffected. AI and voice usage of complimentary members is recorded in `cost_events` under the trainer's workspace exactly as before (no change was needed; a test confirms the attribution).

## Routes

| Method and path | Who | Purpose |
| --- | --- | --- |
| `POST /api/v1/invitations` | owner | Existing route. For `role:"subscriber"` accepts `sendEmail` and returns `{id,url,expiresInDays,expiresAt,email:{status,message}}`; rate limited 60/10 min |
| `GET /api/v1/invitations/followers` | owner | List (latest 100) with status and delivery; `ownerEmailVerified` says whether email sending is available |
| `POST /api/v1/invitations/followers/:id/cancel` | owner | Cancel a pending invitation |
| `POST /api/v1/invitations/followers/:id/resend` | owner with a confirmed email | Email a fresh link (cooldown, caps); `409 EMAIL_VERIFICATION_REQUIRED` otherwise |
| `POST /api/v1/invitations/preview` | anyone with the link | Invitation summary and signed-in viewer state (including the viewer's own current workspace and user id, used to replay the device queue before leaving); 30/10 min |
| `POST /api/v1/invitations/accept-signed-in` | signed-in account | One-click follower acceptance; replaces the browser session with one for the new coach; 10/10 min |
| `POST /api/v1/invitations/accept` | anyone with the link | Existing route; `name` now optional for existing accounts (`NAME_REQUIRED` for new ones); records the outcome and alerts the coach |
| `POST /api/v1/auth/enroll` | public | Existing route; now alerts the coach when a membership is created; `name` is optional for an existing account (`NAME_REQUIRED` for a new one), like `/invitations/accept` |
| `GET /api/v1/public/legal-status` | public | `{joiningOpen, documents:[{key,published,version}]}` for terms, privacy and the digital coaching disclosure, decided as acceptance is recorded (`legalStatus` in `apps/api/src/legal.ts`); joining forms ask people to accept only published documents |
| `GET /api/v1/complimentary-access` | owner, staff | Grants, followers, limits, nutrition-tier availability |
| `POST /api/v1/complimentary-access` | owner + fresh MFA | Grant `{userId,tier,days|null,reason,replaceId?}` |
| `POST /api/v1/complimentary-access/:id/revoke` | owner + fresh MFA | End `{version,reason}` |
| `GET /api/v1/membership/access` | subscriber | Own access summary (no trainer note) |
| `GET /api/v1/admin/complimentary-access` | admin, finance, support + fresh MFA | Cross-workspace list by grant, `?status=active\|ended\|all&workspace=<slug>&follower=<email>&cursor=<nextCursor>`; returns `{grants,canRevoke,nextCursor}`; audited |
| `POST /api/v1/admin/tenants/:tenantId/complimentary-access/:id/revoke` | admin + fresh MFA | Platform revoke, audited |

`GET /api/v1/bootstrap` now also returns `complimentary` (active grants without the reason; followers see only their own).

## Data and security

- Migration 055 creates `complimentary_access` (tenant-scoped, RLS enabled and forced), the system table `complimentary_access_directory` (grant id, workspace id, member id, created/ends/closed times only — no names, reasons or notes) maintained by the `SECURITY DEFINER` trigger function `complimentary_access_directory_sync()` on every insert and update of a grant, and a partial index `one_time_tokens_invite_expiry` for the invitation-email caps. `infra/runtime-role.sql` grants the runtime service role `SELECT` on the directory only (the operator list reads it); tenant roles have no access to it. `scripts/verify-runtime-access.mjs` classifies the directory as a system table (`SELECT`), checks that tenant actors cannot read it, and lists the trigger function as a classified helper (executable by `trainer_app`, not by the service role or `PUBLIC`; a trigger function cannot be called directly).
- Grant table details: Policy: rows are visible inside the tenant, followers see only their own; only the `owner` app role writes. A `complimentary_access_guard` trigger keeps terms immutable, keeps closed grants final and refuses deletes; free text (`reason`, `close_note`) can only be replaced by the fixed marker `[removed at erasure]` while `app.privacy_erasure` is set. `trainer_app` has SELECT, INSERT, UPDATE and no DELETE. The guard trigger function is not `SECURITY DEFINER`. `scripts/verify-runtime-access.mjs` classifies the table as tenant-scoped (no direct service grant).
- Invitation outcome and delivery bookkeeping live in the existing `one_time_tokens.payload` (system table, no migration). Invitation emails carry the link as a bearer credential: `sensitive:true` removes the text after any terminal outcome, and cancelled/expired/accepted/superseded links are never sent.
- Audit events (immutable `events`): `follower.invited`, `follower.invitation_cancelled`, `follower.invitation_resent`, `follower.joined`, `complimentary.granted`, `complimentary.revoked`, `complimentary.platform_revoked`, `complimentary.expired`. They hold structured data only; free-text reasons stay on the grant so erasure can remove them. Operator actions also write `admin_operations_audit` (`complimentary.read`, `complimentary.revoked`, `complimentary.closed_expired`).
- **Expiry sweep.** The worker runs `sweepComplimentaryAccess` for each active workspace beside `scheduleNotifications`: grants whose period ran out are closed as `expired` (at most 100 per pass), the follower is told once (`complimentary-ended:<grant>`), the owner and coaching staff get "Complimentary access ended", and followers with a fixed end date within three days get one reminder (`complimentary-ending:<grant>`). Access already stops at the end date through the entitlement check; the sweep records it and informs people.
- Privacy: personal export includes `complimentaryAccess`; member erasure closes the member's grants (`member_removed`) and scrubs their free text, and deletes that workspace's invitation rows for the erased address (and with them their email send log); workspace closure closes every grant (`workspace_closed`) and scrubs free text (`privacy-hooks.ts`, `privacy-lifecycle.ts`). The operator directory holds only ids and times; an erased member's user row is anonymised, so directory rows carry no personal details.
- The legal gate (`LEGAL_APPROVED` in production) applies to the new signed-in acceptance exactly as to the existing routes. Custom-domain rules match the existing acceptance route.

## Tests actually run (27 September 2026)

Environment: Node 24 (`/opt/node24/bin`), worktree `feat/joining`.

### Review round (after the adversarial review; final code of this commit)

- `npx tsc --noEmit` — exit 0, no errors.
- `node --import tsx --test tests/joining-complimentary.test.ts tests/joining-invitations.test.ts` (PGlite) — 30 tests, 30 passed (14 complimentary, 16 invitations; 11 of them new in this round).
- `node --import tsx --test tests/joining-web.test.ts` — 6 tests, 6 passed (3 new).
- `node --import tsx --test tests/coaching-runtime.test.ts` (PGlite) — 8 tests, 8 passed, including the new complimentary digital-coach test.
- `node --import tsx --test --test-concurrency=2` over 19 related files (`platform-settings`, `provider-configuration`, `settings-runtime`, `fix-settings`, `fix-auth`, `host-routing`, `platform`, `lifecycle-messages`, `nutrition`, `meal-capture`, `integrations-completion`, `coaching-completion`, `coaching-followups`, `notifications`, `privacy-lifecycle`, `team-completion`, `bookings-completion`, `fix2-web`, `fix-web`) on PGlite — 196 tests, 196 passed, 0 failed, 0 skipped. `tests/admin-completion.test.ts` separately — 7 tests, 7 passed.
- `/opt/tools/pg-sandbox.sh 56112 <worktree> tests/joining-complimentary.test.ts tests/joining-invitations.test.ts tests/joining-web.test.ts tests/coaching-runtime.test.ts tests/coaching-followups.test.ts tests/lifecycle-messages.test.ts tests/notifications.test.ts tests/privacy-lifecycle.test.ts tests/team-completion.test.ts tests/bookings-completion.test.ts` — `{"runtimeAccess":"verified","migrations":46,"systemTables":37,"scopedTables":34,"helpers":10}`, then as the restricted runtime role 14/14, 16/16, 6/6, 8/8, 7/7, 8/8, 9/9, 8/8, 6/6, 7/7 passed (89 tests), `PG_SELECTED_FAILED_FILES=0`.

New tests in this round cover: an unconfirmed owner gets `verify_email_first` with a working copy link and resend `409 EMAIL_VERIFICATION_REQUIRED`; the per-address cap counts emails from three different workspaces (and resends) and forgets sends older than 24 hours; the per-workspace and platform-wide caps; re-inviting keeps an expired invitation `expired`; out-of-range limit values are refused when saved; invitation and grant dates use Asia/Dubai or the member's zone; ending a lapsed grant closes it as `expired` without a second notice; the worker sweep (close once, follower and team notices, reminder, idempotent, directory kept in step); operator paging by grant across workspaces with 31 grants including 30 written at the same instant (every grant exactly once), status, workspace and follower filters, invalid cursor 400, audit without the address, tenant roles cannot read the directory; a complimentary-only member's scheduled follow-up pins the grant, is delivered, and a second one returns to review after revocation; program-ready and complimentary intake nudges reach the member and the intake nudge is withdrawn after revocation; the digital coach answers a complimentary member (paid subscription cancelled) with the trainer's approved wording and withholds the answer with `402` when the grant ends during generation; the invitation page leaves the session through `leaveSession`; the coaches card always has an accessible name.

AI check: the only model-backed path touched is the digital coach gate. In the new runtime test the synthetic model returns private reasoning text; the member-facing answer was asserted to equal the trainer's approved action response and not to contain model text. The new notification and email copy in this round is fixed text that I reviewed for accuracy (dates in the reader's zone, no trainer note shown to followers, no payment implied).

### First implementation round

- `npx tsc --noEmit` — passed (no errors).
- `node --import tsx --test tests/joining-invitations.test.ts` (PGlite) — 10 tests, 10 passed.
- `node --import tsx --test tests/joining-complimentary.test.ts` (PGlite) — 9 tests, 9 passed.
- `node --import tsx --test tests/joining-web.test.ts` — 3 tests, 3 passed (server-rendered first state of every new component, logical-property CSS check, switcher queue order).
- `/opt/tools/pg-sandbox.sh 56112 <worktree> tests/joining-invitations.test.ts tests/joining-complimentary.test.ts tests/joining-web.test.ts tests/notifications.test.ts tests/coaching-followups.test.ts tests/privacy-lifecycle.test.ts tests/bookings-completion.test.ts tests/team-completion.test.ts` (final code) — all 46 migrations applied, `verify-runtime-access` `{"runtimeAccess":"verified","migrations":46,"systemTables":36,"scopedTables":34,"helpers":9}`, then as the restricted runtime role: 10/10, 9/9, 3/3, 9/9, 7/7, 8/8, 7/7, 6/6 passed, `PG_SELECTED_FAILED_FILES=0`.
- Related existing suites on PGlite, one run of 30 files (`node --import tsx --test --test-concurrency=1 tests/coaching-completion.test.ts tests/coaching-followups.test.ts tests/notifications.test.ts tests/bookings-completion.test.ts tests/integrations-completion.test.ts tests/lifecycle-messages.test.ts tests/nutrition.test.ts tests/nutrition-completion.test.ts tests/meal-capture.test.ts tests/coaching-runtime.test.ts tests/team-completion.test.ts tests/platform.test.ts tests/privacy-lifecycle.test.ts tests/privacy-media.test.ts tests/fix-settings.test.ts tests/platform-settings.test.ts tests/provider-configuration.test.ts tests/settings-runtime.test.ts tests/host-routing.test.ts tests/fix-auth.test.ts tests/fix2-web.test.ts tests/fix-web.test.ts tests/fix-coaching.test.ts tests/fix2-safety.test.ts tests/acquisition.test.ts tests/chat-attachments.test.ts tests/branding.test.ts tests/fix-nutrition-ops.test.ts tests/fix-nutrition-safety.test.ts tests/rate-limits.test.ts`) — 277 tests: 276 passed, 0 failed, 1 skipped (the existing PostgreSQL-only interleaving test in `fix-nutrition-ops`). This run used the code before three final edits (cancel body schema, shared `Field` in `joining.tsx`, formatting); the joining suites and the PostgreSQL run above were repeated on the final code.
- The full `npm test` suite and `next build` were not run (reserved for the coordinator).

This package produces no model-generated text: invitation emails and notifications are fixed copy written and reviewed in this change, and the digital coach only gained the shared entitlement gate (its model responses are unchanged, so no new AI output needed judging).

The invitation tests use synthetic email settings (`https://email.invalid/send`) and an in-memory sender passed to the worker function; nothing is sent. No provider, Stripe, payout or deployment action was used.

## Left out, with reasons

- **Signed-in one-click join from a coach's public page** (`/join-coach/<name>`): not built. The existing form already joins an existing account with its password; public self-join additionally needs a published storefront, which is blocked on providers. The invitation path was the requested flow.
- **Notification templates** for the new complimentary notices (`complimentary-ending`, `complimentary-ended`, the team notice): not given template keys, like the existing grant notices, so their fixed copy (with the date) cannot be overridden from the templates registry yet.
- **Platform-wide invitation cap** is a volume brake: concurrent sends to different addresses can exceed it by at most the number of in-flight requests (the per-address cap is exact because of a per-address lock).
- **Browser check at 390 px**: not run (no cloud browser; builds are reserved for the coordinator). New CSS wraps rows (`flex-wrap`, `min-width:0`, `overflow-wrap:anywhere`) and hides the compact switcher's label below 720 px; please include `/trainer/subscribers`, `/join/<link>`, `/app` and `/app/membership` in the next browser gate.
- **Support preview** (`support-preview.ts`) still shows only the paid subscription status; operators see complimentary access in the new admin panel.
- Email and push delivery remain `needs_provider` in production until `EMAIL_*` and VAPID keys are configured; invitation acceptance still needs `LEGAL_APPROVED`.

## Review round: findings and what was done

| Finding | Disposition |
| --- | --- |
| Major: owners with an unconfirmed email could queue invitation emails; per-address cap counted per workspace only | Fixed. Email is queued only for a confirmed owner (`verify_email_first` otherwise, resend `409`). Per-address cap now counts every workspace; new platform-wide daily cap setting. Tests added. |
| Limit settings saved out of range but ignored at runtime | Fixed. Key-specific whole-number ranges are enforced when saving (`INTEGER_SETTING_RANGES`), shared with the runtime reader. Test added. |
| Operator list paged by workspace, not by grant | Fixed. System-readable keys-and-dates directory maintained by a definer trigger; the list pages by grant with a keyset cursor and filters by status, workspace and follower. Test added. |
| Re-inviting relabelled an expired invitation as replaced | Fixed (`expires_at>now()` on the replacing update). Test added. |
| Ending an already-lapsed grant recorded a revocation and a second notice; nothing closed lapsed grants | Fixed. Lapsed grants close as `expired` without a second notice; worker sweep closes lapsed grants, notifies follower and team, and reminds three days before the end. Tests added. |
| "Sign out and continue" and one-click join skipped the shared leave flow | Fixed. Both go through `leaveSession` (queue replay, unsynced confirmation, cache clearing). Source-order test added. |
| Intake prompt only after a paid charge | Fixed. Complimentary members get the intake prompt keyed by grant id; withdrawn when the grant ends. Test added. |
| Dates in grant notice and invitation email printed as UTC dates | Fixed. Member's saved zone, otherwise Asia/Dubai. Tests added. |
| No tests for digital coach, follow-ups and program nudges with complimentary access | Added (coaching-runtime and joining-complimentary suites). |
| "Your coaches" section referenced a heading that was not rendered | Fixed (`aria-label` when the heading is absent). Test added. |
