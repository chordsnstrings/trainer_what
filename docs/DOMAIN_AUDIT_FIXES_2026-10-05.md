# Domain and subdomain audit fixes — 5 October 2026

Owner authorized fixing all audit findings. Branch: `fix/web-address-audit-2026-10-05`. No deployment, paid transaction, registrar operation or production DNS change was performed. Production remains the previously verified `f114d16` release.

| Finding | Implemented behavior |
| --- | --- |
| Renewal race / lost provider response | Persist a renewal intent before Stripe, serialize through the existing order lease, reuse its idempotency key and confirm by retrieving the subscription. Opposite requests wait. UI shows the last confirmed setting and pending state. Long failures surface to operators. |
| Unverified domain blocking | Unverified requests no longer reserve names across workspaces. Seven-day challenges expire. Verification acquires exclusive ownership; conflicting verified ownership requires support. Existing approved registration records remain protected. |
| Closure leaves domain billing | Closure checks domain subscriptions, pending purchases/renewals and cancellation intents. Owners can end billing while keeping the paid registration. Worker cancels subscriptions left on legacy closed workspaces. Trainer-owned manual connections release their claim on closure. |
| Manual existing-domain setup | Trainer proves TXT ownership, then connects A records or an approved CNAME. Optional www pairing redirects to the submitted hostname. DNS/TLS and existing active mappings are checked; disconnect includes the pair. Existing operator activation remains available. |
| Misleading Live state | Publication alone is not Live. Post-mapping checks require valid HTTPS, successful response, correct coach identity and expected redirects. Requests pin the platform IP and bypass process proxies. Premature live notices are withheld. |
| DNS / HTTPS drift | Worker checks published subdomains and connected domains hourly. A/AAAA, HTTPS and site identity failures appear in settings. DigitalOcean-hosted purchased domains also verify nameserver delegation. Evidence older than two hours is not Live. |
| Suspended-site TLS mismatch | Published suspended sites can obtain certificates to serve their suspension notice. Closed/unpublished subdomains remain denied. |
| Certificate capacity | Added an opt-in, reversible host upgrade to a wildcard certificate, with a pinned DigitalOcean Caddy module and restricted secret file. Independent custom domains retain the signed certificate allowlist. See deployment boundary below. |
| Payment recovery | Order-scoped Stripe payment-method portal and outstanding-invoice links; confirmation before ending billing. Ended subscriptions have an explicit support route because Stripe cannot reactivate a cancelled subscription. |
| Renewal price increases | Eligible USD cost increases generate an exact-price offer and notice before the next charge. Approval changes the annual price without proration or resetting its billing date. Unaccepted offers switch renewal off three days before charging. No automatic price increase. Already paid renewals are honored; legacy AED contracts and changes too late for notice retain the agreed price and operator cost alert. |
| Settings UX | Capability-gated forms, initial/read retry, visible polling errors, copyable TXT records, A/CNAME guidance, setup deadlines and confirmations. Authenticator wording follows enforcement. |
| Slug aftercare | Confirmation explains yearly limits, 90-day redirects, eventual reuse and sign-in/app-install implications. |

Migration: `084_domain_audit.sql`. It adds reservation expiry and replaces unverified-name uniqueness; purchase quotes and financial history stay immutable. API changes are additive. Tests use invented tenants and provider doubles.

## Verification

Final counts and commit are recorded in `CLAUDE_HANDOFF.md`. Focused checks cover concurrency, unknown outcomes, closure and old-closure cleanup, ownership collisions, A/www activation, stale/failed health, wrong-site/502 HTTPS, billing isolation, exact price approval and missed approval deadlines. Production web build and root TypeScript are required. Deployment unit tests cover the optional wildcard configuration and secret handling.

Local browser verification was blocked by a corrupt/empty browser download; PostgreSQL, Docker and Caddy binaries are absent locally. Added CI gates run the browser journey, restricted PostgreSQL suite, custom Caddy module build and existing application/container checks. These are not claimed passed before their results exist.

## Deployment boundary

Merge only after review and qualification, under the existing owner release authority. Application fixes do not turn on purchases, payments or domain operations. Real Stripe/registrar/CA qualification remains separate.

Wildcard TLS needs one explicit host upgrade after the qualified application release. Run `python3 infra/digitalocean/wildcard_tls.py` from that release as the host administrator. It prompts without echo for a DigitalOcean DNS-only token covering the platform zone, builds the pinned image, validates the Caddy configuration, retains credentials in root-only `edge-dns.env`, reapplies the release and verifies a wildcard SAN. Failure restores the prior edge configuration. Existing deploy/rollback code honors `EDGE_WILDCARD_TLS`; it is off by default. No real token or wildcard certificate was obtained in this implementation turn.

Provider references used: Stripe subscription updates and customer portal API; Caddy custom-build documentation and the DigitalOcean DNS module. Pinned module: `v0.0.0-20250606074528-04bde2867106`.
