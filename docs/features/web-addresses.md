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

Deployment stays separately assigned.

1. **DNS for `trainsyou.com`: done 28 Sep 2026.** The zone is on DigitalOcean DNS (project
   GymMembership): A `@`, `www` and `*` to `64.227.151.196`, TTL 1800, no AAAA, no CAA, no DS.
   The registrar (101domain) delegates to `ns1/ns2/ns3.digitalocean.com`. Do not add AAAA records:
   the server has no IPv6 address, and the platform address change refuses to run while any AAAA
   record exists for these names. A CAA record, if ever added, must allow `letsencrypt.org` (and
   `zerossl.com` if Caddy's fallback issuer is kept). A TXT, MX or CAA record at a coach name
   (`<slug>.trainsyou.com`) stops the wildcard A for that name on DigitalOcean, so add an A record
   there too if that ever happens.
2. **Runtime settings on the server**: once a controller with the platform address change
   (migration `068_platform_address_change`) runs, use Super admin → Host and backups →
   **Change the platform address** with `https://trainsyou.com` and root domain
   `trainsyou.com`. The controller checks DNS, writes `PUBLIC_APP_URL` and
   `PLATFORM_ROOT_DOMAIN` into `runtime.env` itself, keeps the sslip.io name as a permanent
   redirect and restores everything automatically if the new address fails (see "Changing the
   platform's own address" in `docs/features/infra-ops.md`; passkeys, sessions, the Stripe
   webhook endpoint, OAuth redirect addresses and `DOMAIN_CNAME_TARGET` change with it). Keeping
   the sslip.io platform address and setting only the root also works through the same form.
   Before that controller runs, the manual route still applies: edit
   `/opt/gymmembership/runtime.env` (mode 600) in the DigitalOcean console and request
   **Re-apply runtime settings**; the Host page shows "Pending re-apply" until then. Until the
   root is set, nothing changes on the live edge.
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
5. **Registrant: the platform company (owner decision, 28 September 2026)**: every domain is
   registered with the platform company's contact entered in settings (organization required),
   always with WHOIS privacy. The platform holds trainers' custom domains as a business moat:
   trainers are never the registrant, and there is no self-service transfer out or authorisation
   code for them. An exceptional request is handled manually by an operator at the registrar.
   See "Owner decision: the platform holds custom domains" below.
6. **Super admin → Settings → Web addresses and registrar**: registrar Namecheap; API user,
   API key (stored encrypted), account username, whitelisted client IPv4; keep "Use the Namecheap
   test environment" on for the rehearsal; registrant contact of the platform company
   (organization required); yearly margin in AED (default 25);
   USD→AED rate (default 3.6725, the AED peg); offered endings (default `com,net,org,co`);
   optionally the server IPv4 for domain DNS. Run **Test connection** (it reads the balance only),
   then switch **Enable automatic purchases and renewals** on and test again: the settings only
   take effect when the row is enabled, approved and tested at the current revision.
7. **Stripe**: nothing new to create. Checkout uses inline yearly AED prices, and the existing
   webhook endpoint already receives the events (`checkout.session.*`, `customer.subscription.*`,
   `invoice.paid`, `invoice.payment_failed`, refunds, disputes). `COMMERCE_APPROVED` must be true.
8. **Rehearse**, then go live. The Stripe mode and the registrar environment must match: with
   live Stripe keys (`sk_live_…`) and the Namecheap test environment on, or test keys with it
   off, the trainer panel hides purchases, `POST /web-address/orders` is refused, a Checkout
   session Stripe creates in the other mode is expired and refused, the worker buys or renews
   nothing for a payment whose `livemode` differs, and the connection check and operator view
   say so. A server with a single live Stripe key therefore cannot rehearse against the
   Namecheap test environment. Either rehearse on a staging copy with Stripe test keys and the
   Namecheap test environment, or rehearse on the live server with live keys, the test
   environment switched off and one cheap real name bought by the owner (then turn its renewal
   off). Switch to live purchases only when the owner approves.
9. **Owner decision still open**: the accounting policy for yearly domain revenue (recognised in
   full when paid, see "Left out"). Decided on 28 September 2026: the registrant is the platform
   company (step 5), and trainers never see the registrar's name or cost.
10. **DNS hosting (stage 2026-09-28h)**: Super admin → Settings → **DNS hosting**: DNS provider
    DigitalOcean DNS, the DigitalOcean API token (stored encrypted; domain create, read, update
    and delete scopes), optionally its expiry date, the platform root zone (`trainsyou.com`) and
    the record TTL (default 1800). **Test connection** lists at most one domain and reports how
    many zones the token reaches; a DigitalOcean token reaches every domain of its team, so keep
    the platform's domains in a dedicated DigitalOcean team (the owner's current team also holds
    other companies' domains; the code never touches them, but a dedicated team removes the
    exposure). Enable and test again. From then on every bought domain gets its zone at
    DigitalOcean and is delegated there; see "DNS hosting, delegation and forwarding" below.
    Credentials live only in these encrypted settings, never in the repository (owner decision,
    28 September 2026).
11. **Platform DNS**: Super admin → Host and backups → **Check and repair platform DNS** (before
    the platform address change) creates or fixes A `@`, `www` and `*` of the platform root zone
    to this server's IPv4 from the verified host controller report; see `infra-ops.md`.
12. **101domain as registrar (optional)**: Settings → Web addresses and registrar → Registrar
    101domain, the API key (created by the account's primary user with two-factor sign-in, at
    most one year valid) and its expiry date. The connection check reads the balance only.
    101domain has not published registration or renewal in its API yet, so purchases stay off
    with 101domain until **101domain registration and renewal API verified** is switched on
    after checking the live API reference (see below); Namecheap remains the buying registrar.

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
  `app`, `api`, `admin`, `mail`, `smtp`, `ns1`, `billing`, `support`, `stripe`, `trainsyou`, and
  the names clients probe on their own under the wildcard A record: `autodiscover`,
  `autoconfig`, `lyncdiscover`, `sip`, `msoid`, `enterpriseenrollment`, `wpad`, `isatap`,
  `mta-sts`, control panels and role mailboxes …; the full list is `RESERVED_SLUGS` in
  `packages/domain/src/web-address.ts`), a trailing hyphen and
  a double hyphen (`xn--`) are refused at signup and at a change. Existing workspaces whose slug
  is now reserved keep `/coach/<slug>` and get no subdomain until they change it.
- **Own domain.** Search a name (or a full domain under an offered ending); each result shows
  availability, the first-year price and the yearly renewal price in AED (the same amount
  today, see "Owner decision"). Premium names and names in an early-access phase
  (Namecheap `EapFee`) are not offered. Choosing one shows
  both prices again with an explicit "I agree to pay AED … now and AED … every year after,
  renewed automatically"; paying opens Stripe Checkout (subscription, the trainer is the
  customer). If the price changed since the search, the order is refused with the new prices and
  must be confirmed again.
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
  on until that date (the date of the yearly charge). After it, the subscription has ended:
  the reminders say so and point to platform support instead of offering the switch. A Stripe
  event older than the trainer's last switch never changes it.
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
  getList/getInfo reconciliation, for a failed renewal the getInfo check. It never takes over
  an order another run is working on: the answer then says so, `ran: false`), *Retry step*
  (clears the attention flag and the retry budgets; a new attempt always gets a new intent key,
  and a renewal first reads the registrar's expiry), *Record registrar state* (records a
  registration or renewal made at Namecheap by hand; the evidence is `domains.getInfo`: the name
  must be in the platform's account, and a renewal must show a later expiry than recorded;
  nothing is bought or renewed), *Cancel subscription* (ends the trainer's yearly Stripe
  subscription; the domain stays until expiry) and *Refund and close* (only for a paid order
  whose domain was not registered, refused while a registrar attempt is unreconciled). The
  operator view also shows a Stripe/registrar mode mismatch. The manual domain
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

With DigitalOcean DNS (migration 070): `owned` → `zone` (zone and A records at the DNS host,
read back through its API) → `delegating` (the registrar was asked to delegate the domain to
`ns1-3.digitalocean.com`) → `dns` (delegation visible in public DNS) → `active`. A late renewal
goes `expired` → `owned` and provisions again. See "DNS hosting, delegation and forwarding".

- **Lease.** A worker step claims the order with a lease (10 minutes) and a random token; only
  the run holding that token releases it, and no route clears it. The operator's Reconcile runs
  a step only when no other run holds the order.
- **Settling.** A purchase or renewal request without a final answer (`sent`, or `unknown`
  after a timeout) is reconciled only three minutes after it was recorded (the request timeout
  is 45 seconds), so a request that may still be running at the registrar is never taken for
  one that did nothing.
- **Stable intent and reconciliation.** Before each registrar purchase, renewal or DNS write the
  worker inserts a `registrar_operations` row (`register:<order>:<n>`, `renew:<order>:<invoice>`
  and `…:<n>` for further attempts, `hosts:<order>:<n>`); intent keys are unique and never
  reused. Outcomes: `succeeded`, `failed` (the registrar refused), `unknown` (no usable answer),
  then `confirmed`/`absent` after reconciliation. A trigger refuses a new purchase or renewal
  attempt of the same order while one is `sent`, `failed` or `unknown`, and seals finished rows.
  A purchase that is not a confirmed success is reconciled with `domains.getList`, then
  `domains.getInfo` (which answers only for a domain in the platform's account, so a listing
  lag cannot hide it): found → confirmed, registration completes, no second purchase; not found
  → `domains.check`: still available → absent, retry with backoff, at most three attempts, then
  operator attention; taken, premium or early-access → looked at once more five minutes later,
  and only if it is still not ours is the order failed and refunded. Every renewal request,
  including the first, is preceded by `domains.getInfo`: an expiry more than a day past the one
  recorded when the invoice was paid (`renewalBaseExpiry`) means it is already renewed (by a lost
  earlier request or by hand), which is recorded as confirmed without another request;
  otherwise an open attempt becomes absent and a new one is sent (five attempts, then
  attention). A failed renewal (`renewal_status=failed`) is checked the same way on every visit
  and by Reconcile. DNS writes replace the whole set, so they are simply sent again.
- **Payment and registrar environment.** The worker buys only when the paying invoice's
  `livemode` matches the registrar environment (live payment and live registrar, or test and
  test) and the environment is the one quoted; otherwise the order waits with attention and
  can be refunded. The same check stops renewals.
- **Billing date.** After registration the worker moves the subscription's next charge to 30
  days before expiry (`trial_end` with `proration_behavior=none`, idempotency key
  `web-address-align:<order>:<anchor>`). Each paid renewal invoice renews for one year, which
  keeps the 30-day lead. A failed alignment is retried on its own short backoff (not at the
  first grace notice) and flagged after three failures. If that date passes without
  alignment, the renewal is charged at once instead (`billing_cycle_anchor=now`,
  `proration_behavior=none`, key `web-address-charge:<order>:<expiry date>`), so it is paid
  well before expiry; the following charges keep that shorter lead. Two weeks before expiry an
  enabled renewal that is neither paid nor failing is flagged for an operator.
- **Lost payment events.** A completed Checkout whose events never arrived is applied from
  Stripe's own objects (the session, then the subscription's latest invoice) by the checkout
  sweep, and flagged after six visits (an hour) if the invoice is still unpaid. Within 30 days of
  expiry, and after a lapse, the subscription's latest paid invoice is applied the same way when
  its event was lost. Such synthetic events go through the same handler, which ignores an
  invoice already journaled.
- **Price.** `yearlyPriceMinor`: the higher of Namecheap's one-year registration and renewal
  price (each including the ICANN fee Namecheap adds), times the configured rate, rounded up to
  whole dirhams, plus the margin; the same price every year. With the test double's prices a `.com`
  is USD 16.06 → AED 59 + 25 = AED 84. Registrar prices are cached per ending for an hour for
  search; an order always takes a fresh quote. A later registrar price increase is absorbed at
  renewal (the registrar cost journal shows it); changing a running subscription's price is not
  built.
- **Lapse.** At expiry without a paid renewal: `expired`, both mappings inactive (the subdomain
  keeps serving), the trainer is notified with the workspace's current subdomain address. The
  Stripe subscription is cancelled (`web-address-cancel:<order>`) at once when renewal is off or
  nothing is pending; while Stripe still retries the renewal invoice (`past_due`), or the next
  charge falls within three days after expiry, it is kept for up to 20 days
  (`LAPSE_HOLD_DAYS`, inside the registrar grace period of the offered endings), so a late
  payment renews the domain (`expired` → `owned`: the complete host set is written again, since
  the registrar may have parked the name). A failed cancel is retried by the worker and flagged
  after three tries. The old manual expiry sweep handles manual orders only.
- **Stale events.** An `invoice.paid` whose invoice is already journaled (a replay, or an older
  invoice delivered late) changes nothing, and a renewal never moves the recorded expiry
  backwards. `customer.subscription.*` events older than the last one applied are ignored.
- **Refund.** A definitive purchase failure first looks for an earlier refund of the first
  payment (`refunds.list`), then creates one with the key `web-address-refund:<order>`, cancels
  the subscription (retried if Stripe fails) and notifies the trainer. A refund whose outcome is
  unknown sets attention.

### Stripe events and ledger

`processWebAddressStripeEvent` runs first in `processStripeEvent` and handles every event whose
object carries metadata `purpose=web_address` (Checkout session, subscription, invoice through
`parent.subscription_details.metadata`) or whose Stripe ids are recorded in `provider_objects`
with a `web_address_*` kind and no user. The member-subscription path never sees them (tested:
no `subscriptions` row appears). Journals (immutable, idempotent by source key, in the trainer's
workspace):

| Source key | Lines |
| --- | --- |
| `web-address-invoice:<invoice>` | `web_address_receivable` +amount, `web_address_revenue` −amount; for a payment matching no open order (`kind=unmatched`) `web_address_refund_liability` −amount instead |
| `web-address-refund:<refund>` | `web_address_revenue` +amount (or `web_address_refund_liability` for a refund of an unmatched payment), `web_address_receivable` −amount |
| `web-address-dispute:<dispute>` | a lost dispute: `web_address_dispute_loss` +amount, `web_address_receivable` −amount (won or open disputes post nothing and flag the order) |
| `web-address-registrar:<operation>` | `registrar_cost` +AED, `registrar_prepaid` −AED (USD × rate, rounded up; `estimated` when the registrar did not report a charge, and for renewals or registrations recorded from `getInfo`) |

None of them touches `trainer_payable`, `stripe_receivable` or commission, so month close,
settlement, statements' payable bridge and payouts are unaffected. The trainer's statement adds
`webAddresses: {paymentsMinor, refundsMinor}`; the operator's statement of the same workspace
also has `registrarCostMinor` and the registrar cost entries, which the trainer's statement and
ledger export (`/finance/export`) leave out because they would show the platform's margin. Reconciling these receipts
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
  `domains.check` also reads `EapFee` (a non-zero or unreadable fee refuses the name),
  `domains.getList`, `domains.getInfo`, `domains.dns.setHosts` (every record numbered in one
  call: Namecheap replaces all records), `domains.dns.getHosts`, `domains.renew`,
  `users.getBalances`. `api.sandbox.namecheap.com` unless "test environment" is explicitly off.
  A small XML reader refuses DOCTYPE/entity declarations.
- **Generic JSON registrar** (bearer `DOMAIN_API_KEY` at `DOMAIN_API_URL`, from the Custom
  domains settings): `GET v1/domains/check?domain=`, `GET v1/pricing/<tld>` → `{currency:"USD",
  register, renew}`, `POST v1/domains` `{domain, years, registrant, privacy:true}` (409 =
  unavailable), `GET v1/domains?search=`, `GET v1/domains/<domain>`, `PUT`/`GET
  v1/domains/<domain>/records`, `POST v1/domains/<domain>/renew` `{years}`, `GET v1/account` →
  `{balanceUsd}`. The e2e registrar double implements it. It has no test environment, so it
  counts as live (it is test only in the local mock-provider sandbox), and Stripe test keys
  refuse purchases with it.
- **Call budget.** Namecheap limits API calls per account (published as 20 a minute, 700 an
  hour and 8000 a day; to be confirmed against its current terms). Searches and quotes from the
  API process may use at most 8 a minute, 300 an hour and 3500 a day (`REGISTRAR_BUSY`, 503,
  beyond that), availability answers are cached for a minute, and one owner may search 6 times
  a minute, so trainers searching cannot starve the worker's purchases, renewals and
  reconciliation. The budget is per API process (the platform runs one).

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
| `GET /api/v1/web-address/search?q=` | Owner | Availability, `firstYearPriceMinor` and `renewalPriceMinor` (AED); 6/min; 503 `REGISTRAR_BUSY` beyond the account budget |
| `POST /api/v1/web-address/orders` | Owner, fresh MFA | `{domain, firstYearPriceMinor, renewalPriceMinor, accepted:true}` → `{orderId, url}`; 409 `PRICE_CHANGED` (with both prices), `DOMAIN_UNAVAILABLE`, `DOMAIN_IN_USE`, `WEB_ADDRESS_DISABLED` (also for a Stripe/registrar mode mismatch); 429 more than 3 open checkouts |
| `POST /api/v1/web-address/orders/:id/checkout` | Owner | Returns to the same open Checkout (idempotent replay) |
| `GET /api/v1/web-address/orders/:id` | Owner | Progress and the two prices (never the registrar, its cost, the rate or the margin) |
| `POST /api/v1/web-address/orders/:id/cancel` | Owner | Unpaid checkout only; expires the Stripe session |
| `POST /api/v1/web-address/orders/:id/renewal` | Owner, fresh MFA | `{enabled}` → Stripe `cancel_at_period_end` |
| `GET /api/v1/admin/web-addresses` | Super admin, fresh MFA | Operator view |
| `POST /api/v1/admin/web-addresses/:id/{reconcile,retry,refund}` | Super admin, fresh MFA | `{reason}`; manual fallbacks (reconcile answers `ran: false` while another run holds the order) |
| `POST /api/v1/admin/web-addresses/:id/record` | Super admin, fresh MFA | `{reason}`; records a registration or renewal made at the registrar by hand; 409 `NOT_RECORDED` with the reason |
| `POST /api/v1/admin/web-addresses/:id/cancel-subscription` | Super admin, fresh MFA | `{reason}`; ends the yearly subscription; 502 when Stripe does not confirm (retried automatically) |

## Migration 066 (`packages/db/migrations/066_web_addresses.sql`)

- `domain_orders`: `mode` (`manual` default), registrar, Stripe links, billing and renewal
  state, attention, attempts, `next_attempt_at`, lease (`lease_until`, `lease_token`),
  trainer-visible `progress`, notice
  ledger, `live_at`; the status check now depends on the mode; the one-open-order-per-hostname
  index also frees `failed` orders; the guard trigger above (a late renewal moves `expired` →
  `owned` or `dns`). Only nullable columns or columns with defaults are
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
  `apps/web/components/web-address-operations.tsx` (operator view, split out on 28 September),
  `apps/web/app/web-address.css`, `tests/e2e/mocks/namecheap.ts`,
  `tests/web-address-registrar.test.ts`, `tests/web-address-subdomains.test.ts`,
  `tests/web-address-orders.test.ts`, `tests/web-address-stripe.test.ts`,
  `tests/web-address-web.test.ts`, `tests/web-address-moat.test.ts`,
  `tests/test_web_address_deployment.py`, this document.
- **Changed:** `apps/api/src/app.ts` (reserved-slug check at signup, registration, `location`
  and the new prices (`firstYearPriceMinor`, `renewalPriceMinor`) in two error answers, a test seam for the web address doubles),
  `host-routing.ts` (subdomain branch, `platformRoot`, `coachHostTenant`),
  `host-operations.ts` (TLS ask set), `integrations-completion.ts` (manual-only filters, domain
  names under the root refused, OAuth relay accepts subdomains), `stripe-events.ts` (handler
  first), `finance-statements.ts` (registrar cost only in the operator's statement),
  `finance-completion.ts` (operator statement option), the ledger export in `app.ts` (leaves
  out registrar cost entries), `message-templates.ts`, `privacy-hooks.ts` (a failed order is
  no provider blocker), `apps/worker/src/index.ts` (a 30-second background task),
  `packages/db/src/scope.ts` (usedBy), `packages/providers/src/{configuration,index,sandbox}.ts`,
  `apps/web/proxy.ts`, `apps/web/host-proxy.ts`, `apps/web/app/[[...path]]/page.tsx`,
  `apps/web/app/layout.tsx`, `apps/web/components/{integration-center.tsx,discovery-server.ts}`,
  `infra/digitalocean/{host.py,hostops.py}`, `infra/runtime-role.sql`, `compose.yaml`,
  `scripts/verify-runtime-access.mjs`, `tests/e2e/mocks/{http.ts,registrar.ts,stripe.ts}`,
  `docs/E2E_MOCK_PROVIDERS.md`. `workspace.tsx` is unchanged.

## Review fixes (second pass, 28 September 2026)

The review listed thirteen findings; the text of the last one reached this pass cut off after
"The reserved list leaves out names that matter under an A", so it was read as the wildcard A
record case. Each finding, what changed and what was declined:

1. **Double renewal when Reconcile is pressed during a running renewal (major): fixed.** Orders
   carry a lease token; only the claiming run releases its lease (the old `finally` cleared any
   lease), and no route clears a lease any more: Reconcile runs a step only when nobody holds
   the order (`ran: false` otherwise) and Retry only makes it due. A `sent` or `unknown` purchase
   or renewal is reconciled only after a three-minute settle window, so even a run that
   outlived its lease cannot mark an in-flight request absent. The operator view shows such a
   request as in flight instead of as work to reconcile. Test: a gated transport holds
   `domains.renew` while Reconcile is pressed and while a forced run takes an expired lease;
   one registrar renewal, one year added, the recorded expiry matches. With the settle guard or
   the pre-renewal check removed the test fails (checked, then restored).
2. **Manual renewal fallback led to a second renewal; no way to record it (major): fixed.**
   `invoice.paid` stores the expiry the payment extends; every renewal request, including the
   first and one after Retry, is preceded by `domains.getInfo`, and an expiry more than a day
   past it is recorded as confirmed without a request. Reconcile runs that check for a failed
   renewal. New operator actions: *Record registrar state* (registration or renewal made by
   hand, evidence from `getInfo`) and *Cancel subscription*. Test: five refused renewals, a
   renewal by hand, then Reconcile (and, next year, Retry): no further `domains.renew`; a
   goodwill renewal without payment is recorded, a second press is refused; a registration made
   by hand is recorded from the registrar.
3. **A transient Stripe error while aligning billing could make the domain lapse uncharged
   (major): fixed.** Alignment retries on its own short backoff and flags after three failures;
   if the charge date has passed without it, the renewal is charged at once
   (`billing_cycle_anchor=now`). At expiry the subscription is kept up to 20 days while Stripe
   still retries a renewal invoice or the next charge falls just after expiry, so a late payment
   renews the domain. Deviation from the suggested fix: the mapping is still deactivated at
   expiry (the registrar parks an expired name anyway, and the trainer is told the subdomain);
   what is held back is the cancellation. Grace notices now say "update your card" only when a
   payment failed. Tests: `subscriptions.update` fails once (retried within minutes, then
   aligned); a passed charge date charges now; the real-SDK test keeps a `past_due`
   subscription through the hold and cancels it afterwards.
4. **A lost `invoice.paid` after Checkout left the trainer charged with nothing bought (major):
   fixed.** The checkout sweep applies the completed session and the subscription's latest
   invoice from Stripe through the same handler, and flags the order after six visits. The same
   reconciliation runs in the renewal window and after a lapse. Test: session complete, no
   events; flagged while the invoice is open, then paid and journaled once.
5. **Namecheap test environment and Stripe mode not tied (major): fixed.** Orders are refused
   when the Stripe key mode and the registrar environment differ, a live-mode Checkout session
   for a test registrar is expired and refused, and the worker buys or renews only when the
   paying invoice's `livemode` matches (stored on the order) and the environment equals the
   quoted one. The connection check and the operator view show a mismatch; the trainer panel
   hides purchases. The generic registrar counts as live. The rehearsal advice was wrong and is
   rewritten (Go live, step 8). Tests for all four places.
6. **A replayed older `invoice.paid` moved the expiry backwards (major): fixed.** An invoice
   already journaled changes no state, and a renewal never lowers the recorded expiry. Test:
   last year's invoice replayed after two renewals.
7. **A failed subscription cancel after a refund was ignored (minor): fixed.** Cancels are
   retried by the worker with the same idempotency key (and confirmed by reading the
   subscription), flagged after three tries. Test: a cancel failing once.
8. **Refunding a name that may be ours (minor): fixed.** Reconciliation asks `getInfo` after
   `getList`; a name that is not ours and not available is looked at once more before the
   refund. Names with a Namecheap early-access fee are refused in search and quote. Tests:
   a registration missing from `getList` is confirmed by `getInfo`; the taken-name refund waits
   one cycle; `EapFee` parsing and refusal.
9. **Turning renewal off could not be undone although the notices said so (minor): partly
   fixed.** The notices now say until when renewal can be turned back on, and point to support
   after that date. Subscription events set the switch both ways, and an event older than the
   trainer's last switch (or than the last event applied) is ignored. Test with out-of-order
   events. *Declined:* re-enabling after the subscription ended; it needs a new yearly
   subscription (a new Checkout) on an order whose subscription link is immutable, a larger
   change that should follow an owner decision on whether it is wanted.
10. **Ledger incomplete (minor): partly fixed.** Payments for a closed order go to
    `web_address_refund_liability` (and their refunds out of it); a lost dispute is recorded
    in `web_address_dispute_loss`; the trainer's statement and ledger export leave out the
    registrar cost (operators still see it), as the owner decided on 28 September 2026. Tests
    for each.
    *Declined, with reasons:* Stripe processing fees per domain charge (the platform records
    Stripe fees only through its settlement import, which is per trainer payable; web address
    receipts need a platform-level settlement that does not exist yet), the clearing entry for
    `web_address_receivable` at payout and a funding entry for `registrar_prepaid` (both are
    platform-level, outside any workspace; not built), and deferring yearly revenue (an
    accounting policy for the owner to choose).
11. **Notices used the slug captured at order time (minor): fixed.** Failure, lapse and
    reminder notices read the workspace's current slug. Test after a rename.
12. **No account-wide limit on Namecheap calls from searches (minor): fixed.** A per-process
    budget for searches and quotes (8 a minute, 300 an hour, 3500 a day), a one-minute
    availability cache and 6 searches a minute per owner. Test: searches stop at the budget; a
    repeated search makes no call.
13. **Reserved names under a wildcard A record (minor, text cut off): fixed as read.** Added the
    names clients probe on their own (`autodiscover`, `autoconfig`, `lyncdiscover`, `sip`,
    `msoid`, `enterpriseenrollment`, `enterpriseregistration`, `wpad`, `isatap`, `mta-sts`),
    control panels, role mailboxes and further infrastructure names. Tests at signup and in the
    rules.

Migration 066 changed in this pass (still unmerged and never applied anywhere): `lease_token`,
and `expired` → `owned` after a late renewal.

## DNS hosting, delegation and forwarding (stage 2026-09-28h, branch `core/dns-automation`)

Owner direction (28 September 2026): everything is automated, including DNS for the platform root
and for bought trainer domains, and bought domains forwarding to the right trainer subdomain.
Credentials live in the Super admin panel's encrypted settings, which the automation reads; they
are never committed to git. DigitalOcean DNS was chosen for the zones because 101domain's API has
no zone-creation call (its managed zone only appears after a panel action) and web forwarding at a
registrar needs the registrar's own nameservers (and a paid add-on for HTTPS).

### Design

- **`DnsProvider` interface** (`packages/providers/src/dns-hosting.ts`): `nameservers()`,
  `getZone`, `ensureZone` (`existing` | `created` | `held_elsewhere`), `records`, `upsertRecords`
  (converge the desired records of each name and type; `replaceTypes` removes AAAA or CNAME
  records that would shadow them; nothing else is touched), `deleteZone` (guarded). Errors are
  `DnsError` with `outcome` `definitive` (refused, nothing changed) or `unknown` (network,
  timeout, 5xx, 429 with its Retry-After), like `RegistrarError`. Requests have a 30 s timeout and
  go through `integrationRequest` (public-address pinning, no redirects); only the Node test
  runner may inject a transport; the local mock sandbox may point the adapter at a loopback double
  with `DIGITALOCEAN_API_BASE_URL`.
- **`DigitalOceanDns`**: `GET/POST/DELETE /v2/domains[/{zone}]` (created without `ip_address`, so
  every record is written explicitly), `GET /v2/domains/{zone}/records?per_page=200` following
  `links.pages.next`, `POST`, `PATCH` and `DELETE` of records by id. A 422 on create while the zone
  is not in this account means another DigitalOcean account holds the name (`held_elsewhere`); a
  lost create answer is read back. Nameservers are `ns1/ns2/ns3.digitalocean.com`.
- **Zone guard.** A DigitalOcean token reaches every domain of its team, so every zone-level call
  is refused (before any request) unless the caller's `mayManage` accepts the zone: an order's own
  domain once the platform holds the registration (never the platform's own zones), or, for the
  platform DNS action, exactly `PLATFORM_ROOT_DOMAIN` or the platform root zone saved in DNS hosting
  settings.
- **`RegistrarHostedDns`**: the previous behaviour as a `DnsProvider` (the registrar's own DNS: the
  complete host set written with `setHosts` and read back; a domain delegated elsewhere is first
  returned to the registrar's nameservers, because Namecheap refuses host records otherwise).
- **Registrar nameservers**: `getNameservers` and `setNameservers(domain, list | null)` on every
  adapter. Namecheap: `domains.dns.getList`, `domains.dns.setCustom` (comma list), `domains.dns.setDefault`;
  the read-back is the evidence. Generic JSON API: `GET/PUT/DELETE v1/domains/<d>/nameservers`.
  101domain: `GET/PUT /v1/dns/<d>/nameservers` (200 when already set, 202 while the registry
  applies the change: `pending`, then polled).
- **101domain registrar adapter** (`OneOhOneRegistrar`): availability (`GET /v1/domains/search`
  for one name, `POST /v1/domains/bulk-search` up to 50, `invalid[]`, premium refused), one-year
  USD prices (`GET /v1/tlds/<tld>`, endings that need documents such as `.co.ae` refused), domain
  list and details, the finance balance, pending orders, DNS records (only on 101domain
  nameservers). Registration (`POST /v1/domains/registration` with the platform company as every
  contact, private registration except for endings without it such as `.ae`, auto-renew off) and
  renewal follow the announced, not yet published endpoints: they are sent only when **101domain
  registration and renewal API verified** is on; until then they refuse without sending, purchases
  stay off with 101domain (trainers see "not available yet", operators the reason), and a paid
  renewal waits for 101domain's own auto-renewal (about 60 days before expiry), recognised from
  the moved expiry date. An order 101domain is still processing is an unknown outcome and is never
  refunded while `/v1/finance/orders` shows it processing. The field names of the unpublished calls
  must be checked against the live API reference (the Live read-only check stage) before that
  switch is turned on.

### States and steps (DigitalOcean path)

1. `owned` → `zone`: `create_zone` (intent `zone:<order>:<n>`, `ensureZone`), then `set_records`
   (`records:<order>:<n>`: A `@` and A `www` to the server IPv4, the configured TTL, never a
   wildcard for a bought domain), read back through the API (missing or shadowing records fail
   the step). A zone held by another account is never used: the order switches to the registrar's
   DNS (`dns_fallback`), because delegating to it would hand the name to that account.
2. `zone` → `delegating`: only while the zone is still in the platform's account (re-read), and
   never when public DNS shows a DS (DNSSEC) record for the name (DigitalOcean does not sign zones;
   the order waits with attention). `set_nameservers` (`nameservers:<order>:<n>`) at the registrar,
   read back.
3. `delegating` → `dns`: the registrar shows the DigitalOcean nameservers applied and public DNS
   (Cloudflare, then Google, over HTTPS) answers with them; checked with the usual backoff and
   flagged after 72 hours. Nameservers reset by someone else (a grace-period renewal, a hand change)
   send the order back to `zone`, which sets them again.
4. `dns` → `active`: as before (A of the domain and `www` resolve to the server, certificate
   allowances, an HTTPS request to both names, mappings). The HTTPS check now accepts any HTTP
   answer, a 301 included, so a forwarded domain activates; the certificate is still verified.

Every external step is recorded in `registrar_operations` before it is sent. These DNS calls
converge (they read the current state first), so a later attempt runs without waiting; when it
succeeds, earlier attempts of the same kind that never got an answer are recorded as `confirmed`
by that read-back (`via: "read-back"`). Only purchases and renewals keep the reconcile-before-retry
block. After five failed attempts of a DNS step the order is flagged for an operator. The registrar
path (DNS provider "registrar") is unchanged: `owned` → `dns` with the complete host set, first
returning a delegated domain to the registrar's nameservers (recorded as `set_nameservers` with
`nameservers: null`).

### Takeover safety, lapse, refund and closure

- Any DigitalOcean account can add a zone nobody holds there. So the zone is created **before**
  the registrar delegates to DigitalOcean, delegation is never set when the zone is held
  elsewhere, and a zone is **never deleted while the name still delegates to DigitalOcean**.
- At lapse the mappings go inactive as before and the zone is kept (`zoneRetained`). After the
  subscription is settled, the release step waits until `ZONE_RELEASE_DAYS` (45) after expiry, then
  deletes the zone only when neither the registrar (for a name still in the platform's account)
  nor public DNS lists a DigitalOcean nameserver, or the name no longer exists; otherwise it looks
  again every 7 days. `deleteZone` itself refuses with that evidence missing and always refuses the
  platform's own zone. The deletion is recorded (`delete_zone`, `release:<order>:<n>`) with the
  evidence.
- A late renewal (`expired` → `owned`) provisions again: the zone is created again if it was
  released (if another account took it meanwhile, the registrar's DNS is used) and the
  nameservers are set again.
- A refunded order never registered a name, so no zone ever existed. A closed workspace keeps its
  zones (the worker no longer visits closed workspaces; keeping a zone is always safe).
- 101domain (and any registrar whose API cannot switch auto-renewal off) renews by itself: when a
  trainer turns renewal off, and at lapse, operators get an attention item to turn auto-renewal
  off in the registrar's panel.

### Forwarding

- Per bought domain, the owner chooses **Show my site on this domain** (default, the previous
  behaviour) or **Forward to my `<slug>.<root>` address** (a 301 that keeps the path and query).
  `www.<domain>` always redirects to `<domain>` (in forward mode it then forwards on). The choice
  is offered at purchase and on the order card, only when the workspace has an eligible subdomain;
  no DNS host or registrar is ever named.
- Storage: `domain_orders.serve_mode` (`site` | `forward`) and `domain_mappings.redirect` (`apex`
  for www, `subdomain` for a forwarded domain, NULL to serve the site). Tenant actors cannot set
  `redirect` (column privilege, checked by the runtime verifier and a PGlite test); the owner's
  route `POST /api/v1/web-address/orders/:id/serve-mode {mode}` (recent authenticator) updates
  the order and its own mapping through the service and records `web_address.serve_mode`.
- Host routing reads the mapping's `redirect` and the workspace's **current** slug, so a renamed
  workspace forwards to its new subdomain; without a platform root or an eligible slug the site is
  served. `/api/v1/public/host` carries `redirect`; the web proxy follows it only for an https
  origin that is a one-label subdomain of the configured root or the apex of the requested www
  name, answers 301 with `Cache-Control: public, max-age=3600` (switching back takes effect within
  the hour) and never redirects `/api/*`. Certificates are still issued for the domain and www
  (their mappings stay active), so the redirect is served over HTTPS.

### What the owner configures in Super admin

- **DNS hosting**: DNS provider (DigitalOcean DNS or the registrar's own DNS), DigitalOcean API
  token (secret), its expiry date (warning 30 days before), the platform root zone, the record TTL
  (30 to 86400 s). Test connection: `GET /v2/domains?per_page=1` only (no domain named in the
  result; the number of zones the token reaches, with the dedicated-team advice when it reaches
  more than one).
- **Web addresses and registrar**: registrar Namecheap, 101domain or the generic API; 101domain
  API key (secret), its expiry date, and the ordering switch; test connection reads the balance
  only.
- Existing active domains keep the DNS they were set up with; **Re-run DNS setup** (operator view)
  moves one to the current setting, **Use registrar DNS** moves it back to the registrar's DNS.

### Files

`packages/providers/src/dns-hosting.ts` (new), `packages/providers/src/registrar.ts` (nameservers,
`OneOhOneRegistrar`, capabilities, `registrarPurchaseProblem`), `packages/providers/src/configuration.ts`
(`dns_hosting` entry, 101domain fields, validation, capability, connection checks),
`packages/providers/src/sandbox.ts` (two sandbox overrides), `packages/db/migrations/070_dns_hosting.sql`,
`apps/api/src/web-address-orders.ts` (zone, delegation, release, forwarding mappings, HTTPS check,
controller IPv4), `apps/api/src/web-addresses.ts` (serve mode, operator DNS action, trainer
labels), `apps/api/src/host-routing.ts` (`redirect`), `apps/api/src/platform-dns.ts` (new),
`apps/api/src/host-operations.ts`, `apps/api/src/app.ts`, `apps/api/src/privacy-lifecycle.ts`
(comment), `apps/web/host-proxy.ts` (`forwardLocation`), `apps/web/proxy.ts`,
`apps/web/components/web-address.tsx`, `web-address-operations.tsx`, `host-operations.tsx`,
`apps/web/app/web-address.css`, `scripts/verify-runtime-access.mjs`, tests
`web-address-dns.test.ts`, `web-address-dns-orders.test.ts`, `platform-dns.test.ts`,
`web-address-moat.test.ts`, doubles `tests/e2e/mocks/digitalocean.ts`, `oneohone.ts`, and changes
to `namecheap.ts`, `registrar.ts`, `dns.ts`, `index.ts`, `tests/e2e/scenarios/core-features.e2e.ts`.

### Migration 070 (`packages/db/migrations/070_dns_hosting.sql`)

Additive: `domain_orders.dns_provider` (`registrar` | `digitalocean`), `domain_orders.serve_mode`
(`site` default | `forward`), automatic statuses `zone` and `delegating` with the widened
transition guard (owned → zone/dns/expired; zone → delegating/owned/expired; delegating →
dns/zone/owned/expired; dns → owned/active/expired; active → expired/dns/owned; expired →
owned/dns), registrar `101domain`; `registrar_operations` kinds `create_zone`, `set_records`,
`set_nameservers`, `delete_zone` and providers `101domain`, `digitalocean` (the
reconcile-before-retry block stays on register and renew only); `domain_mappings.redirect`
(`apex` | `subdomain` | NULL) without any tenant grant. A previous release pauses orders in the new
statuses (its default branch); the new worker picks them up again.

## Owner decision: the platform holds custom domains (28 September 2026)

The owner decided that the platform holds trainers' custom domains as a business moat. Applied:

- **Registrant.** Always the platform company, with WHOIS privacy (`AddFreeWhoisguard`/
  `WGEnabled` at Namecheap, `privacy: true` on the generic API). The registrant comes only from
  Super admin settings; the organization field is now required (settings readiness and
  `registrantFromConfig`, which refuses a contact without it). No trainer route accepts or
  returns a registrant, and there is no route or adapter method for a transfer out or an
  authorisation (EPP) code. The settings page notes the decision.
- **What trainers and subscribers see.** Never the registrar's name or cost. The trainer screen
  (`apps/web/components/web-address.tsx`) shows only the first-year price and the yearly renewal
  price in AED ("First year AED 84.00 · renews at AED 84.00 per year"), and the agreement names
  both. Search results and order status carry `firstYearPriceMinor` and `renewalPriceMinor`
  only; `PRICE_CHANGED` carries both. The stored quote keeps the registrar, its USD price, the
  rate and the margin for operators. The Checkout subscription charges one yearly price (the
  higher of the registrar's registration and renewal price, converted, plus the margin), so the
  two amounts are equal today; they are separate fields so a different first-year price can
  come later without changing the screens or the agreement.
- **Stripe wording.** Product name `Custom web address — yearly`, subscription description
  `Custom web address — yearly: <domain>` (these appear on Checkout, invoices and receipts). No
  statement descriptor is set, so the platform account's own descriptor applies.
- **Older manual domain flow.** Trainer answers of `/api/v1/domains*` are now a trainer view
  (status, exact price quote, verification token): the registrar and payment references and the
  quote's provider reference stay with operators. Its copy no longer says "registrar quote" or
  that the registration "remains yours" (that is said only for a domain the trainer already
  owned).
- **Operator view** moved to `apps/web/components/web-address-operations.tsx`, the only web file
  allowed to name the registrar (it now shows "Registrar: Namecheap"). Super admin settings and
  the operator screens still name it.
- **Guard.** `tests/web-address-moat.test.ts` fails if "namecheap" (any case) appears in any
  `apps/web` file outside that operator-only allowlist, in the message templates or the trainer
  notice copy, or in the Stripe text built by the web address code; if search or order status
  answers carry a registrar name or a cost, rate, margin or registrar field (the manual flow's
  trainer view too); if the registrant can be saved without the platform company; or if a
  transfer or auth-code route appears. `web-address-orders` also checks the real Checkout
  parameters, the trainer's `GET /web-address` and order answers over HTTP, and every notice
  sent in its scenarios.

Checks run for this change (local, 28 September 2026, in this worktree): `npx tsc --noEmit`
exit 0; `node --import tsx --test tests/web-address-*.test.ts tests/messaging-templates.test.ts`
51 tests, 51 passed (including the 6 new moat tests and 1 new notice test); also
`logical-css`, `healthkit-ui`, `integrations-completion`, `platform-settings`, `fix-settings`
and `settings-runtime`: 47 tests, 47 passed (after Prettier on the changed files). Not run: the full suite, `next build`, e2e, a browser.

## Checks actually run (local, 28 September 2026, in this worktree)

Second pass (review fixes), after the last code change:

- `npx tsc --noEmit`: exit 0. Prettier run on the changed files that were Prettier-clean
  before (not `app.ts` or `tests/e2e/mocks/stripe.ts`, which were not clean at the base).
- PGlite: `web-address-orders` 19, `web-address-stripe` 1, `web-address-registrar` 8,
  `web-address-subdomains` 6, `web-address-web` 5, with `logical-css`, `governance-step-up`,
  `finance-completion` and `platform`: 101 tests, 101 passed. Before the final small edits
  (operator in-flight flag, formatting) also `messaging-templates`, `host-routing`,
  `integrations-completion`, `infra-ops-tls`, `infra-ops-api`, `platform-settings`,
  `provider-configuration`, `fix-ledger`, `e2e-harness-mocks`, `e2e-harness-sandbox` and
  `isolation-elevation`: 157 tests in that batch, all passed.
- `/opt/tools/pg-sandbox.sh 56141 <worktree>` after the last code change:
  `{"runtimeAccess":"verified","migrations":55,…,"tenantScopeFixed":true}`, then 12 files (the
  five web address files, `finance-completion`, `fix-ledger`, `isolation-elevation`,
  `governance-step-up`, `host-routing`, `integrations-completion`, `infra-ops-tls`): 101 tests,
  0 failed, `PG_SELECTED_FAILED_FILES=0`.
- `python3 -m unittest discover -s tests -p 'test_*deployment.py'`: 114 tests OK, 2 skipped (no
  Caddy binary here). `host.py` did not change in this pass.
- Mutation check (not committed): with the settle guard and the pre-renewal `getInfo` removed,
  the in-flight and by-hand renewal tests failed; restored, they pass.
- Not run in this pass either: `next build`, the e2e harness, a browser or 390 px check, the
  full suite, anything on Docker, the live server, real DNS, Namecheap or Stripe.

First pass:

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

- **E2E scenario.** Added on 28 September 2026: the runner starts the Namecheap double and sets
  `PLATFORM_ROOT_DOMAIN`, and the harness core suite covers the subdomain, search, purchase,
  registration with DNS records, yearly renewal and the operator view (docs/E2E_MOCK_PROVIDERS.md).
  The Live step is not reached locally: the target IPv4 must be public, so no edge serves it.
  Stage 2026-09-28h changed the scenario to the DigitalOcean DNS double (zone, delegation through
  the Namecheap double, forwarding switch); that version has **not been run** in the harness yet.
- **DNS drift maintenance** (stage 2026-09-28h). An active domain's nameservers and records are
  not re-checked on a schedule; a changed delegation is noticed only when the order next passes
  through `zone`/`delegating` (late renewal, operator re-run). A daily read-only drift check and a
  platform-DNS drift alert are not built.
- **101domain ordering.** Registration and renewal through 101domain's API are built against the
  announced endpoints but switched off until those endpoints are published and their field names
  are checked (GET only) against the live API reference; early-access fees and whether API prices
  include the ICANN fee are also unverified there. The root domain's own nameservers at 101domain
  are not changed by the platform (the root is already delegated to DigitalOcean).
- **DNSSEC on bought domains.** DigitalOcean does not sign zones; a domain with a DS record at the
  registry waits for an operator (remove DNSSEC, or use the registrar's DNS).
- **390 px and browser check.** The panel uses wrapping flex rows, `min-inline-size: 0` and
  `overflow-wrap` with logical properties only (the RTL lint passes), but it was not rendered in
  a browser at 390 px.
- **Registrant per trainer, transfers out, auth codes.** Not offered, by the owner's decision of
  28 September 2026 (the platform holds the domains); an exceptional request is handled by an
  operator by hand at the registrar. The guard test fails if a route for either appears.
- **Wildcard certificate via DNS validation** for more than about 50 new subdomains a week (see
  above).
- **Price changes of a running subscription.** A higher registrar renewal price is absorbed
  and recorded; re-pricing the trainer's subscription with notice is not built.
- **Operator list cost.** The operator view and the worker visit workspaces one scoped
  transaction each (as other worker tasks do); for thousands of workspaces a cross-workspace
  index of due orders would be needed.
- **Refund of a mismatched first payment** (an amount that does not match the quote) or of a
  payment for a closed order is flagged for the operator, who refunds in Stripe; the money is
  held as a refund liability meanwhile. The automatic refund covers definitive purchase
  failures only.
- **Turning renewal back on after the subscription ended** (see review finding 9).
- **Stripe fees, disputes' fees, receivable clearing, registrar balance funding, revenue
  deferral** (see review finding 10).
- **Registrar call budget across processes.** The search budget is per API process; a second
  API process would need a shared (database) budget.
- **Platform-level reconciliation** of web address receipts with Stripe payouts, and closing a
  workspace with an active domain (the registrar is listed as a provider blocker as before;
  cancelling its subscription at closure is not automated).
