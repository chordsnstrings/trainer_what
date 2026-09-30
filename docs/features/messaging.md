# Messaging: templates, safety policy, inquiries and leads

Work package branch: `feat/messaging` (base `6fa8aba`). Migration:
`packages/db/migrations/057_messaging_policy.sql`.

## Plan (written before implementation)

Findings from the existing code:

- `notifyUser` (apps/api/src/notifications.ts) already looked up a published
  notification template through `published_notification_template()` when a
  caller passed `templateKey`, and stored `{key,version}` on the notification.
  Gaps: template keys were undocumented and unvalidated (a typo silently never
  applied), `{{coach}}` was hard-coded "Your coach", `{{ name }}` with spaces
  passed validation but never rendered, there was no locale fallback, no HTML
  part for email (so no escaping), no admin preview and no list of keys.
- Safety screening was the pure `safetySignal()` floor in packages/domain; the
  published `safety` documents were never read. Training holds created an
  `exception` record without a review deadline; nothing escalated an
  unreviewed hold.
- The public contact form saved a `website_inquiry` record only: no
  notification, no acquisition event. `acquisition_events` already allowed
  `lead`, and the admin funnel already counted `lead` rows.
- Milestones: signup, enroll (self-join and invitation), publish and
  first_paid (subscription invoice) were recorded after commit. Gap: a paid
  one-off coaching session (booking payment) is a trainer's first member
  payment but never recorded `first_paid`.

Plan per requirement: (1) message-kind registry, validation, per-channel
rendering with HTML escaping, `en`/`ar` fallback, version pin, admin preview;
(2) structured tighten-only policy document with a code floor, pinned on every
safety decision, and a worker escalation pass; (3) owner notification per
inquiry with preferences and an hourly alert cap; (4) consented inquiries
become `lead` events shown in the funnel, the trainer analytics and the inbox;
(5) verify milestone hooks and record `first_paid` for paid sessions.

## What was built

### Super admin (platform operator)

- **Message kinds and templates** (Configuration view, new component
  `apps/web/components/messaging-admin.tsx`): the registry of every message
  kind with its template key, audience, category, whether it is critical, and
  which English/Arabic template version is published. Published templates with
  a key no sender uses are listed as a warning.
- **Template validation**: a notification document must use a registered key
  (`<key>` for English, `<key>--ar` for Arabic; `--en` and other locales are
  refused) and only `{{name}}`, `{{coach}}`, `{{link}}`, `{{date}}`,
  `{{message}}` in title and body (whitespace inside braces is allowed and now
  renders). Drafts are checked again at publish time.
- **Template preview with sample data**: renders inbox copy, email subject,
  plain-text email and the HTML email (shown in a sandboxed iframe), plus the
  fixed device notice and the built-in wording. Nothing is stored or sent.
- **Coaching safety policy**: the document `kind=safety`,
  `key=coaching-safety-policy` is a JSON policy:
  `{"schema":1,"summary":"…","redFlagTerms":[…],"personalReviewCategories":[…],"personalReviewTerms":[…],"holdReviewHours":1-24,"personalReviewHours":1-72}`.
  Drafts that try to weaken the floor (a longer deadline, or any field that is
  not one of these, e.g. `removeRedFlagTerms`, `disableFloor`,
  `exemptCategories`) are refused with `SAFETY_POLICY_WEAKENS`; malformed ones
  with `SAFETY_POLICY_INVALID`. The panel shows the policy in effect, its
  version, deadlines against the floor, and any ignored instructions, and has
  a "Check policy" box. Other `safety` keys stay free text as before.
- **Safety queue**: rows now show the review deadline, overdue time and the
  pinned policy version; overdue open items sort first. For open safety holds
  and personal reviews the deadline shown is the effective one (the earlier of
  the pinned deadline and the current policy's), the same value that
  escalates.
- **Acquisition funnel**: website leads from consenting visitors appear in the
  existing `leads` column with the visitor's platform-wide first touch (this
  is the only place the platform's own and other workspaces' campaigns are
  shown); the summary text says so, and "first paid" now names subscription
  or paid-session journals.
- **Safety policy terms**: a term must keep at least two letters or numbers
  after screening folds it (tatweel and Arabic diacritics are removed before
  matching). A term such as `ــ` would otherwise match any punctuation and
  hold every message; drafts with one are refused and a published one is
  ignored at runtime and listed under ignored instructions.

### Trainer

- **Website inquiry notification**: every inquiry creates an in-app
  notification for the workspace owner ("New website inquiry", link
  `/trainer/website`, template key `website-inquiry`). Email and device alerts
  follow the new preference "Website inquiry alerts by email and device"
  (owners only) and are capped at 10 per workspace per rolling hour; beyond
  that the inbox still receives each one. No inquiry content is placed in the
  alert. A delayed alert is dropped if the inquiry was handled first. The
  route's own abuse limits (4 per hour per address, honeypot, consent) are
  unchanged.
- **Inquiry inbox**: each inquiry shows its source, campaign, medium and
  referral when the visitor allowed optional analytics and the touch was
  captured on this workspace's own pages (its own web address, or its
  `/coach/<slug>` and `/join-coach/<slug>` pages on the shared address).
  A consenting visitor whose tagged visits were only on platform pages or
  another coach's pages shows "no tagged visit to your own website pages";
  campaign names and referral codes from elsewhere never reach the trainer.
- **Analytics**: a "Website inquiries and leads" section (owner only) with
  monthly inquiries, handled and attributed counts, and 90-day lead sources
  with how many leads later joined; leads without an own-page touch are one
  "Other platform pages" row. Finance users get no lead card: they cannot read
  inquiry records, so the card would have shown "no inquiries" beside a lead
  table. The analytics endpoint previously failed under the restricted tenant
  role (its cohort query read `users`); cohorts are now built from a scoped
  registry read plus tenant subscription state.
- **Attention list**: safety and policy-review exceptions show "Review due
  by …" or "Overdue", the governing policy version, and matched review topics
  (new component `apps/web/components/safety-review-due.tsx`). The deadline
  comes from `GET /api/v1/safety/review-deadlines`, computed by the same SQL
  as the escalation pass, so a stricter policy published later shows the
  earlier deadline ("a stricter safety policy now applies"). A personal
  review that collected follow-up questions lists them (latest 10).
- **Safety deadlines**: an open safety hold past its deadline (floor 24 h, or
  shorter by policy) or a policy personal review past its deadline (floor
  72 h) is marked overdue once, logged (`safety.review_overdue`) and re-sent to
  the owner and staff as a critical alert (`safety-review-overdue`). A later,
  stricter policy also shortens deadlines of already-open items; nothing ever
  lengthens one. The worker pass selects only rows that are already due, in
  SQL, ordered safety holds first and then by effective deadline (50 per pass
  per workspace), so any number of open not-yet-due reviews can never hide an
  overdue hold.
- **Message language**: the notification preferences gain English/Arabic.

### Follower (subscriber)

- Messages in chat, support, set notes, pain reports and digital coaching are
  screened by the code floor (`docs/features/safety-floor.md`: since 29 September
  2026 it also reads blood-pressure and blood-sugar readings, pregnancy warning
  signs, joint locking or giving way and eating-disorder behaviours, and the
  exception pins `screening.floorCategories`) plus the published policy's extra red-flag terms;
  a match pauses training exactly like a floor match. The hold and exception
  record the policy key, version, effective time, ignored instructions, the
  review deadline and what triggered it (`code_floor`, `policy_term` or
  `reported`).
- In digital coaching (`POST /api/v1/coaching/ask`), a question in a policy's
  personal-review category (medication, supplements, disordered eating,
  chronic conditions, surgery/injury recovery, possible minor, or custom
  terms) is answered "Your trainer will answer this question personally",
  opens a `policy_review` exception with the pinned policy and a deadline, and
  alerts the coaching team. No model or automatic action runs, and training is
  not paused. Further routed questions from the same member join that open
  review (`followUps`, `questionCount`, merged topics; the first question's
  deadline stays) with no new exception and no new trainer alert, so one
  member cannot create a stream of exceptions or emails. After the trainer
  resolves it, the next routed question opens a new review.
- Notification copy uses the member's language choice when a reviewed
  template exists, then English, then the built-in wording.

## Templates in detail

- Registry: `MESSAGE_KINDS` in `apps/api/src/message-templates.ts` (39 kinds:
  coaching message, booking/workout reminders, session reserved / changed /
  canceled / canceled by coach, paid session confirmed / needs refund, session
  refund confirmed, training safety alert, training paused, training hold
  resumed / ended, safety review overdue, policy review, scheduled follow-up
  delivered / needs review, website inquiry, nutrition review, retention
  review, Brain import/compilation review and 16 lifecycle messages). Every
  sender now passes a key. A kind's `critical` flag is derived from its
  category (`safety` or `account`), the same rule `notifyUser` applies at send
  time, so the preview and "keeps built-in text" label match production.
- Registry test: scans every `notifyUser`, `notifyCoachingTeam` and
  `hooks.notify` call in `apps/api/src` and `apps/worker/src` and fails when a
  call has no `templateKey` (one forwarding call inside `notifyCoachingTeam` is
  allow-listed), when a key is unregistered, when a registered kind has no
  sender, or when a sender's literal category differs from the registry's.
  Checked by mutation: removing the refund key and changing a registry
  category each made it fail.
- Rendering (`renderMessage`): one substitution pass (a value such as
  `{{coach}}` inside a name is never expanded again); titles are single-line
  (control and line-separator characters removed, which also prevents header
  injection); the HTML part escapes the fully substituted text, so every
  template fragment and value is escaped; `{{link}}` is the in-app path in the
  inbox and the absolute URL in email; `{{date}}` is the recipient's local
  date; `{{coach}}` is the workspace name via a scoped helper. Safety and
  account messages keep the built-in text after the template text (unchanged
  behaviour).
- Pin on each notification (`data.template`) and its email job:
  `{kind,key,version,locale,requestedLocale,source}` where `source` is
  `published` or `built_in`.
- Email: `sendEmail(to, subject, text, html?)` sends the HTML part when given;
  the worker passes `job.data.html`, and scrubs `html` with `text` for
  sensitive jobs.
- Device push stays content-free by the existing privacy design (the service
  worker shows a fixed notice and opens the inbox), so templates drive inbox
  and email copy only.

## Routes

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/notification-templates` | admin + fresh MFA | Kinds, variables, published versions per locale |
| `POST /api/v1/admin/notification-templates/preview` | admin + fresh MFA | Render `{key,title,content}` with sample data |
| `GET /api/v1/admin/safety-policy` | admin or safety operator + fresh MFA | Policy in effect, floor, categories, example |
| `POST /api/v1/admin/safety-policy/check` | admin or safety operator + fresh MFA | Validate a policy draft |
| `GET /api/v1/safety/policy` | trainer owner/staff | Policy in effect for the attention list |
| `GET /api/v1/safety/review-deadlines` | trainer owner/staff | Effective deadline per open safety/personal review |
| `POST /api/v1/admin/documents` (changed) | admin | Validates notification keys/variables and the safety policy |
| `POST /api/v1/admin/documents/:id/publish` (changed) | admin | Re-validates before publishing |
| `POST /api/v1/public/sites/:slug/contact` (changed) | public | Notifies owner; records a lead with consent |
| `GET /api/v1/tenant/site/inquiries` (changed) | owner | Adds `attribution` per inquiry |
| `GET /api/v1/analytics/business` (changed) | owner/finance | Adds `leads` (owner only; `null` for finance); cohort query fixed |
| `POST /api/v1/public/acquisition/consent`, `/visit` (changed) | public | Optional `site` (coach slug) scopes a touch to that workspace |
| `GET/PUT /api/v1/notifications/preferences` (changed) | signed in | `inquiries`, `language`; GET adds `options.inquiries` |

## Settings, flags and data

- No new platform flags or provider settings. Email delivery still requires
  the configured email provider; without it, jobs wait as before.
- Preferences (JSON, no schema change): `inquiries` (default true), `language`
  (`en` | `ar`, default `en`), `theme` (`system` | `light` | `dark`, default
  `system`; the member app's appearance, saved alone through
  `PUT /api/v1/preferences/appearance`, docs/features/dark-mode.md).
- Notification input gains `topic: "inquiry"`; `data.topic` is stored and
  re-checked at delivery.
- Events: `safety.escalated` now carries `policyVersion` and `reviewDueAt`;
  new `safety.review_overdue`, `coaching.policy_review_required`,
  `website.inquiry_received`.
- Acquisition: `lead` events use `event_key = lead:<inquiryId>`, the contacted
  workspace as `tenant_id`, no `user_id`, the visitor's first/last touch, and
  `attribution.workspace` holding only the touches captured on that
  workspace's pages. Each stored touch may carry `site` (the workspace id of
  the page that captured it: the host's workspace on a workspace address, or a
  published coach page's workspace on the shared address, resolved by the
  server from the slug the page sends). `site` is not returned to visitors.
  Consent withdrawal, expiry and privacy erasure delete them with the other
  analytics history. `first_paid` evidence includes `booking-charge:%`
  journals.

## Migration 057

- `published_safety_policy()` — `SECURITY DEFINER`, executable only by
  `trainer_app`; returns the effective published `coaching-safety-policy`.
- `notification_workspace_name()` — `SECURITY DEFINER`, executable only by
  `trainer_app`; returns the name of the transaction's own active workspace.
- Partial index `records_open_exceptions` for the escalation pass.
- `scripts/verify-runtime-access.mjs` lists both helpers;
  `infra/runtime-role.sql` comment updated (no grant changes needed).

## Review round 1 fixes (27 September 2026)

An adversarial review of commit `d538e5e` found one major and six minor
issues and two missing requirements; all were fixed:

1. Escalation starvation (major): the pass fetched the 50 oldest open items
   and then filtered in code, so 50+ not-yet-due personal reviews hid an
   overdue hold. Now the effective deadline
   (`EFFECTIVE_DUE_SQL` in `packages/domain/src/safety-policy.ts`) is computed
   and filtered in SQL. Regression test: 60 older personal reviews plus one
   chest-pain hold; before the fix the pass returned 0 at +25 h (confirmed by
   temporarily restoring the old ordering), now 1, then 50 and 10 once the
   reviews fall due.
2. Personal-review flood: follow-up questions join the member's open review
   (see Follower).
3. Senders without template keys: the nine remaining sender calls now pass
   keys (eleven new kinds), and the registry test fails on any new sender
   without one.
4. Tatweel-only policy terms: refused and ignored (see Super admin).
5. Registry `critical` flag: derived from category.
6. Trainer deadline display: effective deadline from the API.
7. Finance lead analytics: lead card is owner-only.
8. Lead attribution on the shared host: scoped to the workspace's own pages.

## Tests actually run (27 September 2026)

Review round 1 (after the fixes above, Node 24):

- `npx tsc --noEmit`: exit 0.
- PGlite, `node --import tsx --test --test-concurrency=2` on
  messaging-templates, messaging-safety-policy, messaging-inquiries,
  messaging-milestones, acquisition, admin-completion, bookings-completion,
  coach-site, coaching-completion, coaching-followups, fix2-safety,
  lifecycle-messages, notifications, push-notifications, support-preview,
  retention, source-review-notifications, privacy-lifecycle: 131 tests, 130
  pass, 0 fail, 1 skipped (a PostgreSQL-only interleaving test).
- PostgreSQL restricted role:
  `/opt/tools/pg-sandbox.sh 56114 "$PWD"` with messaging-templates,
  messaging-safety-policy, messaging-inquiries, messaging-milestones,
  acquisition, admin-completion, bookings-completion, coach-site,
  coaching-completion, coaching-followups, fix2-safety, notifications:
  runtime access verified (46 migrations, 11 helpers); 5+6+1+2+13+7+7+12+8+7+6+9
  = 83 tests pass, 0 fail, `PG_SELECTED_FAILED_FILES=0`, exit 0.
- After `prettier --write` on the changed files (formatting only), PGlite
  re-run of messaging-templates, messaging-safety-policy, messaging-inquiries,
  messaging-milestones, bookings-completion, coaching-completion and
  coaching-followups: 36 tests, 36 pass, 0 fail; `npx tsc --noEmit` exit 0.
  (`apps/api/src/admin-operations.ts` was already not Prettier-clean at the
  base commit and was left unformatted to avoid unrelated churn.)

First round:

New files: `tests/messaging-templates.test.ts` (5 tests),
`tests/messaging-safety-policy.test.ts` (5), `tests/messaging-inquiries.test.ts`
(1 end-to-end), `tests/messaging-milestones.test.ts` (2).

- `node node_modules/typescript/bin/tsc --noEmit -p .` (Node 24): exit 0.
- PGlite: `node --import tsx --test --test-concurrency=1` on the four new files
  plus `tests/notifications.test.ts`: 22 tests, 22 pass, 0 fail.
- PGlite, related existing files after the final changes: admin-completion,
  lifecycle-messages, fix-web, push-notifications, source-review-notifications,
  retention, provider-configuration, fix-coaching, coaching-completion,
  finance-completion, onboarding-completion: 93 tests, 93 pass, 0 fail.
  Earlier in the session (before the last small changes): coach-site,
  acquisition, notifications and others 88 tests with 1 failure that my
  preferences change caused (a client sending back the new `options` field);
  fixed by accepting and ignoring `options`, then re-run green. fix2-safety,
  coaching-runtime, platform, bookings-completion, rate-limits,
  platform-settings (with the above): 114 tests, 113 pass, 0 fail, 1 skipped
  (a PostgreSQL-only race test that skips on PGlite).
- PostgreSQL restricted role: `/opt/tools/pg-sandbox.sh 56114 "$PWD" …` with
  the four new files plus notifications, coach-site and acquisition: runtime
  access verified (11 helpers), `PG_SELECTED_FAILED_FILES=0` (5+5+1+2+9+12+13
  tests, all pass). An earlier sandbox run of notifications, coach-site,
  acquisition, admin-completion, lifecycle-messages, fix-web, fix-coaching,
  coaching-completion, onboarding-completion and finance-completion also
  finished with `PG_SELECTED_FAILED_FILES=0` (fix-web: 1 environment skip).
- Screening review: 18 realistic English/Arabic member messages were screened
  and each outcome checked by hand; three false positives were removed from the
  category lists ("medicine ball", "binge-watched", "كسر الروتين"), two missed
  Arabic possessive forms were added ("دوائي", "أدويتي"), and a minor check no
  longer fires on "I'm 15 minutes late". These cases are now a test.

Not run (by instruction): `npm run build`, the full suite, browsers.

## Left out, and why

- Device push copy is not templated: pushes intentionally carry no content.
- Arabic built-in copy is not invented: unreviewed safety/account translations
  would be a risk. Arabic works as soon as reviewed `--ar` templates are
  published; members fall back to English.
- Nutrition safety exceptions keep their own nutrition policy system; the
  coaching safety policy does not drive them.
- Held-out coaching evaluation and the trainer's automatic-action wording
  check still use only the code floor. Runtime screening is stricter than
  evaluation whenever a policy adds terms or review topics, which is the safe
  direction; aligning evaluation with the policy is a follow-up.
- Overdue reviews are shown in the platform safety queue and re-sent to the
  coaching team; a direct alert to platform operators is left to the
  operator-alerts work package.
- Lead attribution for touches stored before this change (no `site`) on the
  shared address is not shown to trainers; only workspace-address consents
  and new page-scoped touches are. This branch was never deployed, so no
  production data is affected.
- UI was checked by type and by reading, not in a browser (no cloud browser;
  screenshots waived). New CSS uses logical properties only inline.
