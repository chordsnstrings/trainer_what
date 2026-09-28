# End-to-end harness: per-feature results

Generated from `2026-09-27T23-35-07-873Z` and `2026-09-27T23-44-32-198Z` by `scripts/e2e/coverage-table.mjs`.

Inventory status comes from the inventory file given to the run, a snapshot: a feature built after it (for example one marked not_built) keeps its snapshot status here. "pass (same flow)" means another audience's step runs exactly this flow (`EQUIVALENT_FEATURES` in `tests/e2e/harness/report.ts`). A local limit names the part of a feature the sandbox cannot exercise (`LOCAL_LIMITS`).

| Run | Steps | Passed | Failed | Skipped | Duration |
| --- | --- | --- | --- | --- | --- |
| 2026-09-27T23-35-07-873Z | 399 | 399 | 0 | 0 | 536 s |
| 2026-09-27T23-44-32-198Z | 399 | 399 | 0 | 0 | 542 s |

## Super admin

| Feature | Inventory status | Provider-dependent | 2026-09-27T23-35-07-873Z | 2026-09-27T23-44-32-198Z | Steps | Local limit or equivalent flow |
| --- | --- | --- | --- | --- | --- | --- |
| First Superadmin creation (npm run admin:bootstrap) | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Sign in with password and authenticator code, sign out | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Authenticator app (TOTP) setup | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Password change | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Fresh authenticator check before operator actions | live_verified | yes | pass | pass | 1/1, 1/1 |  |
| Signed-in sessions list and remote sign-out | ready | no | pass | pass | 1/1, 1/1 |  |
| Recovery codes | ready | no | pass | pass | 1/1, 1/1 |  |
| Passkeys | ready | no | pass | pass | 1/1, 1/1 |  |
| Forgot-password email | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Magic sign-in link | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Email address verification | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Platform screens refuse non-operators | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Grant or change operator roles (npm run operator:role) | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Scoped finance, support and safety operators | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Last-Superadmin protection and self-recovery | ready | no | pass | pass | 1/1, 1/1 |  |
| Emergency authenticator reset (npm run operator:role -- reset-mfa) | ready | yes | pass | pass | 1/1, 1/1 |  |
| Member authenticator reset by a Superadmin | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Settings and API connections page | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Save and validate application settings | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Owner approval switches | split: needs_approval for LEGAL_APPROVED | yes | pass | pass | 1/1, 1/1 |  |
| Encrypted storage of provider keys | ready | no | pass | pass | 1/1, 1/1 |  |
| Provider connection check | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Turn off or disconnect a connection | ready | no | pass | pass | 1/1, 1/1 |  |
| Settings change history | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Settings apply without a restart | ready | no | pass | pass | 1/1, 1/1 |  |
| Stripe payment events endpoint | needs_provider | yes | pass | pass | 2/2, 2/2 |  |
| Draft and publish legal document versions | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Scheduled effective dates and locked published text | ready | no | pass | pass | 1/1, 1/1 |  |
| Public legal pages with past versions | ready | no | pass | pass | 1/1, 1/1 |  |
| Open sign-ups after legal approval | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Support reply macros | ready | no | pass | pass | 1/1, 1/1 |  |
| Notification templates | partial | yes | pass | pass | 1/1, 1/1 |  |
| Safety policy documents | partial | yes | pass | pass | 1/1, 1/1 |  |
| Platform overview dashboard (/admin) | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Executive business metrics | not_built | no | pass | pass | 1/1, 1/1 |  |
| Trainer workspaces list | ready | no | pass | pass | 1/1, 1/1 |  |
| Subscriber accounts list | ready | no | pass | pass | 1/1, 1/1 |  |
| Suspend a workspace or lock an account | not_built | no | pass | pass | 3/3, 3/3 |  |
| Per-workspace finance console | ready | no | pass | pass | 1/1, 1/1 |  |
| Commission and fee policy | ready | no | pass | pass | 1/1, 1/1 |  |
| Charge a platform cost to a trainer | ready | no | pass | pass | 1/1, 1/1 |  |
| Monthly financial statement | ready | no | pass | pass | 1/1, 1/1 |  |
| Month close | ready | no | pass | pass | 1/1, 1/1 |  |
| Reconciliation exceptions | ready | no | pass | pass | 2/2, 2/2 |  |
| Record Stripe bank settlements | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Record Stripe balance debits | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Refund review and operator refunds | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| AI usage cost reconciliation | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Monthly AI usage statements | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Trainer bank destination review | needs_provider | yes | pass | pass | 3/3, 3/3 |  |
| Payout execution to trainer banks | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Payout cancellation and bank outcome recording | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Finance automation | partial | yes | pass | pass | 1/1, 1/1 |  |
| AI cost view (FinOps) | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Support conversation queue | ready | no | pass | pass | 1/1, 1/1 |  |
| Reply to and resolve support conversations | ready | no | pass | pass | 1/1, 1/1 |  |
| Support preview of a member's screens | ready | no | pass | pass | 1/1, 1/1 |  |
| One-time support corrections | ready | no | pass | pass | 1/1, 1/1 |  |
| Wearable connection health view | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Safety escalations queue | ready | no | pass | pass | 1/1, 1/1 |  |
| Operator safety triage note | ready | no | pass | pass | 1/1, 1/1 |  |
| Brain releases and evaluation scores | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Trainer voice verification | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Custom domain operations | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Acquisition funnel | ready | no | pass | pass | 1/1, 1/1 |  |
| Wording experiments | ready | no | pass | pass | 1/1, 1/1 |  |
| Affiliate agreements and earnings | ready | no | pass | pass | 1/1, 1/1 |  |
| Background job queue view | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Email delivery reconciliation | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Infrastructure observer | partial | yes | pass | pass | 1/1, 1/1 |  |
| Alert thresholds and recommendations | ready | no | pass | pass | 1/1, 1/1 |  |
| Worker pause and speed control | ready | no | pass | pass | 1/1, 1/1 |  |
| Scaling, deploy or cloud actions from the admin | not_built | no | pass | pass | 1/1, 1/1 | Allowlisted host actions (pause and resume deploys) are signed by the API and executed by the real controller code with simulated host primitives. Restart, rollback and re-apply need Docker and releases on a real host. Resizing, snapshots, DNS and billing are out of scope by design (no cloud token on the server) and are checked as refused. |
| Readiness report (npm run readiness) | ready | no | pass | pass | 1/1, 1/1 |  |
| Encryption key rotation (npm run secrets:reseal) | ready | no | pass | pass | 1/1, 1/1 |  |
| Health and readiness probes | ready | no | pass | pass | 1/1, 1/1 |  |
| Deletion request queue | ready | no | pass | pass | 1/1, 1/1 |  |
| Erase a member's personal data | ready | no | pass | pass | 2/2, 2/2 |  |
| Privacy follow-ups | ready | no | pass | pass | 1/1, 1/1 |  |
| Complete a workspace closure | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Lifecycle requests and erasure registry | ready | no | pass | pass | 1/1, 1/1 |  |
| Operator activity log and operator list | ready | no | pass | pass | 1/1, 1/1 |  |
| Host command audit | ready | no | pass | pass | 1/1, 1/1 |  |
| Evidence in each workspace's own log | ready | no | pass | pass | 1/1, 1/1 |  |
| Database backups | partial | yes | pass | pass | 2/2, 2/2 | The real host controller code (hostops.py) takes the encrypted backup, uploads it to an S3 double and restores it into a scratch database; only its host primitives are simulated (docker compose exec becomes local pg_dump/psql/pg_restore, containers are reported healthy). The scheduled daily timer and DigitalOcean server backups are not exercised. |
| Alerts to platform operators | not_built | no | pass | pass | 1/1, 1/1 |  |
| Platform's own web address | partial | yes | pass | pass | 1/1, 1/1 | The address check (format, DNS through the sandbox resolver, coach-domain clash, passkeys) runs. Moving the address is a host controller action (DNS check, runtime.env, edge, readiness; tested in `tests/test_platform_address_deployment.py`) and is not performed here. |

## Trainers

| Feature | Inventory status | Provider-dependent | 2026-09-27T23-35-07-873Z | 2026-09-27T23-44-32-198Z | Steps | Local limit or equivalent flow |
| --- | --- | --- | --- | --- | --- | --- |
| Trainer signup (create a coaching workspace) | needs_approval | yes | pass | pass | 3/3, 3/3 |  |
| Sign in, sign out and session revocation | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Change password | partial | yes | pass | pass | 1/1, 1/1 |  |
| Email address verification | needs_provider | yes | pass | pass | 3/3, 3/3 |  |
| Authenticator app (TOTP) for trainers | needs_provider | yes | pass | pass | 3/3, 3/3 |  |
| Password reset and magic-link sign-in | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Passkeys and authenticator recovery codes | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Setup checklist (16-step onboarding registry) | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Save business identity, Brain intro, wearable policy and defer voice | ready | no | pass | pass | 3/3, 3/3 |  |
| Subscriber preview review step | ready | no | pass | pass | 3/3, 3/3 |  |
| Publish storefront (launch) | needs_provider | yes | pass | pass | 3/3, 3/3 |  |
| Public coaching page and public subscriber signup | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as public-join: Public self-join from a coach website (/join-coach/<name>) |
| In-app setup reminders to the trainer | ready | no | pass | pass | 1/1, 1/1 |  |
| Design Studio and brand (app theme, headline, bio, colours, logo) | ready | no | pass | pass | 3/3, 3/3 |  |
| Photo and media upload | ready | no | pass | pass | 2/2, 2/2 |  |
| Photo galleries for the website and the subscriber app | ready | no | pass | pass | 2/2, 2/2 |  |
| Website editor and private preview | ready | no | pass | pass | 2/2, 2/2 |  |
| Publish website | needs_provider | yes | pass | pass | 2/2, 2/2 |  |
| Website contact inquiries inbox | partial | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as public-join: Contact form |
| Custom domain | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Brain workspace screen | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Add teaching sources by pasting text | ready | no | pass | pass | 3/3, 3/3 |  |
| Coaching interview answers | ready | no | pass | pass | 1/1, 1/1 |  |
| Document import with private redaction review | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| AI rule compilation from sources | needs_provider | yes | pass | pass | 4/4, 4/4 |  |
| Write, correct and confirm rules manually | ready | no | pass | pass | 3/3, 3/3 |  |
| Resolve teaching conflicts | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Held-out test scenarios | ready | no | pass | pass | 3/3, 3/3 |  |
| Brain evaluation | needs_provider | yes | pass | pass | 3/3, 3/3 |  |
| Brain release and rollback | needs_provider | yes | pass | pass | 4/4, 4/4 |  |
| Teaching cases (adaptive coaching questions) | ready | no | pass | pass | 1/1, 1/1 |  |
| Routine coaching actions (bounded automatic actions) | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Independent action checks (held-out cases) | partial | yes | pass | pass | 1/1, 1/1 |  |
| Qualify and activate automatic coaching | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Digital coach replies to subscribers | needs_provider | yes | pass | pass | 2/2, 2/2 |  |
| Review AI decisions: corrections, teaching drafts, regression checks and outcomes | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Subscriber list screen | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Invite a subscriber by link | live_verified | no | pass | pass | 11/11, 11/11 |  |
| Subscriber accepts invitation with consent | needs_approval | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Accept a trainer's invitation link |
| Client profile and coaching context view | ready | no | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Coaching context (Client Twin) view |
| Team: invite staff or finance members, change roles and remove members | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Staff and finance role restrictions | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Programs screen, templates and exercise library | ready | no | pass | pass | 3/3, 3/3 |  |
| Assign a program and auto-schedule the calendar | ready | no | pass | pass | 1/1, 1/1 |  |
| Adjust exercises and reschedule or cancel sessions | ready | no | pass | pass | 1/1, 1/1 |  |
| Subscribers train the assigned program | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Log sets (reps, weight, effort, notes) |
| Correct a subscriber's logged sets | partial | yes | pass | pass | 1/1, 1/1 |  |
| Trainer and subscriber messaging | ready | no | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Message your trainer |
| Photo and PDF chat attachments | ready | no | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Send photos and PDFs in chat |
| Personal takeover of a client | ready | no | pass | pass | 1/1, 1/1 |  |
| Scheduled follow-up messages | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Safety holds and hold review | ready | no | pass | pass | 1/1, 1/1 |  |
| Exceptions queue | ready | no | pass | pass | 1/1, 1/1 |  |
| Nutrition setup, teaching cases and text sources | ready | no | pass | pass | 1/1, 1/1 |  |
| Nutrition document import | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Ingredients, recipes, shopping conversions and calorie methods | ready | no | pass | pass | 1/1, 1/1 |  |
| AI recipe drafts and AI policy compilation | needs_provider | yes | pass | pass | 2/2, 2/2 |  |
| Manual nutrition policy and held-out nutrition checks | ready | no | pass | pass | 1/1, 1/1 |  |
| Nutrition evaluation and sample-week preview | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Activate automatic nutrition delivery | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Client calorie targets and coach meal-plan editing | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Nutrition delivery exceptions, pause and weekly-job recovery | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Booking policy and session slots | ready | no | pass | pass | 1/1, 1/1 |  |
| Subscribers reserve sessions | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Reserve or cancel a free session |
| Attendance, no-shows and calendar export | partial | yes | pass | pass | 1/1, 1/1 |  |
| Draft offers (workout and workout + nutrition tiers) | ready | no | pass | pass | 3/3, 3/3 |  |
| Activate an offer for sale | needs_approval | yes | pass | pass | 3/3, 3/3 |  |
| Free trials and promotion codes | needs_provider | yes | pass | pass | 3/3, 3/3 |  |
| Refund decisions | needs_provider | yes | pass | pass | 2/2, 2/2 |  |
| Subscriber plan switching between tiers | needs_approval | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Switch between workout-only and workout + nutrition |
| Finance screen with earnings and balances | live_verified | yes | pass | pass | 1/1, 1/1 |  |
| Ledger CSV export and monthly statements | ready | no | pass | pass | 1/1, 1/1 |  |
| Business analytics and retention | partial | yes | pass | pass | 1/1, 1/1 |  |
| Payout bank account (UAE IBAN) | needs_approval | yes | pass | pass | 3/3, 3/3 |  |
| Monthly payout runs | needs_provider | yes | pass | pass | 2/2, 2/2 |  |
| In-app notification inbox and preferences | ready | no | pass | pass | 1/1, 1/1 |  |
| Email copies of notifications | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Email copies of notifications |
| Device push notifications | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Phone and browser push notifications |
| Subscriber workout and booking reminders | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Workout message policy | ready | no | pass | pass | 1/1, 1/1 |  |
| Integrations status page | ready | no | pass | pass | 1/1, 1/1 |  |
| WHOOP and Amazfit/Zepp connections | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: WHOOP connection |
| Apple Health imports | needs_approval | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Apple Health export import |
| Trainer voice and guided audio sessions | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Settings screen (notification choices and marketing consent) | ready | no | pass | pass | 1/1, 1/1 |  |
| Download my data and request deletion | ready | no | pass | pass | 1/1, 1/1 |  |
| Workspace closure and ownership transfer | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Affiliate agreements and earnings view | ready | yes | pass | pass | 1/1, 1/1 |  |
| Support tickets to the platform | ready | no | pass | pass | 1/1, 1/1 |  |
| Answer subscribers' support requests | ready | no | pass | pass | 1/1, 1/1 |  |
| Switch between workspaces | ready | no | pass | pass | 1/1, 1/1 |  |

## followers

| Feature | Inventory status | Provider-dependent | 2026-09-27T23-35-07-873Z | 2026-09-27T23-44-32-198Z | Steps | Local limit or equivalent flow |
| --- | --- | --- | --- | --- | --- | --- |
| Accept a trainer's invitation link | needs_approval | yes | pass | pass | 11/11, 11/11 |  |
| Join from a coach's public page | needs_approval | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as public-join: Public self-join from a coach website (/join-coach/<name>) |
| Terms, privacy and AI disclosure accepted at joining | partial | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Accept a trainer's invitation link |
| Sign in and sign out | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Only your own data is visible | live_verified | no | pass | pass | 1/1, 1/1 |  |
| See and sign out other devices | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Change password | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Forgot-password reset email | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Email sign-in link | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Verify email address | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Accept a trainer's invitation link |
| Authenticator app (two-step sign-in) | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Recovery codes and authenticator recovery | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Passkeys (fingerprint or face sign-in) | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Switch between trainers | partial | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as public-join: Switch between coaches |
| Sign in at a trainer's own web address | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Today home screen | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Coaching profile questionnaire with consent | ready | no | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Choose a plan and pay (with discount codes) |
| Withdraw coaching-data consent | ready | no | pass | pass | 1/1, 1/1 |  |
| Marketing opt-in choice | ready | no | pass | pass | 1/1, 1/1 |  |
| View assigned program and training calendar | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Move or skip a planned session | ready | no | pass | pass | 1/1, 1/1 |  |
| Start a workout | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Log sets (reps, weight, effort, notes) | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Finish or end a workout early | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Swap to a coach-approved alternative exercise | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Correct a saved set | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Guided session with cues and rest timers | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Trainer's voice reading the guided session | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Report pain during a workout | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Automatic safety pause from worrying messages | ready | no | pass | pass | 1/1, 1/1 |  |
| Trainer's decision on a safety pause | ready | no | pass | pass | 1/1, 1/1 |  |
| Workout reminders and program-ready or missed-session messages | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Message your trainer | ready | no | pass | pass | 1/1, 1/1 |  |
| Send photos and PDFs in chat | ready | yes | pass | pass | 1/1, 1/1 |  |
| Ask the digital coach (AI reply) | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Trainer takeover notice | ready | no | pass | pass | 1/1, 1/1 |  |
| Scheduled follow-up messages from the trainer | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Coaching context (Client Twin) view | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Edit personal coaching preferences | ready | no | pass | pass | 1/1, 1/1 |  |
| Training progress page | partial | yes | pass | pass | 1/1, 1/1 |  |
| Nutrition home screen | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Nutrition profile and consents | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Weekly meal plans | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Recipe options and meal swaps | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Grocery and shopping lists | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Pantry and leftovers | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Food diary | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Saved favourite meals and copying meals | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Weekly nutrition check-ins | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Meal photo estimates | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Barcode lookup | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| See trainer's sessions and my bookings | ready | no | pass | pass | 1/1, 1/1 |  |
| Reserve or cancel a free session | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Pay for a paid session, with refund on cancellation | needs_approval | yes | pass | pass | 2/2, 2/2 |  |
| Add bookings to my calendar | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Choose a plan and pay (with discount codes) | needs_approval | yes | pass | pass | 16/16, 16/16 |  |
| Check an interrupted checkout | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Switch between workout-only and workout + nutrition | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Cancel or reactivate renewal | needs_provider | yes | pass | pass | 2/2, 2/2 |  |
| Request a refund | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Billing history and invoices | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Grace period after a failed payment | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Free or trainer-granted access without payment | not_built | yes | pass | pass | 1/1, 1/1 |  |
| In-app notification inbox | ready | no | pass | pass | 1/1, 1/1 |  |
| Notification preferences and quiet hours | ready | no | pass | pass | 1/1, 1/1 |  |
| Email copies of notifications | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Phone and browser push notifications | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Apple Health export import | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Connections page with import history and delete | ready | no | pass | pass | 1/1, 1/1 |  |
| WHOOP connection | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Amazfit / Zepp connection | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Automatic Apple HealthKit sync | not_built | yes | pass | pass | 1/1, 1/1 | The native companion app does not exist; the harness plays its role against the published device API (pairing code, device token, sample batches, unpair). |
| Trainer photo galleries | ready | no | pass | pass | 1/1, 1/1 |  |
| Support requests | ready | no | pass | pass | 1/1, 1/1 |  |
| Download my data | ready | no | pass | pass | 1/1, 1/1 |  |
| Request account deletion and track it | ready | no | pass | pass | 1/1, 1/1 |  |
| Deletion carried out by the Superadmin | ready | no | pass | pass | 1/1, 1/1 |  |
| Install as a phone app | partial | yes | pass | pass | 1/1, 1/1 | The manifest and icons are fetched over HTTP; the operating system's install prompt cannot run headless. |
| Trainer-branded app icon | needs_approval | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as public-join: Coach-branded app icon and install manifest |
| Offline workout with set sync | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Offline food diary sync | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Coach's public website, galleries and enquiry form | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Leave a trainer (or trainer removes a follower) | not_built | yes | pass | pass | 2/2, 2/2 |  |
| Change name or email address | not_built | yes | pass | pass | 1/1, 1/1 |  |
| Account recovery without email (password reset by Superadmin or trainer) | not_built | yes | pass | pass | 1/1, 1/1 |  |

## public-join

| Feature | Inventory status | Provider-dependent | 2026-09-27T23-35-07-873Z | 2026-09-27T23-44-32-198Z | Steps | Local limit or equivalent flow |
| --- | --- | --- | --- | --- | --- | --- |
| Home page | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Home page earnings calculator | live_verified | no | pass | pass | 1/1, 1/1 |  |
| How it works page | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Pricing ('The economics') page | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Demo page | ready | no | pass | pass | 1/1, 1/1 |  |
| FAQ page | ready | no | pass | pass | 1/1, 1/1 |  |
| HTTPS and browser security headers | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Abuse limits on public forms | ready | no | pass | pass | 1/1, 1/1 |  |
| Trainer sign-up from the marketing site | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Terms page (/terms) | partial | yes | pass | pass | 1/1, 1/1 |  |
| Privacy page (/privacy) | partial | yes | pass | pass | 1/1, 1/1 |  |
| Digital coaching / AI disclosure page (/ai-disclosure) | partial | yes | pass | pass | 1/1, 1/1 |  |
| Earlier legal versions | ready | no | pass | pass | 1/1, 1/1 |  |
| Sign-up and join lock until legal approval | live_verified for trainer registration o | yes | pass | pass | 1/1, 1/1 |  |
| Terms acceptance recorded when joining | needs_approval | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Accept a trainer's invitation link |
| Optional analytics consent panel | ready | no | pass | pass | 1/1, 1/1 |  |
| Withdraw analytics consent | ready | no | pass | pass | 1/1, 1/1 |  |
| Campaign and referral code capture | ready | no | pass | pass | 1/1, 1/1 |  |
| Landing visit tracking | ready | no | pass | pass | 1/1, 1/1 |  |
| Landing wording experiments | ready | yes | pass | pass | 1/1, 1/1 |  |
| Conversion milestones (sign-up, join, publish, first payment) | partial | yes | pass | pass | 1/1, 1/1 |  |
| Analytics expiry, export and erasure | ready | no | pass | pass | 1/1, 1/1 | The 180-day window is reached by moving one consent's expiry into the past; the expired record stops counting at once, but the worker's hourly purge is not awaited within the run. |
| Unpublished coach address today | ready | no | pass | pass | 1/1, 1/1 |  |
| Coach website home page | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| About page | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Memberships page with prices | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Photo galleries page | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Custom pages | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Contact page with direct links | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Contact form | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Search and sharing titles | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Coach-branded app icon and install manifest | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Site footer with member login and legal links | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Coaching address reserved at sign-up | live_verified | no | pass | pass | 1/1, 1/1 |  |
| Launch checklist with blocking reasons | ready | no | pass | pass | 1/1, 1/1 |  |
| Publish storefront (go public) | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Trainers: Publish storefront (launch) |
| Website editor with private draft | ready | no | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Trainers: Website editor and private preview |
| Private website preview | ready | no | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Trainers: Website editor and private preview |
| Publish website changes | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Trainers: Publish website |
| Photo library and galleries | ready | no | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Trainers: Photo galleries for the website and the subscriber app |
| Website inquiry inbox | partial | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as public-join: Contact form |
| Follower invitation link | live_verified | no | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Trainers: Invite a subscriber by link |
| Invitation sent by email | not_built | no | pass | pass | 1/1, 1/1 |  |
| See or cancel pending follower invitations | not_built | no | pass | pass | 1/1, 1/1 |  |
| Accept invitation (/join/<link>) | needs_approval | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Accept a trainer's invitation link |
| Existing account joins another coach | needs_approval | yes | pass | pass | 1/1, 1/1 |  |
| Public self-join from a coach website (/join-coach/<name>) | needs_provider | yes | pass | pass | 9/9, 9/9 |  |
| Training access right after joining | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Switch between coaches | ready | no | pass | pass | 1/1, 1/1 |  |
| Email and password sign-in | live_verified | no | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Super admin: Sign in with password and authenticator code, sign out |
| Sign out | live_verified | no | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Super admin: Sign in with password and authenticator code, sign out |
| Email sign-in link | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Email sign-in link |
| Forgot and reset password | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Forgot-password reset email |
| Email address verification | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Trainers: Email address verification |
| Passkey sign-in | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Passkeys (fingerprint or face sign-in) |
| Authenticator recovery-code sign-in | ready | no | pass | pass | 1/1, 1/1 |  |
| Apple or Google sign-in | not_built | no | pass | pass | 2/2, 2/2 | Google and Apple are OpenID Connect issuer doubles reached through a sandbox-only issuer override; the real providers' consent screens, Apple's private-relay email and key rotation are not exercised. |
| Draft membership offers | ready | no | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Trainers: Draft offers (workout and workout + nutrition tiers) |
| Activate an offer so followers can see and buy it | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Workout + nutrition offer tier | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Trainers: Draft offers (workout and workout + nutrition tiers) |
| Choose a plan and pay (membership checkout) | needs_provider (status is right, but wha | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Choose a plan and pay (with discount codes) |
| Discount codes at checkout | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Choose a plan and pay (with discount codes) |
| Free trial for new members | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Trainers: Free trials and promotion codes |
| Check an interrupted checkout | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Check an interrupted checkout |
| Pay for a booked coaching session | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as followers: Pay for a paid session, with refund on cancellation |
| Coach requests a custom domain | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Trainers: Custom domain |
| Domain ownership check | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Approve a price quote to buy a domain | needs_provider | yes | pass (same flow) | pass (same flow) | 0/0, 0/0 | same flow as Super admin: Custom domain operations |
| Superadmin activates the domain | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| HTTPS certificates for coach domains on the live server | not_built | no | pass | pass | 2/2, 2/2 | The API side (TLS ask endpoint, activation allowance, refusal of unmapped names) runs against a local edge that asks the API before presenting a certificate, as Caddy's on-demand TLS does. The live Caddy configuration and real ACME issuance are host work, covered by the infrastructure unit tests, not by this harness. |
| Coach website on its own domain | needs_provider | yes | pass | pass | 1/1, 1/1 |  |
| Platform coach directory or search | not_built | yes | pass | pass | 1/1, 1/1 |  |
| Search-engine sitemap and robots file | not_built | no | pass | pass | 1/1, 1/1 |  |
| First steps a new follower can take without paying | ready | yes | pass | pass | 1/1, 1/1 |  |
| Install the app on a phone (platform-branded) | ready | no | pass | pass | 1/1, 1/1 |  |
| Coach alert when a follower joins | not_built | no | pass | pass | 1/1, 1/1 |  |
| Website contact messages counted as leads | not_built | no | pass | pass | 1/1, 1/1 |  |

## Totals

| Run | pass | pass (same flow) | not local | NOT EXERCISED | FAIL |
| --- | --- | --- | --- | --- | --- |
| 2026-09-27T23-35-07-873Z | 297 | 43 | 0 | 0 | 0 |
| 2026-09-27T23-44-32-198Z | 297 | 43 | 0 | 0 | 0 |

## Provider-dependent features without a scenario or a stated limit

None.

## Flakiness: steps whose status differs between runs

None: every step has the same status in every run.

Steps whose duration varies by more than 3x (over 5 s), usually authenticator windows or request budgets:

- none

