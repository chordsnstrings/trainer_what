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

Follower estimate (version `2026-09-28.4`, stage 2026-09-28k and its review
round 1): three scenarios from the same arithmetic. **The headline always
shows the strong case** ("Strong case: an engaged, growing audience and weekly
sharing"; "and weekly sharing" only when the inputs have 4 or more link
Stories or keyword Reels a month), at the owner's direction; cautious and
typical appear only in the "How we estimate" table. Every headline line
carries the same best-case qualifier ("Up to N new paying subscribers in your
first month", "Up to N active subscribers after 12 months, after X% yearly
cancellations, and still growing" when month 12 still rises, "Up to AED N a
month", "Up to N sign-ups over 12 months"). The research behind cautious and
typical is the proposal of 28 September (Socialinsider, Metricool, IQFluence,
vendor DM claims, MailerLite, RevenueCat, Dynamic Yield); the strong case uses
the top values found in that research plus two stated assumptions (the Story
audience up to 10,000 followers and the new people each month).

Inputs: followers F, price, link Stories a month k (8), call-to-action Reels
or posts a month n (4), comment-keyword DMs on/off (on), members who cancel
per year (30%, 5-80%; a missing or non-numeric value is 30%), and optional
profile visits a month (the bio link counts only when entered), broadcast
members and link messages a month (4), own average Story views (replaces the
Story audience guess) and engagement rate.

```
g     = your engagement / 0.48%, within ×0.5..×2 (1 if unknown)
S     = Story audience = max over tiers j ≤ yours of min(F, top_j) × share_j × g, or your views
        (strong: share × min(1, g), never below the typical share × g: the strong
        share already assumes an engaged audience, so engagement is not counted twice)
c     = 1 − (1 − rate)^times                    a person's chance of a visit in a month
r     = new people each month (0 / 1.5 / 8%)    share of each group new to your link
f_1   = 1;  f_(m+1) = (1 − r)(1 − c) f_m + r    share of a group not yet visited
V_m   = Σ groups size × c × f_m                 Stories and broadcast nested (Reels too
                                                 when cautious); profile visits × bio click
        + n × Reel viewers × keyword visit chance (typical, strong: each Reel reaches
          new people; viewers and comment rate from one tier)
D(T)  = Σ_(m ≤ T) V_m, the most any tier at or below yours gives with its Reel figures
N_m   = visit to paid × (D(m) − D(m − 1))       one decision per person
A_m   = A_(m−1) × (1 − churn) + N_m;  churn = 1 − (1 − yearly)^(1/12)
Outputs: N_1, A_12, D(12) × paid, whole A_12 shown ("fewer than 1" is 0) × price
```

| Assumption | Cautious | Typical | Strong | Basis (label) |
| --- | --- | --- | --- | --- |
| Story audience, ≤5K / 5-10K / 10-50K / 50-100K / >100K | 9.55 / 3.5 / 1.35 / 0.55 / 0.5% | 10.4 / 5 / 5 / 5 / 5% | 20.5 / 20.5 / 8 / 6.5 / 5% | Socialinsider Stories, image and video (measured, brand accounts); typical floor 5% and strong above 10K: IQFluence "5-8% of followers" (vendor claim); strong up to 10K: **our assumption**, the 20.5% Socialinsider measured for a six-frame sequence (all account sizes) used as a monthly audience, against a measured 3.5-4.2% for 5-10K; HypeAuditor nano 1-10K engage most (vendor data, post engagement) |
| New people each month | 0% | 1.5% | 8% | Cautious: the same people all year (research proposal). Typical: about Socialinsider's measured yearly follower growth, 11-22% by tier, 1-1.7% a month (measured; our rounding). Strong: **our assumption** for a growing audience (new followers plus people Instagram starts showing your content to), set above the default monthly cancellations (2.9%) |
| Reel reach by tier | feed 6.65 / 5.75 / 5.5 / 4.5 / 3.5% | Reels 9.78 / 7.55 / 7.1 / 5.6 / 5% | as typical | Socialinsider reach and Reels studies (measured, brand accounts) |
| Comments per Reel view | 0.52 / 0.60 / 0.49 / 0.36 / 0.37% | same | same | Socialinsider medians, our division |
| Keyword comments per view | × 2.0278 | same | same | Metricool +202.78% (measured); treating them as keyword comments is inference |
| DM link opened | 18% | 30% | 45% | CommuniPass 18-35%, ChatAutoDM 25-45% (vendor claims, no dataset) |
| Link-sticker click per viewer per Story | 1% | 3% | 5% | Creatorflow 1-5% (rule of thumb); IQFluence median 4.1%, strong creators 6-7% (vendor data) |
| Broadcast click per member per message | 1.27% | 1.45% | 2.09% | MailerLite email medians (measured; proxy) |
| Bio click per profile visitor a month | 1% | 2% | 3% | Hopp by Wix 1-3% (rule of thumb) |
| Visit to paid | 0.72% | 2.9% | 6.2% | Dynamic Yield luxury retail; RevenueCat Health & Fitness download-to-paid within 35 days, median and upper quartile (measured; proxies that may overstate, as an install shows more intent than a Story tap) |
| Channel overlap | Reels nested in Stories | each Reel reaches new people | as typical | Instagram ranking statement (platform); our assumption |
| Cancellations | input | input | input | 30% default is an owner assumption; RevenueCat H&F first renewal 46-68% and Coachway 45% at month 12 show more (context) |

Strong-case calibration, as stated on /methodology: per link Story 5% tap ×
6.2% pay = 0.31% of the viewers each time, and 8% of the audience is new to
the link each month, so sign-ups keep coming and active subscribers still
grow at month 12 (at up to 50% yearly cancellations). Over 12 months the
strong case signs up about 2% of followers up to 10,000 followers, a smaller
share for larger accounts. The page says plainly that this is far above
published creator averages: Passion.io's course benchmarks (0.1-1% low,
1.5-5% mid, 0.52-1.1% for higher-priced courses) and Stan's average creator
sales (USD 273 a month for 1-10K followers, against AED 23,084 a month in the
7,000-follower strong case). The owner's creator example (a named fitness
creator selling roughly 500-1,500 USD 20 plans per 100,000 YouTube views) has
no public source, so the public pages no longer name the creator or cite the
figure as evidence: /methodology mentions it only as "an unverified example"
from our founder, compared per view (0.31% is below it), with no name or link.
The all-category RevenueCat hard-paywall median (10.7%, trial-to-paid) is kept
as context only, with its overstatement caveat.

Worked results at AED 199, 8 link Stories, 4 keyword Reels, DMs on, 30%
cancellations a year (month 1 / active at month 12 / sign-ups over 12 months /
AED a month at month 12):

| Followers | Cautious | Typical | Strong |
| --- | --- | --- | --- |
| 3,000 | 0.2 / 1.1 / 1.3 / 199 | 2.1 / 8.4 / 10.5 / 1,592 | 13.2 / 50.3 / 61.9 / 9,950 |
| 7,000 | 0.3 / 1.9 / 2.2 / 398 | 3.5 / 14.5 / 18.0 / 2,985 | 30.7 / 116.4 / 143.3 / 23,084 |
| 20,000 | 0.3 / 2.2 / 2.6 / 398 | 6.8 / 28.6 / 35.4 / 5,771 | 44.4 / 171.9 / 211.3 / 34,228 |
| 50,000 | 0.5 / 3.7 / 4.4 / 796 | 16.9 / 71.4 / 88.5 / 14,129 | 87.4 / 344.2 / 422.7 / 68,456 |
| 150,000 | 0.6 / 4.6 / 5.5 / 995 | 49.0 / 196.6 / 244.7 / 39,203 | 162.8 / 634.2 / 779.3 / 126,166 |

Strong case, 7,000 followers: new subscribers by month 30.7, 21.4, 15.7, 12.3,
10.2, 8.9, 8.1, 7.6, 7.3, 7.1, 7.0, 7.0; active 30.7, 51.2, 65.4, 75.7, 83.7,
90.1, 95.6, 100.4, 104.8, 108.9, 112.7, 116.4 (still rising at month 12).
At 50% cancellations: 96.6 active; at 80%: 61.5 (then it no longer rises at
month 12, and the headline drops "and still growing").

- The tier cliff is fixed: each channel's audience is at least what an
  account at the top of each smaller tier gets, and the Reel channel takes
  its viewers and comment rate from one tier, choosing by month the most any
  tier gives. Property test 100 to 1,000,000 followers (with fine steps at
  4,900-7,000 and 110,000-113,000) in twelve variants: viewers, visitors,
  every month's cumulative sign-ups and 12-month sign-ups never fall in any
  scenario, and typical and strong active subscribers never fall. Cautious
  keeps the same people all year, so where a larger tier's figures bring its
  sign-ups sooner its month-12 count can dip: by up to a ten-thousandth of
  itself at the default cancellations and up to 0.5% in the 80% variants.
- Levers never lower the headline: property test over link Stories (0-60),
  keyword Reels (0-60), broadcast members and links, engagement, own Story
  views and profile visits at 1,000-150,000 followers and 5-80% yearly
  cancellations: the strong case's active subscribers and monthly amount
  never fall. Typical never falls up to 30% cancellations; cautious, and
  typical above 30%, can fall by about 1% a step (sooner sign-ups have longer
  to cancel; typical renews at 1.5%, below those cancellation rates).
- Levers ("What raises your number", strong case, one change at a time):
  bio link per 1,000 profile visits a month, keyword Reels (turn on, or 4
  more), 4 more link Stories, a broadcast channel of 300 members, and "enter
  your Story views" (shows the assumed strong-case viewers). Each shows the
  gain in the first month and in active subscribers after 12 months (the
  headline), with the monthly amount; a change that would lower the headline
  is not offered.
- Display: whole people or "fewer than 1"; the monthly amount is the whole
  active subscribers shown × price, so "fewer than 1" is AED 0. Early access
  keeps "cautious month 1 - strong month 1".
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
  disconnected). Fields (version 2026-09-28.4): assumptions version (the
  earlier defaults `2026-09-28`, `2026-09-28.2` and `2026-09-28.3` read as the
  current one), Story audience per tier for each scenario
  (`FOLLOWER_STORY_<CAUTIOUS|TYPICAL|STRONG>_<5K|10K|50K|100K|ABOVE_100K>`),
  per-scenario link click, DM open, broadcast click, bio click, visit to paid
  and new people each month
  (`FOLLOWER_<CLICK|DM_OPEN|BROADCAST_CLICK|BIO_CLICK|PAID|RENEWAL>_<SCENARIO>`),
  the engagement benchmark and the largest scaling, plus "Public company
  details" shown on `/about` only when set. Reel reach, comments per view and
  the keyword factor are cited constants in code. Percentages above 100,
  renewal above 50 and a scaling outside 1-10 are refused. An inconsistent
  set (cautious above typical, or typical above strong) is refused on save
  with the reason ("To lower a strong value below its typical one, lower
  typical and cautious too"); if one is present anyway (for example saved
  before this check) the public pages ignore it and the cited defaults apply.
  A value that leaves its cited default needs the operator's reason. The old
  low/high keys of version 2026-09-28.2 are no longer read.
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
only with a cited source on `/methodology`. A figure without a public source
(the founder's creator-sales example) is never cited as a source, never names
a person and appears only on `/methodology`, labelled "unverified" and "not
used as evidence"; the tests fail if the creator's name, the store link or
the old "bought a USD 20 plan", "1-3% ... creators say", "sell far more" or
"can do far better" wording returns to any public page or llms file. Headline candidates B and C from
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

## Light site, relay hero and shorter copy (28 September 2026, `core/marketing-light`)

Owner feedback on the live site: dark green on a dark-mode device, not
professional enough, too many words, and the first page does not show what
the product does (the trainer teaches trainsyou, which then trains that
trainer's subscribers). Theme changes are in [brand.md](brand.md) "Light
public pages": every public platform page is always light.

### Home structure

Every region (header content, hero, bands, inner pages, closing, footer)
sits in one container, `.mk-container`: `max-inline-size` 1280 px
(`--ty-layout-max`) plus a gutter of 48 px, 24 px at 1150 px and below and
16 px at 760 px and below, so all content starts at the same edge (x = 80 at
1440 px, 320 at 1920 px). The header bar itself (background and rule) spans
the page.

1. **Hero** (`section.mk-hero`): the H1 and the copy side by side, the relay
   full width beneath (copy stacked above it below 1024 px). Eyebrow, H1
   `BRAND_COPY.homeHeadline` "Teach your AI. It trains your subscribers."
   with `h1Highlight` "trains" in Pace (a `span.mk-mark`, not `<mark>`); the
   15-word `lede` "Share your methods and rules. Your AI coaches every
   subscriber day by day, your way."; the primary action (`button large
   mk-cta`: "Teach your AI", or "Join early access" while registration is
   closed, 15 px semibold at every width); "See how it works"; and "Built for
   UAE trainers · You set the price in AED · No technical skills needed".
   One name for the product in the hero: "your AI". The Trainer Brain is
   introduced on deeper pages.
2. **The relay** (`components/marketing/hero-flow.tsx`, a server
   component): a `figure` labelled "How trainsyou works" with three steps
   in an `ol`, one row of three cards at every width: 01 You teach
   (Methods, Rules, Programmes, a sample rule), 02 trainsyou learns (the
   relay mark on a Pace tile, or the initials for a renamed platform; "Your
   coaching, applied to every day", "Confident: applies your rule"), 03
   Subscribers train (today's session, next week's progression, and
   "Voice-led session" with the /features/voice-coach chip only while the
   voice provider is on; otherwise "Missed Tuesday · moved to Thursday"). A
   dashed loop returns from 02 to 01: "Not sure? It asks you first. Pain and
   red flags always come to you." Every card has the same 48 px icon slot so
   the titles line up; wires sit at the icon row. Tagged "Illustration with
   sample data"; no headings, metrics, counts, revenue or hard-coded domain.
   At 760 px and below the relay is a compact row (icons and titles only,
   short wires, the loop), so all three steps show on a 390×844 first
   screen. Wires mirror right to left (`scale: var(--inline-sign) 1`); the
   lockup and the mark never mirror. Motion is CSS only, plays once, ends at
   2.5 s and runs only under `prefers-reduced-motion: no-preference`; every
   card and word shows from the first paint (only the wires, the travelling
   dot, the core tile's pulse and the row ticks move), and the decorative
   dot rests hidden.
3. **What your subscribers get** (white): flat tiles, each a link to its
   feature page with one short line (Daily plan, Guided workouts, Progress
   they can see, and the first available of Nutrition, Chat and Sessions
   with you). Unavailable features are not shown here; "Available soon"
   stays on /features. "All features".
4. **You stay in charge** (paper): "You choose what runs on its own. Take
   over any subscriber, any time." and the decision flow card (one
   `role="img"` with a text summary; subscriber message, the 2.5 kg rule and
   confidence meter, the three lanes). Links: "How your AI decides"
   (/trainer-brain) and "Try the demo".
5. **Your site. Your price.** (white): the coaching address from
   `coachAddressTemplate` shown without the scheme in the body font (a
   browser-bar mock with `yourname` while registration is closed, the live
   `AddressPreview` with a Pace claim button while open), the band pills
   from the ledger's `BANDS` under "Commission by paying subscriber" (25% ·
   first 100, 20% · 101–300, 15% · 301–1,000, 10% · 1,001+) and "Each rate
   applies only to the subscribers in its band."; the copy names card
   processing and AI usage at cost; "Pricing in detail".
6. **What are your followers worth?** (paper): "The headline is a strong
   case for an engaged, growing audience, from published benchmarks and our
   stated assumptions. An estimate, not a promise." and the compact follower
   calculator (v3, strong-case headline) unchanged in its own
   `.mk-home-calc` block (only its container is styled); "Open the full
   calculator".
7. **Questions trainers ask**: six FAQs, the same list as the FAQPage
   JSON-LD; the first, "How does trainsyou work?", answers with the
   answer-first introduction. All start closed, which keeps the home page
   under its 400-word budget (an open first answer measured 435 words).
   The budget counts the visible words in `main` outside the follower
   calculator block (`.mk-home-calc`, block 6), which belongs to the
   calculator package; `scripts/brand-check.mjs` reports both numbers. On
   28 September: 392 words outside the calculator, 112 in the closed v3
   compact calculator, 504 in total.
8. **Closing** (every marketing page): a contained Pace panel, H2 the brand
   line (or "Ready to teach your AI?" for a renamed platform), "Guided setup.
   Nothing goes live until you publish.", the ink button and a link ("See
   how it works" on / and /follower-calculator, otherwise "What are my
   followers worth?").

The optional-analytics prompt (`components/acquisition.tsx`) on marketing
pages is a slim bottom bar (one sentence, "Allow analytics", "No thanks",
"Details"; 58 px tall at 1440 px) that opens only after the visitor
scrolls, so the first screen is never covered. The footer's "Analytics
preferences" button opens the full panel; pages with that footer show no
floating preferences button. Other pages keep the full panel as before.

Measurements: see "Review fixes" below.

### Where the home content went (moved, not deleted)

| Former home block | Now |
| --- | --- |
| "What is trainsyou?" | Already the /about introduction (`ENTITY_SENTENCE`, still in llms.txt and the Organization JSON-LD); the "not" statements are /about's "What we are and are not" |
| "Your income stops when your hours do." with the three price anchors and sources | /pricing "An hour sells only once" with its three sources and the anchor cards |
| "Everything included" counts | /features, as a paper strip |
| Eight subscriber cards | /features "What your subscribers get" |
| "Inside the product" screens, feature tiles | Already on /features |
| "Teach it. It coaches. You earn." steps | Replaced by the relay; /how-it-works has the eight steps |
| Trainer Brain cards (Confident, Not sure, Safety) and "You stay in control" bullets | /trainer-brain "How it decides" and "You stay in control" |
| The privacy and export bullet | Already on /security-and-privacy |
| Worked example | Stays on /pricing |
| The longer technical-skills FAQ | /faq (shared `TECH_FAQ`, shortened) |

Every moved passage keeps its `sources`, so llms-full.txt carries it under
its new page. `lastUpdated` stays 2026-09-28 on / and the receiving pages
(the sitemap `lastmod`).

### Copy limits

Applied now to / and the header pages (/how-it-works, /trainer-brain,
/features, /pricing, /about, /get-started), each with a `lede` (25 words or
fewer) as the one statement above the fold. The answer-first introduction
of those pages is an "In short" section before the FAQs (never straight
under the lede it would repeat); JSON-LD and llms-full.txt carry it
unchanged. Pages without a lede keep the introduction under the H1.
Other pages follow when next edited; /methodology and the calculator copy
belong to the calculator package.

| Element | Limit |
| --- | --- |
| H1 | 8 words or fewer, one idea, no colon subtitle |
| Eyebrow | 4 words or fewer |
| Lede | 25 words or fewer |
| Introduction | 35-65 words (tested), aim for 35-50 |
| H2 | 6 words or fewer (guides 9, questions allowed) |
| Section body | 2 paragraphs or fewer, 35 words each (guides 60) |
| Sentences | 20 words or fewer; at most one colon or semicolon |
| Cards and steps | Title 4 words, body 18 words |
| Bullets | 12 words, 5 per list |
| FAQ answers | 45 words; the first sentence answers |
| Hub tiles | One line, 12 words |
| Home page | 400 visible words in `main`, not counting the follower calculator block (reported separately) |

Voice: second person, active, UAE/UK spelling. Not used: seamless,
revolutionary, cutting-edge, unlock, empower, game-changing. Two text-only
sections in a row at most. Known exceptions kept on purpose: the home
introduction (locked by the brand test and reused as FAQ 1, 55 words), the
shared safety FAQ (one 27-word sentence) and the /about introduction (the
entity sentence).

### Checks for this package

- `tests/marketing-site.test.ts`: the home test (one H1 whose text is the
  registry `h1`, the highlight inside it, the lede length, the relay's text,
  tag and absence of headings, the voice and nutrition chips on and off,
  the address from `/coach/{slug}` and `{slug}.<root>` templates open and
  closed, no `yourname.trainsyou.com` literal, the band pills equal to
  `BANDS`, the H2 list, six FAQs equal to the FAQPage JSON-LD, the
  calculator line byte-identical); a copy-limits test for the header pages
  and the moved-content map; the counts and screens checks moved to
  /features. The 350-word floor is unchanged.
- `scripts/brand-check.mjs`: the home page as a new visitor sees it (the
  analytics notice in its default state) at 1440×900 (hero bottom, three
  relay cards in one row with aligned titles, nothing covered by the
  notice, one left edge for header, hero, bands, closing and footer, the
  bar after a scroll at most 64 px, visible words, H2 count, one H1) and
  390×844 (H1, primary action and all three relay titles on the first
  screen, one compact row, nothing covered, one left edge); inner
  marketing pages start at the header logo's edge; reduced motion (no
  animation, everything visible), motion allowed (every card visible at
  first paint, plays once, ends by 4.5 s, at rest after 5 s), right to
  left at 1440 (steps mirrored, wires towards the next step, lockup and
  mark not mirrored) and every public route at 390 with `?lang=ar` (no
  overflow).
- `scripts/browser-completion-check.mjs` (`npm run test:browser`): on `/`
  no analytics prompt before a scroll, then the bar; "No thanks" sets no
  identifier and does not return; the footer's "Analytics preferences"
  opens the full panel for opt-in, the readback and withdrawal.

### Review fixes (28 September 2026, second pass)

The structure above is the state after review round 1. Measured by
`npm run test:brand` on the production build, as a new visitor: at
1440×900 the hero ends at 771 px, the three relay titles sit at 483 px,
every region starts at x = 80, no notice shows before a scroll and the bar
is 58 px after one, and `main` has 380 visible words and 6 H2s; at 390×844
the H1 ends at 248 px, the primary action at 419 px and the three relay
titles at 611 px, in one row. The motion ends at 2.5 s. Declined: opening
the first home FAQ (435 words, over the 400 budget) and "your AI" in step
02 (the owner's brief names trainsyou as the middle step). Full list and
checks: `docs/COMPLETION_STAGES.md` stage 2026-09-28l, "Review round 1".

### Merged with calculator v3 (28 September 2026)

The owner approved the light home page, and `core/marketing-light` was
merged into the PR #4 branch (`integrate/round2`) on top of the follower
calculator v3. The home page keeps this package's structure; the
calculator keeps its own model, component, /methodology tables and copy.
Calculator copy that this package added or kept now follows v3 (the
headline is the strong case, labelled a best case and not a typical
result, with cautious and typical results shown, and always an estimate,
not a promise), within the copy limits above: the shared Instagram FAQ
(`INSTAGRAM_FAQ`, 45 words), the home "What are your followers worth?"
line, the /get-started minimum-followers answer, a second /about honesty
bullet ("The follower headline is a strong case: a best case, not
typical.") and the footer note ("Earnings and follower figures are
labelled estimates, never promises.", the /about bullet's wording and
the llms.txt scope; the merge first said "Figures on this site", which
also covered firm terms such as the commission bands, and review narrowed
it). The render test that no page calls the
follower result an estimate range now also covers /, /get-started and the
footer. The calculator's CSS uses the shared tokens, which resolve to the
light palette on public pages (white card, paper result panel, ink figure,
the green "Strong case" badge on its pale tint); no dark band returns.
Checks: `docs/COMPLETION_STAGES.md` stage 2026-09-28l, "Merge into the PR
#4 branch".

## Coach-to-subscriber journey (29 September 2026, `mk/walkthrough`)

The owner asked for "a UI animation that shows how the whole coach
onboarding process will go like and how that will translate to a
subscriber. the whole workflow." Built from part A of the accuracy-checked
storyboard (`scratchpad/marketing-motion/storyboard.md`; the deviations are
recorded there and below). Sitewide microanimations (part B) are a separate
track.

### What it is

- One player, eight chapters: the eight /how-it-works steps. Each chapter
  shows what the coach does in the workspace (a laptop mock), how it
  crosses a wire, and what it means for a subscriber (a phone mock in the
  demo coach's colours, "Layla Strength", the name the address preview
  already uses). Chapters 6-8 also draw the dashed return wire, the relay's
  "it asks you" loop: pain comes back to the coach, an unsure change is
  handed over, the payment reaches the coach.
- `components/marketing/journey.tsx` (server): the launch gate
  (`journeyAvailable`), the subscriber-line lookups, the chapter timings,
  the eight scenes and both placements. `journey-player.tsx` (the only
  client code, React only): the control bar, the chapter clock and the
  root's data attributes; the stage and captions arrive as server-rendered
  slots, so the mocks never enter the JavaScript bundle.
  `app/marketing-journey.css`, imported next to `marketing.css` in
  `app/layout.tsx`, holds the motion tokens and every journey style.
- /how-it-works: the "Eight steps, start to finish" section keeps its h2 and
  `ol.mk-steps`, with the registry titles and bodies unchanged and the
  HowTo JSON-LD untouched. Each step adds one subscriber line, looked up
  from the registry (never copied; a test resolves every lookup) behind a
  visually hidden "Your subscriber:" (the column header of "Who does what"
  on the same page). The steps show 4 columns from 1150 px, 2 below, and a
  scroll-snap carousel on phones; the active step gets an ink edge and a
  Pace bar, and a click on a card selects its chapter.
- Home: a paper band directly after the hero, with no heading (the six H2s
  and brand-check limits stay): the existing heading as a small label, the
  active step's title, the controls and "See how it works" to
  `/how-it-works#steps`. Its stage shows the same scenes with every word
  replaced by a bar (no words in the stage). It adds at most 13 visible
  words (label, one title, link).
- The launch gate: the second half of the workflow (publish, join, pay,
  daily coaching, payouts) exists only once a coach can launch, so both
  placements render only while registration is open and the model,
  payments and payouts providers are available. Otherwise /how-it-works
  renders its steps section exactly as before and the home page has no
  band. On the live site today (commerce off until the owner approves)
  the player stays hidden and appears by itself once those approvals are
  recorded (storyboard decision D10, needing the owner).
- Honesty: sample data only ("Illustration with sample data" on the full
  stage); no metrics, counts, revenue or amounts (prices and statement
  values are placeholder bars; the statement has three rows and no total);
  no AI usage, cost, fee or model names anywhere in the mocks; only
  features available now (chapter 4's nutrition tier and voice add-on rows
  follow their `/features` availability). Chapter 1's phone has no Join
  (nothing is published yet); chapter 5's follower joins, pays and answers
  the intake.
- New visible words: "Evaluate" (the Scenario lab button), "LS" (the demo
  coach's initials) and the slug `layla-strength` inside the address built
  from the platform's `coachAddressTemplate`; control names "Replay" and
  "Previous step" (accessible names only). Everything else is existing
  site wording in new places; `tests/marketing-journey.test.ts` checks the
  mock text against the marketing sources.

### Motion

- Tokens on `.mk, .mk-header, .mk-footer` (the brief's values):
  80/140/200/280 ms and 420 ms for emphasis; out, in, in-out and spring
  (success only: ticks, Reserved, Confirmed, Passed, Live, Applied and
  Rescheduled automatically, Approved, Paid).
- Base styles are each chapter's complete picture; keyframes hold only the
  starting states and run while the root carries `data-run`. Only opacity,
  transform (translate, scale, rotate) and one stroke-dashoffset (the rest
  ring) animate; scenes crossfade (opacity, with content-visibility so the
  seven hidden scenes skip rendering). Nothing is infinite; the player
  plays once through (about 54 s) and stops on its last chapter with
  Replay.
- The chapter clock is a Web Animations API animation on the active
  progress segment; its finish advances the chapter. The first automatic
  pass shows chapter 1 complete (no blank flash at load). A chapter
  restarts by rewinding its CSS animations' current time. The CSS
  animations are never played or paused through the API: in Chromium that
  detaches them from the style sheet, and a swap animation removed by the
  next chapter kept running (found by the browser check); pausing uses
  `animation-play-state` through `data-hold` instead.
- Auto-play starts only when at least half of the stage is on screen and
  the tab is visible. It holds (and resumes by itself) when the stage
  leaves the screen, the tab is hidden or a mouse rests on the player; it
  stops until Play when keyboard focus enters the player, on Pause, a
  swipe, a chapter button, Previous or Next, or a touch on the step cards.
- Phones (up to 760 px): a square stage showing one frame at a time under a
  strip (laptop icon, wire, phone icon); at each crossing the frames swap
  (the leaving one slides 12% towards the inline start and fades, the other
  enters). Mock text never goes below 11 px; the bar (Play, Previous, eight
  24 px-wide chapter targets, Next) fits one row at 360 px.
- Reduced motion: no auto-play, static complete chapters, instant changes;
  Play runs a slideshow whose clock has no target, so nothing on screen
  moves. Without JavaScript: every step shows, the stage shows chapter 1
  complete and no controls show.
- Keyboard and screen readers: Pause/Play/Replay is the first control;
  chapter buttons use a roving tabindex (arrows, mirrored in right to left,
  Home and End), carry `aria-current="step"` and are named "01 Claim your
  address" from the visible number and heading; a polite live region
  announces the step only after manual navigation. The stage is
  `aria-hidden`.
- Right to left: everything uses logical properties; the coach sits at the
  inline start, the wires point from coach to phone, the platform mark is
  never mirrored.

### Weight (measured on the production build)

With the launch gate open, against the gate-closed page: /how-it-works
+9.0 kB gzipped (HTML with its inline RSC payload; 9.6 kB in an earlier
run; storyboard limit 16 kB) and / +6.3 kB (limit 10 kB). The stylesheet is 29.0 kB raw; minified, it
adds about 4.1 kB gzipped to the combined app CSS (limit 5 kB; all app
CSS ships on every route). The island minifies to 7.1 kB, 3.0 kB gzipped
(limit 8 kB). No images and no new dependency.

### Checks

- `tests/marketing-journey.test.ts` (10 tests): the captions are the
  registry's eight titles and bodies in the same `ol`, and the chapter
  buttons' names follow them; the steps stay real HTML and the embedded
  HowTo JSON-LD is the registry's; every subscriber line resolves and
  shows; the launch gate (registration, model, payments and payouts each
  off: no player, no band, the steps section byte-identical to the base
  `Section`); the home band (no heading, no words in its stage, directly
  after the hero); no AI cost, fee, model names, amounts, counts or
  "Available soon" in the mocks, the three-row statement, no Join in
  chapter 1, Pay in chapter 5, the gated extras; the new-word list; the
  address from the platform; the token values; motion hygiene (keyframes
  and transitions limited to transform, opacity and stroke-dashoffset,
  token durations and easings, hover rules inside `(hover: hover)`, a
  reduced-motion block, nothing infinite, the spring only on success
  states); the island imports only React and no dependency was added.
- `npm run test:marketing-motion` (`scripts/run-marketing-motion-check.mjs`
  starts the production build against a stub platform API, no database,
  provider or credential; `scripts/marketing-motion-check.mjs` runs local
  Chromium at 360×740, 390×844 and 1366×900): the gate closed, then open;
  the player visible with no horizontal overflow; auto-play at load only
  if half of the stage is on screen, holding out of view and resuming in
  view (home too); Pause/Play by keyboard, the chapter buttons (Tab, arrows,
  Home, End, names, live announcement), Previous and Next; phones: square
  stage, one frame at rest, the strip, the swap at the crossing, controls
  in one row, a swipe; no layout shift (CLS and layout boxes) while
  chapters change and through one full pass sped up 20× (chapters 2-8 in
  order, then Replay); reduced motion (no auto-play, no animation even
  after Play, the slideshow advances, instant chapters); stage text AA
  contrast and at least 11 px in every chapter (both sides on phones); no
  JavaScript; right to left at 390 and 1366.

## Not done / next

- Journey: the owner decides D10 (keep the player hidden until a coach can
  launch, the default built here, or show it earlier). brand-check has no
  launch-ready run yet (its runner seeds a platform with every provider
  off, so it measures the gate-closed pages, which equal base); the
  storyboard's LCP and long-task measurements (`marketing-perf-check.mjs`,
  section C) are not built. The sitewide microanimations (part B) and the
  motion-token names shared with the subscriber app's pass are a separate
  track; the combine step de-duplicates the token block.
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
