The current pipeline is mapped below. The main risk for phase 1: every page served by the catch-all route already loads about 845 KB gz of JS, so the new engine must be a dynamic `import()` from inside a client island, never a static import. Line numbers refer to the current tree. The weight figures come from the existing local production build (`apps/web/.next`, BUILD_ID `mvp4dvkj`), served with `next start`, no API and a throwaway signing key. That means the fallback platform was in use: registration closed, Kamran off.

## 1. How the four pages render

**Shared path**
- **Route:** there is one route for everything, `apps/web/app/[[...path]]/page.tsx`. The only other app routes are `/og`, `llms*.txt`, the sitemaps and `/app/offline`.
- **Page:** `Page()` (page.tsx:301-315) looks up `marketingPage(route)`. If the page is not a workspace page and the host is not a coach host, it returns `<MarketingSite page platform={await publicPlatform()} origin>`. Otherwise it handles redirects and 404s (318-320).
- **Metadata:** `generateMetadata` (page.tsx:174-190) uses `marketingMetadata` (packages/contracts/src/marketing.ts:521-560). That sets an absolute title, description, canonical, robots, OG and Twitter, with the image from `/og?path=`. `generateViewport` makes public pages white and light (page.tsx:94-102, 141-143).
- **Always dynamic:** pages are rendered per request because `headers()` and `cookies()` are read (components/discovery-server.ts:15,28; public-website.ts:64-66).
- **Platform facts:** `publicPlatform()` (components/marketing/platform.ts:62-75) calls GET `/api/v1/public/platform`, caches it for 60 s in memory, and falls back to defaults (27-54). Its fields are in the `PublicPlatform` type (14-25): `registrationOpen`, `availability` (keys model, nutrition, voice, customDomains, payments, payouts, whoop, zepp, instagram, frontier), `followerModel`, `assistant`, `coachAddressTemplate`, `supportEmail`, `companyDetails`.
- **Root layout:** app/layout.tsx:154-194.
  - `<html lang dir data-reduce-motion suppressHydrationWarning>` (172-178).
  - Head scripts: `LAUNCH_COLOUR_SCRIPT` and `SCENES_HEAD_SCRIPT` (180-182).
  - Then `LocaleProvider`, the page, `AssistantButton` (not on coach hosts) and `AcquisitionConsent` (186-190).
- **`MarketingSite`:** components/marketing/site.tsx:1544-1586.
  - `marketingPageFor()` applies the availability lines (contracts marketing.ts:449; marketing-content.ts:681-713).
  - The CTA comes from `primaryCta` (82-87) and JSON-LD from `marketingJsonLd`.
  - Root element: `div.public.mk.platform-ui[data-mk-motion]` (1561).
  - Then `MarketingHeader key={page.path}` (1562-1568), `main#main.mk-main` containing `Home` or `StandardPage` (1569-1575), `MarketingFooter`, `<MarketingMotion path>` (1579) and the JSON-LD script (1580-1583).
- **Where the content comes from:** the registry `MARKETING_CONTENT` (packages/contracts/src/marketing-content.ts). Text passes through `brandText` (marketing.ts:318) as `t()`. JSON-LD, llms-full.txt and the sitemap use the same registry. A few strings are hard-coded in site.tsx: the hero micro line (1477-1479), the closing line (295), the `ControlFlow` text and `PriceAnchors`.

**`/`**
- Registry entry: marketing-content.ts:733-792. Sections `subscribers`, `control`, `economics`, `followers`; 6 FAQs; no `cta`.
- H1 is `BRAND_COPY.homeHeadline` (contracts brand.ts:27) with highlight "trains".
- Renders `Home()` (site.tsx:1441-1541). Section details are in part 4.

**`/trainer-brain`**
- Registry entry: 863-970. Sections what, teach, decides (cards), learns, never, control.
- CTA "Start teaching your Brain" → /signup (969). When registration is closed this becomes "Join early access".
- The frontier flag adds a bullet to "learns" and swaps the answer to the "trained on my data" FAQ (682-697).
- Rendered by `StandardPage` (site.tsx:1114-1209): breadcrumbs, head with eyebrow, H1, chip, lede, CTA and secondary link, then `Section`s, "In short", FAQs, related links, "Last updated", `Closing`.
- No page-specific island.

**`/demo`**
- Registry entry: 972-1033. CTA "Build my Brain" → /signup (1032).
- It has no lede, so the intro shows as `p.mk-answer` (site.tsx:1130) and there is no "In short".
- The "scenarios" section becomes the `DemoScenarios` island (site.tsx:1144-1155; islands.tsx:884-937).

**`/pricing`**
- Registry entry: 1830-1921. CTA is "Estimate my earnings" → /earnings-calculator (1920), so the header and closing CTA on /pricing are not "Start coaching".
- `CustomBlock` (site.tsx:1002-1008) renders `WorkedExample` (server-computed, 432-464) and the `EarningsCalculator compact` island before the sections.
- `AfterSection` adds `PriceAnchors` after the "hours" section (1068). The bands table comes from registry rows.

**Client components that hydrate**

| Where | Components |
|---|---|
| All four pages | `MobileMenu` (mobile-menu.tsx), `MarketingMotion` (motion.tsx), `AssistantButton` (renders nothing unless on `/` or a call is open), `AcquisitionConsent`, `LocaleProvider` |
| `/` | `JourneyPlayer` (journey-player.tsx), `FollowerCalculator compact`, `AddressPreview` (only while registration is open), `ScrollScenes` (scene-mount.tsx) |
| `/pricing` | `EarningsCalculator` |
| `/demo` | `DemoScenarios` |
| `/trainer-brain` | none beyond the shared ones |

`HeroFlow`, `showcase.tsx`, `chip.tsx` and `frame.tsx` are server code with no hooks. `frame.tsx` is also imported by the client file `public-header.tsx`.

**Measured weight**
- All four pages load the same 20 script tags: about 3.0 MB raw / 845 KB gz.
- One of those chunks, `1uw9bhae29hzc.js` (1.1 MB raw / about 303 KB gz), contains workspace and setup-wizard code plus the scroll-scenes engine, the journey player and the mobile menu.
- `/login`, `/coaches` and `/app` load the same chunks. The islands chunk `06jlwi6l1u2uh.js` (47 KB) also loads everywhere.
- Every page also loads 5 stylesheets, about 501 KB raw / 87 KB gz.
- Kamran's panel chunk (`2vhlj82-1wy1m.js`) and its CSS (`1rhs_p1ytuogk.css`, 3.4 KB) are referenced by no page's HTML. They load only on demand.

## 2. How islands work today

**Mounting and data**
- A server component imports a `"use client"` component and passes it serialisable props, for example `FollowerCalculator model={platform.followerModel}` (site.tsx:1447).
- Registry strings are passed through `t()` on the server before they reach the island (1147-1153).
- `JourneyPlayer` receives server-rendered parts as props (`stage`, `captions`, `head`, `foot`, `subLabel`; journey.tsx:964-998). It wraps them in a memoised `<Activity mode="visible">` so they hydrate late and never re-render (journey-player.tsx:164-172). docs/features/marketing-motion.md:198-218 records that a Suspense boundary was tried and rejected.
- Islands that fetch at runtime: `EarlyAccessForm` (islands.tsx:1020) and the consent component (acquisition.tsx:55-77, 246-292).
- The layout passes `MARKETING_SITE_PATHS` to client components (layout.tsx:22-24, 188-189) so the registry stays out of the client bundle (acquisition.tsx:580-581).
- All calculators sit in one client file, `islands.tsx`.

**Lazy-loading precedents**
- Kamran's panel: `await import("./assistant-panel")` on the first tap (assistant-button.tsx:58-73). The panel imports its own CSS (assistant-panel.tsx:3), which produced a separate CSS chunk.
- Also `next/dynamic` in the workspace (workspace.tsx:18-97) and `import("onnxruntime-web/wasm")` in lib/voice-input.ts:119.
- The marketing motion code itself is not lazy: `MarketingMotion` and `ScrollScenes` are static imports (site.tsx:60-62).
- The app does not use `next/script` anywhere.

**Scroll scenes**
1. `SCENES_HEAD_SCRIPT` (scenes-head.ts:20) runs before first paint and adds `html.scenes-on`. It does so only on `/`, never under device or member reduced motion, never for bots or webdriver unless `?scenes=on` is present, and only when IntersectionObserver and sticky positioning exist.
2. `<ScrollScenes/>` sits at the end of `Home` (site.tsx:1538; scene-mount.tsx:64-100). It repeats the head test for client-side navigation (`wanted()`, 23-37), runs `fitInPlace`, and calls `mountScenes()`. It switches off on a reduced-motion change through matchMedia and a MutationObserver (76-90).
3. Recipes register when their files are imported (scene-mount.tsx:15-16): scenes.ts:61-149 (beats, device, assemble, rise, flip, reveal, depart) and journey-scene.ts:17-56.
4. The engine (scroll-scenes.ts:138-258) finds `[data-scene]` elements and uses `[data-pin]`, `[data-stage]`, `data-span`, `data-mode`, `--len` and `--len-phone`. Its CSS is scroll-scenes.css:1-25, and the sticky top is `--scene-top` (74/69/65px, 33-46).
5. Test hooks: `html[data-scenes-still]` freezes time and `?scenes=on` forces scenes for automated browsers.

**Motion switch and reduced motion**
- `MARKETING_MOTION = "always"` (motion-mode.ts:34). It is rendered as `data-mk-motion` on `.mk` (site.tsx:1561) and on `.mk-assistant-host` (assistant-button.tsx:86-89).
- CSS reduced-motion rules skip everything inside it using `MOTION_ALWAYS_EXCLUDED` (motion-mode.ts:44-45). The rules are in globals.css:2002-2007, motion.css:55-58 and :132/:153, marketing.css:2966-2992 and :3025, marketing-journey.css:1569-1584, and marketing-assistant.css:32-36.
- JS reads the setting only in "device" mode: motion.tsx:34-37, journey-player.tsx:71-76 and :379-407, mobile-menu.tsx:26-27.
- The member's own setting arrives as `<html data-reduce-motion="on">` (layout.tsx:165-167, 176).
- The pinned scenes always follow both reduced-motion settings (scenes-head.ts:13-18; scene-mount.tsx:9-21).

## 3. Header, footer and the "Start coaching" CTA

- `START_COACHING = "Start coaching"` is defined at frame.tsx:24. `claimCta(open)` (25-29) returns that label with /signup, or "Join early access" → `/get-started#early-access` when registration is closed.
- `primaryCta` (site.tsx:82-87) uses `claimCta` when a page has no CTA or its CTA points to /signup. Otherwise it uses the page's own CTA.
- The header CTA appears at frame.tsx:115-117 and in the phone menu at 152-154. The footer's Analytics preferences button carries `data-analytics-preferences` (203).
- Navigation groups come from `marketingNav()` (contracts marketing.ts:385-412): Product (dropdown), For trainers (dropdown), Pricing (link), Calculators (dropdown). The footer map comes from `marketingFooter()` (414-436).
- The CTA is also rendered at site.tsx:1470-1472 (hero), 1132-1134 (`StandardPage`) and 297-299 (`Closing`). The secondary links come from 88-92 and 308-314.
- Other users of the header: `PublicHeader` on sign-in pages (public-header.tsx:39-45, uses `claimCta`) and coach-directory.tsx:296.
- Other places the "Start coaching" label appears:
  - Sign-up page heading: public-pages.tsx:657.
  - Kamran's hand-off label: apps/api/src/marketing-assistant.ts:346, and his prompt (packages/domain/src/marketing-assistant.ts:347).
  - Coach-site defaults: contracts site-builder.ts:2067, apps/api/src/coach-site.ts:71, lib/i18n/messages/site.ts:13.
- Tests that pin the label: tests/brand.test.ts:207-208, 259-264, 283, 293, 312; tests/setup-wizard-web.test.ts:234-246; tests/public-pages.test.ts:287, 302, 373; tests/marketing-assistant.test.ts:249-251.

## 4. The current home, in order

1. **Header** `.mk-header`: skip link `.mk-skip` → `#main`, wordmark, `nav.mk-nav[aria-label=Main]`, `.mk-header-actions` (Sign in, `.button.mk-cta`), and the phone menu `details.mk-mobile-menu` (`summary`, `.mk-mobile-panel`, `nav[aria-label="Site menu"]`, `.mk-mobile-row` with `--mk-stagger`, `.mk-mobile-actions`).
2. **Hero** `section.mk-hero` (site.tsx:1451-1484).
   - `<link rel="expect" href="#mk-relay-cap" blocking="render">` (1458).
   - `h1#mk-hero-h` with `span.mk-mark`.
   - `p.mk-hero-lede`, the CTA, the "See how it works" link and `p.mk-hero-micro`.
   - `HeroFlow`: `figure.mk-relay` with `figcaption#mk-relay-cap`, `ol.mk-relay-steps` with `.mk-relay-teach`, `.mk-relay-core` and `.mk-relay-train`, wires, `.mk-relay-return` and `.mk-relay-loop` (hero-flow.tsx:66-165).
3. **Journey band** `section.mk-home-band.mk-home-paper.mk-walk-band[data-scene=journey][data-pin]` with `--len:480; --len-phone:500` (journey.tsx:954-1002). It is always shown (`journeyAvailable` returns true, 40-42).
   - Inside: `[data-stage]` and `.mk-walk.mk-walk-compact`.
   - Player attributes: `data-chapter/state/run/hold/ready/start/end/go/back/sw2/scrub` (journey-player.tsx:626-644), `.mk-walk-seg[data-seg]`, `#mk-walk-label`.
   - Events: `mk-scene`, `mk-scene:hello`, `mk-scene:seek`.
   - Link to `/how-it-works#steps`.
4. **`#subscribers`** (white band): `ul.mk-icon-tiles` with `li[data-beat]` items (inert, because the band has no scene). Link "All features".
5. **`#control`** (paper band, `data-scene="beats"`): `ControlFlow` `div.mk-flow-card[role=img]` with `data-beat` 1-4 and `data-from` (site.tsx:1352-1395). Links to /trainer-brain and /demo.
6. **`#economics`** (white band): `div.mk-econ` containing `AddressPreview` or the static `.mk-browser`, then `#mk-bands-label` and `ul.mk-band-pills` (`li[data-beat]`). Link to /pricing.
7. **`#followers`** (paper band, `.mk-home-followers`): `div.mk-home-calc` containing `FollowerCalculator compact`. Link to /follower-calculator.
8. **FAQ band**: `section#faq.mk-faqs` titled "Questions trainers ask", with 6 `details.mk-faq`.
9. **Closing**: `section.mk-closing` with `h2#mk-closing-h` and `.mk-closing-cta`. Its unused `scene` prop is at site.tsx:277-290.
10. Then `<ScrollScenes/>`, the footer with `[data-analytics-preferences]`, `MarketingMotion` and the JSON-LD (WebPage and FAQPage).

**Script-set attributes:** `data-mk-reveal`, `data-mk-item` and `data-mk-cue`, plus `.mk-motion` on the root (motion.tsx:93-186).

**Kamran**
- The only entry point is `button.mk-assistant-fab` labelled "Talk to Kamran (AI voice)", placed by layout.tsx:188.
- It shows only on `/` unless a call is already open (assistant-button.tsx:57), and only when `platform.assistant` is true.
- Its CSS is marketing.css:2994-3029. It is hidden while the phone menu is open (marketing.css:355).
- Kamran can navigate only to `ASSISTANT_DESTINATIONS` (packages/domain/src/marketing-assistant-navigation.ts:2-15). That list does not include `/demo`.

**Experiment slot:** consent has a `landing-welcome` experiment slot on `/` (acquisition.tsx:657-663).

**What tests and scripts lock on the current home**
- tests/marketing-site.test.ts:482-622 pins the relay, the tile hrefs, the flow card, the band pills, the exact H2 list (591-599), the 6 FAQs, and the literal `mk-home-calc` source line.
- tests/marketing-motion-sitewide.test.ts:831-846 requires the `rel=expect` link to `#mk-relay-cap`.
- tests/marketing-journey.test.ts:131, 255 and 304 pin the journey band.
- scripts/brand-check.mjs:
  - Public routes list: 44-60.
  - Fails any dark surface on public pages: 250-273, 327-328.
  - Relay plays once, finishes by 4.5 s, no `infinite` animation: 484-540.
  - 400-word limit in `main` outside the calculator: 552-574.
- scripts/browser-check.mjs:80-89 clicks the /demo tabs "New pain" and "Outside what it was taught".
- scripts/marketing-motion-sitewide-check.mjs:88 checks `/,/how-it-works,/pricing,/features,/earnings-calculator`.

## 5. How to add a lazily loaded canvas engine

**Shape**
1. **Server component:** add one under `components/marketing/brain/`, the location the spec sets (SHOWCASE_DESIGN.md:230). It renders the first frame from the prototype's `renderStatic(d)` into the showcase root with `dangerouslySetInnerHTML`. React never reconciles inside that element, so the engine can change it freely.
2. **Client island:** pass that root as `children` to a tiny `"use client"` island. The docs say server components passed as children stay out of the client module graph (01-getting-started/05-server-and-client-components.md:180-182, 300-304). Wrap them in `<Activity mode="visible">` the way journey-player.tsx:164-172 does, and never re-render after mounting.
3. **Dynamic import:** the island must not import the engine statically. A `"use client"` file pulls all its static imports into the client bundle (same doc, 180-182). Here that bundle is the 1.1 MB chunk every route loads.
   - Use a literal `import("./brain/field")` inside the island, as the docs show for libraries (02-guides/lazy-loading.md:97-129). Kamran's panel shows this produces a separate chunk that no page HTML references.
   - Do not put the import in site.tsx: lazy-loading.md:60 says a Server Component's dynamic import of a Client Component is not code-split.
4. **Timing**, in `useEffect`:
   - Wait for `document.readyState === "complete"`, or the `load` event.
   - Then `requestIdleCallback(start, {timeout: 1500})`, falling back to `setTimeout(start, 300)` on Safari.
   - Then an IntersectionObserver with `rootMargin: "200px"`, then `import()`, then `mount(el)`.
   - This matches SHOWCASE_DESIGN.md:242-245. Prefetch anatomy with a literal `import()`, not `import(url)`.
5. **Clean-up:** strict mode is on by default with the app router (03-api-reference/05-config/01-next-config-js/reactStrictMode.md:8), and next.config.ts does not change it. So the mount must be safe to run twice and have a real cleanup.
   - The engine needs an unmount/destroy function. Today `mount()` returns nothing and keeps module-level state (a-field.js:195-203; brain-core.js `loop().stop()` at 173-183).
   - That module state survives `<Link>` navigation between pages.
6. **Before first paint:** use the existing head-script pattern. Add an `<html>` class in the layout head script, as `SCENES_HEAD_SCRIPT` does with `scenes-on` (layout.tsx:180-182; 02-guides/preventing-flash-before-hydration.md:15, 57-61, 109-116; `<html>` already has `suppressHydrationWarning`).
   - This is where the prototype's `data-sc="pre"` behaviour and its 6 s fallback belong, and C's `.js .ca` tall pinned section (c-anatomy.css:10). Setting either after hydration would shift the layout.
   - The island must repeat the test on client-side navigation, as scene-mount.tsx:23-37 does.
   - Map the prototype's `--header-h` to the site's `--scene-top`.
   - The site's scenes engine is `/`-only (scenes-head.ts:20; scene-mount.tsx:30). Anatomy has its own scroll loop (c-anatomy.js:526-537).
7. **CSS:**
   - First-frame CSS must load with the page, so it goes in a new sheet imported in app/layout.tsx. Every route pays for it (marketing-site.md:1108-1109), and the spec limit is 6 KB per concept (SHOWCASE_DESIGN.md:236). The prototype's a-brain.css is 46 KB.
   - CSS needed only once the showcase is running can be imported inside the lazily loaded module, like assistant-panel.tsx:3.
   - Replace the engine's `new URL(..., import.meta.url)` loading of CSS and JSON (a-field.js:198-201; brain-core.js:58) with static imports. Turbopack supports JSON and global CSS imports (03-api-reference/08-turbopack.md:91-109). The Next docs show `new URL(…, import.meta.url)` only for a service worker (02-guides/progressive-web-apps.md:158-160).
   - Never import CSS from site.tsx or anything it imports statically. The tests import site.tsx under node+tsx (tests/marketing-site.test.ts:61), and I confirmed a `.css` import throws there ("Unexpected token '.'").
8. **Rejected alternatives:**
   - `next/dynamic` loses the server-rendered first frame with `ssr:false`, cannot be used that way in Server Components (lazy-loading.md:66, 94-95), and starts loading right after hydration with no idle or viewport gate.
   - `next/script` needs a classic script in public/ with no bundling and no shared imports. `lazyOnload` has no viewport gate (03-api-reference/02-components/script.md:192-196), `onLoad` and `onReady` work only in client components (259, 305), and the `worker` strategy does not work with the app router (02-guides/scripts.md:128).
   - Turbopack is the build default in this Next (02-guides/upgrading/version-16.md:126-128).

**Conflicts the plan must resolve**
- **Reduced motion:** the owner's exception (showcases follow reduced motion) contradicts tests/marketing-motion-sitewide.test.ts:491-512. That test requires every reduced-motion rule in marketing.css, marketing-assistant.css and marketing-journey.css to skip `"always"`, and :301-337 bans `infinite` and non-token easing in marketing.css.
  - Put showcase CSS in a new sheet and add tests that pin the exception.
  - Inside `.mk`, globals.css:2002-2007 does not stop animations, so the showcase needs its own reduced-motion rules, plus the JS check `reduced()` (brain-core.js:86-94).
- **Section reveal:** add `[data-showcase]` to `NEVER` (motion.tsx:55). Otherwise a showcase band is a reveal unit (48-53) and gets faded and moved.
- **Dark stage:** the Concept A ink stage (for example a-brain.css:138, 225, 311) fails brand-check's dark-surface rule (250-273) and runs against tests/brand.test.ts:439-450 (no ink bands). It needs an explicit, agreed exemption for `[data-showcase]`.
- **Word limit:** brand-check's 400-word limit will count showcase words unless they are excluded the way `.mk-home-calc` is.
- **Copy source:** showcase text in the engine's `COPY` (a-field.js:14-34) sits outside the registry, which site.tsx:1-3 says every word comes from. That also affects JSON-LD and llms-full.txt.
- **Tests to rewrite with the new home:** the relay and journey checks, `rel=expect` (move it to the new hero copy anchor), and the /demo tab checks.
- **Kamran:** the button is fixed at the bottom-right with z-index 60 (marketing.css:2997-3014). Phone showcase controls should keep clear of it. Consider adding `/demo` to his destinations.