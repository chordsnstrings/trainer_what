# trainsyou corporate identity

Work package branch: `core/brand` (base `53063eb`, `integrate/round2`). No
migration.

The owner supplied the corporate identity kit (CI v1.0, 25 September 2026:
logos, icons, tokens, contrast checks, copy bank and guidelines). The site is
trainsyou.com and the brand name is written as one lowercase word:
**trainsyou**. Primary line "Your coaching. Beyond your hours.", descriptor
"Trainer-led AI coaching platform", primary action "Teach your AI".

The identity applies to the platform: the marketing site, sign-in and
sign-up pages, the coach directory, and the trainer, team and Super admin
workspace. Trainers' own coaching websites and member apps keep their Design
Studio branding and never show the trainsyou logo.

## One rule: the name decides the logo

`packages/contracts/src/brand.ts` holds the name, domain, approved copy
(`BRAND_COPY`), palette (`BRAND_COLORS`) and asset paths (`BRAND_ASSETS`).

- `DEFAULT_PLATFORM_NAME` is `trainsyou`, and so is the **Platform name**
  settings default (`APP_NAME`, `packages/providers/src/configuration.ts`; a
  test keeps them equal). The API's hard-coded "Trainer Brain" fallbacks
  (bootstrap, directory, joining emails, passkey `rpName`) now use it; the
  booking calendar `PRODID` reads `-//trainsyou//Booking Calendar//EN`.
- A Super admin who sets `APP_NAME` still overrides the name everywhere.
  `usesBrandIdentity(name)` is true for `trainsyou` in any case, with spaces
  or with `.com`; only then are the trainsyou logo, icons, share card and
  slogan used. Any other name is shown as text with the generated initials
  icons (the previous behaviour), so the logo never contradicts the
  configured name.
- `platformName(configured)` (contracts `brand.ts`) is the one place the
  shown name is resolved (API bootstrap, public platform facts, directory,
  install manifest, joining emails, passkey `rpName`, the web fallback): a
  blank value or the old default **"Trainer Brain"** (exactly, after
  trimming; `SUPERSEDED_PLATFORM_NAMES`) resolves to trainsyou, and any
  spelling that shows the identity ("TrainsYou", "Trains You",
  "trainsyou.com") is shown as `trainsyou`, as the copy bank requires. Any
  other chosen name is kept as entered.
- The settings form resubmits every shown value, so a platform whose
  application settings were saved before the rename stores "Trainer Brain"
  explicitly. The APP_NAME field lists it in `supersededValues`, so the
  settings page and the runtime settings read it (stored or from the
  environment) as the trainsyou default, and the next save stores
  `trainsyou`. No migration rewrites stored rows.

## Assets (`apps/web/public/brand`, supplied files, unmodified)

| File | Use |
| --- | --- |
| `trainsyou-lockup-ink.svg` / `-white.svg` | Header, footer, workspace sidebar (ink on light, white on dark) |
| `trainsyou-lockup-ink.png` / `-white.png` | Organisation logo in JSON-LD; places that cannot take SVG |
| `trainsyou-wordmark-*.svg`, `trainsyou-symbol-*.svg` | Available; the Open Graph route draws the ink symbol |
| `favicon.ico`, `favicon.svg` | Platform favicon (root layout `icons`) |
| `apple-touch-icon.png` (180), `app-icon-192.png`, `app-icon-512.png` | Apple touch icon and the install manifest (512 is also the maskable icon: the mark sits inside the safe zone on an opaque Pace square) |
| `social-share-1200x630.png` | Open Graph and Twitter image of the home page |

`/brand/` is excluded from the routing proxy (static files). The kit's own
sample manifest assumed `/icons/`; the paths are adapted to `/brand/`.

## Where it is applied

- **Header and footer** (`components/marketing/frame.tsx`, shared by the
  marketing pages, the directory and the sign-in pages): `PlatformLogo`
  (`components/brand-logo.tsx`) renders both lockups; CSS shows the ink one
  on light surfaces and the white one when `prefers-color-scheme: dark`
  applies inside `.platform-ui`. The lockup is 41 px high, 162 px wide (the
  digital minimum is 160 px). The footer adds the brand line and the
  descriptor. There is no in-app theme toggle today; a future one can reuse
  the same classes.
- **Workspace** (`components/workspace.tsx`): trainers, their team and
  operators get the lockup in the sidebar and `.platform-ui`; subscribers
  keep `TrainerTheme` with their coach's identity. The loading screen, which
  a member app also shows before it knows its trainer, now has a neutral
  indicator instead of the old "b." mark.
- **Favicons, touch icon and manifest**: `platformIcons(name)` and
  `platformManifest(name)` (contracts `discovery.ts`) serve the trainsyou
  icons, theme colour ink and background paper, and the descriptor as the
  manifest description. The root layout's `themeColor` is paper in light
  and ink in dark (two `theme-color` metas with media queries). Coach
  websites keep their own icons, manifest and colour; a signed-in member
  app (`components/member-app-install.tsx`) sets every `theme-color` meta
  to the trainer's colour and drops the media queries, so dark mode shows
  the trainer's colour too, and restores both on sign-out.
- **Trainers' own addresses** (custom domain or subdomain): sign-in,
  recovery, joining and legal pages there (`/login`, `/forgot-password`,
  `/join/*`, `/terms`, …) render through the workspace's public screens.
  The page passes the proxy's `x-trainer-site-slug` down
  (`requestOrigin().coachSlug`), and `components/public-header.tsx` then
  shows the trainer's identity inside `TrainerTheme`, "Sign in" and "Join
  coaching" (`/join-coach/<slug>`), never the trainsyou lockup or the
  "Teach your AI" sign-up link that coach addresses refuse; the card's
  "New to …? Get started" becomes "New here? Join coaching". Those pages'
  title, description, icons and browser colour are the trainer's, not the
  platform's B2B description.
- **Social previews**: the brand's home page uses the supplied share card;
  every other marketing page gets `app/og/route.tsx`, redrawn in the brand
  (white field with the ink lockup, the page's eyebrow and H1, a Pace panel
  with the relay mark). A renamed platform gets its name and initials.
- **JSON-LD**: the Organization logo is the lockup PNG and its `slogan` is
  the brand line, which the footer shows on every page.
- **Emails**: no email template carried a logo, and notification emails go
  to trainers' subscribers about their trainer's coaching, so no platform
  logo was added. The service worker's push title ("Trainer Brain") is now
  the neutral "Coaching update", because member apps carry the trainer's
  brand.

## Design tokens (`apps/web/app/globals.css`)

The supplied palette is declared as `--ty-*` and the existing variables map
onto it, so every existing rule follows the brand:

| Variable | Light | Dark (`.platform-ui`, `prefers-color-scheme: dark`) |
| --- | --- | --- |
| `--canvas` (marketing page) | white `#FFFFFF` | ink `#171917` |
| `--paper` (app background) | paper `#F3F4F0` | ink `#171917` |
| `--white` (cards, fields) | white | `#202320` |
| `--ink` (text) | ink | paper |
| `--muted` | `#616660` | `#A9AEA6` |
| `--line` | `#D9DDD5` | `#3A3F39` |
| `--field-border` | muted (the kit's field edge) | `#8A8F87` |
| `--green` (primary action and structure) / `--on-green` | ink / white | paper / ink |
| `--mint`, `--sand`, `--blue` (panels) | paper | `#272B27` |
| `--lime` / `--on-lime` | Pace `#D5F24A` / ink | the same |
| `--success`, `--warning`, `--error` | `#226044`, `#805400`, `#AD3535` | `#7FCB9F`, `#E0B25C`, `#F08A80` |
| `--*-bg`, `--*-line` | status tints (`color-mix`) | recomputed in dark |
| `--band-ink` / `--on-band` | ink / paper | `#262A26` / paper |
| `--focus` | ink (on ink bands: `--on-band`) | paper |
| `--radius` | 8 px panels (controls 6 px) | |

- About 380 hard-coded colours (the previous green palette) in
  `globals.css`, `marketing.css`, `platform-settings.css`, `governance.css`,
  `host-operations.css`, `nutrition.css`, the Design Studio editor chrome in
  `trainer-design.css` and smaller files were replaced with these tokens.
  Light grey text that failed AA (for example `#9aa199` on white) is now the
  muted token.
- Pace is a background accent with ink text (the done step, the exception
  count, the current row, the automatic lane) and a figure colour on the
  ink band; it is never text on a light surface. A test enforces it.
- The marketing site uses the white canvas with paper panels; bands are
  square editorial frames.
- `.trainer-theme` maps the tokens it did not have before (`--field-border`,
  `--on-green`, `--on-lime`, `--focus`, `--canvas`, `--green-hover`,
  `--client-bubble`) onto its own Design Studio variables and keeps the
  light status colours with self-contained tints, so trainer
  surfaces never pick up the trainsyou palette, and never go dark.
- Typography: Inter, kept in the repository (`apps/web/app/fonts`, the
  variable-weight Latin and Latin Extended files of
  `@fontsource-variable/inter` 5.3.0, SIL OFL 1.1 in `Inter-OFL.txt`) and
  loaded by `next/font/local`, so neither the image build nor the browser
  contacts Google. Latin is preloaded as `--font-inter` with a
  metric-matched Arial fallback; `--font-inter-ext` comes first in the
  stack but its unicode-range limits it to Latin Extended letters, which
  load only when a page uses them. Inter Display is not bundled, so display
  sizes use Inter. Headings are weight 500. The previous "DM Sans" and
  "Manrope" names (never loaded) are gone. Trainer surfaces keep their font
  stacks.
- Focus rings: `:focus-visible` draws `--focus`; the ink bands
  (`.mk-closing`, `.mk-band-ink`) set it to `--on-band`, since the page's
  ink ring would vanish on an ink band. A test resolves the ring against
  the band in light and dark and fails for any new `--band-ink` background
  without it.
- Logical properties only (`tests/logical-css.test.ts` passes); the lockup
  is Latin artwork and does not mirror in right-to-left layouts.

## Copy

- Home page: eyebrow "FOR PERSONAL TRAINERS", H1 "Your coaching. Beyond
  your hours.", an introduction that opens with "Teach your own AI how you
  coach" and ends with the copy bank's paid-offering sentence, followed by
  what the product does today; meta description led by the brand line.
- Primary call to action "Teach your AI" (sign-up and the guided setup);
  "Join early access" while registration is closed. Hero secondary action
  "Explore the platform" (to How it works).
- `llms.txt` and `llms-full.txt` add the descriptor, audience, line and the
  one-sentence introduction under the entity summary (brand only).
- Root layout description: the line and the product explanation.
- Every existing honesty rule and its test still apply; the copy bank's
  "avoid" list (perfect clone, unlimited income, guaranteed results, …) is
  not used. "Trainer Brain" remains the product's name for a trainer's AI;
  renaming it to the copy bank's "Your AI" navigation is a product decision
  left open.

## Checks

- `tests/brand.test.ts` (new, 8 tests): default name equals the settings
  default and `APP_NAME` overrides; every asset exists at its real size
  (opaque install icons, 1200×630 share card, outlined SVGs in ink and
  white, ICO header); manifest, favicons, touch icon, font, proxy
  exclusion; share card on the home page and the branded preview elsewhere;
  JSON-LD logo and slogan only for the brand; approved lines on the home
  page and in llms.txt; header and footer render both lockups and a renamed
  platform renders its name; trainer surfaces never use the platform
  identity; the palette equals the kit and every text/background token pair
  reaches 4.5:1 (focus and field edges 3:1) in light and dark; Pace is never
  text on a light surface. Review fixes added: `platformName` (blank, old
  default and brand spellings), the settings field's superseded value, the
  ink-band focus ring (3:1 in light and dark), the header on a trainer's
  own address (rendered), and the vendored font files and licence.
- Updated: `marketing-site` (the default name, the home share card, the
  lockup logo, a renamed platform), `discovery-seo` (initials icons for a
  renamed platform, the blank-name default), `fix-settings` (settings
  default), `rtl-layout` (the font class on `<html>`).
- `scripts/brand-check.mjs` (`npm run test:brand`, through
  `scripts/run-brand-check.mjs`, which reuses the right-to-left runner on
  ports 3124/4124): local Chromium, never a cloud browser. It also checks
  every visible focusable element's ring colour (`--focus`) at 3:1 against
  the surface behind it (trainer themes draw their own double ring), and
  that the coach website and the member app have every `theme-color` meta
  set to the trainer's colour. It does not visit a trainer's own address
  (that needs host mapping); the rendered-header test covers it.

Results of this package's run are recorded under "Checks run" below.

## Checks run (28 September 2026)

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass.
- `tests/brand.test.ts`, `marketing-site`, `logical-css`, `rtl-layout`:
  40 pass, 0 fail.
- PGlite: `discovery-seo`, `discovery-install`, `discovery-directory`,
  `marketing-api`, `fix-settings`: 37 pass after the updates (the two
  expected failures before them were the old default name and the
  initials icons of the brand name). `accounts-web`, `acquisition`,
  `fix-web`, `fix2-web`, `governance-web`, `infra-ops-web`, `joining-web`,
  `messaging-templates`, `platform-settings`, `provider-configuration`,
  `settings-runtime`, `web-address-web`, `marketing-api`: 92 pass, 0 fail.
- `npm run build` (once): passes; Inter was fetched and self-hosted.
- `scripts/brand-check.mjs` on that production build (`RTL_WEB_MODE=start`):
  72 screens pass (9 public and sign-in pages, 7 trainer and Super admin
  pages, the coach website and the member app, each in light and dark at
  390 and 1440 pixels): no horizontal overflow, the ink lockup in light and
  the white one in dark (162 px wide), the trainsyou favicon (the trainer
  workspace keeps its own install icon, as before), every scanned text
  element at WCAG AA against its rendered background (0 failures), no page
  errors; the coach website and member app show no platform identity;
  `/manifest.webmanifest`, `/brand/*` and `/og?path=/pricing` answer. The
  first runs found a real gap in the check itself (the sign-in click at
  390 px timed out, so workspace pages were never reached); signing in at
  desktop width and asserting the workspace path fixed it. After the last
  code changes (workspace footer line, analytics panel in dark, trainer
  theme status tokens) the same check passed again with `next dev`
  (72 screens), since the one allowed build had already run.
- `scripts/run-rtl-check.mjs` (`next dev`, after the last changes): 85
  measurements across the public, trainer, Super admin and follower
  screens, one failure: "English public header is not left to right". The
  check measured `.public-header`, which the marketing package had already
  replaced with `.mk-header` on platform pages, so it compared two missing
  elements (not caused by this package). The check now measures either
  header; the sources and public sections were rerun: 27 measurements,
  0 failures, 0 page errors.
- PostgreSQL sandbox (`/opt/tools/pg-sandbox.sh 56151`): `marketing-api`,
  `fix-settings`, `discovery-seo`, `discovery-install`: 32 pass,
  `PG_SELECTED_FAILED_FILES=0`.
- Not run: the full repository suite, the full PostgreSQL suite, the Python
  deployment tests (no infrastructure file changed) and the e2e harness.

## Review fixes and checks run (28 September 2026, second pass)

Fixed: the invisible focus ring on the ink bands (light mode); the stored
"Trainer Brain" name keeping the old identity after deploy; the member app
leaving the platform's dark `theme-color`; the platform header, sign-up link
and description on sign-in pages at a trainer's own address; the
`.env.example` name; brand spellings shown against the copy rules; the
build's Google Fonts download.

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass.
- `brand`, `marketing-site`, `logical-css`, `rtl-layout`, `fix-settings`,
  `marketing-api`, `discovery-seo`, `discovery-install`,
  `platform-settings`, `provider-configuration`, `settings-runtime`,
  `fix2-web` (PGlite): 102 pass, 0 fail. `joining-web`,
  `joining-invitations`, `discovery-directory`, `fix-auth`,
  `account-completion`: 52 pass, 0 fail.
- PostgreSQL sandbox (`/opt/tools/pg-sandbox.sh 56151`): `fix-settings`,
  `marketing-api`, `discovery-seo`, `joining-web`: 32 pass,
  `PG_SELECTED_FAILED_FILES=0`.
- `npm run build` (once): passes with no font download; the output has
  the two Inter files, Latin preloaded.
- `scripts/brand-check.mjs` on that build (`RTL_WEB_MODE=start`): 72
  screens pass, now including the focus-ring check on every screen and the
  trainer `theme-color` check on the coach website and member app in light
  and dark. A trainer's own address is not visited by the browser check.
- Not run: the full repository suite, the full PostgreSQL suite, the Python
  deployment tests (no infrastructure file changed) and the e2e harness.

## Deployment notes (deployment is separately assigned)

- A live platform whose application settings were saved before the rename
  stores `APP_NAME = "Trainer Brain"`; it now reads as unset, so the
  platform shows trainsyou after rollout with no operator step. A platform
  that chose any other name keeps it; to show the identity, set **Platform
  name** to `trainsyou` (a blank value is rejected). An environment
  `APP_NAME=Trainer Brain` is treated the same way; `.env.example` now says
  `trainsyou`.
- The build no longer downloads fonts: Inter is in the repository.
- The kit's own pre-launch checks remain the owner's: trademark clearance of
  the name and symbol, domain control, and an accessibility review of the
  implemented screens (the palette checks are not a full audit).
