# Web addresses: automatic subdomains and autonomous domain purchase

Branch `core/web-addresses`, based on `b9ec7c1`. Migration `066_web_addresses`. Nothing here was
deployed, no live DNS or server was changed, no domain was bought and no real Stripe request was
made. All evidence below is local. One honest exception is recorded under "Checks actually run":
while a test was being written, a handful of requests reached Namecheap's **test environment**
(`api.sandbox.namecheap.com`) with fictitious credentials and were refused there.

## Plan (written before implementation)

Owner requirement: every trainer gets a web address automatically, and can instead buy their own
domain, paid yearly, set up and renewed without an operator. Platform domain: `trainsyou.com`
(bought, DNS not set up). Preferred registrar: Namecheap.

Constraints read from the code first:

- Host routing (`host-routing.ts`) already serves custom domains through a signed proxy proof and a
  `custom: true` host context; sessions are host-only cookies and `enforceHostTenant` refuses a
  session of another workspace or a platform operator. Subdomains reuse exactly that context, so
  every existing custom-host rule (signup refused, public-slug check, webhooks refused, origin
  gate, OAuth relay) applies unchanged.
- The web proxy (`apps/web/proxy.ts`) already treats every non-platform host as a coach host and
  asks `GET /api/v1/public/host`; it needs no new routing, only a redirect for a renamed slug.
- The TLS ask endpoint answers from an in-memory set of permitted names; subdomains of published,
  active workspaces join that set (no query per random name).
- `infra/digitalocean/host.py` runs on the live server; `edge_config(endpoint, revision, ask)` must
  keep its output byte-for-byte when the new root setting is unset. The root has to be known to the
  edge, so it is a `runtime.env` setting (`PLATFORM_ROOT_DOMAIN`), passed to the containers through
  `compose.yaml` (an environment entry only: no new service or mount, so the currently deployed
  controller accepts the file).
- `domain_orders` (migration 017) holds the manual flow; its operator routes stay the manual
  fallback. Automatic orders are rows of the same table with `mode='automatic'`, extra state
  columns and statuses, so the operator sees one list.
- Namecheap's API has no idempotency key. The stable intent is ours: every registrar call is
  preceded by an immutable `registrar_operations` row (`intent_key` unique). A database trigger
  refuses a new purchase or renewal attempt while an earlier attempt of the same order is still
  `sent` or `unknown`; only a reconciliation (`domains.getInfo`/`getList`) resolves it.
- Stripe collects. The trainer is the Stripe customer of a yearly subscription (Checkout,
  `price_data` in AED). The member-subscription webhook path must never see these events, so a
  dedicated handler runs first and recognises them by metadata `purpose=web_address` and by
  `provider_objects` kinds. Journals use their own accounts (`web_address_receivable`,
  `web_address_revenue`, `registrar_cost`, `registrar_prepaid`), never `trainer_payable`,
  `stripe_receivable` or commission, so month close, settlement and payouts are unaffected.
- Renewal must be charged before expiry: after the first registration the subscription's next
  billing date is moved to 30 days before the domain expires (`trial_end` with
  `proration_behavior=none`, Stripe's documented way to move a billing date). Each paid renewal
  invoice renews the domain for one year, which keeps the 30-day lead.

Steps:

1. Subdomains: `PLATFORM_ROOT_DOMAIN`, reserved names at signup and slug change, slug change with a
   90-day redirect (`tenant_slug_redirects`), subdomain host routing, TLS ask, Caddyfile wildcard
   block with on-demand TLS (only when the root is set and on-demand TLS is on), Python tests.
2. Registrar adapters (`packages/providers/src/registrar.ts`): a small XML reader, the Namecheap
   adapter (check, getPricing, create, getInfo, getList, dns.setHosts, dns.getHosts, renew,
   getBalances) and the generic JSON adapter behind one interface; Super admin settings with a
   read-only connection check (`users.getBalances`).
3. Orders: search with price (registrar price × fixed USD→AED rate, rounded up, plus the yearly
   margin), Stripe Checkout, webhook handler, worker state machine (purchase → reconcile →
   hosts → DNS → TLS → mapping), renewal, grace notices, lapse, renewal off, refund on a
   definitive purchase failure, ledger, notifications, operator view and actions.
4. Web: trainer panel (address, slug change, search, buy, live progress, renewal switch), operator
   panel, proxy redirect for renamed subdomains, old `/coach/<slug>` redirect.
5. Tests: Namecheap XML mock and recorded response shapes, order flow with the mock through the
   fixture transport, Stripe events, subdomain routing, reserved names, TLS ask, isolation, Python
   Caddyfile tests; PGlite, pg-sandbox and the deployment tests.

## Go live: what the owner must do

Nothing below has been done. Deployment stays separately assigned.

1. **DNS for `trainsyou.com`** (at whichever registrar holds it; Namecheap: Domain List → Manage →
   Advanced DNS). With the server's public IPv4 address `<IP>`:

   | Type | Host | Value | TTL |
   | --- | --- | --- | --- |
   | A | `@` | `<IP>` | automatic / 30 min |
   | A | `*` | `<IP>` | automatic / 30 min |

   Remove the registrar's parking records for `@` and `www` (a URL redirect or a `www` CNAME)
   so they do not shadow these. Add AAAA records only if the server gets an IPv6 address. No CAA
   record is needed; if one is added it must allow `letsencrypt.org`.
2. **Runtime settings on the server** (`/opt/gymmembership/runtime.env`, mode 600, via the
   DigitalOcean console): add `PLATFORM_ROOT_DOMAIN=trainsyou.com`. Recommended at the same time:
   move the platform to `PUBLIC_APP_URL=https://trainsyou.com`, following "Changing the
   platform's own address" in `docs/features/infra-ops.md` (passkeys, sessions, Stripe webhook
   endpoint, wearable redirect addresses and `DOMAIN_CNAME_TARGET` change with it). Keeping the
   sslip.io platform address and setting only the root also works. Then request **Re-apply
   runtime settings** on the Host page (or let the next deployment apply it); the Host page
   shows "Pending re-apply" until then. Until the root is set, nothing changes on the live edge.
3. **Namecheap API access** (Profile → Tools → Business & Dev Tools → Namecheap API Access):
   turn API access on (Namecheap only allows it for accounts that meet its eligibility rules,
   such as a minimum balance, domain count or spend; check its current terms), note the API key,
   and add the server's public IPv4 address to the **whitelisted IPs**. Every call from any other
   address is refused. For a rehearsal, create a separate account at
   `sandbox.namecheap.com`, enable its API and whitelist the same address.
4. **Namecheap balance**: purchases and renewals are paid from the Namecheap account balance.
   Keep enough funds for expected registrations plus every renewal due in the next 30 days (the
   connection check warns under USD 20). An empty balance does not lose money: the purchase is
   retried three times, reconciled each time, then waits for an operator.
5. **Registrant decision (required)**: domains are registered with the contact entered in
   settings, with free WHOIS privacy. If that is the platform company, the platform legally owns
   every trainer's domain and must offer transfers on request (not automated here); if trainers
   should own theirs, the flow needs their own contact details and ICANN email verification
   (not built). The owner must decide and confirm the registrant contact before enabling
   purchases.
6. **Super admin → Settings → Web addresses and registrar**: registrar Namecheap; API user,
   API key (stored encrypted), account username, whitelisted client IPv4; keep "Use the Namecheap
   test environment" on for the rehearsal; registrant contact; yearly margin in AED (default 25);
   USD→AED rate (default 3.6725, the AED peg); offered endings (default `com,net,org,co`);
   optionally the server IPv4 for domain DNS. Run **Test connection** (it reads the balance only),
   then switch **Enable automatic purchases and renewals** on and test again: the settings only
   take effect when the row is enabled, approved and tested at the current revision.
7. **Stripe**: nothing new to create. Checkout uses inline yearly AED prices, and the existing
   webhook endpoint already receives the events (`checkout.session.*`, `customer.subscription.*`,
   `invoice.paid`, `invoice.payment_failed`, refunds, disputes). `COMMERCE_APPROVED` must be true.
8. **Rehearse** with the Namecheap test environment and Stripe test mode: buy a test name, watch
   it reach Live, turn renewal off, then switch the Namecheap test environment off only when the
   owner approves live purchases.

## What was built, per audience

### Trainer (owner, with a fresh authenticator for changes)

- **Automatic web address.** Every published workspace is served at `<slug>.<root>`: the coach
  website at `/`, and the member app sign-in and app on the same host, with exactly the
  custom-domain rules (signed host proof, host-only session cookie, sessions of other
  workspaces and platform operators refused, public pages of other workspaces refused, trainer
  signup and provider callbacks refused). `/coach/<slug>` on the platform keeps working.
- **Address change** (`/trainer/domains`): at most three changes in any 365 days, counted from
  the audit events. The previous name keeps redirecting for 90 days (the old subdomain with a
  307 to the new host, `/coach/<old>` and `/join-coach/<old>` with a 307 on the platform) and
  nobody else can take it meanwhile; the workspace may take it back. Reserved names (`www`,
  `app`, `api`, `admin`, `mail`, `smtp`, `ns1`, `billing`, `support`, `stripe`, `trainsyou`, …; the
  full list is `RESERVED_SLUGS` in `packages/domain/src/web-address.ts`), a trailing hyphen and
  a double hyphen (`xn--`) are refused at signup and at a change. Existing workspaces whose slug
  is now reserved keep `/coach/<slug>` and get no subdomain until they change it.
- **Own domain.** Search a name (or a full domain under an offered ending); each result shows
  availability and one yearly price in AED. Premium names are not offered. Choosing one shows
  the price again with an explicit "I agree to pay AED … per year, renewed automatically"; paying
  opens Stripe Checkout (subscription, the trainer is the customer). If the registrar price
  changed since the search, the order is refused with the new price and must be confirmed again.
- **Live progress** on the same page (refreshed every 5 s while in progress): Paid →
  Registered → DNS set up → Security certificate → Live, with the next yearly charge date and
  the registration end date. A step waiting for the platform shows "The platform team is
  checking this step". Notifications (in-app and email, template keys below) when the site is
  live, when the domain renews, when a renewal payment fails, before expiry without a paid
  renewal (14, 7, 3 and 1 days; only the most urgent due one is sent), when it lapses and when a
  purchase fails and is refunded.
- **Renewal switch**: turning renewal off sets the Stripe subscription to end at the period end
  (which is 30 days before the domain expires, so no renewal is charged); the domain keeps
  working until it expires and the site then falls back to the subdomain. It can be turned back
  on while the subscription has not ended.
- A domain the trainer already owns is still connected with the existing manual flow, shown
  below the new panel.

### Followers and visitors

They reach the coach website and member sign-in at the subdomain or the bought domain with a
valid certificate. After a lapse the domain stops resolving to the workspace and the subdomain
keeps working. No follower screen changed.

### Super admin and operators

- **Settings** (above) with a read-only connection check (`users.getBalances`): verified with
  the environment and balance, or a failure naming the credential/whitelist cause.
- **Operator view** (Integration operations page, "Web addresses" panel; route
  `GET /api/v1/admin/web-addresses`, fresh authenticator): every automatic order of every
  workspace with its status, renewal and billing state, expiry, the last ten registrar calls
  (intent key, status, USD cost) and a red flag for anything needing attention or a registrar
  attempt awaiting reconciliation; sorted with those first.
- **Manual fallbacks**, each with a recorded reason (10 to 500 characters) and an audit event:
  *Reconcile now* (runs the order's next step immediately; for an open purchase that is the
  getList reconciliation), *Retry step* (clears the attention flag and the retry budget; a new
  attempt always gets a new intent key), *Refund and close* (only for a paid order whose domain
  was not registered, refused while a registrar attempt is unreconciled). The manual domain
  routes (quote, ownership evidence, activation, renewal evidence) keep working for manual
  orders only; automatic orders never appear in or match them.

## How it works

### Subdomain routing and TLS

- `PLATFORM_ROOT_DOMAIN` (runtime.env → `compose.yaml` → API, worker, web). A plain DNS name of
  two or more labels; anything else, or unset, turns subdomains off. An sslip.io name such as
  `gymmembership.<ip>.sslip.io` is valid: every name under it resolves to that address.
- `resolveRequestHost` (API): a host `<label>.<root>` with one label selects a published
  workspace (active or suspended, as for domains) by slug; a previous slug inside its redirect
  window answers 421 `HOST_MOVED` with `location`; anything else 421. Reserved labels never
  select a workspace. Custom domains cannot be requested under the root.
- `apps/web/proxy.ts` needed no new routing; it follows a `HOST_MOVED` answer only to an https
  origin that is itself a single-label subdomain of the web container's `PLATFORM_ROOT_DOMAIN`.
- TLS ask (`host-operations.ts`): the in-memory permitted set also holds `<slug>.<root>` for
  published, active workspaces, previous slugs during their redirect, and `www.<root>` when
  the platform itself is served at the root. The set is keyed by the root and re-read at least
  every 30 s, as before; random names still cost at most one reload per 5 s.
- Caddyfile (`infra/digitalocean/host.py`): `edge_config(endpoint, revision, ask, root)`; with
  a root and on-demand TLS it adds one site between the platform block and the catch-all:

  ```
  *.trainsyou.com {
      tls {
          on_demand
      }
      @www host www.trainsyou.com            # only when the platform is https://trainsyou.com
      redir @www https://trainsyou.com{uri} 308
      <same encode / release header / reverse_proxy as the other blocks>
  }
  ```

  Without a root (the live server today), or with on-demand TLS off, the output is byte-for-byte
  unchanged. `edge_root()` ignores an invalid value with a console message instead of failing a
  deployment. `hostops.edge_state` compares the served file with what the controller would now
  render, so adding the root shows "Pending re-apply"; it also works with a controller that has
  no `edge_root`.
- Certificates are per name (verified locally with Caddy 2.11.4 and its internal CA: a
  `*.<root>` on-demand site issued a certificate whose only name was the requested
  `layla.trainsyou.test`, logged no wildcard issuance, and refused an unapproved name in the
  handshake). Let's Encrypt allows 50 new certificates per registered domain per week; more new
  published trainers than that per week would need a wildcard certificate through DNS
  validation (a Caddy DNS module and registrar DNS credentials on the server), not built.

### Order state machine (automatic orders in `domain_orders`)

`checkout` → `paid` (first invoice paid, amount and currency equal to the quote) → `purchasing`
(register intent recorded, then `domains.create`) → `owned` (registered; the expiry is read with
`domains.getInfo`) → `dns` (complete host set written with `domains.dns.setHosts` and read back
with `domains.dns.getHosts`) → `active` (A of the domain and `www` resolve to the server,
15-minute issuance allowances created, an HTTPS request to both names succeeds, mappings
activated) → `expired` (lapse). Also `cancelled` (checkout expired or cancelled) and `failed`
(refunded). A database trigger allows only these transitions, keeps identity, quote and billing
links immutable and forbids deleting automatic orders; a renewal paid late provisions again
(`expired` → `dns`).

- **Stable intent and reconciliation.** Before each registrar purchase, renewal or DNS write the
  worker inserts a `registrar_operations` row (`register:<order>:<n>`, `renew:<order>:<invoice>`
  and `…:<n>` for further attempts, `hosts:<order>:<n>`); intent keys are unique and never
  reused. Outcomes: `succeeded`, `failed` (the registrar refused), `unknown` (no usable answer),
  then `confirmed`/`absent` after reconciliation. A trigger refuses a new purchase or renewal
  attempt of the same order while one is `sent`, `failed` or `unknown`, and seals finished rows.
  A purchase that is not a confirmed success is reconciled with `domains.getList`: listed →
  confirmed, registration completes, no second purchase; not listed → absent, then
  `domains.check`: taken or premium → the order fails and is refunded; still available → retry
  with backoff, at most three attempts, then operator attention. A renewal is reconciled with
  `domains.getInfo`: an expiry more than a day past the one recorded with the attempt confirms
  it; otherwise it is retried (five attempts, then attention). DNS writes replace the whole set,
  so they are simply sent again.
- **Billing date.** After registration the worker moves the subscription's next charge to 30
  days before expiry (`trial_end` with `proration_behavior=none`, idempotency key
  `web-address-align:<order>:<anchor>`). Each paid renewal invoice renews for one year, which
  keeps the 30-day lead.
- **Price.** `yearlyPriceMinor`: the higher of Namecheap's one-year registration and renewal
  price (each including the ICANN fee Namecheap adds), times the configured rate, rounded up to
  whole dirhams, plus the margin; the same price every year. With the test double's prices a `.com`
  is USD 16.06 → AED 59 + 25 = AED 84. Registrar prices are cached per ending for an hour for
  search; an order always takes a fresh quote. A later registrar price increase is absorbed at
  renewal (the registrar cost journal shows it); changing a running subscription's price is not
  built.
- **Lapse.** At expiry without a paid renewal: `expired`, both mappings inactive (the subdomain
  keeps serving), the trainer is notified with the subdomain address, and the Stripe
  subscription is cancelled (`web-address-cancel:<order>`). The old manual expiry sweep now
  handles manual orders only.
- **Refund.** A definitive purchase failure first looks for an earlier refund of the first
  payment (`refunds.list`), then creates one with the key `web-address-refund:<order>`, cancels
  the subscription and notifies the trainer. A refund whose outcome is unknown sets attention.

### Stripe events and ledger

`processWebAddressStripeEvent` runs first in `processStripeEvent` and handles every event whose
object carries metadata `purpose=web_address` (Checkout session, subscription, invoice through
`parent.subscription_details.metadata`) or whose Stripe ids are recorded in `provider_objects`
with a `web_address_*` kind and no user. The member-subscription path never sees them (tested:
no `subscriptions` row appears). Journals (immutable, idempotent by source key, in the trainer's
workspace):

| Source key | Lines |
| --- | --- |
| `web-address-invoice:<invoice>` | `web_address_receivable` +amount, `web_address_revenue` −amount |
| `web-address-refund:<refund>` | `web_address_revenue` +amount, `web_address_receivable` −amount |
| `web-address-registrar:<operation>` | `registrar_cost` +AED, `registrar_prepaid` −AED (USD × rate, rounded up; `estimated` when the registrar did not report a charge) |

None of them touches `trainer_payable`, `stripe_receivable` or commission, so month close,
settlement, statements' payable bridge and payouts are unaffected; the trainer's statement adds
`webAddresses: {paymentsMinor, refundsMinor, registrarCostMinor}`. Reconciling these receipts
with Stripe payouts to the company bank is outside the per-workspace settlement flow (a
platform-level reconciliation, not built).

### Registrar adapters (`packages/providers/src/registrar.ts`)

One `Registrar` interface: `check`, `pricing`, `register`, `list`, `info`, `setHosts`,
`getHosts`, `renew`, `balance`. `RegistrarError.outcome` is `definitive` (the registrar
answered with an error) or `unknown` (network, timeout, non-200, unreadable body).

- **Namecheap** (XML over HTTPS POST, so the key stays out of request lines): `domains.check`,
  `users.getPricing` (`YourPrice` plus Namecheap's misspelled `YourAdditonalCost`),
  `domains.create` (the same contact for Registrant, Tech, Admin and AuxBilling;
  `AddFreeWhoisguard=yes`, `WGEnabled=yes`; Namecheap's own DNS so `setHosts` applies),
  `domains.getList`, `domains.getInfo`, `domains.dns.setHosts` (every record numbered in one
  call: Namecheap replaces all records), `domains.dns.getHosts`, `domains.renew`,
  `users.getBalances`. `api.sandbox.namecheap.com` unless "test environment" is explicitly off.
  A small XML reader refuses DOCTYPE/entity declarations.
- **Generic JSON registrar** (bearer `DOMAIN_API_KEY` at `DOMAIN_API_URL`, from the Custom
  domains settings): `GET v1/domains/check?domain=`, `GET v1/pricing/<tld>` → `{currency:"USD",
  register, renew}`, `POST v1/domains` `{domain, years, registrant, privacy:true}` (409 =
  unavailable), `GET v1/domains?search=`, `GET v1/domains/<domain>`, `PUT`/`GET
  v1/domains/<domain>/records`, `POST v1/domains/<domain>/renew` `{years}`, `GET v1/account` →
  `{balanceUsd}`. The e2e registrar double implements it.

### Notification templates (registered in `message-templates.ts`)

`web-address-live`, `web-address-renewed`, `web-address-renewal-failed`,
`web-address-renewal-reminder`, `web-address-lapsed`, `web-address-refunded` (trainer, account
category, so the built-in text is always kept).

## Routes

| Method and path | Who | Purpose |
| --- | --- | --- |
| `GET /api/v1/web-address` | Owner | Subdomain, slug, change allowance, redirects, purchase availability, automatic orders |
| `POST /api/v1/web-address/slug` | Owner, fresh MFA | `{slug, currentSlug}`; 400 `RESERVED_SLUG`/`INVALID_SLUG`, 409 `SLUG_TAKEN`/`SLUG_CHANGED`, 429 `SLUG_CHANGE_LIMIT` |
| `GET /api/v1/public/slug-redirect/:slug` | Platform web | The current slug of a previous one during its redirect; 404 otherwise and on coach hosts |
| `GET /api/v1/web-address/search?q=` | Owner | Availability and yearly AED price; 20/min |
| `POST /api/v1/web-address/orders` | Owner, fresh MFA | `{domain, priceMinor, accepted:true}` → `{orderId, url}`; 409 `PRICE_CHANGED` (with `priceMinor`), `DOMAIN_UNAVAILABLE`, `DOMAIN_IN_USE`; 429 more than 3 open checkouts |
| `POST /api/v1/web-address/orders/:id/checkout` | Owner | Returns to the same open Checkout (idempotent replay) |
| `GET /api/v1/web-address/orders/:id` | Owner | Progress |
| `POST /api/v1/web-address/orders/:id/cancel` | Owner | Unpaid checkout only; expires the Stripe session |
| `POST /api/v1/web-address/orders/:id/renewal` | Owner, fresh MFA | `{enabled}` → Stripe `cancel_at_period_end` |
| `GET /api/v1/admin/web-addresses` | Super admin, fresh MFA | Operator view |
| `POST /api/v1/admin/web-addresses/:id/{reconcile,retry,refund}` | Super admin, fresh MFA | `{reason}`; manual fallbacks |

## Migration 066 (`packages/db/migrations/066_web_addresses.sql`)

- `domain_orders`: `mode` (`manual` default), registrar, Stripe links, billing and renewal
  state, attention, attempts, `next_attempt_at`, lease, trainer-visible `progress`, notice
  ledger, `live_at`; the status check now depends on the mode; the one-open-order-per-hostname
  index also frees `failed` orders; the guard trigger above. Only columns with defaults are
  added, so the previous release keeps working between migrate and restart.
- `registrar_operations`: tenant-scoped (RLS forced, owner-only restrictive policy, like
  `domain_orders`); `SELECT, INSERT, UPDATE` for `trainer_app`; the guard trigger above.
- `tenant_slug_redirects`: service-only, RLS forced with the workspace binding policy of
  migration 061, revoked from `trainer_app`; `SELECT, INSERT, UPDATE` for `trainer_service`
  (`infra/runtime-role.sql`). `scripts/verify-runtime-access.mjs` classifies both tables
  (scoped / system, bound, unreadable by the tenant role).

## Files

- **New:** `packages/db/migrations/066_web_addresses.sql`, `packages/domain/src/web-address.ts`,
  `packages/providers/src/registrar.ts`, `apps/api/src/web-addresses.ts`,
  `apps/api/src/web-address-orders.ts`, `apps/web/components/web-address.tsx`,
  `apps/web/app/web-address.css`, `tests/e2e/mocks/namecheap.ts`,
  `tests/web-address-registrar.test.ts`, `tests/web-address-subdomains.test.ts`,
  `tests/web-address-orders.test.ts`, `tests/web-address-stripe.test.ts`,
  `tests/web-address-web.test.ts`, `tests/test_web_address_deployment.py`, this document.
- **Changed:** `apps/api/src/app.ts` (reserved-slug check at signup, registration, `location`
  and `priceMinor` in two error answers, a test seam for the web address doubles),
  `host-routing.ts` (subdomain branch, `platformRoot`, `coachHostTenant`),
  `host-operations.ts` (TLS ask set), `integrations-completion.ts` (manual-only filters, domain
  names under the root refused, OAuth relay accepts subdomains), `stripe-events.ts` (handler
  first), `finance-statements.ts`, `message-templates.ts`, `privacy-hooks.ts` (a failed order is
  no provider blocker), `apps/worker/src/index.ts` (a 30-second background task),
  `packages/db/src/scope.ts` (usedBy), `packages/providers/src/{configuration,index,sandbox}.ts`,
  `apps/web/proxy.ts`, `apps/web/host-proxy.ts`, `apps/web/app/[[...path]]/page.tsx`,
  `apps/web/app/layout.tsx`, `apps/web/components/{integration-center.tsx,discovery-server.ts}`,
  `infra/digitalocean/{host.py,hostops.py}`, `infra/runtime-role.sql`, `compose.yaml`,
  `scripts/verify-runtime-access.mjs`, `tests/e2e/mocks/{http.ts,registrar.ts,stripe.ts}`,
  `docs/E2E_MOCK_PROVIDERS.md`. `workspace.tsx` is unchanged.

## Checks actually run (local, 28 September 2026, in this worktree)

- `npx tsc --noEmit`: exit 0 after the last code change. `npx prettier --check` clean for the
  new files and for `configuration.ts` and `discovery-server.ts`; `app.ts` and
  `packages/providers/src/index.ts` were already not Prettier-clean at the base and were left
  unformatted to keep the diff small.
- New tests on PGlite: `web-address-registrar` 7, `web-address-subdomains` 6,
  `web-address-orders` 9, `web-address-stripe` 1 (real Stripe SDK against the Stripe double over
  TLS, signed webhooks through the application's webhook route), `web-address-web` 5: 28 passed.
- Final combined PGlite run of the new files with `isolation-elevation`, `logical-css`,
  `messaging-templates`, `host-routing`, `integrations-completion`, `infra-ops-tls`,
  `infra-ops-api`, `e2e-harness-mocks`, `e2e-harness-sandbox`, `platform-settings`,
  `provider-configuration`, `fix-ledger`, `finance-completion`: 142 tests, 142 passed, 0 failed,
  0 skipped.
- Earlier in the stage (before the last fixes, which touched only `web-address-orders.ts`,
  `web-address.tsx` and the new tests), three batches of related existing files passed:
  101 + 164 + 120 = 385 tests (settings, configuration, integrations, host routing, infra-ops,
  harness mocks and sandbox, finance, checkout, ledger, payouts, web, RTL, accounts, OIDC,
  acquisition, discovery, HealthKit, nutrition, privacy, infrastructure, rate limits and edge
  deployment files). The full `npm test` suite was not run.
- `/opt/tools/pg-sandbox.sh 56141 <worktree>` (PostgreSQL 16, restricted `trainer_service`):
  `{"runtimeAccess":"verified","migrations":55,"systemTables":53,"scopedTables":38,"helpers":40,"serviceLookups":2,"workspaceBoundServiceTables":18,"tenantScopeFixed":true}`,
  then 12 files (`web-address-orders`, `-subdomains`, `-stripe`, `-registrar`, `host-routing`,
  `integrations-completion`, `infra-ops-tls`, `infra-ops-api`, `messaging-templates`,
  `fix-ledger`, `finance-completion`, `isolation-elevation`): 94 tests passed, 0 failed,
  `PG_SELECTED_FAILED_FILES=0`.
- `python3 -m unittest discover -s tests -p 'test_*deployment.py'`: 114 tests OK with 2 skips
  (Caddy validation without a Caddy binary). With `CADDY_BIN` set to a Caddy v2.11.4 binary: 114
  OK, no skips (the wildcard, root-platform and bootstrap Caddyfiles validated).
- Manual, not committed: Caddy 2.11.4 with `local_certs`, `skip_install_trust`, a `*.<root>`
  on-demand site and a local ask server: the approved name was served with a certificate whose
  only SAN was that name, no wildcard certificate was requested, and an unapproved name was
  refused in the TLS handshake. Scratch files were removed.
- **Unintended requests to Namecheap's test environment.** While `web-address-orders` was being
  written, its first two runs (and one debugging script) wrapped `app.inject` in the fixture
  transport, whose async context does not reach the Fastify route handlers. About six requests
  therefore went to `https://api.sandbox.namecheap.com/xml.response` with the fictitious user
  `trainsyou` and key `nc-fixture-key-…`; Namecheap answered "API Key is invalid or API access
  has not been enabled". No account, credential or purchase was involved. The adapters now take
  an explicit test transport (refused outside the Node test runner) and every test that goes
  through the application uses it; the committed tests make no network request.
- Not run: `next build`, the e2e harness, the browser and 390 px checks, the full test suite,
  anything on Docker, the live server or real DNS.

## Left out, and why

- **E2E scenario.** The Namecheap double is not started by `scripts/e2e/run.mjs` and no
  harness scenario was added: the harness needs a production web build, which this task did not
  allow, and an unrun scenario would be unverified. The double is covered by unit tests through
  its fetch entry point.
- **390 px and browser check.** The panel uses wrapping flex rows, `min-inline-size: 0` and
  `overflow-wrap` with logical properties only (the RTL lint passes), but it was not rendered in
  a browser at 390 px.
- **Registrant per trainer, transfers out, auth codes.** Not built; depends on the owner's
  registrant decision.
- **Wildcard certificate via DNS validation** for more than about 50 new subdomains a week (see
  above).
- **Price changes of a running subscription.** A higher registrar renewal price is absorbed
  and recorded; re-pricing the trainer's subscription with notice is not built.
- **Operator list cost.** The operator view and the worker visit workspaces one scoped
  transaction each (as other worker tasks do); for thousands of workspaces a cross-workspace
  index of due orders would be needed.
- **Refund of a mismatched first payment** (an amount that does not match the quote) is
  flagged for the operator, who refunds in Stripe; the automatic refund covers definitive
  purchase failures only.
- **Platform-level reconciliation** of web address receipts with Stripe payouts, and closing a
  workspace with an active domain (the registrar is listed as a provider blocker as before;
  cancelling its subscription at closure is not automated).
