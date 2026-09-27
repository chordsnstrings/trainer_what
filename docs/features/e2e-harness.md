# Mock provider sandbox and full-stack end-to-end harness

Status: in progress (plan written before implementation; results are added below as they are observed).

## Plan

1. **Sandbox guard** (`packages/providers/src/sandbox.ts`). A single decision function reads
   `TRAINER_PROVIDER_SANDBOX`. It is honoured only when the value is exactly `mock`, `PUBLIC_APP_URL`
   is a loopback URL and the API listens on a loopback address. API and worker startup call
   `assertProviderSandboxBinding()`, which refuses to start when the variable is set in any other
   situation, or when a sandbox-only endpoint override is set without an honoured sandbox.
2. **Endpoint overrides honoured only inside the sandbox**: Stripe SDK host/port/protocol
   (`STRIPE_API_BASE_URL`), the Stripe account check, the WHOOP API/OAuth base
   (`WHOOP_API_BASE_URL`) and Open Food Facts (`FOOD_LOOKUP_BASE_URL`). Provider URL validation and
   `providerRequest` accept `https://` loopback endpoints (never plain HTTP) only in the sandbox, so
   the admin settings API can point the model, email, Lean, Zepp and voice URLs at the mocks. Push
   subscription endpoints on loopback are accepted only in the sandbox.
3. **Visible state**: `/api/v1/ready` reports `providerSandbox: "mock"`; the admin settings response
   carries the same flag and a new `ProviderSandboxBanner` component shows a loud banner in the
   Superadmin settings/overview screens.
4. **Mocks** under `tests/e2e/mocks/` (Node `https`, no new dependencies): stateful Stripe (only the
   endpoints the code calls) with a correctly signed webhook sender; Lean; email API with an inbox;
   OpenAI-compatible model API with scripted queue, rule-based responder and capture/replay JSONL;
   web push capture; WHOOP and Zepp OAuth/data; ElevenLabs TTS; registrar API; Open Food Facts.
5. **TLS**: a throwaway CA and loopback leaf certificate per run (openssl), exported to the app with
   `NODE_EXTRA_CA_CERTS` so the app runs with `NODE_ENV=production` and HTTPS provider URLs.
6. **Runner** `scripts/e2e/run.mjs`: throwaway PostgreSQL cluster shaped like CI (migration owner +
   restricted runtime role), migrations, `infra/runtime-role.sql`, `verify-runtime-access.mjs`, web
   build when missing, API/web/worker in production mode on loopback, Superadmin through
   `npm run admin:bootstrap`, provider configuration through the Superadmin settings API, seeding
   through the real APIs, scenario suites, JSON report `tests/e2e/report.json` (gitignored), teardown.
7. **Scenarios** `tests/e2e/scenarios/*.e2e.ts` (outside the `tests/*.test.ts` glob), one per
   audience, each step mapped to a feature name from the verified inventory.
8. **Docs** `docs/E2E_MOCK_PROVIDERS.md` and this file; focused fast tests
   `tests/e2e-harness-*.test.ts` for the guard, overrides and mock behaviour.
