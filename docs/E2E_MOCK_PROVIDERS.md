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

Options: `--suites=super-admin,trainer,follower,public-join`, `--keep` (leave the stack up),
`--pg-port=N`, `--rebuild`/`--skip-build`, `--features=<inventory.json>` (checks feature names and
adds per-audience coverage), `--report=<file>`, and the model options below.

Requirements: Node 24, PostgreSQL 16+ server binaries (`initdb`, `pg_ctl`), `openssl`, the
installed dependencies. A full run takes about six minutes (343–357 s measured) plus a web build
when one is needed, mostly authenticator waits (each fresh code needs a new 30-second window). The
Superadmin sets the worker cycle to one second through the reviewed worker-speed operation.

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

The sandbox announces itself: `/api/v1/ready` returns `providerSandbox: "mock"` with a notice,
`/api/v1/bootstrap` and `/api/v1/admin/settings` carry `providerSandbox`, every workspace screen
(including the Superadmin screens) shows a red "Mock providers" banner, the API and worker log a
warning at startup and `npm run readiness` reports a finding.

## Mock providers (`tests/e2e/mocks/`)

| Mock | Covers |
| --- | --- |
| `stripe.ts` | account, products, prices, coupons, Checkout sessions (create/list/retrieve/expire), subscriptions retrieve/update, invoices list, invoice payments list, payment intents, refunds create/list, billing portal configuration/session, idempotency keys; signed webhooks for checkout completion/expiry, subscription created/updated/deleted, invoice paid/failed, refund created, charge refunded and disputes; helpers for renewals, failed payments, disputes and portal plan changes |
| `lean.ts` | payment destinations and payments with idempotency keys |
| `email.ts` | the Bearer JSON send contract; an inbox with `waitFor` and link extraction |
| `model.ts` | OpenAI-compatible `/v1/models` and `/v1/chat/completions` with JSON output and token usage |
| `push.ts` | web push endpoint; verifies the VAPID ES256 JWT and records that no payload was sent |
| `wearables.ts` | WHOOP v2 OAuth, token refresh, paginated recovery/sleep/workout pages and revocation; Zepp partner OAuth with PKCE, canonical observations and revocation |
| `voice.ts` | ElevenLabs text-to-speech returning a short silent MP3 |
| `registrar.ts` | domain availability/price, registration and DNS record calls (the app records registrar work as operator evidence; it does not call a registrar API itself) |
| `food.ts` | Open Food Facts v2 product lookups, including not-found |

## Model answers: queue, rules, capture and replay

Answers come from, in order: a scripted queue (`mocks.model.enqueue(...)` in a scenario), a replay
file of reviewed answers, then the rule-based responder (`model-rules.ts`) unless
`--model-fallback=fail`. The rule-based responder produces schema-valid JSON for every prompt kind
the app sends (Brain decisions, rule compilation, coach action selection, nutrition evaluation,
weekly plans, recipe drafts, policy compilation and meal-photo estimates) from the supplied
evidence only. It proves the pipeline, not coaching quality.

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
   was withheld by validation, and the recorded cost.

`tests/e2e/reviewed/model-answers.jsonl` holds the reviewer's answers for the digital-coach squat
question and the meal-photo estimate (`npm run e2e -- --model-replay=tests/e2e/reviewed/model-answers.jsonl`).
Seeded content and the order of compiled rules are deterministic, so every model request that the
rule responder or a replay file answers hashes identically from run to run (85 of 86 distinct
requests matched between two runs; the one difference is a scripted guardrail request with a random
case ID, answered from the queue). If a later change alters a prompt, the replay falls back to the
rule responder and the report's `model.bySource` shows fewer `replay` answers.

## Test clock

Two holds cannot be waited out in a run, so the harness moves specific timestamps in the throwaway
database with the migration superuser and records each move under `clockShifts` in the report:
the 72-hour bank-change hold after an operator verifies a payout destination, and (for the month
close) one workspace's journals and model-usage timestamps 40 days back so the previous month has
ended with its seven-day refund buffer. Amounts and every other record are untouched; all other
data is created through the API.

## Unit tests

`tests/e2e-harness-sandbox.test.ts` (guard, overrides, readiness flag, banner) and
`tests/e2e-harness-mocks.test.ts` (real Stripe SDK against the mock over TLS with verifiable
webhooks, email/Lean/push adapters, capture/replay across runs) run in the normal `npm test`, as do
the regression tests for defects the harness found (`tests/e2e-harness-booking-refund.test.ts`,
`tests/e2e-harness-member-dates.test.ts`, `tests/e2e-harness-payout-precondition.test.ts`; see
`docs/features/e2e-harness.md`). The member-dates test needs PostgreSQL with the restricted runtime
role (`/opt/tools/pg-sandbox.sh`) to prove the column grant; PGlite does not enforce column grants.

## Suite order

Platform setup, trainer seed and follower seed run first. Then the follower suite runs before the
trainer suite (trainers review what members produced: exceptions from digital coaching, consented
nutrition captures), then public-join, then the Super admin suite (month close and payout on
`sara-mobility`, whose members paid full price; `omar-conditioning` members are in a free trial, so
its payout preparation is expected to be refused with 409).
