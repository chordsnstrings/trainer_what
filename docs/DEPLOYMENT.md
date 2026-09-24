# Deployment and operating instructions

## Current evidence

The application builds and passes local integration checks. The supplied containers, PostgreSQL runtime role and DigitalOcean deployment have not been executed here. Chromium was unavailable locally; the GitHub browser smoke passed on the first implementation checkpoint. An expanded production-role PostgreSQL/container job is configured; see BUILD_STATUS for its actual result. Do not treat this document as deployment evidence.

## Local development

1. Install Node 24.19.0+, run `npm ci`, copy `.env.example` to `.env`.
2. Leave `DATABASE_URL` empty for PGlite. Its relative path is resolved from the repository root.
3. Run `npm run seed:demo` if synthetic accounts are wanted, then `npm run dev`.
4. Stop the API before seeding or migrating the same embedded database. A live process owns an exclusive lock; a crashed process's stale PID lock is reclaimed on the next open.
5. With an ordinary PostgreSQL database, set `DATABASE_URL`; the standalone worker can then process queued email. Embedded mode persists jobs but does not deliver them.

## Secrets and configuration

- Supply Stripe, Lean, model and email secrets through the selected deployment's secret mechanism. `.env` and database files are ignored by Git.
- Generate `SECURITY_ENCRYPTION_KEY` as 32 cryptographically random bytes, base64 encoded. Back up this key separately from the database: it encrypts authenticator secrets. Changing it without migration breaks existing authenticators.
- Set the exact `PUBLIC_APP_URL`. Browser mutations are origin-checked. Production requires HTTPS and secure cookies.
- Use `LEGAL_APPROVED`, `COMMERCE_APPROVED`, `PAYOUTS_APPROVED` and `LEAN_CONTRACT_VERIFIED` only after the corresponding reviewed evidence exists. Flags express operator decisions and cannot prove them.
- Model costs are recorded from provider usage and supplied prices. Missing pricing remains unknown, never free.
- A generic transactional email endpoint must accept the configured provider payload. Delivery, domain authentication and provider policy are not verified by setting environment variables.

## PostgreSQL and containers

1. Choose the approved region and infrastructure budget before provisioning. The operator preference remains DigitalOcean; no resources have been purchased.
2. Create a migration administrator connection and a separate runtime login. Apply migrations with `MIGRATION_DATABASE_URL`; do not use that credential in API/worker.
3. Use `infra/runtime-role.sql` as the grants template after migration. Set the runtime password through the database administrator's secret flow. The runtime cannot own tables or bypass RLS and must be permitted to `SET ROLE trainer_app`.
4. Set `DATABASE_URL` to that runtime account. If using Compose's database, its hostname is `database`, port 5432, database `trainer`. Set `POSTGRES_PASSWORD` for initial administrator creation. Do not expose port 5432 publicly.
5. Build `trainer-brain:<release>` with `API_INTERNAL_URL=http://api:4000` for Compose. Next's rewrite target is compiled into the web build. Other topologies need their internal API URL at build time.
6. Run migrations, provision the runtime role, and start API/web/worker. `compose.yaml` encodes health and migration dependencies. Its web port binds to loopback.
7. Put the approved HTTPS reverse proxy in front of port 3000. `infra/Caddyfile.example` is a configuration example; replace its domain and deploy TLS/DNS through the operator's chosen process.
8. Run `npm run readiness`, then `/api/v1/ready`, signup/verification/MFA, tenant isolation, the browser smoke and a staging journey. A `ready` response verifies database reachability, not all provider connections.

## Operator identity

Create the intended account, verify its email and enroll its authenticator. An authorized deploy operator can set `OPERATOR_EMAIL` and `OPERATOR_ROLE` (`admin`, `finance`, `support`, `safety`, `none`), then run `npm run operator:role` using runtime database access. This command is privileged operational access. All production platform actions require recent MFA; production bank changes and publish actions do too.

## Document imports

Local PDF extraction requires `pdftotext` (Poppler); DOCX extraction requires Python 3. These are installed in the container and CI. Only selectable PDF text is supported; scans require a separate approved OCR path. Uploads are bounded, parsed in temporary files with a restricted child environment and removed after extraction. Set `FILE_IMPORTS_APPROVED` in production only after parser isolation and security review. Original binaries are not retained.

## Payments

Register the Stripe signature endpoint at `/api/v1/webhooks/stripe`. Configure its separate signing secret. Receipts are stored before projection; failures retain the receipt and return an error so the provider can retry. Reconciliation of unresolved receipts remains an operator task.

Do not enable Lean execution until the account-specific destination/payment contracts, authentication, source bank, recipient eligibility, callback verification and finality have been proven. Review bank-change ownership, the hold, close, funding and finance authority. Never resubmit an unknown payment. Resolve it from bank/provider evidence; failed/returned instructions retain history and require a new revision.

## Recovery and rollback

Use the database provider's encrypted backups and point-in-time recovery once selected. No recovery-time claim is made. Before pilot, restore a backup into an isolated environment, run migrations/status checks, and reconcile known journal totals and provider receipts. Record measured recovery time and data loss.

Tag each container release. Roll web/API/worker back together to the previous compatible image; migrations are additive and should be rolled forward, not destructively reversed. Restore must preserve unique business intents and immutable journals. Replaying webhooks or jobs must not create new financial effects. Keep runtime and authenticator encryption keys available to the restore environment through the secret mechanism.

## Current troubleshooting

- `PROVIDER_UNAVAILABLE`: inspect the integration's configuration and approval state; no success is fabricated.
- `MFA_STEP_UP`: verify a fresh authenticator code in Account security, then retry within ten minutes.
- `WORKOUT_STATE`: the workout is held/completed; existing matching event retries still return their original outcome.
- `INTENT_CONFLICT`: the same idempotency key was reused with changed data; inspect the existing record.
- Embedded database already open: stop its current process. Use PostgreSQL for concurrent API/worker instances.
- Uncertain refund/payout: retain the original instruction and references. Do not create an unrelated second financial request to bypass its status.
