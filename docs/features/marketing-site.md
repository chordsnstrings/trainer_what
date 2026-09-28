# Public marketing site: multi-page, conversion, SEO and LLM SEO

Work package branch: `core/marketing-site` (base `b9ec7c1`). Migration: none.

Built from the 28 September 2026 strategy brief (positioning, personas,
honest conversion levers, site map, SEO and LLM SEO plan, follower model).
The brand is always the configured platform name (`APP_NAME`); copy is
written to read well as "TrainsYou" but never hard-codes it.

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

### Pages (44 registry entries)

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
- `/uae/dubai` and `/uae/abu-dhabi` with cited local facts and a "Looking for
  a coach?" directory block. No Sharjah page: no local data was found, and
  doorway pages are avoided.
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

Follower estimate, per month, as a low-high range:

```
Story views  = followers × Story reach(tier) × link Stories per month
Visits       = Story views × link-sticker click-through
Subscribers  = min(followers, visits × visit-to-paid conversion)
```

- Reach by follower tier (low = image, high = video): Socialinsider Stories
  benchmarks. Click-through 1-5%: creator reports (no industry benchmark
  exists; shown as such). Conversion 1.51-5.39%: Dynamic Yield e-commerce.
- An engagement rate (typed or from Instagram) scales reach by
  rate / 0.48% (Socialinsider average), clamped to ×0.5-×2.
- Also shown: the monthly subscription value at the trainer's own price, the
  twelve-month total before cancellations (not modelled), and the range with
  four more link Stories (the honest nudge "Followers who never see your offer
  can't subscribe").
- Display rounds the low end down and the high end to nearest, never up.

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
  disconnected). Fields: assumptions version, Story reach low/high for the
  five tiers, link click-through low/high, visit-to-paid low/high, the
  engagement benchmark and the largest scaling, plus "Public company details"
  shown on `/about` only when set. Percentages above 100 and a scaling outside
  1-10 are refused; an inconsistent set (a low above its high) is ignored and
  the cited defaults apply. Changes are in the existing settings change
  history.
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

## Not done / next

- Stage record: this package ran in parallel with others, so it does not edit
  `CLAUDE_HANDOFF.md`, `docs/COMPLETION_STAGES.md` or
  `docs/PROJECT_MEMORY.md`; the coordinating session records it there.
- Merge notes: `apps/api/src/onboarding.ts` gains the `share` step (other
  packages touching the registry need the step counts in tests re-checked);
  no migration is used (Instagram state and numbers are workspace records).

- Arabic pages (`/ar/...` with hreflang) wait for human translation.
- A consented early-access email capture endpoint (new storage).
- Open Graph images; Search Console and keyword validation after launch.
- Public company details must be supplied by the owner.
- When the web-addresses package (subdomains) lands, `coachAddressTemplate`
  in `publicPlatform()` should return `{slug}.<root>`.
- Headline A/B via the existing experiments needs admin-configured variants.
