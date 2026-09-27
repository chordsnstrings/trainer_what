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

- **Invite by link or email** (`/trainer/subscribers`, `FollowerInvitations`). The owner enters the follower's email and optionally ticks "Email the invitation link". The response always contains the single-use link (7 days) to copy; the email status is shown (`queued`, `unavailable` when email is not configured, `rate_limited`).
- **Invitation list** with a status filter: pending, accepted, expired, cancelled (including "replaced" when a newer invitation to the same address superseded it), expiry/acceptance dates, and delivery state (link only, email queued, waiting for email setup, sent, not sent, failed, delivery unconfirmed, email not configured, email limit reached). Actions on pending invitations: **Cancel invitation** (link stops working immediately; an unsent email is withdrawn) and **Resend email / Send by email** (issues a fresh link, retires the old one, restarts the 7-day window; confirmation dialog says so).
- **De-duplication.** One pending invitation per address: a new invitation to the same address replaces the earlier link and withdraws its unsent email. Every email job has a unique intent key `invite-email:<invitationId>:<send>`, and the worker sends only the invitation's current send while it is pending and unexpired. Inviting someone who already belongs to the workspace returns `409 ALREADY_MEMBER`.
- **Join alerts.** When a follower accepts an invitation or self-joins from the published coach page, the owner and every coaching staff member (not finance) get a `coaching` notification "A new follower joined" linking to `/trainer/subscribers/<id>`. Email and push copies follow each person's notification preferences and quiet hours through the existing channels.
- **Complimentary access** (`ComplimentaryAccessManager` on `/trainer/subscribers`). The owner chooses a follower, tier (Workout, or Workout + nutrition when nutrition is approved and set up), a fixed number of days or "until I revoke it" (when allowed), and a reason. Granting and ending require a fresh authenticator check (`MFA_STEP_UP` shows a link to Account security). One open grant per follower; granting over an active grant asks to replace it. Ended grants can be shown. Coaching staff see the list read-only. The subscriber table's membership badge shows "Complimentary" for such members (and "No plan" instead of the former misleading "Invited" for joined members without any plan).

### Follower (subscriber)

- **Joining page** `/join/<link>` (`InvitationJoin`) first previews the invitation (coach name, masked invited address, expiry, status). Closed invitations explain why (used, expired, cancelled, replaced by a newer link).
  - Signed in with the invited address: one click "Join <coach>" after accepting the terms. No password, no new account; the browser session moves to the new coach and the account keeps its other coaches.
  - Signed in with a different address: explained, with "Sign out and continue".
  - Signed out: "I'm new here" (name, email, password) or "I already have an account" (email, password, authenticator code; no name, no new account).
- **Switching coaches**: a "Your coaches" card on the Today page lists every coach with "Switch to …" buttons, a compact "Coach" switcher sits in the top bar (visible on phones where the sidebar is collapsed), and the sidebar label reads "Switch coach" for followers. After a one-click join the Today page confirms "You joined …". Switching replays offline workout/meal queues first, like the existing sidebar switcher.
- **Membership page** shows a "Your coach has given you access" card with the tier and end date (or "until your coach ends it"). The trainer's free-text reason is not shown to the follower. Paid plans remain available.
- Notifications when complimentary access is granted or ended.

### Super admin (platform operators)

- `/admin/subscribers` shows a **Complimentary access** panel (`AdminComplimentaryAccess`) across workspaces (25 workspaces per page, or one workspace): follower, workspace, tier, who granted it, dates and reason. Visible to `admin`, `finance` and `support` operators with a fresh authenticator; every read is written to `admin_operations_audit`.
- Only a platform `admin` can **End access** (reason required). This closes the grant as `platform_revoked`, writes `admin_operations_audit` and a workspace event, and notifies the follower and the coaching team.
- **Limits** are application settings in Settings & API connections (`packages/providers/src/configuration.ts`, application group):

| Setting | Default | Meaning |
| --- | --- | --- |
| `FOLLOWER_INVITE_EMAILS_PER_DAY` | 50 | Invitation emails per workspace per 24 h (0–10000, includes resends) |
| `FOLLOWER_INVITE_EMAILS_PER_ADDRESS` | 3 | Invitation emails to one address per workspace per 24 h (1–20) |
| `COMPLIMENTARY_ACCESS_MAX_DAYS` | 365 | Longest fixed complimentary period (1–3650) |
| `COMPLIMENTARY_ACCESS_OPEN_ENDED` | true | Whether "until revoked" grants are allowed |
| `COMPLIMENTARY_ACCESS_MAX_ACTIVE` | 25 | Active complimentary members per workspace; 0 switches the feature off |

Out-of-range or blank values fall back to the default. The resend cooldown is fixed at 5 minutes and links last 7 days (constants in `joining.ts`).

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
| Nutrition (API, meal capture, nutrition completion) | `nutrition.ts` `nutritionEntitlement` | `hasNutritionAccess` |
| Weekly nutrition scheduler | `nutrition-schedule.ts` | `hasNutritionAccess` |
| Unused legacy helper | `app.ts` `activeMembership` | `hasMemberAccess` |

Deliberately left paid-only: billing/renewal/refunds/plan change (`finance-billing.ts`, `app.ts` change-plan), checkout, retention/cancellation reporting, lifecycle "paid milestone" and "intake after first payment" triggers, commission ranking, business analytics — these are about money, and complimentary access creates none.

Grants create no `subscriptions` row, no Stripe object and no journal, so revenue, commission bands, payouts and statements are unaffected. AI and voice usage of complimentary members is recorded in `cost_events` under the trainer's workspace exactly as before (no change was needed; a test confirms the attribution).

## Routes

| Method and path | Who | Purpose |
| --- | --- | --- |
| `POST /api/v1/invitations` | owner | Existing route. For `role:"subscriber"` accepts `sendEmail` and returns `{id,url,expiresInDays,expiresAt,email:{status,message}}`; rate limited 60/10 min |
| `GET /api/v1/invitations/followers` | owner | List (latest 100) with status and delivery |
| `POST /api/v1/invitations/followers/:id/cancel` | owner | Cancel a pending invitation |
| `POST /api/v1/invitations/followers/:id/resend` | owner | Email a fresh link (cooldown, caps) |
| `POST /api/v1/invitations/preview` | anyone with the link | Invitation summary and signed-in viewer state; 30/10 min |
| `POST /api/v1/invitations/accept-signed-in` | signed-in account | One-click follower acceptance; replaces the browser session with one for the new coach; 10/10 min |
| `POST /api/v1/invitations/accept` | anyone with the link | Existing route; `name` now optional for existing accounts (`NAME_REQUIRED` for new ones); records the outcome and alerts the coach |
| `POST /api/v1/auth/enroll` | public | Existing route; now alerts the coach when a membership is created |
| `GET /api/v1/complimentary-access` | owner, staff | Grants, followers, limits, nutrition-tier availability |
| `POST /api/v1/complimentary-access` | owner + fresh MFA | Grant `{userId,tier,days|null,reason,replaceId?}` |
| `POST /api/v1/complimentary-access/:id/revoke` | owner + fresh MFA | End `{version,reason}` |
| `GET /api/v1/membership/access` | subscriber | Own access summary (no trainer note) |
| `GET /api/v1/admin/complimentary-access` | admin, finance, support + fresh MFA | Cross-workspace list, audited |
| `POST /api/v1/admin/tenants/:tenantId/complimentary-access/:id/revoke` | admin + fresh MFA | Platform revoke, audited |

`GET /api/v1/bootstrap` now also returns `complimentary` (active grants without the reason; followers see only their own).

## Data and security

- Migration 055 creates `complimentary_access` (tenant-scoped, RLS enabled and forced). Policy: rows are visible inside the tenant, followers see only their own; only the `owner` app role writes. A `complimentary_access_guard` trigger keeps terms immutable, keeps closed grants final and refuses deletes; free text (`reason`, `close_note`) can only be replaced by the fixed marker `[removed at erasure]` while `app.privacy_erasure` is set. `trainer_app` has SELECT, INSERT, UPDATE and no DELETE. The trigger function is not `SECURITY DEFINER`, so no runtime helper grant is needed. `scripts/verify-runtime-access.mjs` classifies the table as tenant-scoped; `infra/runtime-role.sql` needed no change (no direct service grant).
- Invitation outcome and delivery bookkeeping live in the existing `one_time_tokens.payload` (system table, no migration). Invitation emails carry the link as a bearer credential: `sensitive:true` removes the text after any terminal outcome, and cancelled/expired/accepted/superseded links are never sent.
- Audit events (immutable `events`): `follower.invited`, `follower.invitation_cancelled`, `follower.invitation_resent`, `follower.joined`, `complimentary.granted`, `complimentary.revoked`, `complimentary.platform_revoked`. They hold structured data only; free-text reasons stay on the grant so erasure can remove them. Operator actions also write `admin_operations_audit` (`complimentary.read`, `complimentary.revoked`).
- Privacy: personal export includes `complimentaryAccess`; member erasure closes the member's grants (`member_removed`) and scrubs their free text, and deletes that workspace's invitation rows for the erased address; workspace closure closes every grant (`workspace_closed`) and scrubs free text (`privacy-hooks.ts`, `privacy-lifecycle.ts`).
- The legal gate (`LEGAL_APPROVED` in production) applies to the new signed-in acceptance exactly as to the existing routes. Custom-domain rules match the existing acceptance route.

## Tests actually run (27 September 2026)

Environment: Node 24 (`/opt/node24/bin`), worktree `feat/joining`.

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
- **Expiry reminders** for complimentary access (e.g. "ends in 3 days"): not built; the membership page shows the end date and the follower is notified when a coach or operator ends it.
- **Browser check at 390 px**: not run (no cloud browser; builds are reserved for the coordinator). New CSS wraps rows (`flex-wrap`, `min-width:0`, `overflow-wrap:anywhere`) and hides the compact switcher's label below 720 px; please include `/trainer/subscribers`, `/join/<link>`, `/app` and `/app/membership` in the next browser gate.
- **Support preview** (`support-preview.ts`) still shows only the paid subscription status; operators see complimentary access in the new admin panel.
- Email and push delivery remain `needs_provider` in production until `EMAIL_*` and VAPID keys are configured; invitation acceptance still needs `LEGAL_APPROVED`.
