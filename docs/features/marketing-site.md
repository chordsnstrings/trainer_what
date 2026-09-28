# Public marketing site: multi-page, conversion, SEO and LLM SEO

Work package branch: `core/marketing-site` (base `b9ec7c1`). Migration:
`067_early_access.sql` (review fixes; 063-066 are taken by other packages).

Built from the 28 September 2026 strategy brief (positioning, personas,
honest conversion levers, site map, SEO and LLM SEO plan, follower model).
The brand is always the configured platform name (`APP_NAME`); copy is
written to read well as "TrainsYou" but never hard-codes it. Since the
corporate identity package the default name is `trainsyou` (lowercase), with
its logo, icons, share card and tokens: see [brand.md](brand.md).

## What was built

### One registry, everything derived

`packages/contracts/src/marketing.ts` (types and builders) and
`marketing-content.ts` (copy and sources) hold every public page: path,
title, meta description, H1, eyebrow, answer-first introduction, keyword
hypothesis, parent (breadcrumbs), sections (paragraphs, bullets, cards,
steps, tables, cited sources), FAQs, CTA, related links, last-updated date,
indexability and JSON-LD kinds. Copy uses the token `{APP_NAME}`.

Derived from it, so nothing drifts:

- `PUBLIC_MARKETING_PATHS` (discovery.ts), therefore robots metadata,
  `isIndexablePlatformPath` and the platform sitemap (the API sitemap now
  also sends each page's `lastUpdated` as `lastmod`).
- Header navigation (`marketingNav`) and the footer site map
  (`marketingFooter`, every indexable page).
- Per-page metadata (`marketingMetadata`: `<title>` "Title | {APP_NAME}",
  description, canonical, Open Graph, Twitter card).
- JSON-LD (`marketingJsonLd`): Organization and WebSite on `/` (and
  Organization on `/about`), WebPage / AboutPage / CollectionPage / Article,
  BreadcrumbList on every page, HowTo on `/how-it-works`, WebApplication on
  the calculators, FAQPage built only from the FAQs the page shows.
  `jsonLdScript` escapes `<`, `>`, `&` and line separators.
- `/llms.txt` (llmstxt.org shape: H1, entity blockquote, H2 link lists,
  "Optional") and `/llms-full.txt` (every page's text, FAQs and sources).
- The workspace's public-path check and the consented acquisition tracking
  (`components/acquisition.tsx`) use `isMarketingPath` /
  `isMarketingSitePath`.

### Pages (42 registry entries)

- Core: `/`, `/how-it-works` (8 HowTo steps and a who-does-what table),
  `/trainer-brain`, `/demo` (four scripted decisions, rewritten to the
  28 September concept: applied automatically, rescheduled automatically,
  handed to the trainer, pain pauses the workout), `/features`, `/pricing`
  (bands, worked example computed by the calculator function, what else is on
  the statement, billing, payouts, compact calculator), `/earnings-calculator`,
  `/follower-calculator`, `/security-and-privacy`, `/faq` (rewritten in
  customer language; no build-status notes, no payout provider name),
  `/about`, `/methodology`, `/get-started` (the setup checklist and the
  claim-address preview, or early access), `/for-trainers`, `/uae`, `/guides`.
- 11 feature pages under `/features/` with availability chips.
- 8 specialty pages under `/for-trainers/` (slugs are `DIRECTORY_SPECIALTIES`
  ids with hyphens), each with three rules labelled "Illustrative", handoff
  examples, a programme outline, a follower calculator starting from an
  editable example price, and a specialty FAQ.
- `/uae` with Dubai, Abu Dhabi and northern-emirates sections (cited local
  facts, published price table, a licensing note that makes no unverified
  claims) and a "Looking for a coach?" directory block. The former
  `/uae/dubai` and `/uae/abu-dhabi` pages (same bullets, one fact each: a
  doorway pattern) now answer 308 to `/uae#dubai` and `/uae#abu-dhabi`
  (`MARKETING_REDIRECTS`).
- 4 guides: pricing online coaching in the UAE, followers to clients, the
  advertiser permit (information only, not legal advice), writing coaching
  rules.
- `/terms`, `/privacy`, `/ai-disclosure` stay in the registry for metadata
  and discovery but keep their published-document renderer.

Unknown children of `/features/`, `/for-trainers/`, `/uae/` and `/guides/`
return 404 instead of falling through to the app.

### Rendering

Marketing pages are server components (`components/marketing/site.tsx`)
rendered by `app/[[...path]]/page.tsx` before the workspace: the 5,000-line
client workspace no longer renders them (`marketing-pages.tsx` was removed).
Client islands are small (`components/marketing/islands.tsx`): follower and
earnings calculators, the live address preview and the demo tabs. The header
and footer (`components/marketing/frame.tsx`) have no hooks, so the directory
and the sign-in pages share them. Dropdowns open on hover or keyboard focus
without JavaScript; the mobile menu is a `<details>` element. A skip link,
breadcrumbs, "Last updated" dates and related links are on every page.

The platform facts come from a new public endpoint,
`GET /api/v1/public/platform` (`apps/api/src/marketing.ts`): name, initials,
support email, public company details, whether registration is open (the same
rule as `POST /auth/register`), the coaching address template, provider
availability and the follower model. The web process caches it for a minute
(`components/marketing/platform.ts`) and falls back to the last value, then to
`DEFAULT_PLATFORM_NAME`. The root layout's title template and the directory,
workspace sign-in pages and footers use the configured name; coach websites
keep their own titles (`title.absolute`).

When registration is closed (a strict deployment without approved legal
documents) every "Claim your coaching address" CTA becomes "Join early
access", pointing at `/get-started#early-access`, which offers the support
email when one is configured. A consented email-capture endpoint is still
new work (see below).

Styles: `app/marketing.css`, logical properties only (checked by
`tests/logical-css.test.ts`), Swedish-minimal tokens from `globals.css`.

### Calculators (`packages/domain/src/marketing-calculators.ts`)

Follower estimate (version `2026-09-28.3`, stage 2026-09-28k): three
scenarios from the same arithmetic. **The headline always shows the strong
case** ("Strong case: an engaged audience and weekly sharing"), at the
owner's direction; cautious and typical appear only in the "How we estimate"
table. The research behind cautious and typical is the proposal of 28
September (Socialinsider, Metricool, IQFluence, vendor DM claims, MailerLite,
RevenueCat, Dynamic Yield); the strong case is calibrated to creator sales.

Inputs: followers F, price, link Stories a month k (8), call-to-action Reels
or posts a month n (4), comment-keyword DMs on/off (on), members who cancel
per year (30%, 5-80%), and optional profile visits a month (the bio link
counts only when entered), broadcast members and link messages a month (4),
own average Story views (replaces the Story audience guess) and engagement
rate.

```
g     = your engagement / 0.48%, within ×0.5..×2 (1 if unknown)
S     = Story audience = max over tiers j ≤ yours of min(F, top_j) × share_j (× g), or your views
R, K  = Reel viewers and keyword comments per Reel, the same max over tiers
v(T)  = 1 − (1 − rate)^(times × T)                   chance of a visit by month T
D(T)  = nested union of Stories and broadcast (and Reels when cautious)
        + R × v_reel(T) (typical and strong: Reels reach new people)
        + profile visits × (1 − (1 − bio click)^T)
C(T)  = visit to paid × D(T)                          one decision per person
N_m   = C(m) − C(m − 1);  A_m = Σ N_i (1 − c)^(m − i); c = 1 − (1 − yearly)^(1/12)
Outputs: N_1, A_12, C(12), round(A_12) × price (before platform commission)
```

| Assumption | Cautious | Typical | Strong | Basis (label) |
| --- | --- | --- | --- | --- |
| Story audience, ≤5K / 5-10K / 10-50K / 50-100K / >100K | 9.55 / 3.5 / 1.35 / 0.55 / 0.5% | 10.4 / 5 / 5 / 5 / 5% | 20.5 / 20.5 / 8 / 6.5 / 5% | Socialinsider Stories, image and video (measured, brand accounts); typical floor 5% and strong above 10K: IQFluence "5-8% of followers" (vendor claim); strong up to 10K: Socialinsider six-frame sequence 20.5% (measured), HypeAuditor nano 1-10K engage most (vendor data) |
| Reel reach by tier | feed 6.65 / 5.75 / 5.5 / 4.5 / 3.5% | Reels 9.78 / 7.55 / 7.1 / 5.6 / 5% | as typical | Socialinsider reach and Reels studies (measured, brand accounts) |
| Comments per Reel view | 0.52 / 0.60 / 0.49 / 0.36 / 0.37% | same | same | Socialinsider medians, our division |
| Keyword comments per view | × 2.0278 | same | same | Metricool +202.78% (measured); treating them as keyword comments is inference |
| DM link opened | 18% | 30% | 45% | CommuniPass 18-35%, ChatAutoDM 25-45% (vendor claims, no dataset) |
| Link-sticker click per viewer per Story | 1% | 3% | 5% | Creatorflow 1-5% (rule of thumb); IQFluence median 4.1%, strong creators 6-7% (vendor data) |
| Broadcast click per member per message | 1.27% | 1.45% | 2.09% | MailerLite email medians (measured; proxy) |
| Bio click per profile visitor a month | 1% | 2% | 3% | Hopp by Wix 1-3% (rule of thumb) |
| Visit to paid | 0.72% | 2.9% | 10.7% | Dynamic Yield luxury retail; RevenueCat Health & Fitness median; RevenueCat hard-paywall median day-35 (measured; proxies) |
| Channel overlap | Reels nested in Stories | Reels add people | as typical | Instagram ranking statement (platform); our assumption |
| Cancellations | input | input | input | 30% default is an owner assumption; RevenueCat H&F first renewal 46-68% and Coachway 45% at month 12 show more (context) |

Strong-case calibration: per link Story 5% tap × 10.7% pay = 0.535% of
viewers, the low end of the owner-supplied creator example (Ryan Humiston:
roughly 500-1,500 of his USD 19.99 plans per 100,000 YouTube views; no public
source for the sales figure was found; the store price is cited), and the
12-month share for accounts up to 10,000 followers (about 2.4%) sits inside
the creator rule of thumb that 1-3% of an engaged audience buys over time
(Passion.io course benchmarks, vendor). Larger accounts get lower shares
(Stan creator sales by follower count, vendor data).

Worked results at AED 199, 8 link Stories, 4 keyword Reels, DMs on, 30%
cancellations a year (month 1 / active at month 12 / sign-ups over 12 months /
AED a month at month 12):

| Followers | Cautious | Typical | Strong |
| --- | --- | --- | --- |
| 3,000 | 0.2 / 1.1 / 1.3 / 199 | 2.1 / 7.8 / 9.8 / 1,592 | 22.7 / 55.4 / 71.7 / 10,945 |
| 7,000 | 0.3 / 1.9 / 2.2 / 398 | 3.5 / 13.4 / 16.7 / 2,587 | 52.9 / 127.6 / 165.5 / 25,472 |
| 20,000 | 0.3 / 2.2 / 2.6 / 398 | 6.8 / 26.4 / 32.9 / 5,174 | 76.5 / 191.4 / 247.2 / 38,009 |
| 50,000 | 0.5 / 3.7 / 4.4 / 796 | 16.9 / 65.9 / 82.3 / 13,134 | 150.8 / 387.1 / 498.4 / 77,013 |
| 150,000 | 0.6 / 4.6 / 5.5 / 995 | 49.0 / 181.6 / 228.1 / 36,218 | 280.9 / 711.1 / 916.9 / 141,489 |

- The tier cliff is fixed: each channel's audience is at least what an
  account at the top of each smaller tier gets, so viewers, visits, every
  month's cumulative sign-ups and active subscribers never fall when
  followers rise (property test 100 to 1,000,000). The only exception found:
  with 60 link Stories a month and 80% yearly cancellations, the cautious
  active count can move by a hundred-thousandth where a larger tier's rates
  take over, because earlier sign-ups have longer to cancel.
- Levers ("What raises your number", strong case, one change at a time):
  bio link per 1,000 profile visits a month, keyword Reels (turn on, or 4
  more), 4 more link Stories (month 1 and 12-month sign-ups only; they bring
  the same viewers sooner), a broadcast channel of 300 members, and "enter
  your Story views" (shows the assumed strong-case viewers).
- Display: whole people or "fewer than 1"; the monthly amount is whole active
  subscribers × price. Early access keeps "cautious month 1 - strong month 1".
- Default follower count on the page is 7,000 (the calibration example).

Earnings estimate: subscribers, monthly or upfront (monthly equivalent =
price / months), share on workout + nutrition, voice add-on uptake, paid
sessions, and the trainer's usual rate. Commission uses the ledger's own
marginal band function (`commission`, `BANDS`); for one price it equals
`projectedCommission`. Output: subscriptions, commission by band, amount
before other costs, and "about N sessions at your usual rate". Excluded and
stated: processing, AI usage at cost, voice usage, domain, refunds, disputes,
booking fees, tax.

Every result carries "Estimate, not a promise" / "Not an earnings promise",
the assumptions and a link to `/methodology`, which lists every source with
its date and use, the assumptions in force (read from settings) and a change
log.

### Super admin: assumptions and company details

Platform settings gain a "Growth & marketing" group:

- **Marketing estimates** (`marketing`, operator controls like the
  application settings: always enabled, no connection test, cannot be
  disconnected). Fields (version 2026-09-28.3): assumptions version (the
  earlier defaults `2026-09-28` and `2026-09-28.2` read as the current one),
  Story audience per tier for each scenario (`FOLLOWER_STORY_<CAUTIOUS|
  TYPICAL|STRONG>_<5K|10K|50K|100K|ABOVE_100K>`), per-scenario link click,
  DM open, broadcast click, bio click and visit to paid
  (`FOLLOWER_<CLICK|DM_OPEN|BROADCAST_CLICK|BIO_CLICK|PAID>_<SCENARIO>`), the
  engagement benchmark and the largest scaling, plus "Public company details"
  shown on `/about` only when set. Reel reach, comments per view and the
  keyword factor are cited constants in code. Percentages above 100 and a
  scaling outside 1-10 are refused; an inconsistent set (cautious above
  typical, or typical above strong) is ignored and the cited defaults apply.
  A value that leaves its cited default needs the operator's reason. The
  old low/high keys of version 2026-09-28.2 are no longer read.
- `IntegrationDefinition.controls` replaces the hard-coded
  `id === "application"` checks in the settings API and page.

### Connect Instagram (optional, disabled until configured)

Settings entry **Instagram (follower estimates)**: app ID, app secret
(sealed like other secrets), redirect URI
(`/api/v1/trainer/instagram/callback` on the platform address) and "Meta app
review approved for instagram_business_basic". The connection test is
`unavailable` until approval is recorded; `integrationCapability("instagram")`
needs all three values plus approval. Instagram API with Instagram Login only
serves professional (business and creator) accounts.

Owner-only routes (`apps/api/src/marketing.ts`):

- `GET /api/v1/trainer/instagram`: availability, saved numbers, the model.
- `POST /api/v1/trainer/instagram/authorize` (platform address, rate
  limited): stores a single-use state (hash, session hash, 10-minute expiry)
  as a workspace record and returns the Instagram authorize address.
- `GET /api/v1/trainer/instagram/callback`: checks the state against the
  signed-in owner's session, deletes it, exchanges the code, reads
  `followers_count` and the likes and comments of up to 12 recent posts, and
  stores only `{username, followers, mediaCount, engagementRatePct,
  postsSampled, fetchedAt}`. The token is used in memory and discarded.
  Redirects to `/trainer/growth?instagram=connected|declined|expired|failed|
  professional_required|unavailable`.
- `DELETE /api/v1/trainer/instagram`: removes the saved numbers.

Events: `instagram.authorization_started`, `instagram.snapshot_saved`,
`instagram.snapshot_removed` (no token). Nonproduction fixtures can replace
the HTTP calls through `buildApp({ providers: { instagram } })`.

### Trainer workspace

- New owner page **Followers & growth** (`/trainer/growth`,
  `components/trainer-growth.tsx`): Connect / refresh / remove Instagram, the
  follower calculator filled from the saved numbers, and the tagged links.
- New optional setup step **Share your link** (`share`, after Publish) in the
  onboarding registry: tagged links for the bio and Stories
  (`utm_source=instagram&utm_medium=social&utm_campaign=bio|story`, which the
  existing consented acquisition tracking records as channel and campaign
  codes), the follower estimate, and "I've shared my link" with the channels
  used (`PUT /api/v1/onboarding/share`). It is complete once the workspace is
  published and the owner saved it; before launch it shows "Launch first".
  It never gates publishing. `SETUP_CHECKLIST` in contracts mirrors the
  registry (a test keeps them equal); the checklist now has 17 base steps
  (23 with nutrition), and the three tests that counted steps were updated.
- The signup form pre-fills the address typed in the public preview
  (`/signup?slug=`).

## Honesty rules enforced by tests

`tests/marketing-site.test.ts` fails when public pages, llms files or the
marketing sources name a domain registrar, when rendered pages or llms files
name the payout provider, or contain hype and invented-proof phrases
("trusted by", "as seen in", "#1", "guaranteed", "passive income", …). No
testimonials, logos, customer counts or ratings exist; market figures appear
only with a cited source on `/methodology`. Headline candidates B and C from
the brief can be tested with the existing landing wording experiments
("landing-welcome" slot); only true variants should be tested.

## Checks run

- `npx tsc --noEmit` (whole repository): passes.
- `tests/marketing-site.test.ts`: 13 pass (registry integrity, page set,
  discovery and robots, metadata, JSON-LD validity and visible-text match,
  llms files, follower and earnings arithmetic, settings mapping,
  disclaimers, platform-driven brand/availability/registration, checklist
  mirror, honesty scan).
- `tests/marketing-api.test.ts` (PGlite): 6 pass (public platform endpoint,
  Instagram owner-only single-use session-bound flow with no stored token,
  disabled until approved, snapshot reader, settings validation, Share your
  link step).
- `tests/logical-css.test.ts`: passes with `marketing.css`.
- Related existing suites (PGlite): discovery-seo, discovery-directory,
  discovery-install, fix-settings, platform-settings, provider-configuration,
  settings-runtime, rtl-layout, logical-css, fix2-web, acquisition,
  accounts-web, joining-web, governance-web: 97 pass, 0 fail. platform,
  onboarding-completion, nutrition (step counts updated): 58 pass, 0 fail.
- `npm run build`: the first run stopped at Next's type check (the web
  tsconfig is not strict, so a zod-inferred type needed a cast); after the fix
  the second run passed. `npx tsc --noEmit -p apps/web/tsconfig.json` also
  passes.
- Local Playwright check (local Chromium at `/opt/pw-browsers/chromium`,
  never a cloud browser; API on PGlite and `next dev`, because the production
  build had already been run): every one of the 41 rendered marketing pages at
  390 and 1440 pixels returned 200 with no horizontal overflow, exactly one
  H1, a "… | TrainsYou" title, the canonical address, a description, one
  valid JSON-LD block, no noindex and no console errors; `/`, `/pricing`,
  `/follower-calculator` and `/features` with `?lang=ar` render right to left
  without overflow; the follower calculator updates on input
  (5,000 followers / 8 Stories "0–11" → 40,000 / 20 "1–43"), the address
  preview shows `/coach/layla-strength`, the demo tabs switch, the mobile menu
  and desktop dropdown reach `/trainer-brain`; `/llms.txt`,
  `/llms-full.txt`, `/sitemap.xml` (every page) and `/robots.txt` answer;
  `/features/teleportation` is 404; `/login` carries the configured name.
  The check found one real defect before it passed: a formatting helper
  exported from a client module was called from a server component; it now
  lives in `marketing-calculators.ts` (`aedWhole`).
- Not run: the full repository suite, the PostgreSQL sandbox suite and the
  e2e harness.

## Review fixes (28 September 2026, second pass)

Blocker and majors from the review of `693edd1`, all fixed:

- **Calculator maths** (above): unique viewers, saturating visit chance,
  first-month and twelve-month figures bounded by V × conversion, nudge on the
  same curve, methodology formula rewritten (now registry text, so it is also
  in llms-full.txt). Tests: bounds over a grid of inputs, the review's
  impossible cases (1,000 followers / 60 Stories: at most 3), monotone and
  saturating in Stories.
- **Conversion benchmark**: defaults 0.72-2.89% with the label above; settings
  defaults, help text, source `usedFor` and the model version updated.
- **Shown = used**: copy quotes assumptions through `{CLICK_RANGE}`,
  `{PURCHASE_RANGE}` and `{ENGAGEMENT_AVG}`, resolved by `brandText(text,
  appName, figures)` from `platform.followerModel` on pages, metadata,
  JSON-LD and llms files. `followerModelAdjustments()` marks any value that
  differs from its cited default as "Adjusted by the operator (version X);
  differs from the cited source" on /methodology and in the calculator, with
  the operator's note in the change log. New setting
  `FOLLOWER_MODEL_CHANGE_NOTE`; saving marketing settings is refused while a
  value differs from its default and the note is empty.
- **Pre and postnatal**: rewritten to the safety floor (any mention of
  pregnancy, bleeding, dizziness or chest pain pauses training and comes to
  the trainer whatever the settings; pregnant subscribers: the Brain drafts,
  the trainer approves; automation only for postnatal return after
  clearance). Every specialty page now separates "Always paused and sent to
  you, enforced in code" (each item must trip `safetySignal`) from "What you
  might choose to review yourself" (no item may trip it); a test enforces
  both, and no rule card mentions a floor situation.
- **Early access** (registration closed): `POST /api/v1/public/early-access`
  (`apps/api/src/early-access.ts`, migration `067_early_access.sql`,
  platform-scoped, service role only, RLS `service_only`, grants in
  `infra/runtime-role.sql` and `verify-runtime-access.mjs`). Name, email,
  Instagram handle, specialty, emirate, followers, the calculator estimate
  and the typed address; explicit consent (notice `early-access-notice:v1`
  plus the privacy version, or `privacy:unpublished`); platform address and
  same origin only; 5 requests per 10 minutes; a hidden field and a
  3-second minimum fill time drop bots silently; one row per lower-cased
  email (later submissions update it; the answer never reveals whether an
  address exists). Channel, campaign and medium come only from a visitor who
  gave optional analytics consent (`consentedVisitor`). Super admin: the
  "Early access requests" operations view (newest 500), CSV export
  (formula-safe), status (new, contacted, invited, declined) and erasure,
  each audited without personal data. The form (`EarlyAccessForm`) is
  pre-filled from the follower calculator and the address preview through
  the address (`withEarlyAccessContext`), and keeps a mailto fallback whose
  body carries the numbers.
- **Scale of the product**: `packages/contracts/src/marketing-features.ts`
  holds the capability inventory (85 capabilities in 10 areas, each with
  its provider availability and offering) and the 7 generic tool categories
  it replaces (no competitor names). /features shows four illustrative
  screens (review queue, subscriber Today, workout logger with rest timer,
  monthly statement computed with `estimateEarnings`; labelled as sample
  data), the full matrix with "Available soon" chips, the replaced tools and
  the feature guides; the home page gains an "Everything included" strip
  whose counts come from the registry, and the screens.
- **SEO depth**: every feature page gained a practical section and FAQs;
  /about, /security-and-privacy, /get-started, /earnings-calculator (worked
  example), /methodology and /demo expanded; the four guides were rewritten
  (pricing about 1,000 words with worked AED tables checked against the
  calculator by a test; followers-to-clients about 790 with a live example
  table from the model in use; advertiser permit about 510, limited to what
  the cited report says; coaching rules about 670). Test: no indexable
  non-hub page below 350 words, guides at least 500, the pricing guide at
  least 1,000.

Minors fixed:

- JSON-LD: Organization (name, url, logo) and WebSite on every page, no
  dangling `@id`; Article author is the Organization by name and has the page
  image; WebPage `primaryImageOfPage`.
- Social previews: `app/og/route.tsx` (next/og) renders brand, eyebrow and
  H1 at 1200×630; metadata sets `og:image` and a `summary_large_image`
  Twitter card. A route handler, not `opengraph-image.tsx`, because the
  file convention in `[[...path]]` would also attach platform images to coach
  websites and app pages.
- Brand: `app/manifest.ts` serves `platformManifest(APP_NAME)`; the static
  manifest and the "b." icons are removed. Icons and the JSON-LD logo are
  the name's initials, rendered by `GET /api/v1/public/platform/icon/:file`
  (180, 192, 512, maskable-512). Coach pages set `applicationName` to the
  coach and fall back to a coach description, never the platform's.
- Titles at most 60 characters with " | {APP_NAME}", descriptions at most
  155 (tested); /about is "About us".

Also fixed while verifying: the Instagram test read workspace tables through
the service role, which PostgreSQL refuses (it passed only on PGlite); it now
reads them in the owner's scope. The e2e "extended" scenario's stale checks
(old calculator heading, `/icon.svg`) follow the new pages.

Checks run (this pass):

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass.
- PGlite: marketing-site (20), marketing-api (9) and 22 related files
  (discovery-seo, -directory, -install, logical-css, rtl-layout, fix-web,
  fix2-web, governance-web, governance-step-up, infra-ops-web, acquisition,
  accounts-web, joining-web, platform-settings, fix-settings,
  provider-configuration, settings-runtime, admin-completion,
  messaging-inquiries, onboarding-completion, nutrition, platform):
  214 tests, 214 pass.
- PostgreSQL restricted role, `/opt/tools/pg-sandbox.sh 56177`: migrations
  (55), runtime role and `verify-runtime-access` passed; marketing-api,
  marketing-site, governance-step-up, discovery-seo, admin-completion,
  acquisition: 67 tests, 67 pass, `PG_SELECTED_FAILED_FILES=0`.
  platform-settings cannot run in the sandbox's selected-file mode (it
  asserts the full runner's database name); it passed on PGlite.
- `npm run build`: passes (routes include `/manifest.webmanifest` and `/og`).
- Local Playwright (Chromium at `/opt/pw-browsers/chromium`, never a cloud
  browser; API on PGlite, `next start` on the build): all 39 rendered
  marketing pages at 390 and 1440 pixels (78 loads) returned 200 with no
  horizontal overflow, one H1, a title of at most 60 characters ending
  "| TrainsYou", one valid JSON-LD block, an `og:image` to `/og`, a large
  Twitter card, no noindex and no console errors; `/`, `/features`,
  `/follower-calculator` and `/uae` with `?lang=ar` render right to left
  without overflow; the follower calculator updates (5,000 / 8 "0–5" →
  40,000 / 20 "0–15", 540–800 viewers); /features shows 85 capability rows
  and 4 screens; the home strip reads "85 capabilities in one workspace";
  `/uae/abu-dhabi` redirects to `/uae#abu-dhabi`; the guide's example table
  has 3 rows; `/og?path=/features` is a 1200×630 PNG; the manifest names
  TrainsYou with the generated icons.
- Not run: the full repository suite, the full PostgreSQL suite and the e2e
  harness. The early access form was checked by render tests and the API by
  PGlite and PostgreSQL tests, not submitted in the browser (the local
  deployment has registration open).

## Not done / next

- Stage record: this package ran in parallel with others, so it does not edit
  `CLAUDE_HANDOFF.md`, `docs/COMPLETION_STAGES.md` or
  `docs/PROJECT_MEMORY.md`; the coordinating session records it there.
- Merge notes: `apps/api/src/onboarding.ts` gains the `share` step (other
  packages touching the registry need the step counts in tests re-checked);
  Instagram state and numbers are workspace records; the only migration is
  `067_early_access.sql` (renumber it if another package takes 067).

- Arabic pages (`/ar/...` with hreflang) wait for human translation.
- Early access: no automatic retention period yet (rows stay until the Super
  admin erases them or marks them); the confirmation email to the person is
  not sent (the transactional email provider is not configured).
- Guide depth: the followers, permit and rules guides are 510-790 words,
  below the review's 1,000-1,800 target; the permit guide is limited by
  what the cited report states. Licensing facts per emirate were not
  added because no official source confirmed them.
- Search Console and keyword validation after launch.
- Public company details must be supplied by the owner.
- When the web-addresses package (subdomains) lands, `coachAddressTemplate`
  in `publicPlatform()` should return `{slug}.<root>`.
- Headline A/B via the existing experiments needs admin-configured variants.
