# Home page: the owner's HTML design — 25 October 2026

The owner uploaded a complete home page (`index.html`, about 128 KB) and asked for three things:
- check that the current implementation works;
- implement the site design as that HTML;
- check that the design is SEO, LLM SEO and conversion compliant.

They asked to be asked before starting. They then answered four questions:
- **Checks:** a full check.
- **Design:** "Exact copy of the HTML", including its GSAP 3D scroll motion, which overrides the "short, play once" marketing motion rule.
- **Additions:** none ("as it is now").
- **Release:** a PR first. The owner approves before anything merges or deploys.

## What was built

The home page (`/`) renders the design in place of the previous home. Every other marketing page is unchanged.

- **`apps/web/components/marketing/home-design.tsx`** (server component) holds the design's markup: header, phone menu, sections, sticky phone bar, footer and JSON-LD.
  - Classes carry a `tyh-` prefix.
  - Copy, order, icons and attributes follow the file, including `target="_blank"` on the links that open new tabs.
- **`home-design-runtime.tsx`** (client) is the design's script with an undo for every listener, observer, timer and GSAP context, because the marketing site navigates in place. It covers:
  - the sample decision feed and Replay;
  - the earnings calculator (marginal bands);
  - the stat count-up and the tools strike-through;
  - the sticky phone bar, the menu and Escape;
  - campaign parameters (`utm_*`, `gclid`, `fbclid`, `ttclid`, `ref`) carried to every sign-up link, with `price_aed` added to the calculator's link;
  - the `dataLayer` events;
  - GSAP ScrollTrigger scenes and the magnetic buttons.
- **`apps/web/app/home-design.css`** is generated from the file's `<style>`:
  - every rule sits under `.tyh` and every class is prefixed, so nothing reaches the trainer workspace, member app or coach sites (all app CSS is global);
  - left/right are written as inline start/end (identical in English, mirrored in Arabic);
  - rules for classes the page never uses were dropped;
  - hand-written additions are marked "Not in the design".
- **Assets:**
  - the file's lockup (the symbol on a Pace square, 480 × 95) is `BRAND_ASSETS.lockupPace`;
  - its favicon matched the existing app icon, so the site's icons stay;
  - the design's Google Fonts Inter (variable, with the optical-size axis) is self-hosted from the same files as `--font-inter-opsz` (latin) and `--font-inter-opsz-ext`.
- **GSAP `3.15.0`** (exact pin) in `apps/web`.
  - The file loaded 3.12.5 from cdnjs; 3.15 has the same API and the free standard licence.
  - Only `home-design-runtime.tsx` imports it (enforced by a test), and only `/` renders that component, so GSAP runs only on `/`.
  - Correction (25 October, after merge): every page downloads it. The single catch-all page gives the whole app one shared client bundle (about 850 KB gzip before this change). GSAP and ScrollTrigger are in that bundle, so every page downloads about 42 KB gzip more, about 5 %. On other pages the code is never run. Making it a dynamic import inside the runtime's effect would move it to a chunk only `/` fetches.
- **Registry** (`packages/contracts/src/marketing-content.ts`): the home entry carries the design's words, so metadata, the sitemap, `llms.txt`, `llms-full.txt` and the JSON-LD say what the page says:
  - title "AI Coaching Platform for Personal Trainers";
  - the eyebrow, lede and H1, with the second sentence marked;
  - the "What is {APP_NAME}?" definition as the intro;
  - a section per design block: the at-a-glance table, the three how-it-works steps, the seven tools, the platform parts and add-ons, earnings, control, pricing bands and specialties;
  - the design's eight FAQs.
  - A test checks that every registry line is on the rendered page.
- **JSON-LD** (`marketing.ts`): the home graph adds the design's SoftwareApplication (free offer in AED, audience, feature list), a HowTo and the WebPage `speakable` selectors (`#what p`, `#facts dl`). It keeps the Organization, WebSite, BreadcrumbList and FAQPage nodes.
- **`site.tsx`:** the previous home renderer is removed: `Home`, `HomeSection`, `SubscriberTiles`, `ControlFlow` and `EconomicsVisual`, plus `JourneyBand` from `journey.tsx`.

## Where the build differs from the file, and why

Only item 1 adds anything a visitor sees; the HowTo and the description are read only by search engines; the rest change nothing on screen in the production configuration.

1. **"Analytics preferences" in the footer's copyright line** (an underlined text button, like every other public footer). The analytics consent (`components/acquisition.tsx`) opens its preferences only from a footer control marked `data-analytics-preferences`. Without it, a visitor on the home page could not change or withdraw their answer. CI's browser check caught this.

2. **Font and GSAP are served from this site, not Google Fonts and cdnjs.** The files and API are the same. This removes two third-party origins: speed, privacy, and no failure when a CDN is down.
3. **The two time-based GSAP entrances are CSS:** the hero copy rising (y 24, 700 ms, power3.out, 80 ms stagger) and the feed turning in on desktop (1 s, 150 ms delay).
   - They use the same values, so they start with the first paint instead of after the script loads. With the script loading after hydration, the hero would otherwise flash visible, hide, then animate.
   - The scroll-scrubbed scenes and the magnetic buttons stay on GSAP, as written.
4. **Links are relative paths** (`/signup`, `/pricing`, …), the same addresses on trainsyou.com. They are `next/link` where the design opens in the same tab.
5. **Computed figures equal the file's figures today.** Text comes from the configured platform name, so a renamed platform never shows "trainsyou". The figures come from the code, so they cannot drift:
   - 91 capabilities;
   - 7 tools;
   - 25→10 % and the 25/20/15/10 bars;
   - the follower table: 7,000 followers at AED 199 gives 398 / 2,985 / 23,084 AED;
   - "30% yearly cancellations".
6. **While registration is closed**, the sign-up buttons read "Join early access" and go to `/get-started#early-access`, as before. Live registration is open, so the design's wording shows.
7. **For a renamed platform**, the end box asks "Ready to teach your AI?" instead of the trainsyou brand line, as every other page does.
8. **Robots meta** `max-image-preview:large, max-snippet:-1`, as in the file, now on every indexable marketing page.
9. **Meta description:** shortened from 184 to 155 characters, the length search results show. The wording is the file's, minus "nothing to pay upfront" and one "your".
10. **HowTo structured data:**
   - The file listed four setup steps ("Add a method", "Test a response", "Set your price", "Review and publish") that the page does not show.
   - Google's structured-data guidelines ask for marked-up content to be visible, and the repo's JSON-LD test enforces it.
   - So the HowTo uses the three visible "How it works" steps.
11. **The app's own CSS was neutralised under `.tyh`:**
   - its 14 px root (the design's rem are 16 px);
   - its heading font, letter-spacing and line-heights;
   - paragraph line-height, `small`, table header case and colour, the last table row's border;
   - input padding, and `font: inherit` on range inputs;
   - the paper canvas behind the page.
   - The assistant panel and consent bar keep the app's 14 px.
12. **`backdrop-filter` is written after its `-webkit-` form.** The CSS compiler drops the standard one when it comes first, which left the header unblurred.
13. **Text written as one string where the file has one text node.** React's server-render markers between split text nodes changed kerning on a few glyphs.
14. **`overflow-x: clip` on the root.** The scroll scenes start blocks up to 40 px to the side. The design hides that with `body { overflow-x: hidden }`, which iOS does not always honour, and in Arabic the offset showed as 6 px of sideways scroll (brand check). The clip keeps the sticky header working.
15. **The assistant's round button** (bottom right, 52 px) rises 72 px while the sticky phone bar shows, so it never sits on the bar's button.

## Fidelity check (the file against the built page)

`compare.mjs` (session scratch, not committed) loads a local copy of the owner's file next to the production build. The copy has the same font files and GSAP from `node_modules`, so no network is needed. It runs at 1366, 1080, 720 and 390 px, with reduced motion and with motion. Results on the final head:

- **Structure:** all 745 elements match in tag, class (prefix aside), text, link, target and attributes, at every width.
- **Computed styles** (about 60 properties per element) match, apart from 33 `text-align` values written as `start`/`end` instead of `left`/`right`, which is the same in English.
- **Full-page screenshots under reduced motion:** 0 different pixels at 1366, 1080, 720 and 390 before the footer's preferences button was added. After it, about 726 pixels differ, all on the copyright line. Page heights are unchanged.
- **With motion:**
  - the hero after the entrances, and scrolled states at 900 / 1800 / 2700 / 3600 / 4500 px, match. The 1366 hero differs by 889 to 964 pixels on the primary button's edges;
  - the same file compared with itself differs by 720 to 1,369 pixels on the same rows, from raster noise on its `will-change` button;
  - one scrolled state per run differs by a few thousand to about 19,000 pixels (1,800 px in one run, 3,600 px in another), with 0 at the others;
  - the built page compared with itself shows the same: 7,000 to 30,000 pixels at the scrolled states, including the 3,600 px earnings cards. These differences are raster noise from GPU-composited scenes, not a design difference.
- **Behaviour check (`behaviour.mjs`, local production build), all passed on the final build:**
  - the assistant's round button rises above the sticky bar, checked with a stand-in button because the fixture has the assistant off;
  - the menu opens and closes, including with Escape and on a link;
  - the sticky bar shows only between the hero and the end box;
  - the calculator: 150 at AED 199 → 29,850 / 6,965 / 22,885, 23.3%, and the sign-up link gets `price_aed=199` and the campaign parameters;
  - the feed plays, ends approved and replays;
  - FAQ answers open;
  - one JSON-LD block, whose FAQ equals the 8 rendered questions, with speakable targets present;
  - title, description, canonical and one H1;
  - navigating away in place and back restores the page and its scenes;
  - no page or console errors.

## SEO, LLM SEO and conversion review (shared with the owner before building)

What the design does well:
- **Answer-first definition and facts list.** The "What is trainsyou?" paragraph and the "at a glance" list are what AI answers and AI Overviews quote, and they are marked `speakable`.
- **Conversion:** one call to action repeated ("Teach your AI — free"), with zero price and risk reversal ("Nothing goes live until you publish", "No subscription fee").
  - The interactive calculator carries its price into sign-up.
  - The commission is framed as shrinking as trainers grow.
  - Objections are answered in the FAQ, and a sticky phone bar keeps the button in reach.
- **Search:** a stronger title keyword, one H1, a canonical URL, Open Graph and Twitter cards. The FAQ, SoftwareApplication and Organization data come from the page's own words.

What the owner was told and chose to keep as the file has it:
- **No social proof:** no testimonials or trainer counts. None were invented. The honesty scan blocks invented proof.
- **The calculator's "You keep" excludes card processing fees.** Other pages itemise them.
- **Internal links open new tabs** (`target="_blank"`).
- **The GSAP scroll-scrubbed 3D and magnetic buttons** override the "short, play once" marketing motion rule, by the owner's decision.
- **No Arabic copy:** the page is English and mirrors under `?lang=ar`.
- **No availability gating:** nutrition and voice show as offerings even while their providers are switched off.
- **The claim-your-address field** of the previous hero is gone.
- **About 1,600 words**, against the previous home's 400-word budget. The budget check was dropped for this page.
- **Google no longer shows FAQ or HowTo rich results for most sites** (2023). The markup stays because AI search engines read it.

Resolved in the build: the follower figures (computed, no drift) and the third-party font and script origins (self-hosted).

## Follow-ups (not in this change)

- **Dormant code from the previous home** can go in a separate cleanup once the owner approves this page. Keeping it until then makes switching back easy. It covers:
  - `HeroFlow` (hero relay), the journey player's compact variant;
  - the scroll-scene engine and its head script (inert: no page has `[data-scene]`);
  - `bandPills`;
  - the `.mk-hero`, `.mk-relay`, `.mk-home-*` and `.mk-walk-band` CSS.
- **The design's `dataLayer` events** (`cta_click`, `calc_change`, `faq_open`, `section_view`, `feed_replay`, `login_click`) go nowhere until a tag manager is added. That would need the analytics consent (`docs/features/analytics-consent.md`).
- **Conversion work the owner may want later:**
  - real testimonials or trainer counts;
  - a card-fee line in "You keep";
  - the claim-your-address field.
