# Coach sign-up and the setup wizard (backend)

Owner decisions of 30 September 2026. Branch `r4/signup-backend` (round 4). The web wizard is built
separately on top of these endpoints.

## Open self-serve sign-up

- "Start coaching" → email + six-digit code (or the existing email/password form) → the wizard.
  Google and Apple come later.
- `GET /api/v1/public/signup-options` → `{registrationOpen, methods: {emailCode, password, google,
  apple}, earlyAccess}`. The early-access form is shown only while `registrationOpen` is false.
- `POST /api/v1/auth/signup/code {email}` sends a code through Resend. Codes are off
  (`503 EMAIL_CODES_OFF`) until a Resend key is saved in Super admin (settings "Resend email":
  `RESEND_API_KEY` encrypted, `RESEND_FROM`). The reply is the same whether or not the address
  already has an account; an existing account gets an email saying so, with no code. Limits: 5 codes
  per address per hour, 15 minutes per code, 5 wrong tries end a code. Only a salted SHA-256 of the
  code is stored (`coach_signup_codes`, migration 078, service role only).
- `POST /api/v1/auth/signup/verify {email, code, name, password?, accepted: true}` → `201
  {ok, next: "/trainer/setup"}` and a session. The address starts verified. Without a password the
  account gets an unusable one (as for Apple/Google accounts) and can add one later
  (`/account/password/set`). The workspace gets a free starting subdomain from the name.
- `POST /api/v1/auth/register` keeps working; `slug` is now optional (a free one is reserved from the
  name when it is left out).
- Both paths stay behind the existing registration gate: on a strict deployment sign-up returns
  `503 LEGAL_PENDING` until the owner sets legal approval, and the registration consent needs the
  published legal documents. Nothing here bypasses it. Sign-up is refused on a coach's own host.
- When Resend is saved, every account email (links, invitations, alerts) also goes through Resend
  (`emailTransport()` in `packages/providers`); otherwise the generic transactional email settings
  are used as before.

## The wizard: `GET /api/v1/setup`

Six steps (`SETUP_STEPS` in `packages/contracts/src/coach-setup.ts`), about 15 minutes:
`account`, `about`, `page`, `brain`, `plan`, `live`. Each step has `status` `done | in_progress |
not_started | skipped | waiting` (`waiting`: only `live`, when every coach check passes and something
waits on trainsyou). The response also has `progress {done,total,percent,minutesLeft}`,
`resumeStep`, and per-step detail:

- `about.values`: prefilled from saved answers, then the workspace name, then the person's own
  early-access request (specialty, emirate, Instagram; only once the email is verified).
  `about.specialties` lists the offered specialties only (hidden ones stay hidden).
- `page`: `brandReady`, `approved`, `approvalVersion`, `digest` (what the public sees),
  `issues` (contact details or medical claims), `subdomain {name, host, confirmed, version, live}`.
- `brain`: `minimum {quiz: 8, own: 3}`, `quizAnswered`, `ownCases`, `enoughCases`,
  `confirmedRules`, `checked`, `mode: "waits_for_me"`.
- `plan`: `priced`, `plans`.
- `goLive`: `checks[] {key,label,owner:"coach"|"trainsyou",ok,reason}`, `ready`,
  `waitingOnTrainsyou` (labels for the one "Waiting on trainsyou" line).
- `security`: `authenticatorRequired`, `authenticatorEnrolled`, `hasPassword`, `verifiedRecently`
  (the go-live screen asks for the authenticator itself; see below).
- `grow`: voice clone, your one-on-one sessions (`one_on_one`, done once the coach confirmed a
  session style; `docs/features/voice-session.md`), nutrition, own domain, bank details ("asked at
  your first payout"), qualification badge (optional).

## Saving: `PUT /api/v1/setup/:step`

Body `{version, values, skip}` (optimistic `version`; `409 STALE_ONBOARDING` when stale).

- `about`: `values` per `setupAboutSchema` (name, specialty, audience, emirate, instagram,
  programmeUrl, programmeSourceId); partial answers save. A hidden or unknown specialty is refused.
  The name becomes the workspace name while the page is not live.
- `page`: approve the page with `{version: page.approvalVersion, values: {digest: page.digest}}`
  (`409 PREVIEW_CHANGED` if the public page changed meanwhile), or `{skip: true}` with the step's
  own `version`.
- `brain`, `plan`: `{skip: true}` skips for later, `{skip: false}` takes it back up. Teaching and plans
  are saved through the existing Brain and product endpoints.

Skipping never passes a go-live check.

## Subdomain

- `GET /api/v1/setup/subdomain/check?name=` → `{name, host, available, current, reason:
  format|hyphen|reserved|taken|null, message, suggestions[]}` (existing slug rules and reserved
  names; another workspace's redirect counts as taken).
- `PUT /api/v1/setup/subdomain {name, currentSlug, version}` reserves it now. Before launch this
  needs no authenticator and leaves no redirect (nothing was public). Once live it returns
  `409 USE_WEB_ADDRESS`: renames go through `POST /api/v1/web-address/slug`, which keeps the old
  address redirecting.
- The subdomain answers once the coach goes live (host routing serves published workspaces only;
  wildcard DNS and on-demand certificates already exist, so nothing in DigitalOcean changes).

## Automatic go-live checks (`POST /api/v1/setup/go-live`, also `/tenant/publish`)

Instead of a staff approval. Coach checks: `real_name` (first and last name, no placeholders),
`email_verified`, `page_ready` (headline, bio, specialty and the approved page), `page_clean` (no
phone numbers, links, email addresses, medical claims or medical advice on the name, brand text,
published website text, galleries or plans; the website's own WhatsApp, Instagram, YouTube and
contact-email fields are allowed), `subdomain` (confirmed), `priced_plan` (a plan with a
price; turned on once payments work), `brain_minimum` (confirmed rules, no open conflicts, enough
cases, a passing evaluation and a published Brain matching the current rules, and a current automatic
qualification if automation is on), plus nutrition when a workout + nutrition plan is published.
trainsyou checks: `legal`, `payments`, `model`. The page goes live in "Waits for me" mode; the
response has `{ok, path, mode: "waits_for_me", url}`.

Removed from launch: bank details and the payout review (asked at the first payout; payouts still
require a verified beneficiary after its hold), "Meet your Brain", "Your address".

The page approval ("preview tick") now covers only what the public sees: name, slug, brand, the
published website, galleries and published plans (name, description, price, billing) and the legal
versions. Private teaching, automation, model settings and unpublished drafts never reset it.

The authenticator is asked in place: a go-live without a recent authenticator check returns
`403 MFA_STEP_UP` with "Enter your authenticator code to go live. If you have none yet, set one up on
this screen." The screen uses `/auth/mfa/verify` or `/auth/mfa/enroll` + `/auth/mfa/confirm` and
retries.

## Brain minimum ("Waits for me")

`brainCaseCoverage()` (contracts): at least 3 cases the coach wrote, plus at least 8 confirmed
practice-quiz answers or 20 cases in total. Quiz answers are held-out scenarios whose `data.origin`
is `"platform_quiz"`; the quiz endpoint (Brain builder) must set it server-side, never from the
client. `POST /brain/evaluate` uses the same rule. "Sends automatically" keeps its own full check in
`coaching-runtime.ts` (20 independent cases and the rest).

Integration (r4/integrate): the practice quiz shipped as rounds (`brain_quiz_round`, see
`brain-teach.md`), not as `platform_quiz` scenarios. The wizard therefore also accepts the quiz
route: a completed quiz round plus 3 own cases passes the `scenarios` step and the "Brain taught"
reason, `brain.quizAnswered` counts answered round questions, `brain.enoughCases` is true on either
route and `brain.quizCompleted` says whether a round is finished. On the quiz route the Brain goes
live in "Waits for me" through `POST /brain/releases/supervised`; `POST /brain/evaluate` keeps the
case rule above.

## Report this coach

- `POST /api/v1/public/coaches/:slug/report {reason, details?, email?}`; reasons `unsafe_advice,
  medical_claims, impersonation, offensive, scam, other`. Published coaches only; at most 3 reports a
  day from one source about one coach are stored (quietly), 5 an hour per client.
- Super admin: `GET /api/v1/admin/coach-reports?status=open|dismissed|actioned|all` (each with
  `suspendPath`, the existing suspension action) and `POST /api/v1/admin/coach-reports/:id/review
  {status: dismissed|actioned, note}` (audited).

## Live model check (Seed 2.0 Pro, 30 September 2026)

No prompt changed. The app's own `held_out_evaluation` call and grading were run live on
`seed-2-0-pro-260328` over the wizard's minimum shape (10 platform safety quiz cases, 8 English and
2 Arabic, plus 3 own routine cases), twice: English quiz 12/16, Arabic quiz 4/4, own cases 6/6,
overall 22/26; neither full 13-case evaluation passed. Every failure is the same: the two
medication/supplement questions ("How much ibuprofen…", "Which creatine dose…") are escalated with a
clean member message, but the trainer-facing `reason` names "medication"/"supplement", which the
evaluation's medical screen flags (the prompt asks to call it "a health question"). A coach whose quiz
includes such a case cannot publish on Seed until either the reason screen or the model's compliance
changes. Cost about USD 0.05. Script: session scratchpad `round4-evals/signup/eval.mts`.
