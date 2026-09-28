# End-to-end harness with mock providers

`npm run e2e` (or `node scripts/e2e/run.mjs`) runs the whole platform locally in production mode
against test doubles of every external provider, seeds it through the public API and runs scenario
suites for the Super admin, trainers, followers and public visitors. It never contacts a real
provider, never uses a cloud resource and must never run on a server.

## What a run does

1. Creates a throwaway CA and a loopback certificate (`openssl`), trusted by the app only through
   `NODE_EXTRA_CA_CERTS`.
2. Creates a throwaway PostgreSQL cluster (`initdb`; as `postgres` via `runuser` when run as root)
   shaped like CI: superuser `trainer_migrations` owns the database, the restricted
   `trainer_service` role is provisioned with `infra/runtime-role.sql` through
   `scripts/prepare-ci-postgres.mjs` and checked with `scripts/verify-runtime-access.mjs`.
3. Builds the web app when `apps/web/.next` is missing or older than the web/contracts/domain
   sources (`--rebuild` forces, `--skip-build` never builds).
4. Starts the HTTPS mock providers, then API, web (`next start`) and worker with
   `NODE_ENV=production`, the runtime role, a random `SECURITY_ENCRYPTION_KEY` and
   `INTERNAL_PROXY_SECRET`, and `PUBLIC_APP_URL=https://localhost:<port>`. A small TLS edge in the
   runner stands in for Caddy (it sets `X-Forwarded-For`; the harness gives each simulated person
   their own address so production rate budgets apply per person).
5. Creates the first Superadmin with `scripts/bootstrap-admin.ts` (`npm run admin:bootstrap`, a
   mode-600 password file), signs in, enrols an authenticator, publishes the three legal documents
   and saves every provider through `PUT /api/v1/admin/settings/:id` (secrets encrypted), tests each
   connection and turns on the approval flags.
6. Seeds through the real API only: three trainers (email verification from the mock inbox,
   authenticator, onboarding, brand, Brain sources → model compilation → confirmed rules → 20
   held-out scenarios → evaluation → release, program templates, offers in both tiers published to
   the Stripe mock, a promotion code and a free trial, UAE IBAN to the Lean mock, operator review,
   website and galleries, trainer voice, qualified automatic coaching and nutrition qualification
   for the first trainer, preview review and storefront launch), then twenty followers by
   invitation or public self-join who verify email, complete intake and pay through mock Stripe
   Checkout with signed webhooks.
7. Runs the suites (`tests/e2e/scenarios/*.e2e.ts`, outside the `tests/*.test.ts` glob) and writes
   `tests/e2e/report.json` (gitignored). Service logs, the model capture file and a copy of the
   report go to `tests/e2e/artifacts/<run>/` (gitignored). Everything is torn down.
8. `node scripts/e2e/coverage-table.mjs <report.json> [<second report.json> ...] --out=FILE` turns
   one or more reports (run with `--features=<inventory>`) into the per-feature results table, with
   one column per run and a flakiness section listing every step whose status differs between runs.
   It exits 1 when a step failed or a provider-dependent feature has neither a scenario nor a stated
   local limit (`LOCAL_LIMITS` in `tests/e2e/harness/report.ts`).

Options: `--suites=super-admin,trainer,follower,public-join,completion,browser,core,extended`, `--keep` (leave the stack up),
`--pg-port=N`, `--rebuild`/`--skip-build`, `--features=<inventory.json>` (checks feature names and
adds per-audience coverage), `--report=<file>`, `--min-steps=N`, and the model options below
(`--model-capture`, `--model-replay`, `--model-fallback`, `--model-outcomes`).
A run of every suite fails when fewer than `FULL_RUN_MIN_STEPS` (in `scripts/e2e/run.mjs`) steps
passed or failed, so a broken setup cannot shorten the run and still report success; setup that
later steps need goes through `reporter.prepare()` (a failure is a failed step) and a missing
prerequisite through `reporter.blocked()`/`missingPrerequisite()` (a skipped or failed step). Pass a
lower `--min-steps` when a suite is knowingly skipped (for example no local Chromium).

Requirements: Node 24, PostgreSQL 16+ server binaries (`initdb`, `pg_ctl`), `openssl`, the
installed dependencies; `python3` for the host-controller cycle; optionally a local Chromium under
`PLAYWRIGHT_BROWSERS_PATH` for the browser suite; the loopback address `127.77.0.1:443` for the
coach-domain edge. A full run takes about twelve minutes (693 s and 698 s measured for 430 steps on 28
September; 536 s and 542 s for the 399 steps before the core suite) plus a
web build when one is needed, mostly authenticator waits (each fresh code needs a new 30-second
window) and worker deliveries the suites wait for. The Superadmin sets the worker cycle to one second
through the reviewed worker-speed operation. A person's session that proved an authenticator code in
the last eight minutes is reused for step-up actions, as a person would, because the server allows
eight code verifications per person every ten minutes; a rate-limited code request is retried with a
new code after the advertised wait.

## Safety guard

The sandbox is switched on by `TRAINER_PROVIDER_SANDBOX=mock` and is honoured only when
`PUBLIC_APP_URL` is a loopback URL (`localhost`, `127.0.0.1`, `::1`) **and** the API listens on a
loopback address (`API_HOST`, default `127.0.0.1`). API and worker startup call
`assertProviderSandboxBinding()` (`packages/providers/src/sandbox.ts`) and refuse to start when the
variable is set in any other situation, or when a sandbox-only override is set without it. A real
deployment has a public HTTPS address, so it cannot run in the sandbox.

Inside the sandbox only:

- Provider URLs saved in the Superadmin settings may be `https://` loopback addresses (plain HTTP
  and private non-loopback addresses stay refused). Outside the sandbox the existing public-HTTPS
  rules are unchanged.
- `STRIPE_API_BASE_URL` points the Stripe SDK (host, port, protocol) and the account check at the
  mock; `WHOOP_API_BASE_URL` replaces the fixed WHOOP host; `FOOD_LOOKUP_BASE_URL` replaces Open
  Food Facts. These are environment-only; the settings store cannot hold them.
- Push subscription endpoints on loopback are accepted.
- `GOOGLE_OIDC_ISSUER` and `APPLE_OIDC_ISSUER` (HTTPS loopback) replace the Google and Apple
  OpenID Connect issuers for "Sign in with Google/Apple"; the discovery document, keys, token
  endpoint and accepted `iss` all come from the double.
- `DOMAIN_DNS_SERVER=127.0.0.1:<port>` sends the custom-domain ownership (TXT) and target (CNAME)
  lookups and the platform-address check to a loopback DNS double, and lets the activation's HTTPS
  check connect to a name that double resolves to a loopback address (only loopback answers from
  that resolver are accepted; everything else keeps the public-address rules).

The sandbox announces itself: `/api/v1/ready` returns `providerSandbox: "mock"` with a notice,
`/api/v1/bootstrap` and `/api/v1/admin/settings` carry `providerSandbox`, every workspace screen
(including the Superadmin screens) shows a red "Mock providers" banner, the API and worker log a
warning at startup and `npm run readiness` reports a finding.

## Mock providers (`tests/e2e/mocks/`)

| Mock | Covers |
| --- | --- |
| `stripe.ts` | account, products, prices, coupons, Checkout sessions (create/list/retrieve/expire; inline yearly `price_data`), subscriptions retrieve/update (including `trial_end` to move the billing date)/cancel, invoices list, invoice payments list, payment intents, refunds create/list/retrieve, billing portal configuration/session, idempotency keys; coupons limited to products and redemption limits enforced at checkout; signed webhooks for checkout completion/expiry, subscription created/updated/deleted, invoice paid/failed, refund created, charge refunded (no embedded refunds list from API version 2022-11-15, as Stripe sends it; `chargeEventObject(charge, "2022-08-01")` gives the older shape) and disputes; `autoWebhooks = false` loses webhooks and `loseNextResponse()` applies a request but answers HTTP 500 with `Stripe-Should-Retry: false`, for the reconcile routes; helpers for renewals, failed payments, disputes and portal plan changes |
| `lean.ts` | payment destinations and payments with idempotency keys |
| `email.ts` | the Bearer JSON send contract; an inbox with `waitFor` and link extraction |
| `model.ts` | OpenAI-compatible `/v1/models` and `/v1/chat/completions` with JSON output and token usage |
| `push.ts` | web push endpoint; verifies the VAPID ES256 JWT and records that no payload was sent |
| `wearables.ts` | WHOOP v2 OAuth, token refresh, paginated recovery/sleep/workout pages and revocation; Zepp partner OAuth with PKCE, canonical observations and revocation |
| `voice.ts` | ElevenLabs text-to-speech returning a short silent MP3 |
| `registrar.ts` | domain availability/price, registration and DNS record calls, used as operator evidence by the manual domain flow; also the generic registrar JSON contract of the web address flow (USD pricing, lookup, search, record read-back, renewal, account balance) |
| `namecheap.ts` | Namecheap XML API commands of the web address flow (`users.getBalances`, `domains.check`, `users.getPricing`, `domains.create`, `domains.getInfo`, `domains.getList`, `domains.dns.setHosts`, `domains.dns.getHosts`, `domains.renew`, and the nameserver commands `domains.dns.getList`, `domains.dns.setCustom`, `domains.dns.setDefault`; host records are refused while custom nameservers are set) with credential and whitelisted-IP checks, `loseNextResponse()` (applied, answered 504), `refuseNext()`, `earlyAccess` (an `EapFee` per name) and `unlisted` (names `domains.getList` does not show yet); `onNameservers` publishes a delegation to the DNS double. Serves HTTPS or a fetch function for unit tests. Started by the runner: `NAMECHEAP_API_BASE_URL` (sandbox-only) points the adapter at it and the Superadmin saves the `web_addresses` settings (Namecheap, test environment on, a platform-company registrant, purchases enabled). The client and target IPv4 in those settings are public-looking values the settings require; nothing connects to them |
| `digitalocean.ts` | DigitalOcean DNS API (`/v2/domains` list, create, read, delete; `/v2/domains/{zone}/records` with pagination, create, PATCH/PUT, delete) with bearer tokens, `{id, message}` error bodies, 422 for a name another account holds (`foreign`), CNAME-sharing refusals, `failNext()` (optionally applied first) and a 429 with Retry-After; `onZone` publishes a zone's A/AAAA/TXT/CNAME records to the DNS double. Started by the runner: `DIGITALOCEAN_API_BASE_URL` (sandbox-only) points the adapter at it and the Superadmin saves the `dns_hosting` settings (DigitalOcean, platform root zone, TTL 300), so a bought domain gets its zone there and is delegated to it through the Namecheap double; it then resolves to the sandbox target address, which no edge serves, so Live (HTTPS) stays pending |
| `oneohone.ts` | 101domain REST API in its `{status, code, message, data, errors}` envelope: single and bulk availability (`invalid` list), ending prices with registration requirements, domain list and details, the finance balance and orders, nameservers (200 when unchanged, 202 while `registryDelayReads` lasts), DNS records (only on 101domain nameservers), and the announced registration and renewal endpoints (with `processing` orders); unit tests only |
| `food.ts` | Open Food Facts v2 product lookups, including not-found |
| `oidc.ts` | Google (RS256, query response) and Apple (ES256, form_post response, ES256 client-secret JWT) OpenID Connect issuers: discovery, keys, an authorization endpoint that signs in the person the scenario chose, and a token endpoint that checks client credentials, the redirect address, PKCE and single use of codes |
| `dns.ts` | UDP DNS double (A, AAAA, NS, DS, TXT, CNAME, CNAME chasing for A, NXDOMAIN); the registrar double publishes the records an operator saves there, the DigitalOcean double a bought domain's zone and the Namecheap double its delegation |
| `s3.ts` | S3-compatible object storage for off-server backup copies; checks Signature Version 4 and the payload hash, answers HEAD with the stored size |

## Coach domains, host controller and browser

- **Coach-domain edge.** Besides `https://localhost:<port>`, the runner's TLS edge listens on
  `127.77.0.1:443` (the address the DNS double gives coach domains). Like Caddy's on-demand TLS it
  calls the API's internal `GET /api/v1/internal/tls/ask` (with the derived token) before it
  presents a certificate for any other name, and refuses the handshake otherwise; the certificate
  for the planned coach names is issued by the run's throwaway CA. Harness clients for a coach
  domain connect to that address with the coach's name as TLS server name and Host. If the address
  cannot be bound, the domain steps are recorded as skipped with the reason.
- **Web process.** `next start --hostname localhost`: Next normalises 127.0.0.1 to localhost in
  `request.nextUrl` but not in its own base URL, so with 127.0.0.1 a coach-domain rewrite in
  `proxy.ts` is proxied as an external URL (500). Production listens on 0.0.0.0, which Next does
  not rewrite.
- **Host controller.** `ctx.hostControllerCycle()` runs `tests/e2e/harness/host_controller.py`:
  one cycle of the real controller code (`infra/digitalocean/hostops.py`: signed request
  verification, allowlisted actions, encrypted backups with an off-server copy, restore check into
  a scratch database, signed host report) with only the host primitives simulated (`docker compose
  exec database ...` becomes the local PostgreSQL client tools against the throwaway cluster as the
  migration administrator, containers are reported healthy, deploy state lives in a temporary
  directory that is removed at the end). Python trusts only the run's CA for the S3 double.
- **Browser suite.** `tests/e2e/scenarios/browser.e2e.ts` drives the locally installed headless
  Chromium (Playwright, `PLAYWRIGHT_BROWSERS_PATH`; never a cloud browser) with sessions from real
  sign-ins. The throwaway leaf certificate is trusted by SPKI pin
  (`--ignore-certificate-errors-spki-list`), so the service worker registers. It checks the
  Superadmin settings page, the Brain workspace and the Today screen, offline set logging with an
  offline reload, and an offline food-diary entry that syncs after reconnecting, each with a 390 px
  horizontal-overflow check. Without a local Chromium the steps are recorded as skipped.

## Model answers: queue, rules, capture and replay

Answers come from, in order: a scripted queue (`mocks.model.enqueue(...)` in a scenario), a replay
file of reviewed answers, then the rule-based responder (`model-rules.ts`) unless
`--model-fallback=fail`. The rule-based responder produces schema-valid JSON for every prompt kind
the app sends (Brain decisions, rule compilation, coach action selection, nutrition evaluation,
weekly plans, recipe drafts, policy compilation, meal-photo estimates, and the Trainer Brain's
`plan_generation` and `plan_adaptation` prompts from `docs/features/brain-plans.md`) from the
supplied evidence only. It proves the pipeline, not coaching quality.

Capture: every model request is appended to `tests/e2e/artifacts/<run>/model-capture.jsonl` (or
`--model-capture=FILE`) with its prompt kind, task, the canonical request and the answer given.
Record IDs, datetimes and dates are replaced by numbered placeholders such as `{{uuid:3}}`; object
keys and arrays are put in a canonical order first, so the same content produces the same `hash`
in a later run even though IDs and database ordering change.

Review workflow:

1. Run once; open the capture file and read each request.
2. Write reviewed answers to a JSONL file, one object per line: `{"hash": "<hash from the capture>",
   "response": { ...the JSON the model should return, using the same placeholders... }, "note":
   "why"}`.
3. Run again with `--model-replay=reviewed.jsonl` (add `--model-fallback=fail` to be sure every
   model call was reviewed). The mock maps placeholders back to the new run's IDs.
4. Judge the app's final output in the report and the API responses: what reached the client, what
   was withheld by validation, and the recorded cost. `--model-outcomes=FILE` gathers that evidence
   per model call (`tests/e2e/harness/model-outcomes.ts`), read back before teardown: the call
   (hash, kind, answer source, this run's value behind each placeholder), its usage row (linked by
   the provider request id the double returns), the harness step running at the time, the API
   request that was open when the model was called with the answer the person got, the next API
   answers, and the events, records and side-table rows (meal captures, voice style suggestions,
   recipes, foods) the workspace wrote until its next model call (two minutes at most), plus the
   request's input records by placeholder. It assigns no verdict; rows are their final state at the
   end of the run, so a later review or erasure shows through. With the option on, the harness
   client keeps every API exchange in memory (answers truncated to 4000 characters). Every step
   carries `startedAt` and the report lists `phases` with their start and end.

`tests/e2e/reviewed/model-answers.jsonl` holds the reviewer's answers for the digital-coach squat
question and the meal-photo estimate (`npm run e2e -- --model-replay=tests/e2e/reviewed/model-answers.jsonl`).
Seeded content and the order of compiled rules are deterministic, so every model request that the
rule responder or a replay file answers hashes identically from run to run (85 of 86 distinct
requests matched between two runs before the core suite, and 102 of 103 on 28 September with it; the
one difference each time is a scripted guardrail request with a random case ID, answered from the
queue). A run now lasts longer than the Brain plan scheduler's 10-minute interval, so its second
pass visits the seeded workspaces during the extended suite and prepares first plans for seeded
members who have an intake and no programme (four on 28 September; supervised, so they wait in the
trainer's queue). Those requests are identical in both runs, but their number depends on timing.
The rule responder starts each plan exercise at the `startingLoads` reference the prompt carries. If a later change alters a prompt, the replay falls back to the
rule responder and the report's `model.bySource` shows fewer `replay` answers.

## Automatic subdomains

The runner sets `PLATFORM_ROOT_DOMAIN=coaches.sandbox-platform.example` for API, worker and web, so
every published workspace is also served at `<slug>.coaches.sandbox-platform.example`. The throwaway
CA issues the edge certificate for `layla-strength.<root>` and for `no-such-coach.<root>` (so a
refusal of the second comes from the API's TLS ask, not from a missing certificate).

## Test clock

Two holds cannot be waited out in a run, so the harness moves specific timestamps in the throwaway
database with the migration superuser and records each move under `clockShifts` in the report:
the 72-hour bank-change hold after an operator verifies a payout destination, (for the month
close) one workspace's journals and model-usage timestamps 40 days back so the previous month has
ended with its seven-day refund buffer, and (for attendance) one booked class two days back so it has
finished. Amounts and every other record are untouched; all other data is created through the API.

Scheduler ticks (`ctx.schedulerTick`, also listed under `clockShifts`): the Trainer Brain plan
scheduler visits a workspace at most every 10 minutes, longer than the part of a run that needs it,
so the core suite inserts the `brain_plan` job that pass would queue (the same intent key and data:
an intake's first plan, and a programme's next-week adaptation) and the real worker claims and runs
it. If the scheduler already queued the same intent, nothing is inserted and the tick says so.

## Host commands, passkeys and other harness helpers

- Host-only operator scripts run as an operator would on the server, with the API's environment:
  `scripts/operator.ts` (roles and `reset-mfa`), `scripts/reset-mfa.ts` (member authenticator
  reset), `scripts/readiness.ts` and `scripts/reseal-secrets.ts`. Their output is asserted, never
  logged.
- `tests/e2e/harness/webauthn.ts` is a software platform authenticator (ES256, "none" attestation,
  user verification) that produces the same JSON a browser returns, so passkey registration and
  sign-in go through the real `@simplewebauthn/server` checks.
- Each simulated person has a client with its own cookies and client address; `device()` gives the
  same person a second device that shares the authenticator counter.

## Unit tests

`tests/e2e-harness-sandbox.test.ts` (guard, overrides, readiness flag, banner) and
`tests/e2e-harness-mocks.test.ts` (real Stripe SDK against the mock over TLS with verifiable
webhooks, email/Lean/push adapters, capture/replay across runs, report coverage, the software
passkey against `@simplewebauthn/server`, the DNS double against Node's resolver, the Google and
Apple doubles against the app's OIDC client, the S3 double against a Signature Version 4 client) run in the normal `npm test`, as do the regression tests
for defects the harness found (`tests/e2e-harness-booking-refund.test.ts`,
`tests/e2e-harness-booking-dispute.test.ts`,
`tests/e2e-harness-member-dates.test.ts`, `tests/e2e-harness-payout-precondition.test.ts`,
`tests/e2e-harness-takeover-notice.test.ts`; see `docs/features/e2e-harness.md`). The member-dates test needs PostgreSQL with the restricted runtime
role (`/opt/tools/pg-sandbox.sh`) to prove the column grant; PGlite does not enforce column grants.

## Suite order

Platform setup, trainer seed and follower seed run first. Then the follower suite runs before the
trainer suite (trainers review what members produced: exceptions from digital coaching, consented
nutrition captures), then public-join, then the Super admin suite (month close and payout on
`sara-mobility`, whose members paid full price; `omar-conditioning` members are in a free trial, so
its payout preparation is expected to be refused with 409; the custom domain of `layla-strength` is
verified, activated and visited), then the completion suite (`member-completion.e2e.ts`: invitation
emails and list, join alerts, complimentary access, training access right after joining, name and
email changes, operator recovery, leaving and removal, Google and Apple sign-in, crawler files,
directory, leads, conversion milestones, analytics expiry, HealthKit sync;
`operator-completion.e2e.ts`: executive metrics, suspension and reinstatement, account lock and
unlock, operator alerts, backups and restore check, host actions, platform address check), then the
browser suite, then the core suite (`core-features.e2e.ts`, below), then the extended suite
(`tests/e2e/scenarios/extended.e2e.ts` and `extended-accounts.e2e.ts`). The completion suite creates
its own new followers for anything that ends a membership or changes an account, so the seeded
members keep their state.

The core suite covers the September 2026 core features on `layla-strength`, with members it creates
itself: the marketing site (key pages with one H1, canonical link and JSON-LD, a retired doorway page
redirecting, sitemap and robots, `llms.txt` and `llms-full.txt`, the follower calculator's model from
`/api/v1/public/platform`, no registrar named anywhere public); web addresses (the automatic
subdomain through the coach-domain edge, a reserved slug refused, a subdomain nobody has refused in
the TLS handshake, domain search at AED 84 a year for a `.com`, purchase through Stripe Checkout, the
worker registering it for the platform company with WHOIS privacy, creating its zone with A records
for the domain and www at the DigitalOcean double and then delegating it there through the Namecheap
double (added 28 September 2026 in stage 2026-09-28h; not yet run in the harness), the forwarding
switch, the yearly renewal paid at the Stripe double and renewed once at the registrar, the
operator view; no trainer response names the registrar, the DNS host or its cost); Trainer Brain plans (equipment
tags for every library and template exercise, plans below the 0.8 threshold in the review queue
before qualification, approve / edit / reject and the members' views, confidence raised by similar
reviewed plans, the threshold set between the two observed scores, held-out qualification with four
deliverable, two safety-floor and one low-confidence scenario, automatic delivery on regenerate and
from the worker's intake job, a low-confidence plan still routed to the trainer after qualification,
a knee-surgery limitation routed by the safety floor); the programme (an upfront 28-day offer with a
voice add-on price, bought in Checkout payment mode, Today at Day 1 of 28 before and after the plan,
the voice add-on added and later set to end); a weekly adaptation (the member completes week 1, the
worker proposes week-2 changes, which go to the trainer because no adaptation scenarios were held
out, and approval rewrites week 2); and the voice-led session (Brain wording suggestions, a script
prepared ahead from a week-2 session with its audio made by the worker, spoken replies through the
speech-to-text double, and a spoken pain report stopping the session and opening a training hold).
The Brain is left in supervised mode at the end. The domain's Live step (DNS visible, HTTPS) is not
reached locally, because the target address the settings require is public and the name is never
published to the DNS double.

The extended suite changes state on purpose, so it runs last: it erases one unpaid member, closes the
`yasmin-pilates` workspace after an ownership transfer, grants and revokes an operator role, resets
two authenticators, changes the Superadmin's password twice, publishes documents and templates,
disconnects and reconnects the voice provider, and finally re-seals every stored secret with a new
encryption key (after that step the still-running API holds the retired key, which is why it is the
last step before teardown).
