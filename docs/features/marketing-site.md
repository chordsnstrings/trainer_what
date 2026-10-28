# Public marketing site: multi-page, conversion, SEO and LLM SEO

Work package branch: `core/marketing-site` (base `b9ec7c1`). Migration:
`067_early_access.sql` (review fixes; 063-066 are taken by other packages).

Built from the 28 September 2026 strategy brief (positioning, personas,
honest conversion levers, site map, SEO and LLM SEO plan, follower model).
The brand is always the configured platform name (`APP_NAME`); copy is
written to read well as "TrainsYou" but never hard-codes it. Since the
corporate identity package the default name is `trainsyou` (lowercase), with
its logo, icons, share card and tokens: see [brand.md](brand.md).

**Owner decision, 30 September 2026: no AI costs on the marketing site.**
"Let's not talk about AI costs. It's integrated." Every "AI usage at cost",
"passed through at cost", "voice usage cost" and "Why is AI usage passed
through?" sentence, bullet, FAQ, statement row and calculator exclusion was
removed from `marketing-content.ts`, `marketing-features.ts` and the
marketing components (showcase statement, pricing example, earnings
calculator). Where a removal left a page under its word floor, the removed
sentence was replaced with a true one that says nothing about costs (voice
page: "Uses your voice only for your own subscribers who add it.", a "Yours
to withdraw" card, "Only subscribers who add it hear the session in your
voice."; pricing intro: "Payment processing and optional services are
itemised on your statement."; pricing guide: subscribers choose whether to
add voice). The voice feature row "Usage on your statement" became "Only
your subscribers" (same capability count). The trainer-facing billing label
"AI Coach Service Fee" inside the app is unchanged. `tests/marketing-site.test.ts`
("the marketing site does not talk about AI costs") scans every registry
page, every rendered site page, the feature matrix and the earnings
calculator.

## Current state — 28 October 2026: phase 1 of the marketing revamp

`/`, `/trainer-brain`, `/demo` and `/pricing` were rebuilt in phase 1 of the marketing revamp (PR #105). They follow the owner's choice of 27 October 2026 ("Go with your recommendation"): concept A's "Live Brain", C's decision anatomy and Never list, and B's pricing page.
- **Where the details are:**
  - "Phase 1 of the marketing revamp" below: the page structure, the call to action, copy limits and checks;
  - [brain-showcase.md](brain-showcase.md): the animated Brain showcases.
- **Removed from the site then:**
  - the hero relay (`hero-flow.tsx`);
  - the old home bands: subscriber tiles, the decision-flow card and the commission pills;
  - the home's journey band and its scroll scenes;
  - the old `/demo` tabs;
  - the old `/pricing` parts: the three price anchors, the old worked example and the compact earnings calculator. The new page has its own example and calculators.

  The dated sections below that describe them are the record of their time.
- **Unchanged:** every other page, the header, the phone menu, the footer, Kamran's button and `/how-it-works` with its journey player.
- **What the pages call live** follows the platform's go-live checks since the final fix pass (28 October 2026): publishing waits for sign-ups, subscriber payments and the AI model, not for payouts. See "What is live: gates and flags" below. The same gates reach `/faq`'s money answers, `llms-full.txt` and the assistant facts.

## Current refresh — 3 October 2026

See [marketing refresh](../MARKETING_REFRESH_2026-10-03.md) for the owner-approved audit fixes and verification. Public copy now describes the desktop multipage builder, catalogue-derived layout counts, AI module starters, transformation galleries, six-step setup, current member languages and voice modes. The shared registry feeds search and bounded assistant facts. Product illustrations use current navigation labels and remain explicitly illustrative.

Public legal reads and consent resolution exclude explicit development placeholders, without editing their immutable records. Missing company/contact values are stated plainly. Address examples follow the existing configured platform root; routing and DNS are unchanged. An unavailable settings service defaults to early access. Frontier wording remains conditional on qualification. Historical implementation and verification below retain their original dates.

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
  handed to the trainer, pain pauses the workout; since 28 October 2026 the
  Brain playground with 12 sample moments), `/features`, `/pricing`
  (bands, worked example computed by the calculator function, what else is on
  the statement, billing, payouts, compact calculator; since 28 October 2026
  concept B's page with two calculators, see "Phase 1" below), `/earnings-calculator`,
  `/follower-calculator`, `/security-and-privacy`, `/faq` (rewritten in
  customer language; no build-status notes, no payout provider name),
  `/about`, `/methodology`, `/get-started` (the setup checklist and the
  claim-address preview, or early access), `/for-trainers`, `/uae`, `/guides`.
- 11 feature pages under `/features/` with availability chips.
- 8 specialty pages written under `/for-trainers/` (slugs are `DIRECTORY_SPECIALTIES`
  ids with hyphens), each with three rules labelled "Illustrative", handoff
  examples, a programme outline, a follower calculator starting from an
  editable example price, and a specialty FAQ.
  Four are public (weight loss, strength, muscle gain, pre and postnatal).
  Combat, endurance, yoga and pilates are hidden (owner, 30 September 2026):
  `HIDDEN_SPECIALTIES` in `packages/contracts/src/marketing.ts` keeps them out
  of the registry, so navigation, footer, hub listing, sitemap, llms.txt and
  JSON-LD drop them and their addresses are a normal 404; removing a slug from
  that list switches its page back on.
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
earnings calculators, the live address preview and the demo tabs (removed on
28 October 2026). Since then the four phase-1 pages render through their own
components (`components/marketing/pages/`, mapped in `BESPOKE` in `site.tsx`)
with their own islands (`home-islands.tsx`, `brain-page-islands.tsx`,
`pricing-islands.tsx`) and the Brain showcases (`components/marketing/brain/`,
[brain-showcase.md](brain-showcase.md)). The header
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
stated: processing, domain, refunds, disputes, booking fees, tax (no AI or
voice usage line since the owner's decision of 30 September 2026, below).

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
  It never gates publishing. At this historical stage the public checklist mirrored the
  legacy registry; the current public checklist follows the six-step wizard. The legacy checklist had 17 base steps
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

**Added with phase 1 (28 October 2026).**
- **No prototype placeholders.** `PLACEHOLDER` in `tests/marketing-helpers.ts` matches text such as "[rate: owner to state]", "owner to confirm" and "decision 3". The page tests and the trace test fail on any match in a page's rendered HTML, its registry entry or the Brain traces.
- **`C0_PAGES`** (`tests/marketing-site.test.ts`) holds `/`, `/trainer-brain`, `/demo` and `/pricing`. A page in it gets four checks:
  - its registry text avoids the C0 vocabulary (`C0_BANNED`);
  - its headings and FAQ questions say "your AI";
  - the copy limits apply;
  - the placeholder check runs on its registry text and rendered page.
- **No invented figures on `/pricing`.** Every AED amount and percentage comes from the ledger (`BANDS`, `estimateEarnings`, `MEMBERSHIP_MINIMUMS`). The test fails if a card-processing rate appears.
- **Statements that depend on payments follow the payments flag:** the "Not on yet" chips, the status panel and strip, and the answer to "Can subscribers pay me today?". Nothing says subscribers can pay while payments are off.
- **No `/signup` link while sign-ups are closed** on the four pages, including the showcases' calls to action. Unit tests and browser check 13 hold this.
- **The Brain showcases are labelled samples, and no AI model is called.** `tests/marketing-brain-traces.test.ts` holds their claims to the code ([brain-showcase.md](brain-showcase.md)). `tests/model-name-guard.test.ts` also scans `components/marketing/brain/**`.
- **"Download your data and request deletion"** replaces the prototype's "Export or delete it whenever you like", because deletion is a reviewed request. The Never sheet ships unsigned: there is no founder note yet.

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
- These are the checks of the first package (28 September 2026). Phase 1's
  checks and results are under "Phase 1 of the marketing revamp" below.

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

**Superseded on 28 October 2026.** Phase 1 replaced this home: the relay
hero, the subscriber tiles, the decision-flow card and the commission pills
are gone. The current home is under "Phase 1 of the marketing revamp" below.
The container rule (the next paragraph) and the analytics bar (after the
list) still hold. The list is the 28 September design, kept as the record.

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
   mk-cta`: "Start coaching", or "Join early access" while registration is
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
   lockup and the mark never mirror. Motion is CSS only, plays once and ends
   at 2.5 s; since 22 October 2026 it plays for every visitor while the marketing motion switch (`MARKETING_MOTION`, `components/marketing/motion-mode.ts`; [marketing-motion.md](marketing-motion.md), "Motion for every visitor") is `"always"` (with `"device"`, only under
   `prefers-reduced-motion: no-preference`); every
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
   processing ("Card processing is itemised."); "Pricing in detail".
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
pages is a slim bottom bar that opens only after the visitor scrolls, so
the first screen is never covered. Since 29 September 2026 (branch
`ui/consent`, `docs/features/analytics-consent.md`) it has two equal 48 px
choices, a 48 px Close and a privacy policy link (65 px tall at 1440 px),
it reserves its own space, and any answer (allow, No thanks or Close) ends
it for good: no floating analytics control on any page, after a reload too.
The footer's "Analytics preferences" button opens the preferences sheet.
Coach websites, sign-in and the member app use the same bar at once.

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
fewer) as the one statement above the fold. Since 28 October 2026 they also
apply to every page in `C0_PAGES`, so `/demo` joined them with its own lede
and "In short". The answer-first introduction
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
| Home page | Until 28 October 2026: 400 visible words in `main`, not counting the follower calculator block (reported separately). Since phase 1: 624, the measured figure (see "Phase 1", copy limits) |

Voice: second person, active, UAE/UK spelling. Not used: seamless,
revolutionary, cutting-edge, unlock, empower, game-changing. Two text-only
sections in a row at most. Known exceptions kept on purpose: the home
introduction (locked by the brand test and reused as FAQ 1, 55 words), the
shared safety FAQ (one 27-word sentence) and the /about introduction (the
entity sentence).

### Checks for this package

Since 28 October 2026 the home test below is replaced by
`tests/marketing-home.test.ts`, and the brand check's relay checks by
hero-field checks (see "Phase 1 of the marketing revamp").

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
  bar after a scroll at most 72 px (64 px before the 48 px choices of
  29 September 2026), visible words, H2 count, one H1) and
  390×844 (H1, primary action and all three relay titles on the first
  screen, one compact row, nothing covered, one left edge); inner
  marketing pages start at the header logo's edge; reduced motion (by the
  marketing motion switch since 22 October 2026: with `"always"` the same
  rules as motion allowed; with `"device"` no animation, everything
  visible), motion allowed (every card visible at
  first paint, plays once, ends by 4.5 s, at rest after 5 s), right to
  left at 1440 (steps mirrored, wires towards the next step, lockup and
  mark not mirrored) and every public route at 390 with `?lang=ar` (no
  overflow).
- `scripts/browser-completion-check.mjs` (`npm run test:browser`): on `/`
  no analytics prompt before a scroll, then the bar; "No thanks" sets no
  identifier and does not return; the footer's "Analytics preferences"
  opens the preferences sheet for opt-in, the readback and withdrawal
  (since 29 September 2026 also: nothing floats after an answer, and the
  phone checks in `docs/features/analytics-consent.md`).

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

## Sitewide microanimations (29 September 2026, `mk/motion`)

Owner request: "marketing site should get microanimation revamp". This
package builds part B of the motion storyboard (every component present at
`c856d9d`); the coach-to-subscriber walkthrough (part A,
`components/marketing/journey.tsx`) is a separate track. No marketing text
was added, reworded or removed, and no layout proportion changed; the
site stays light with Pace accents.

### Rules and tokens

The home relay's house rules now hold on every page: every word is real
HTML and visible from the first paint; motion is decorative, short and
plays once; reduced motion removes it (since 22 October 2026 only while the marketing motion switch (`MARKETING_MOTION`, `components/marketing/motion-mode.ts`; [marketing-motion.md](marketing-motion.md), "Motion for every visitor") is `"device"`; it is `"always"`, motion for every
visitor); no metrics, counts, revenue or count-ups. The tokens are defined
once on the marketing roots (`.mk, .mk-header, .mk-footer`, and
`.mk-assistant-host` since Kamran's button, in `app/marketing.css`), with
the values of the subscriber app's first motion pass (the subscriber tokens
have changed since, on 20 October 2026; `docs/features/motion.md`):
`--mk-dur-press` 80 ms, `--mk-dur-fast` 140 ms,
`--mk-dur-base` 200 ms, `--mk-dur-slow` 280 ms, `--mk-dur-emphasis` 420 ms,
`--mk-ease-out` `cubic-bezier(0.2, 0, 0, 1)`, `--mk-ease-in`
`cubic-bezier(0.4, 0, 1, 1)`, `--mk-ease-in-out` `cubic-bezier(0.4, 0, 0.2,
1)` and `--mk-ease-spring` `cubic-bezier(0.34, 1.4, 0.64, 1)` (success states
only). Only transform (`translate`, `scale`, `rotate`), opacity, SVG
`stroke-dashoffset` and a FAQ's grid rows move; colour changes (tints,
borders, the focus ring) are instant. Hover effects sit in `@media (hover:
hover)`; the one exception is the header menu opening on hover, which is
behaviour, not decoration (it also opens on keyboard focus). CSS
transitions and keyframes, one IntersectionObserver and the Web Animations
API only: no library, no new dependency. Logical properties throughout;
arrows nudge by `calc(3px * var(--inline-sign, 1))` and inline-start
origins use `calc(50% - 50% * var(--inline-sign, 1))`.

### What moves

| Part | Motion |
| --- | --- |
| Buttons (`.button` in `.mk` and the header) | Press `scale: .97` on every device (80 ms in, 140 ms out); the existing 1 px lift only where the pointer hovers (cancelled under `hover: none`, so no stuck lift after a tap); the trailing arrow nudges 3 px forward (200 ms). The hover colour is instant (the storyboard's faded tint overlay was not built: see deviations). |
| Single-line links (`.mk-link`, sign in, breadcrumbs, footer, header) | A 1 px ink bar slides in from the inline start on hover (200 ms) and shows at once on keyboard focus; the current page keeps it at 2 px, static. Links inside sentences keep their underline. |
| Header | Its shadow fades in over the first 48 px of scrolling (a scroll-driven animation, no script; browsers without scroll timelines keep the flat header). Menus open with opacity and a 4 px rise (140 ms out, close 80 ms in); the group chevron turns. The phone menu (26 October 2026, owner: "more animated and more aesthetically pleasing"): "Menu" is a pill whose two lines turn into a cross and which fills with Pace while open; the panel hangs from the header with rounded lower corners, drops in (280 ms) and its rows rise 18 ms apart (each row carries its own `--mk-stagger`); the page behind dims from the header down and stops scrolling (the header's blur pauses while open, because it would make the header the dim layer's containing block; the scrollbar keeps its space, so nothing shifts); rows are 48 px with a soft fill on press (and hover where there is a pointer) and an arrow that leans forward; the current page keeps a Pace tint; "Sign in" and the call to action stay pinned at the panel's foot, and Kamran's button hides while the menu is open. Closing plays the panel's exit (150 ms) first: "Menu", Escape (focus returns to "Menu"), a tap on the dimmed page or a link all close it, and so does widening past 1150 px, where the menu is hidden (`components/marketing/mobile-menu.tsx`; without JavaScript it is still a plain `<details>`). |
| Home relay | Unchanged sequence and delays, on the tokens: wires draw in 420 ms, the dot travels in 420 ms in-out, the row ticks pop with the spring (280 ms). The core tile's box-shadow pulse is now a Pace ring behind the mark (`::after`, scale 1 to 1.5, fading); the mark itself never scales. It ends at 2.53 s. |
| Section reveal (`components/marketing/motion.tsx`) | Units wholly below the first screen when the page loads (home band contents; each block of an inner page; the closing panel) wait and rise 12 px into place once as they enter the view (280 ms); grid items follow 40 ms apart, at most 240 ms (cards, tiles, steps, the /get-started checklist, price anchors, band pills), the /features screens 80 ms apart. Never the hero, breadcrumbs, page heading, relay or anything on the first screen. |
| Link cards (`.mk-tile`, home icon tiles, /features included) | Lift 2 px and a soft shadow (overlay opacity) where the pointer hovers, the icon rises with its home tile, press `scale: .99`. Static cards never move on hover. |
| Pills and chips | No motion of their own; link pills tint instantly on hover, the related links' arrows nudge. |
| "You stay in charge" (home) | Once, as its band is revealed: the message card rises, your AI's card follows (+140 ms), the confidence meter fills from the inline start (`scale`, its 86% width never changes), the lanes follow 80 ms apart, "Applied automatically" pops (spring) and the safety lane stamps. About 1.1 s. |
| Economics (home) | The band pills stagger in; the address preview settles (opacity .5 to 1) once typing pauses for 120 ms. |
| Disclosures (FAQs, the calculators' assumptions and optional numbers) | The native marker becomes a chevron at the inline end, in the space the marker took (1.06em), so every question wraps as before; it turns as the answer opens (200 ms). A FAQ answer also unfolds through its grid row (`::details-content`, 280 ms; checked in Chromium 141) and fades in; the calculators' disclosures fade and their height changes at once (their content has several children, so one grid row cannot hold it). |
| Tables | Row hover: an instant paper tint on hover devices. |
| Calculators | No count-up (the result is an `aria-live` region, widths would jitter, and a rolling figure dramatises an estimate). 150 ms after the last change the result figure settles (Web Animations, opacity .55 to 1 and 4 px, 200 ms) and changed rows and cells settle the same way (140 ms). Marketing pages only: the trainer workspace's follower calculator is unchanged. |
| /demo | After a visitor picks a tab, the chosen decision rises 6 px (200 ms) and its label follows 80 ms later: the two automatic outcomes pop (spring), the hand-offs stamp. The first decision shows at once. |
| /features screens | Reveal 80 ms apart; the ticks inside pop once. The timer never ticks and the counts never count up. |
| /get-started | The checklist staggers in; the early-access confirmation rises (280 ms); errors appear without a shake. |
| Closing panel, footer | The panel reveals as a section; footer links get the bar; "Analytics preferences" presses (it is now `inline-block`). |

### How the reveal stays safe

`MarketingMotion` (one island in `MarketingSite`, rendering nothing) adds
`.mk-motion` to the page root only when JavaScript runs, IntersectionObserver
exists and (while the marketing motion switch is `"device"`; with
`"always"`, since 22 October 2026, for every visitor) the visitor has not
asked for reduced motion. Its observer's
first report says where each unit starts; only a unit whose top is below
the viewport is marked `data-mk-reveal="pending"`, and it turns `"in"` once
it enters the view (root margin 10% from the bottom). Every hiding rule
needs `.mk-motion`, so without JavaScript nothing is hidden; a unit that
holds the address's `#target` never waits; printing reveals everything;
leaving the page reveals what is left. Under reduced motion in the switch's
`"device"` mode the script does nothing, `globals.css` stops every element's
transitions and animations,
and `marketing.css` stops the pseudo-elements and the details content box
(which `*` does not reach), removes lifts, presses and nudges, and shows any
unit that was waiting when the preference changed. The settle checks the
preference itself.

Two measures keep a reveal cheap to draw, found by tracing a scroll
through /features with the CPU throttled 4x. A waiting unit is at 0.001
opacity, not 0: it looks the same, but Chromium skips painting content at
0 opacity, so a reveal would repaint the whole unit in one frame. A
revealed unit and its grid items keep `translate: 0 0` (no movement), so
the end of the rise does not tear down their layers and repaint them a
second time. Grid items become `data-mk-item="done"` once the longest
stagger and the rise are over, so a revealed link card lifts on hover with
its own 200 ms timing instead of the reveal's stagger.

### Deviations from the storyboard (part B)

- Button hover tints are instant colour changes, not a faded overlay: the
  storyboard's own rule is that colour changes are instant, and the
  overlay would need a stacking context on every button and a rewrite of
  the brand test's contrast check of the hover colour.
- The calculators' assumptions and optional-numbers disclosures fade but do
  not unfold (several children; storyboard D7's fallback). FAQs unfold.
- A waiting unit is at 0.001 opacity rather than the storyboard's 0 (B5),
  for the paint cost above; it is not visible.
- The FAQ answer's 18 px bottom space moved from its margin into the
  answer (a block after its text), so a closed answer folds to nothing;
  open and closed FAQs measure the same as before (checked against a
  `c856d9d` build at 390 and 1366 on eight pages, every FAQ open and
  closed: the same page heights and element positions). Because the
  chevron is at the inline end (B10), a question now starts at the inline
  edge where the native marker used to sit, about 16 px earlier.
- The static audit is `tests/marketing-motion-sitewide.test.ts` and the
  browser check `scripts/marketing-motion-sitewide-check.mjs`
  (`npm run test:marketing-motion-sitewide`), so they do not collide with
  the walkthrough track's `marketing-motion` files.
- The browser check runs without the API (the fallback platform facts);
  the walkthrough's launch-ready platform state is that track's concern.

### Checks for this package

- `tests/marketing-motion-sitewide.test.ts` reads `marketing.css` with its
  at-rule context and fails when a transition or keyframe moves anything
  but transform, opacity, `stroke-dashoffset` or a disclosure's grid rows
  (never width, height, top, left, margin and the like); when a duration or
  easing is not a `--mk-*` token (delays are choreography and exempt, and so
  is the scroll-driven header shadow); on an infinite animation; on the
  spring outside the success states; on a `:hover` rule outside `@media
  (hover: …)` (one listed exception); when motion escapes the reduced-motion
  rules or (until 22 October 2026) an auto-playing keyframe sits outside
  `prefers-reduced-motion: no-preference` (since then: when a
  reduced-motion rule that reaches the marketing root does not skip
  `[data-mk-motion="always"]`, a no-preference wrapper is left, or the
  switch is not wired to the root, the assistant host and the scripts);
  when anything is hidden without `.mk-motion`; when the
  tokens are defined twice, differ from the agreed values or from the
  script's copy; or when a marketing component imports an animation
  library.
- `tests/brand.test.ts` reads the primary action's hover colour inside
  `@media (hover: hover)`.
- `scripts/brand-check.mjs` scrolls every public page through once before
  its contrast pass, so revealed sections are scanned, and fails if a
  section never appears.
- `scripts/marketing-motion-sitewide-check.mjs` (local Chromium, never a
  cloud browser): /, /how-it-works, /pricing, /features and
  /earnings-calculator at 390x844 (touch, DPR 3) and 1366x900 with the CPU
  throttled 4x, against a build of `c856d9d` (`MOTION_BASE_DIR`): LCP
  median of five cold loads within max(50 ms, 5%) of base and the same
  element; CLS on load and during a scroll-through in 300 px steps no worse
  than base; the reveal script's setup and every observer callback under
  50 ms (timed where they run); no more long tasks while scrolling than
  base (median run); no gross regression in blocking time on load; every
  word visible with JavaScript off and after a scroll-through; nothing on
  the first screen waits; reduced motion leaves nothing running, marks
  nothing and does not settle (since 22 October 2026 this follows the
  switch: with `"always"`, under the device setting and separately the
  member's cookie, the same as without it, plus timed loads of that cohort
  and `/?scenes=on` controls); the FAQ opens fully; the phone menu opens.

### Measured results (29 September 2026, local Chromium, this machine)

The machine is a shared 4-core container that other jobs were using (load
average 5 to 10 during every run), so single timings vary by several
hundred ms between identical loads. Numbers are medians of five cold loads
per page and width, the CPU throttled 4x, against a `next build` of
`c856d9d` served the same way, loads alternating between the builds.

`npm run test:marketing-motion-sitewide` (with `MOTION_BASE_DIR`), final
run after the paint fixes:

| Page and width | LCP new (base) | CLS load / scroll | Long tasks while scrolling (median run) | Reveal setup / slowest callback |
| --- | --- | --- | --- | --- |
| 390 `/` | 592 (636) ms | 0 / 0 (base 0 / 0) | 0 (0) | 2.6 / 16.0 ms |
| 390 `/how-it-works` | 504 (524) ms | 0 / 0 | 0 (0) | 0.4 / 6.6 ms |
| 390 `/pricing` | 572 (520) ms | 0 / 0 | 0 (0) | 2.3 / 25.1 ms |
| 390 `/features` | 780 (708) ms | 0 / 0 | 0 (0) | 4.1 / 9.5 ms |
| 390 `/earnings-calculator` | 428 (508) ms | 0 / 0 | 0 (0) | 1.9 / 8.5 ms |
| 1366 `/` | 696 (684) ms | 0 / 0 | 0 (0) | 1.1 / 9.9 ms |
| 1366 `/how-it-works` | 600 (452) ms | 0 / 0 | 0 (0) | 1.3 / 1.2 ms |
| 1366 `/pricing` | 512 (496) ms | 0 / 0 | 0 (0) | 1.1 / 7.5 ms |
| 1366 `/features` | 780 (864) ms | 0 / 0 | 0 (0) | 3.3 / 4.8 ms |
| 1366 `/earnings-calculator` | 472 (456) ms | 0 / 0 | 0 (0) | 1.7 / 2.1 ms |

The same LCP element as base on every page (the page heading, the lede or
the calculator's answer). All of the check's own rules passed: nothing on
the first screen, in the hero or the relay ever waited; nothing was still
waiting or hidden after a scroll-through; every word was visible with
JavaScript off at both widths (nothing marked, no `.mk-motion`); under
reduced motion nothing ran, nothing was marked, the calculator did not
settle and the FAQ opened fully; with motion the calculator settled (7
animations), the FAQ unfolded to full height and opacity and the phone
menu opened; no infinite animation. The run exited 1 on four comparisons
with base: LCP at 390 `/pricing` (+52 ms), 390 `/features` (+72 ms) and
1366 `/how-it-works` (+148 ms), and blocking time on load at 390 `/pricing`
(490 against 367 ms). The previous run (before the paint fixes) failed on
different pages (LCP at 390 `/earnings-calculator` and 1366
`/how-it-works`), so each was re-measured with fifteen alternating cold
loads per build (a separate probe, same throttling, no scrolling):

| Page and width | LCP median new (base) |
| --- | --- |
| 1366 `/how-it-works` | 492 (444) ms |
| 390 `/pricing` | 428 (428) ms |
| 390 `/features` | 720 (712) ms |
| 390 `/earnings-calculator` | 392 (392) ms |
| 1366 `/` | 480 (452) ms |

All are within the budget (max(50 ms, 5%)). On the desktop pages LCP is the
first paint, which is about 30 to 48 ms later at 4x throttling (about 10 ms
unthrottled); the marketing stylesheet is 1.7 KB larger gzipped (8.2 KB
against 6.5 KB) and draws the link bars and card overlays. It has not been
reduced further.

Scroll-through long tasks: before the paint fixes the reveal produced 1 to
3 long tasks (50 to 176 ms) per run on 1366 `/` and `/features` and 390
`/features`, where base had none; a trace showed paint, pre-paint and
layerisation work, not script (the reveal's own code stayed under 26 ms).
After the fixes the median run had none on any page. Main-thread work
during a scroll-through of 1366 `/features` is still about twice base's
(the reveals' paint and compositing, measured by trace: roughly 1.0 s
against 0.45 s over the whole scroll at 4x), and single runs on this busy
machine still show the occasional long task, so this budget holds on the
median, not on every run.

Layout: against the `c856d9d` build at 390 and 1366 on eight pages (`/`,
`/how-it-works`, `/pricing`, `/features`, `/earnings-calculator`, `/demo`,
`/get-started`, `/follower-calculator`), every FAQ closed and then open,
under reduced motion: the same page heights and the same position and size
for every visible element, except the FAQ answers themselves (their 18 px
bottom space is now inside them) and the address preview's width (the two
servers' port numbers differ).

Other checks run for this package: `npx tsc --noEmit`, `npx tsc --noEmit -p
apps/web/tsconfig.json`, `node --import tsx --test` on
`tests/marketing-site.test.ts`, `tests/marketing-api.test.ts`,
`tests/logical-css.test.ts`, `tests/marketing-motion-sitewide.test.ts`,
`tests/brand.test.ts` and `tests/branding.test.ts`, and `npm run build`;
`git diff c856d9d` shows no change to `marketing-content.ts` or
`marketing.ts`.
`npm run test:brand` on the production build (`RTL_WEB_MODE=start`, its own
ports and PGlite data) passed on 112 screens, including its scroll-through
before the contrast pass (no section left waiting).

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
  `app/layout.tsx`, holds every journey style (since the combine step the
  motion tokens are defined only in `marketing.css`; see "Combined" below).
- /how-it-works: the "Eight steps, start to finish" section keeps its h2 and
  `ol.mk-steps`, with the registry titles and bodies unchanged and the
  HowTo JSON-LD untouched. Each step adds one subscriber line, looked up
  from the registry (never copied; a test resolves every lookup) after a
  visible "Your subscriber" label (the column header of "Who does what"
  on the same page; visually hidden until the second review). The steps
  are a scroll-snap carousel at every width once the island runs (four in
  view from 1150 px, two from 761 px, one and a peek on phones; the grid
  without JavaScript); the active step gets an ink edge and a Pace bar,
  and a click on a card selects its chapter.
- Home: a paper band directly after the hero, with no heading (the six H2s
  and brand-check limits stay): the existing heading as a small label, the
  active step's title, its subscriber line (after "Your subscriber"; added
  in the second review), the controls and "See how it works" to
  `/how-it-works#steps`. Its stage shows the same scenes with every word
  replaced by a bar (no words in the stage).
- The launch gate: the second half of the workflow (publish, join, pay,
  daily coaching, payouts) exists only once a coach can launch, so both
  placements render only while registration is open and the model,
  payments and payouts providers are available. Otherwise /how-it-works
  renders its steps section exactly as before and the home page has no
  band. On the live site today (commerce off until the owner approves)
  the player stays hidden and appears by itself once those approvals are
  recorded (storyboard decision D10, needing the owner).
- Honesty: sample data only ("Illustration with sample data" on the full
  stage, at every width since the second review); no metrics, counts, revenue or amounts (prices and statement
  values are placeholder bars; the statement has three rows and no total);
  no AI usage, cost, fee or model names anywhere in the mocks; only
  features available now (chapter 4's nutrition tier and voice add-on rows
  follow their `/features` availability). Chapter 1's phone has no Join
  and no address bar (nothing is published yet); chapter 5's follower
  opens the address, joins, pays and answers the intake.
- New visible words: "Evaluate" (the Scenario lab button), "Passed" (its
  badge; no longer elsewhere on the site since the AI usage lines were
  removed on 30 September 2026), "LS" (the demo
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
  leaves the screen or the tab is hidden; a mouse resting on the player
  stops only the chapter clock (the beats finish; see the second review);
  it stops until Play when keyboard focus enters the player, on Pause, a
  swipe, a chapter button, Previous or Next, or a touch on the step cards.
- Phones (up to 760 px): a square stage showing one frame at a time under a
  strip ("You" with a laptop, the wire, "Your subscriber" with a phone,
  labelled since the second review); at each crossing the frames swap
  (the leaving one slides 12% towards the inline start and fades, the other
  enters). Mock text never goes below 11 px; the bar (Play, Previous, eight
  24 px-wide chapter targets, Next) fits one row at 360 px.
- Reduced motion (while the marketing motion switch is `"device"`): no
  auto-play, static complete chapters, instant changes; Play runs a
  slideshow whose clock has no target, so nothing on screen moves. With
  `"always"` (since 22 October 2026) the player behaves as without reduced
  motion and keeps every hold. Without JavaScript: every step shows, the
  stage shows chapter 1 complete and no controls show.
- Keyboard and screen readers: Pause/Play/Replay is the first control;
  chapter buttons use a roving tabindex (arrows, mirrored in right to left,
  Home and End), carry `aria-current="step"` and are named "01 Claim your
  address" from the visible number and heading; a polite live region
  announces the step only after manual navigation that does not focus the
  chapter's own button (Previous, Next, a swipe, a card). The stage is
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
  reduced-motion block (scoped to the switch's `"device"` mode since
  22 October 2026), nothing infinite, the spring only on success
  states); the island imports only React and no dependency was added.
- `npm run test:marketing-motion-journey` (since the combine step;
  `npm run test:marketing-motion` now runs this and the sitewide check;
  `scripts/run-marketing-motion-check.mjs` starts the production build against a stub platform API, no database,
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
  after Play, the slideshow advances, instant chapters; since 22 October
  2026 only in the switch's `"device"` mode, and with `"always"` auto-play
  and every hold under the device setting and the member's cookie); stage
  text AA
  contrast and at least 11 px in every chapter (both sides on phones); no
  JavaScript; right to left at 390 and 1366.

## Combined: sitewide motion and the journey (29 September 2026, `ui/marketing-motion`)

`mk/motion` (sitewide microanimations, `53c1443`) and then `mk/walkthrough`
(the journey player, `3ccff10`) merged with `--no-ff` onto `c856d9d` in
`.claude/worktrees/mk-integrate`. Git conflicts: `site.tsx` (both imports
kept: `journey` and `motion`), `package.json` (the npm scripts, below) and
this file (both sections kept). No marketing text changed (`git diff
c856d9d` on `marketing-content.ts` and `marketing.ts` is empty).

Resolved so the two tracks behave as one:

- Tokens: one definition, on `.mk, .mk-header, .mk-footer` in
  `app/marketing.css`. The walkthrough's duplicate block in
  `app/marketing-journey.css` is gone (same selector, same values); the
  journey only uses them. `tests/marketing-motion-sitewide.test.ts` now
  fails if any stylesheet in `app/` other than `marketing.css` defines a
  `--mk-dur-*` or `--mk-ease-*` token, and `tests/marketing-journey.test.ts`
  checks that every token the journey uses is one of those.
- Reveal: the section reveal never marks the journey (`NEVER` in
  `components/marketing/motion.tsx` adds `.mk-walk-section` and
  `.mk-walk-band` to the hero, page heading and relay). Without this the
  /how-it-works steps section, as one unit below the first screen, would
  fade and rise 12 px and stagger its eight step cards while the player
  starts its own chapter beats. The home band was never a unit (its inner
  is `.mk-container`, not `.mk-home-inner`); the exclusion covers it anyway.
- Relay ring: the hero relay's one-off ring (`mk-ring` on
  `.mk-relay-mark::after`) was keyed on every `.mk-relay-mark`, so it also
  fired, 0.85 s after load, on the journey laptop bar's copy of the mark
  (`CoreMark`). It is now `.mk .mk-relay .mk-relay-mark::after`.
- Press: the player's control buttons (`.mk-walk-btn`: Pause/Play/Replay,
  Previous, Next) join the sitewide press (scale 0.97 on the press token,
  ease-in) and the reduced-motion freeze list (which applies in the motion
  switch's `"device"` mode since 22 October 2026). Their hover tint was
  already instant and inside `(hover: hover)`, like the sitewide buttons;
  the chapter segments and the step cards keep their instant tints and do
  not move (they are not link cards).
- Checks: `npm run test:marketing-motion` (`scripts/run-marketing-motion-checks.mjs`)
  runs the journey check and then the sitewide check, the second even when
  the first fails, and exits 1 if either fails. `npm run
  test:marketing-motion-journey` and `npm run test:marketing-motion-sitewide`
  run one each. The sitewide check's server log is now
  `test-results/marketing-motion-sitewide-servers.log` (it shared a name
  with the journey's). The journey check adds, at 360, 390 and 1366 with
  motion allowed: the sitewide reveal ran on the page (`.mk-motion`) but
  left no mark on or in the player's section or band; the laptop bar's
  mark has no animation; the hero relay still has its ring.

### Checks on the merged tree (29 September 2026, this machine)

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`:
  both pass.
- `node --import tsx --test --test-concurrency=1` on
  `tests/marketing-site.test.ts`, `tests/marketing-api.test.ts`,
  `tests/marketing-journey.test.ts`, `tests/marketing-motion-sitewide.test.ts`,
  `tests/logical-css.test.ts`, `tests/brand.test.ts` and
  `tests/branding.test.ts`: 68 tests, all pass;
  `tests/marketing-follower-model.test.ts`: 12, all pass.
- `npm run build`: passes.
- `npm run test:marketing-motion` with `MOTION_BASE_DIR` set to a fresh
  `next build` of `c856d9d`: exit 1.
  - Journey player: 146 checks passed, 0 failed (including the new reveal,
    ring and gate checks).
  - Sitewide: every rule of its own passed (nothing on the first screen,
    in the hero or relay waited; nothing hidden after a scroll-through or
    with JavaScript off; reduced motion ran, marked and settled nothing;
    CLS 0 on load and while scrolling on every page; no scroll long tasks
    in the median run; the reveal's setup at most 3.4 ms and its slowest
    callback 17.5 ms). It failed two LCP comparisons with base, both at
    1366: `/` 508 against 400 ms and `/features` 696 against 632 ms
    (allowance 50 ms). The other eight page and width medians were within
    the allowance (390: `/` 452 (500), `/how-it-works` 456 (420),
    `/pricing` 464 (464), `/features` 664 (744), `/earnings-calculator`
    376 (356); 1366: `/how-it-works` 436 (408), `/pricing` 412 (404),
    `/earnings-calculator` 452 (420) ms).
- A separate probe (not committed): fifteen cold loads per build, the
  three builds alternating, CPU throttled 4x, no scrolling, LCP median
  (it equals first paint on these pages):

  | Page and width | `c856d9d` | `mk/motion` alone | merged |
  | --- | --- | --- | --- |
  | 1366 `/` | 472 ms | 488 ms | 500 ms |
  | 1366 `/features` | 772 ms | 768 ms | 816 ms |
  | 1366 `/how-it-works` | 436 ms | 440 ms | 456 ms |
  | 1366 `/pricing` | 444 ms | 472 ms | 468 ms |
  | 390 `/` | 396 ms | 400 ms | 440 ms |

  The merged build is within the check's allowance of base on all five,
  but it paints later than `mk/motion` alone on four of them (12 to 48 ms;
  `/pricing` 4 ms earlier). The pages here run with the launch
  gate closed, so the only difference the merge makes to them is the
  journey stylesheet, which `app/layout.tsx` imports for every page: the
  marketing CSS chunk is 6.5 KB gzipped at `c856d9d`, 8.1 KB with
  `mk/motion` alone and 12.1 KB merged. This is the combined weight of the
  two tracks as built (the walkthrough measured its stylesheet at about
  +4.1 KB gzipped), not a conflict, so it was not changed here.
- `npm run test:brand` on the production build (`RTL_WEB_MODE=start`,
  ports 3941/4941, fresh PGlite data): passed on 112 screens. Its platform
  has every provider off, so the journey is not rendered there.
- `npm run test:browser` (ports 3943/4943, fresh PGlite data,
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`): the
  first attempt stopped before any page because the demo workspace had not
  been seeded (its fixture requires `npm run seed:demo`); after `npm run
  seed:demo` on fresh data it passed ("Browser smoke passed", including
  its marketing-site pass, which loads the key public pages such as `/`,
  `/how-it-works`, `/demo`, `/features`, `/pricing` and the calculators and
  checks each H1 in the shared frame).

## Second review of the combined motion work (29 September 2026, `ui/marketing-motion`)

25 review findings on the journey player and the sitewide motion; the
reference for the result is [marketing-motion.md](marketing-motion.md).
No marketing text changed (`git diff c856d9d` on `marketing-content.ts`,
`marketing.ts` and `brand.ts` is empty).

Layout and legibility:

- The step cards are a carousel at every width once the island runs (four
  in view from 1150 px, two from 761 px), so chapters 5 to 8 no longer
  play with their explanation off screen; the chapter change scrolls it
  (never the page). From 1150 px the full stage is 5/2 (508 px at 1366)
  instead of 21/9, so header, stage, controls and a full row of cards fit
  900 px. Without JavaScript wider screens keep the grid.
- Phones: the subscriber phone is 76% of the stage (text about 13 to 14 px
  instead of the 11 px floor) and the coach window is 4/3 with text of at
  least 12.5 px. The square stage stays: the suggested 6/5 cut chapter 6's
  "Report pain / Workout paused" row off at 360 and 390 px (checked in
  screenshots), so the strip is 32 px, the fade 24 px and chapter 6's set
  rows and card padding tighter instead. The home band's stage is 4/3 on
  phones.
- "Illustration with sample data" is the journey's own label (`.w-tag`, no
  longer the relay's class, which phones hide) and shows at every width.
- The subscriber side is named on screen: a visible "Your subscriber" label
  before each card's subscriber line (the colon stays for screen readers),
  and on phones the strip names both sides, "You" (laptop) and "Your
  subscriber" (phone), borderless, the side on screen on lime. Both are the
  "Who does what" column headers. The home band shows the active step's
  subscriber line under its title, in reserved space.
- Controls: 6 px between buttons on phones (40 px arrows and 4 px at 380 px
  and below, so each chapter segment keeps a 24 px target at 360 px); the
  current segment is a lime track ringed in ink. The last phone card ends a
  gutter from the edge (the list is as wide as its cards; the suggested
  last-card margin shrank the card inside its grid track instead).
- Scenes: chapter 6's card and its pain row and chapter 3's Evaluate row
  have entry beats (each frame builds top to bottom); chapter 5's intake
  sheet keeps its padding and lines up with the card above; the address
  bar no longer wraps (it trims) and moved from chapter 1 (nothing is
  published yet) to chapter 5, where the follower opens the link; chapter
  8's payout crosses back solid and lime-backed. From 1024 px the phone
  column is wider (56/18/26) and the phone 9/16, its foot cropped by the
  stage.
- No blue tap flash on the header menu or any disclosure.

Behaviour:

- The Play/Pause icon no longer disappears when the player is held: the
  hold pauses only the stage's animated parts, so the icon's fade runs.
- A mouse over the player stops only the chapter clock; the beats finish.
  An explicit Play or Replay wins until the pointer leaves and comes back
  (the button's icon swap under a resting pointer also reads as an entry,
  so the hover pause is re-armed only by leaving).
- Previous and Next stay focusable at either end (`aria-disabled`).
- The in-view observer uses the latest entry of a batch.
- The steps' scroller is no longer a second region with the section's
  name, and it is a tab stop only while it scrolls.
- The live region speaks only when focus does not land on the chapter's
  own button (Previous, Next, a swipe, a card), so arrow keys read the step
  once.

Weight:

- The stage and the steps each sit in a memoised `<Activity
  mode="visible">` inside the island: still server-rendered in place, but
  hydrated after the controls at low priority in interruptible pieces. A
  `Suspense` boundary was tried first and rejected (the server streamed
  both into hidden `<div>`s revealed by a script: hidden without
  JavaScript and painted late).
- The player's mount effects no longer read layout (the tab-stop check runs
  in a ResizeObserver callback; the carousel scroll skips the mount), and
  the hold rule no longer has a universal selector. A trace of
  `/how-it-works` at 1366 (CPU 4x) went from 93 to 159 ms of long tasks
  after the main script to 52 to 80 ms (base: 0 to 55 ms).
- Declined: loading `marketing-journey.css` only where the player renders.
  With the stylesheet's journey rules removed from the chunk (the same
  request intercepted in both arms, eleven cold loads each, CPU 4x), first
  paint on pages without the player did not change (390
  `/earnings-calculator` 388 against 396 ms, 1366 `/pricing` 488 against
  484 ms), so the regressions the review saw there were not the
  stylesheet. Every component's CSS is imported in `app/layout.tsx` and
  all pages share one catch-all route, and a stylesheet imported from a
  component would break the node tests that render the site.
- The frames' text no longer uses container queries: the sizes come from
  the viewport and the known grid shares (`--walk-s`, `--walk-cw`,
  `--walk-pw` on `.mk-walk`), and the journey check compares them with the
  frames' real widths at every tested width. With the stage replaced by
  nothing but its box (`content-visibility: hidden`), first paint on
  `/how-it-works` at 1366 matched base (400 against 372 ms, nineteen loads
  each); removing the container queries saved 30 to 70 ms of the roughly
  90 to 150 ms in two such comparisons. The rest is drawing chapter 1's two
  frames. See "Checks" in marketing-motion.md for the committed
  comparison.

Checks: `npm run test:marketing-motion`'s sitewide half now runs with the
launch gate open (the same platform stub as the journey check), so `/` and
`/how-it-works` are compared with the player; the journey check adds the
sample-data label at every width, the Play icon's opacity while paused,
focused and hovered, Play under a resting mouse, hover early in a chapter
(the beats finish, the clock holds), focus kept on Next at the last step,
the live region's quiet on arrow keys, the active card in view, one region
for the steps, no layout shift on the home band, and the mocks' text size
against the frames' real widths (181 checks).

## Frontier wording and the model-name guard (1 October 2026, `r5/kamran`)

Plan section 6. Four lines show only while the availability flag `frontier` is on (the active model
profile is frontier tier and its latest switch check passed, `publicAvailability`); with the flag
off the registry text shows unchanged.

- `AVAILABILITY_LINES` (`packages/contracts/src/marketing-content.ts`): a fifth "How it learns"
  bullet on `/trainer-brain` ("A frontier model plus your corrections: it keeps getting better with
  time."), the `TRAINED_FAQ` answer on every page that carries it, a new `/faq` question "Does it get
  better over time?", and the `/how-it-works` step "You correct, it learns" ("Approve or correct
  what comes to you. Each tested release learns from it and keeps getting better.").
- One filter, `marketingPageFor(page, availability)` (`packages/contracts/src/marketing.ts`): used by
  `MarketingSite` (the page and its JSON-LD), `marketingJsonLd` and `llmsFullTxt` (both take
  `availability` in `MarketingContext`; the web routes pass it). Idempotent; a page without lines
  is returned as is.
- "Keeps getting better", never "only gets better": single answers can regress, which is why
  releases roll back.
- Tests: `tests/marketing-frontier.test.ts` (flag off: "frontier model" nowhere in any rendered
  page, its raw HTML including JSON-LD, `llms.txt` or `llms-full.txt`; flag on: the four lines on
  their pages, in FAQ structured data and `llms-full.txt`; copy limits per line; idempotent) and
  `tests/model-name-guard.test.ts` (no model or vendor name in marketing content including legal
  pages, `BRAND_COPY`, the gated lines, the assistant's public words, the web message catalogs, and
  `llms.txt` / `llms-full.txt` with every flag off or on).

## Brand check fixes on the home walkthrough (1 October 2026, `r5/kamran`)

`npm run test:brand` failed 12 checks on `main` (light and dark): dark surfaces in the walkthrough,
408 words in the home page's `main` (limit 400) and an animation ending at 4.83 s (limit 4.5 s).

- **Always-light surfaces** (`app/marketing-journey.css`): the coach's header in the phone mock
  is white with the coach's colour as text and a 3 px accent rule; colour swatches are thick rings
  on white; the logo tile and avatar are white with a coach-colour border; the phone notch is the
  frame's light grey. The illustration still shows the coach's colour everywhere it did.
- **Words** (396): the hero line under the actions is "Built for UAE trainers · No technical
  skills needed" (the AED price is said in "Your site. Your price."); the control card's rule reads
  "Your rule: two easy sessions → add 2.5 kg."
- **Motion** (every beat ends by 4.48 s): chapter 5's subscriber steps (profile, Join, card, Pay,
  intake chips at 80 ms steps) start earlier; chapter 6 returns to the coach at 3,450 ms (swap at
  4,020 ms, the usual 570 ms after) with the phone's "Report pain" at 3,100 ms and "Workout
  paused" at 3,250 ms, so "Safety hold" rises at 4,100 ms. No beat was removed; chapter lengths are
  unchanged.
- Checks: `npm run test:brand` 112 screens, 0 failures. `npm run test:marketing-motion`: sitewide
  passes; the journey check's launch-gate expectation now follows the owner's "always show the
  walkthrough" (30 September; `journeyAvailable`), and the journey half is 180/181. The remaining
  failure ("1366 mouse: hover stops the clock, not the beats") is identical on the base `r5/models`
  build and is not touched here.

## Phase 1 of the marketing revamp: /, /trainer-brain, /demo and /pricing (28 October 2026, PR #105)

**Decision.** The owner chose the recommendation on 27 October 2026: "Go with your recommendation". That means concept A's "Live Brain", plus concept C's decision anatomy, Never list and source badges, plus concept B's pricing page and calculators. It came with the owner defaults:
- publish "14 AI specialists and 11 code steps" with "How we count";
- the Recovery rule and the Meal planner show as "Not on yet";
- no founder note, and no card-processing rate.

**Rollout.**
- Phase 1: these four pages, as their own PR, "checked and deployed".
- Phase 2: every other page.
- Phase 3: Arabic, tracking and A/B tests.

**Where to read more.**
- Spec: `docs/marketing-revamp-2026-10-26/phase1/PLAN.md`; design: `PLAYBOOK.md` and `showcase/SHOWCASE_DESIGN.md` in the same folder.
- Branch: `claude/repository-overview-osejlw`.
- The showcases: [brain-showcase.md](brain-showcase.md). The motion exception: [marketing-motion.md](marketing-motion.md).

### Rendering

**Pages.** `BESPOKE` in `site.tsx` maps the four paths to their own server components in `components/marketing/pages/`: `home.tsx`, `trainer-brain.tsx`, `demo.tsx` and `pricing.tsx`. Every other page still renders through `StandardPage`.

**Shared parts:**
- `page-parts.tsx`: `Section`, `PageHead`, `InShort`, `Faqs`, `Related`, `Closing`, `primaryCta`, `TEACH_CTA_PATHS` and the `Ctx` type;
- `proof.tsx`: the proof atoms (status chips and panel, "Not on yet", the sample and estimate labels, source badges, the Never sheet, `CtaMicro`);
- `packages/contracts/src/marketing-proof.ts`: the lists behind them (`STATUS_ITEMS`, `HOME_OFFER`, `PROOF_LINKS`, `NEVER_LIST`), the gates (`PUBLISH_GATES`, `TEACH_GATES`, `gatesState()`) and `/pricing`'s block chips (`PRICING_CHIPS`, `BlockChip`).

**Islands:**
- `home-islands.tsx`: the walkthrough stepper;
- `brain-page-islands.tsx`: RuleLedger, ReleaseTimeline and CompareReplies, every one labelled as a sample;
- `pricing-islands.tsx`: ShareSlider and TakeHome, each with one polite live region that speaks after input pauses for 500 ms.
- **Their startup work** (final fix pass, L16). Number formatters are built once per module, not on every call (`islands.tsx`, `pricing-islands.tsx`, `pages/pricing.tsx`, `marketing-calculators.ts`). `BANDS` and `commission` moved into `packages/domain/src/commission-bands.ts`, which imports nothing, so the browser no longer evaluates the domain index and its red-flag rules; `@trainer/domain` still re-exports them. The follower-settings zod schema is built on first use. `/` blocking time at 4× CPU on a quiet machine went from a median of 298 ms to 261 ms. `tests/marketing-follower-model.test.ts` holds the imports.

**Static mode.** `Ctx.showcase` carries the showcases' static mode (`MARKETING_SHOWCASE`, [brain-showcase.md](brain-showcase.md)).

**Stylesheets.** All are imported in `app/layout.tsx` after `marketing-journey.css`, so every route on the catch-all loads them.
- Page sheets: `marketing-proof.css` (`.mk-pf-`), `marketing-home.css` (`.mk-hm-`), `marketing-brain-pages.css` (`.mk-tb-` and `.mk-dm-`) and `marketing-pricing.css` (`.mk-pr-`). Together they are 7.93 KB gzipped (8,118 B, measured on `41e3a4c` with the budget test's arithmetic) against an 8 KB budget, so 74 B are left. Any new rule has to pay for its bytes.
- Then the four first-frame showcase sheets, `app/brain-*.css`.
- Don't run Prettier on the page sheets. It splits the reduced-motion selectors across lines, and the motion test needs each selector on one line.

**Bands.** Every band keeps the house structure, `.mk-home-band > .mk-container.mk-home-inner`, so the section reveal and the band rhythm are the home's. A band that holds a showcase carries `.mk-sc-band`, and the reveal leaves it alone.

**In-page links and focus clear the sticky header.** The public root's `scroll-padding-block-start` is the header's height plus 8 px: 82, 77 and 73 px at the header's three heights ([brand.md](brand.md)). Fix round 2 had given the bands a `scroll-margin` instead; the final pass removed it, since it would add to the padding.

**Light, except the showcases.** Public pages stay light in every colour scheme. The one dark surface is the showcases' ink stage, inside `[data-showcase]` only ([brand.md](brand.md)).

### The call to action

**Primary.** "Teach your AI — free" goes to `/signup`. While sign-ups are closed it is "Join early access — free", going to `/get-started#early-access`.
- `teachCta()` in `frame.tsx` builds it.
- It appears on the four pages only: the header, the hero, the closing panel, the showcases and the calculators.
- `TEACH_CTA_PATHS` in `page-parts.tsx` lists the four paths, and their registry entries have no `cta` of their own.

**Unchanged until phase 2.** Every other page keeps `claimCta` ("Start coaching", or "Join early access"), and so do the sign-in and sign-up header and Kamran's hand-off.

**Micro line.** Under the hero buttons, `CtaMicro` reads:
- "Free to join · Nothing to pay upfront · Nothing goes live until you publish";
- or, while sign-ups are closed, "Free to join · We’ll tell you here when sign-ups reopen".

**Secondary.** From the registry's `secondaryCta`. The closing panel's link uses it too.

| Page | Secondary call to action |
|---|---|
| `/` | Try the demo → `/demo` |
| `/trainer-brain` | Try the demo → `/demo` |
| `/demo` | See how it works → `/how-it-works` |
| `/pricing` | Estimate my earnings → `/earnings-calculator` |

"Teach your AI — free" follows sign-ups only (PLAN §1.5), so it still shows while the AI model is off. Making it depend on the model is the owner's decision.

### What is live: gates and flags (corrected 28 October 2026)

Fix round 2 and the final fix pass tied every "live" claim on the four pages to the checks the product itself makes. Before, publishing was taken to wait for payments and payouts, and several answers were fixed text.

**The gates** (`packages/contracts/src/marketing-proof.ts`):
- `PUBLISH_GATES` is sign-ups (`registration`), subscriber payments and the AI model. These are the go-live checks `publishStorefront` refuses on (`apps/api/src/onboarding.ts`): approved legal documents (in production, `LEGAL_APPROVED` also opens sign-ups), card payments configured and approved, and the coaching assistant. Bank details are asked at the first payout, not before launch, so payouts are not a publish gate.
- `TEACH_GATES` is the AI model.
- `gatesState(flags, gates)` is true once every gate is on, false once one is off, and undefined while the others are on and sign-ups are unknown. A line that waits for sign-ups is left out while they are unknown.

**The status panel and strip (`STATUS_ITEMS`).**

| Item | Live once |
|---|---|
| Sign up free | sign-ups open; otherwise "New sign-ups (early access for now)" under Not on yet |
| Set up your page and app; Preview what subscribers will see | always |
| Teach and test your AI | the AI model is on; otherwise "Teaching and testing your AI" |
| Publish your page to subscribers | every `PUBLISH_GATES` gate is on; otherwise "Publishing your page to subscribers" |
| Subscriber payments in AED; Paid bookings | payments |
| Payouts to a UAE bank | payouts |
| Voice add-on for subscribers | voice and payments (subscribers buy it at checkout) |

**The home walkthrough's "Not on yet" flags** (`STEP_GATES`, `pages/home.tsx`): "Teach your Brain" and "Test it" while the model is off; "Publish and share" until every publish gate is on; "Get paid monthly" until payments and payouts are both on. `tests/marketing-home.test.ts` runs all 32 combinations of sign-ups × model × payments × payouts × voice against an expectation written apart from `STATUS_ITEMS`.

**The `/pricing` hero strip** (`StatusStrip`, `proof.tsx`) says "Subscriber payments and payouts are live." only once publishing and payouts are on. Otherwise it names what is missing, with a "What works today" link:
- while payments are off: "Subscriber payments are not on yet." or "Subscriber payments and payouts are not on yet.";
- while payments are on and publishing is not: "Publishing your page is not on yet." or "Publishing your page and payouts are not on yet.";
- once publishing is on: "Payouts are not on yet."

**Answers that follow the gates** (`AVAILABILITY_LINES`, `marketing-content.ts`). A line's `when` is one flag or a list of gates, `registration` included. `marketingPageFor(page, availability, registrationOpen)` applies a line only when every gate is on; the registry's own text holds in every other state. `site.tsx` passes `platform.registrationOpen`, and so do JSON-LD, the `llms-full.txt` route and the assistant facts. A caller that leaves it out gets the cautious answers, never "Yes".
- **"Can subscribers pay me today?"** (`/`, `/pricing`):
  - payments off: "Not yet. Subscriber payments are not on yet, and publishing your page waits for them. With an account you can already set up your page and app." While the model is on it adds ", and teach and test your AI.";
  - payments on, publishing not on: "Not yet. Subscriber payments are on, but publishing your page is not on yet. With an account you can already set up your page and app.", with the same addition while the model is on;
  - every publish gate on: "Yes. Subscribers pay you by card in AED."
- **"How do my Instagram followers become subscribers?"** (`/faq`, and the `/how-it-works` journey's phone line): the registry answer is conditional ("Once your page is live, followers open it, choose your offer and pay in AED."); the present-tense answer waits for the publish gates.
- **`/faq` "How does money reach me?"**: until payments and payouts are both on, "Once subscriber payments and payouts are on, subscribers pay by card in AED through Stripe, and after reconciliation your earnings are paid monthly to your verified UAE bank account, with a statement from gross to net." Once both are on, the present tense.
- **`/faq` "What does a subscriber get for their money?"** ends "… nutrition, voice and one-to-one sessions once each is on." until nutrition, voice and payments are all on.

**`/pricing`'s block chips** (`PRICING_CHIPS`): "Not on yet: subscriber payments" and "Not on yet: payouts" on "How you earn"; "Not on yet: subscriber payments" on the worked example; "Not on yet: payouts" on the payouts card; "Not on yet: your own domain" on the Optional card while custom domains or payments are off (a domain is bought by card). The page renders them through `BlockChips`, and `llms-full.txt` and the assistant facts print the same table after each block's text, so a sentence about payouts never reads as live there either.

**`llms-full.txt` and the assistant facts** also print the home offer with each item's state ("(included)", "(optional tier, not on yet)", "(add-on, not on yet)"), the status lines under "What works today" and "Live today, and not on yet", and every section's note ("Once your page is live.", "An arithmetic example, not a forecast or promise.").

**Checks.** `tests/marketing-home.test.ts`, `marketing-pricing.test.ts`, `marketing-site.test.ts` and `marketing-frontier.test.ts` (which allows gate lists) hold this. The final fix pass's flag-matrix scan rendered `/`, `/pricing`, `/trainer-brain`, `/demo` and `/faq` in 80 flag states (400 renders) with exact checks and found 0 problems; fix round 2's scan had found none in 337.

### Home structure

Title "Free-to-join AI trainer platform for UAE coaches", with the eyebrow "FOR UAE PERSONAL TRAINERS". `lastUpdated` is 2026-10-27 on all four pages.

1. **Hero.**
   - The H1 is `BRAND_COPY.homeHeadline`, "Teach your AI. It trains your subscribers.", with "trains" in Pace.
   - Then the field ([brain-showcase.md](brain-showcase.md)), then the lede: "Specialists inside your AI handle every message. Code checks every step. You decide what goes out."
   - Then the primary action, "Try the demo", and the micro line.
   - The DOM order is the same at every width: H1, field, lede, buttons. Wide screens place the field in the second column with grid areas, never CSS `order`. Tablets from 761 to 1180 px stack in DOM order.
   - From 1181 px the hero grid is `minmax(0, 5fr) minmax(720px, 7fr)` (final fix pass, L11). The field keeps the 720 px its desktop layout needs, so no node label is cut, and below about 1,370 px the copy column gives up the difference. Measured: 0 ellipsized labels at 1181, 1240, 1280, 1312, 1366 and 1440 px, and the call to action on the first screen at 1280×720 and 1181×720.
   - `<link rel="expect" href="#mk-hero-end" blocking="render">`: the first paint waits until the hero's last child is parsed, the field's first frame included.
2. **"Change a setting. Watch it re-sort."** (`#resort`, paper): the board, labelled by the band's H2, and "Throw a moment at your Brain" → `/demo`.
3. **"How it works"** (white): three numbered steps from the registry, then "Setup to payday · 8 steps". The third, "You decide", reads "Replies wait for you. Your choice: approved reply fits → sent on its own. Pain → paused." (fix round 2: level 1 starts in "Waits for me").
   - That is the `/how-it-works` steps as an ARIA tabs stepper with a roving tabindex. Left and Right move between tabs, with wrap; Home and End jump; Previous and "Next step" step. Up and Down are not captured.
   - "Not on yet" flags (corrected 28 October 2026): "Teach your Brain" and "Test it" while the AI model is off, "Publish and share" until sign-ups, payments and the model are all on, and "Get paid monthly" until payments and payouts are both on ("What is live: gates and flags"). Until fix round 2, "Publish and share" waited for payments and payouts.
   - "See how it works" links to `/how-it-works`.
4. **"What subscribers get, under your name"** (white).
   - The offer list (`HOME_OFFER`), each item with its status: an available item shows its offer in green; one that is not shows it in grey with "Not on yet".
   - The address line: "Your site, your app icon," then the platform's coaching address for "your-name".
   - The sample app, labelled "Sample trainer". Its tabs follow the flags: "Chat" only while the AI is on, and "Meals" only while nutrition is on.
   - "All features".
5. **"You stay in charge"** (paper).
   - The registry's lead line, with its "“Waits for me” mode:" opening in bold.
   - The Never sheet, unsigned. Each line is a whole sentence that starts with "Never" ("Never hide pain or red flags from you."), so it reads the same in `llms-full.txt` and the assistant facts, which also carry its note.
   - The flow window "How your AI decides": Omar, Yousef and Noura's lines, taken from traces t1, t6 and t2 and the default settings; the test holds them to the traces.
   - "How your AI decides" → `/trainer-brain`.
6. **"Free to start. Your price."** (white).
   - The status panel comes first: what works today, before any amount.
   - Then three facts, with the share bands from the ledger's `BANDS`: "25% first 100 · 20% 101–300 · 15% 301–1,000 · 10% 1,001+".
   - "Tools it replaces": all seven `REPLACES` rows with their status, live ones first.
   - The address preview, only while sign-ups are open.
   - "Pricing in detail".
7. **"What are your followers worth?"** (paper).
   - The chips "Not on yet: subscriber payments", "Estimate, not a promise" and a source badge.
   - The compact follower calculator, unchanged.
   - A call to action with "Free to join", and "Open the full calculator".
8. **"Proof you can check"** (white): `PROOF_LINKS`.
9. **"Questions trainers ask"** (white): seven questions, all closed, with "All questions" → `/faq`.
   - The first is "How does {APP_NAME} work?", answered by the answer-first introduction (the house rule; `brand.test.ts`).
   - The six approved questions follow: "Will my AI replace me?", "What happens when a subscriber reports pain?", "Does it cost anything to join?", "Will my followers pay?", "Can subscribers pay me today?" and "Do I need technical skills?".
10. **Closing panel**, with "Try the demo".

**Left `/`:** the journey band and its pin, the scroll scenes (parked: [scroll-scenes.md](scroll-scenes.md)), the relay, the decision-flow card and the commission pills.

**Stays:** Kamran's floating button, unchanged, on `/` only.

**Moved:**
- The Instagram question (`INSTAGRAM_FAQ`) is now at the end of `/faq`.
- The journey's subscriber line that quoted it (`SUBSCRIBER_LINES[4]`) points there, so `/how-it-works` renders the same text.

### /trainer-brain, /demo and /pricing

**`/trainer-brain`.** Title "Trainer Brain: an AI trainer from your judgment"; H1 "Your AI, built from your judgment".
- **Head:** the lede, the calls to action and the micro line, with the RuleLedger sample beside them. Since the final fix pass the ledger agrees with the traces (HON-11): "Deload every 4th week · notes.pdf · reviewed" is Confirmed, because t6 cites it as the trainer's rule; the flagged row is "Cardio before lifting → swap the order · notes.pdf · reviewed · Flagged · conflicts with case 3", a rule no trace uses; "No equipment match → hand to me" was dropped to keep four rows.
- **Bands, in order:**
  - "Not a generic workout generator" (`what`): one decision traced to its source. The chain uses t1's numbers: "Back squat 60 → 62.5 kg", the rule "Every set at 2+ RIR → +2.5 kg, up to 5%" and the source "“If every set leaves two reps in reserve, I add a small jump.”"
  - "Who’s inside your Brain" (`inside`): the roster by crew, with "How we count" and "See it work" links that play the specialist's moment in the playground. A link shows only while its moment runs under the page's flags ([brain-showcase.md](brain-showcase.md)).
  - "Anatomy of one decision" (`decides`): the anatomy, with "Skip the figure".
  - "Throw a moment at your Brain" (`play`): the playground.
  - "What you teach it" (`teach`): five cards with source badges.
  - "How it gets better" (`learns`): ReleaseTimeline and CompareReplies. Since fix round 2 the versions follow the order the product makes releases: "v1 Rules, quiz, 3 cases 16 Oct · v2 + 17 cases 18 Oct · v3 + 1 rule 19 Oct · v4 + 2 corrections 21 Oct". The rule card to review is the suggestion from the trainer's edit (t7): "Your edit · 22 Oct", "When every set of an upper-body lift is done, add 2.5 kg".
  - "What your AI will never do" (`never`): the unsigned Never sheet, beside "Your method stays yours" (`yours`).
- **Then:** "In short", four questions under "Questions about your AI", related links and "Last updated".
- **Claims about checks** (fix round 2). A first "Waits for me" version is published after confirmed rules, a finished quiz and 3 of the trainer's own cases, without an evaluation. Only sending on its own needs a passing check of 20 or more own cases, and once live every edit is re-checked. So the lede reads "…Every reply waits for you until you choose otherwise.", the intro "It is taught by you. Once it passes your test cases, it can send on its own, only within your rules.", and no answer says each release is checked before it goes live.

**`/demo`.** Title "See an AI coach decide: interactive demo"; H1 "Throw a moment at your Brain".
- The standard one-column page head, then the playground under it. The playground plays its first moment that runs under the page's flags once on its own, and takes its name from the H1.
- "What happens in your account" (`next`, three steps).
- "The 12 sample moments" (`moments`). Since the final fix pass (HON-1) its two paragraphs are built from the traces under the page's flags (`momentLines()` in `pages/demo.tsx`): each moment's outcome under the sample settings, and which moments are not on yet. With sign-ups open, the AI model on, and payments, payouts, voice and nutrition off, they read: "With the sample settings, “Squats felt easy” and “First plan” are sent on their own, within your rules. “Skip my deload?”, “Week is over” and “Creatine question” wait for you." and "“My knee popped”, “22 weeks pregnant” and “Chest pain (Arabic)” pause training. “You edit a reply” suggests a new rule. “Low recovery”, “Meal photo” and “Voice session” are not on yet." With the AI model off, only “Creatine question” waits, the three safety moments pause, and the other eight are not on yet.
  - The registry text, which `llms-full.txt` carries, names no moment: "Each moment ends one of five ways: sent on its own within your rules, waits for you, training paused, the member confirms, or a new rule for you." and "Change a setting and the same moment can end another way. A moment that needs something not on yet says so."
  - `tests/marketing-brain-pages.test.ts` parses the rendered paragraphs in six flag states, the AI model off and nutrition on with meal photos off among them.
- "Is this a real AI response?" says the playground banner's sentence: "AI steps replay answers from test runs or the app's tests, or are marked illustrative." "Can I test my AI before launch?" explains the practice quiz, the trainer's own test cases and the 20-case check before anything sends on its own.
- "In short", four questions under "Demo questions", related links and "Last updated".
- `/demo` is not in Kamran's destinations or the assistant's fact pages.

**`/pricing`.** Concept B's page: title "Online coaching platform fees and commission"; H1 "Free to join. You set the price.", with "price" in Pace.
- **Head:** the status strip comes before any AED figure, with the stairs of our share beside it. It follows publishing and payouts ("What is live: gates and flags").
- **Bands, in order:**
  - "What’s free, what we take" (`glance`): three cards. The Optional card reads "Your own domain, priced before you buy.", with "Not on yet: your own domain" while custom domains or subscriber payments are off. Since the final fix pass (HON-5, HON-6) it no longer offers the voice add-on, which subscribers buy, not trainers: a trainer's own domain is the only optional purchase (the owner's decision of 7 October 2026).
  - "How our share falls" (`bands`): the bands from `BANDS`, and the share slider. The slider runs from 1 to 1,500 subscribers, with jumps to 100, 300, 1,000 and 1,500, and one decimal.
  - "What you keep, in AED" (`example`): the worked example from `estimateEarnings`, with "Not on yet: subscriber payments" while payments are off, and the take-home tile from `MEMBERSHIP_MINIMUMS`. Under the tile ("Try your numbers") one computed line gives the minimum prices and the prepaid packs: "Prices start at AED 199 a month, AED 299 with nutrition or voice included and AED 399 with both. On a monthly offer, subscribers can also prepay 6 or 12 months at 10% or 30% off; your share of a pack is held until its 15-day refund window closes." The figures come from `MEMBERSHIP_MINIMUMS`, `prepayQuote` and `PREPAY_REFUND_DAYS`.
  - While payments are off a note follows: "Subscriber payments are not on yet.", plus "Set up and teach your AI now." while sign-ups are open and the model is on, or "Set up your page and app now." while sign-ups are open and the model is off.
  - "An hour sells only once" (`hours`): B's two price anchors.
  - "What else appears on your statement" (`statement`).
  - The `how`, `billing` and `payouts` cards. "How you earn" carries "Not on yet: subscriber payments" and "Not on yet: payouts", and the payouts card "Not on yet: payouts", each while its flag is off (`PRICING_CHIPS`).
  - "Live today, and not on yet" (`status`).
- **Then:** "In short", six questions under "Pricing, answered", related links and "Last updated".
  - "Who sets the price?": "You do: the price in AED, from 199 a month (299 with nutrition or voice included, 399 with both), the programme length, monthly or upfront billing, trials and promotions. Monthly offers also let subscribers prepay 6 or 12 months at 10% or 30% off." The share bands moved out of this answer in the final pass.
  - "What will I pay?" lists commission, card processing and "Your own domain, if you choose one, is extra."
  - "Who owns my subscribers’ data, and what if I leave?": "You keep your rights in what you provide, and subscribers keep theirs: we never own your method or sell client information. If you leave, you can download your data and ask to close your workspace once your existing subscribers are looked after." It rests on the terms of 14 October 2026 (§73, §95) and the closure route, which refuses until existing clients are settled. The pricing test reads both clauses from the terms file.
- **Figures:** every AED figure and percentage is the ledger's own, and the minimums and packs are computed from the product's constants. There is no card-processing rate: the statement says card processing is itemised.
- **The pricing guide** (`/guides/pricing-online-coaching-uae`, "Include commission and costs") says the same since the final pass: "Your statement also lists payment processing and your own domain, if you choose one. Monthly offers also let subscribers prepay 6 or 12 months at 10% or 30% off." That also brings the guide back over its 1,000-word floor (1,010).

### Copy limits

**`C0_PAGES`.** The four pages are in `C0_PAGES` (`tests/marketing-site.test.ts`), which checks:
- the C0 vocabulary;
- "your AI" in headings and FAQ questions;
- the house copy limits above;
- no placeholders.

**Registry words, measured by WP0 with each entry applied:**

| Page | Registry words | Title (with the brand) | Description |
|---|---|---|---|
| `/` | 632 | 60 | 147 |
| `/trainer-brain` | 684 | 59 | 152 |
| `/demo` | 358 | 52 | 150 |
| `/pricing` | 602 | 56 | 145 |

The SEO-depth floor is 350 registry words. `/demo` is 8 over it, so any cut there needs a replacement line.

**Home word budget: 624.**
- **How it counts:** visible words in `main`, as C1 counts them. It leaves out the showcases (`[data-showcase]`), the sample screens (`[data-sample-ui]`), the follower calculator (`.mk-home-calc`), screen-reader text, and closed or hidden content.
- **C1's target was 400.** The approved copy measures more, and copy is not cut without the owner. So the plan's rule applies: the measured figure is the budget.
- **Measured** by `scripts/brand-check.mjs` on 28 October 2026:
  - 624 with sign-ups open, as the brand check's platform has them;
  - 610 with them closed;
  - the old home measured 447.
- `HOME_WORDS` in `brand-check.mjs` holds it.
- **H2 cap: 9.** That is the seven registry sections, the FAQ band and the closing panel (`HOME_H2`).

### Checks for this package

**New unit tests.** All in `npm test`, so they gate deploys:

| Test file | Tests (on `41e3a4c`) | What it holds |
|---|---|---|
| `marketing-brain-traces` | 15 | the Brain traces |
| `marketing-showcase` | 19 | the showcase contract and budgets |
| `marketing-field` | 11 | the field and the board |
| `marketing-anatomy-play` | 28 | the anatomy and the playground |
| `marketing-home` | 12 | the home, the status panel and walkthrough over every flag combination |
| `marketing-brain-pages` | 12 | `/trainer-brain` and `/demo`, the moments paragraphs in six flag states |
| `marketing-pricing` | 11 | `/pricing`: the strip, chips, minimums, packs and the data answer |
| `root-marks` (fix round 2) | 7 | no `:has()` on the root, the marks, the header's scroll padding and the `<noscript>` rules |

`tests/marketing-helpers.ts` holds the shared helpers: `PLACEHOLDER`, `C0_BANNED` and `MODEL_OR_VENDOR`.

**Existing tests, changed in the merge that needed them.**
- `marketing-site`: the old home test is deleted, and `C0_PAGES`, the `/trainer-brain` `decides` bullets, `/demo`'s lede and "In short", and `/pricing`'s two anchors are added.
- `brand`: the eyebrow, and the home and `/pricing` closing links.
- `marketing-journey`: the journey is absent from `/` and unchanged on `/how-it-works`, plus the word lists.
- `marketing-motion-sitewide`: the hero's `rel=expect`; the relay, pills and `/demo` entries are removed.
- `marketing-frontier`: payments in the fixture.
- `logical-css`: its checker moved to `marketing-helpers.ts` (`physicalRule`), and the relay dot's exception went with the relay.
- `model-name-guard`: it also scans `components/marketing/brain/**`.

The plan's §2 table lists every row.

**Browser checks.**
- **`npm run test:marketing-showcase`.** The showcase check, also run in CI in the `homepage-call` job ([brain-showcase.md](brain-showcase.md)).
- **`npm run test:browser`.** The `/demo` smoke test now opens `/demo?sc=on`. In the playground, the knee moment must show "Training paused" and "No AI called", and Low recovery must show "Not on yet".
- **`npm run test:brand`.** The relay checks are replaced by hero-field checks:
  - at 1440: the H1, the primary action and the field's lanes on the first screen;
  - at 390: Noura's words, the STOP stamp and the Paused lane above y 770;
  - in right to left: the field's blocks swap sides.

  Showcases are exempt from the dark-surface rule, and from the focus-ring rule because they draw their own ring. It also holds the word budget and the H2 cap.
- **`npm run test:marketing-motion`.**
  - The sitewide check gives the four pages absolute budgets instead of comparing them with `c856d9d`: LCP 2.5 s or less on the H1 or the lede, CLS 0.001, at most 2 long tasks while scrolling, and blocking time of 600 ms or less.
  - `/trainer-brain` and `/demo` join its default pages, and showcases are left out of its hidden-text rule.
  - The journey check runs on `/how-it-works` only.

### Checks run (27–28 October 2026, per work package; local Chromium only)

**Typecheck and build.** `npm run typecheck` passed at the end of every package. `npm run build` passed at the end of WP0, WP1, WP4, WP5, WP6 and WP7a, and the route table shows `ƒ /[[...path]]`. The engine packages (WP2, WP3a and WP3b) did not run Next, so their code was first built inside the pages, in WP4 and WP5.

**Unit tests.**
- **Marketing suites** (`tests/marketing-*.test.ts`, `brand`, `logical-css`, `model-name-guard`, `discovery-seo`, `public-pages`): 214 of 215 after WP5.
  - The one failure was the journey test's Instagram line. The lead fixed it in `d5d32b9`.
  - WP7a then ran the journey and sitewide motion tests: 20 of 20.
- **Full `npm test`** (WP7a, 22 min 43 s): 2,064 tests, 2,061 passed, 1 skipped, 2 failed.
  - Both failures were the OCR tests (`ingestion-completion`, `onboarding-media`), because this container had no `tesseract`. CI installs it.
  - With `tesseract-ocr` installed, those two files passed 29 of 29.

**Rendered output (WP0's snapshot of all 35 pages under 4 platform states, plus the llms files and the assistant facts).** Only these changed:
- the four pages;
- `/faq`, with the appended Instagram question;
- `/features`, whose Trainer Brain tile shows `/trainer-brain`'s new description;
- `llms.txt`, `llms-full.txt` and the assistant facts.

`/how-it-works` was unchanged. WP7a's deletions changed no page: before and after were identical apart from React's generated ids on `/earnings-calculator`.

**Browser checks.**
- **The showcase check** passed on `0dfc1dd`: exit 0, 0 failures, 6 min 5 s. It passed again on fix round 1's tree, and twice more in WP7b's second round (375 s and 376 s). Later runs are in "Checks run after part 2" below ([brain-showcase.md](brain-showcase.md) has the measurements).
- **The journey check:** 209 passed, 0 failed.
- **The sitewide motion check:** passed in 18 min 41 s. In WP7b's second round it failed twice on `/trainer-brain` at 1366×900 (CLS 0.048 in 1 cold load of 5): the page head moved while the rule ledger was still being parsed. The lead added a render-blocking `rel=expect` to the end of its hero ([marketing-motion.md](marketing-motion.md): 0 shifts in 40 loads).
- **The brand check:** 38 failures in the first round.
  - 36 are pre-existing: the identical set fails on `4f35e5c`, the build before phase 1. They are the coach sign-in wait, workspace lockups in dark, the coach website and member-app colour checks, and `.onboarding-presence` at 4.30:1.
  - 2 were the phone walkthrough's "Not on yet" dots, drawn in their own background colour. Fix round 1 (`22d1a1a`) keeps each dot's words visually hidden instead. WP7b's second round ran the brand check again: 36 failures, all of them the pre-existing set, so nothing from phase 1 is left.
- **`npm run test:browser`** passed on its third run.
  - The first run failed on the member app's consent bar at 390×844 while another browser check ran alongside it. That step passed in runs 2 and 3.
  - The second run failed on WP5's own `/demo` smoke test, which looked for "No AI called" in the wrong element. It was fixed in `ad479b4`.

**WP4 and WP5's Playwright acceptance probes, each against `next start` and a platform stub.**
- LCP is the H1, or the lede on narrow `/trainer-brain` and `/pricing`.
- No horizontal overflow at 360, 390 and 1440, left to right and with `?lang=ar`. No duplicate ids, and no page or console errors.
- With JavaScript off, the first screens hold.
- Sign-ups closed: no `/signup` link.
- Kamran's button covers no control.
- `next dev`: no hydration warnings. WP4's duplicate-key error was fixed by keying host and island as one fragment.

### Checks run after part 2 (28 October 2026: fix round 2 and the final fix pass)

**Fix round 2** (reports in the session scratchpad, `fix2-*.json`):
- Copy and honesty: `npm run typecheck` exit 0; 237 of 237 targeted tests; a flag-matrix render scan of 337 page states with 0 problems; the showcase check passed on that engineer's build.
- Root marks: 130 before/after screen comparisons across public, member and trainer pages, light and dark, 390 and 1440; 126 identical, and 4 differ only in relative times ("7→8 minutes ago"). `npm run test:dark` and `npm run test:phone` failed identically on both builds (pre-existing failures).

**The final fix pass** (the pages' report is `final-P.json` in the session scratchpad; the engines' figures are in [brain-showcase.md](brain-showcase.md)):
- `npx tsc --noEmit -p .` exit 0, and 304 of 304 tests across the marketing suites, `brand`, `discovery-seo`, `public-pages`, `model-name-guard`, `i18n-hardcoded`, `logical-css`, `motion-css`, `rtl-layout`, `root-marks`, `react-dom-behaviour` (local Chromium), `analytics-consent`, `pwa` and `appearance`; `tests/platform.test.ts` 37 of 37.
- Real pages on its build of `488b9d1` in five flag states: the copy of `/`, `/pricing`, `/demo`, `/faq`, `/trainer-brain` and `/llms-full.txt`; keyboard focus walks with 0 controls hidden under the header in 8 walks; the root marks without JavaScript; the consent bar; the hero widths.
- The flag-matrix scan with exact checks: 400 renders, 0 problems.
- Its showcase check: exit 1, with 4 failures, all in the playground, whose engine work was still in progress ([brain-showcase.md](brain-showcase.md), "Results so far").
- The engines' half ran the full `npm test` at the end: 2,094 tests, 2,093 passed, 1 skipped, 0 failed (22 min 43 s).

**Not run here:** the milestone run of PLAN.md §4.6 (running alongside this docs pass) and the PR's CI. The lead records them in `CLAUDE_HANDOFF.md` and `docs/COMPLETION_STAGES.md`.

### For the owner (FYI)

- **CSS on every page.** Every page of the site, the member app included, loads the showcases' first-frame CSS (17.5 KB gzipped) and the page sheets (7.93 KB). WP7a's deletions took 2.1 KB off `marketing.css`. Net, the first-load CSS grew by 18.6 KB gzipped in the final fix pass's measurement. This holds until the marketing and app bundles are split.
- **JavaScript on every marketing page.** The catch-all route ships about 835 KB gzipped of JavaScript (about 2.9 MB raw) to every marketing page, the workspace and member chunks included. Phase 1 added 4.5 KB of it. A separate marketing route group would cut startup work far more than anything left in the page files (phase 2 or 3).
- **Speed budgets.** Long tasks of 80 ms or less are looser than the showcase spec (50 ms). Page blocking time is judged only against the build before phase 1 measured in the same session (baseline + 100 ms; the spec said prototype + 50 ms), and the engine's own share has a fixed 100 ms budget ([brain-showcase.md](brain-showcase.md), "Budgets").
- **Layout shift is reported in CI, not judged,** until it passes three PR runs in a row.
- **Search engines and automated tools see the still frames.** Lighthouse scores leave out the engine.
- **The off switch** (`MARKETING_SHOWCASE=static`) works without a rebuild. In production, set it in `runtime.env` and re-apply ([brain-showcase.md](brain-showcase.md)).
- **Copy derived or trimmed to fit the house limits** is listed in the PR. That includes the safety tooltip that now names the platform's rule, and the answer to "Can subscribers pay me today?" that no longer says "Today you can join".
- **Copy that needs the owner (final fix pass):**
  - the prepaid-packs sentences on `/pricing` and in the pricing guide are factual and computed from `prepayQuote` and `PREPAY_REFUND_DAYS`, but not approved by the owner;
  - the answer to "Who owns my subscribers’ data, and what if I leave?" comes from the 14 October terms (§73, §95) and the closure route; legal or the owner should confirm it;
  - "What will I pay?" lists commission, processing and the domain. The "AI Coach Service Fee" charged for AI and voice that serve subscribers (`platform-finance.md`) stays unmentioned, under the owner's no-AI-costs rule;
  - not changed: `/features/payments-and-payouts` still says "Optional services such as voice and your own domain.", and `PRICE_FAQ` (`/faq` and others) leaves out the minimums and the packs;
  - "Teach your AI — free" still shows while the AI model is off.

## Not done / next

- Phase 1 of the marketing revamp (28 October 2026, PR #105):
  - **Phase 2**, every other page:
    - "Teach your AI — free" everywhere, including `claimCta`, the sign-up heading and Kamran's hand-off;
    - "Not on yet" in place of "Available soon";
    - the C0 navigation, the sticky call-to-action bar on phones and the page transition;
    - Kamran's inline pills, Kamran on more pages, and `/demo` among his destinations;
    - the FAQ renames on other pages;
    - deleting or reusing the parked scroll-scenes engine;
    - `/coaches` noindex.
  - **Phase 3:** Arabic strings, measurement events and the A/B route split.
  - **Open checks:**
    - the milestone verification on the final tree (PLAN §4.6), the full showcase check included;
    - judging CLS in CI after three PR runs in a row;
    - judging the frame budgets on real hardware, and the anatomy's mount, which went over budget in 2 of 7 loads at 4× CPU here ([brain-showcase.md](brain-showcase.md), "Open").
    - Done since: the brand check and the showcase check after fix round 1 (WP7b's second round).
  - **Open in the pages:** while the consent bar is open it covers the anatomy's Pause at 1440×900 and on phones, and at `/demo` 320 the header's `nav.mk-mobile-nav` overflowed by 8 px in 1 of 3 runs.
  - **Later:**
    - a founder note and a card-processing rate (owner defaults);
    - splitting the marketing and app bundles (a marketing route group), so other routes stop paying for the showcases' CSS and marketing pages stop loading the workspace and member JavaScript. The final review's first-paint finding (PERF-7: first paint on `/` 150–400 ms later than before phase 1 at 4× CPU) was deferred to it: `content-visibility` on the lower bands measured no gain.
- Journey: the owner decides D10 (keep the player hidden until a coach can
  launch, the default built here, or show it earlier). brand-check has no
  launch-ready run yet (its runner seeds a platform with every provider
  off, so it measures the gate-closed pages, which equal base); the
  storyboard's LCP and long-task measurements (`marketing-perf-check.mjs`,
  section C) are not built. The sitewide microanimations (part B) are
  combined on `ui/marketing-motion` (tokens de-duplicated; see "Combined"
  above).
- Journey weight (second review): with the launch gate open, the player's
  first paint still costs `/how-it-works` roughly 50 to 120 ms at 4x CPU
  throttling (the visible stage itself; see "Second review" above and
  marketing-motion.md), so `npm run test:marketing-motion`'s sitewide half
  exits 1 on the player pages. It needs the owner to accept that cost or
  a lighter stage (fewer visible elements in chapter 1's two frames). The
  same run also failed on pages without the player (see marketing-motion.md
  for the numbers and the load on the machine).
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
