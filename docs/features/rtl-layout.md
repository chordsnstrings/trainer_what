# Right-to-left (Arabic-ready) layout

Work package branch: `hard/rtl` (base `3088123`). Migration: none.

## Plan (written before implementation)

Findings from the existing code:

- `apps/web/app/layout.tsx` always renders `<html lang="en">`; nothing sets
  `dir`. Every page is the optional catch-all `app/[[...path]]/page.tsx`
  (Workspace, the coach website, the directory), so a per-route root layout
  is not available without restructuring routing.
- The member language (`en` | `ar`) is the notification preference added by
  the messaging package (`notification_preferences.data.language`, per
  workspace membership, `GET/PUT /api/v1/notifications/preferences`). The
  coach website (`coach_sites.draft/published`, `siteSchema`) has no
  language.
- `proxy.ts` already sees every page request, strips client `x-trainer-*`
  headers and rewrites custom-domain paths to `/coach/<slug>/...`.
- Physical CSS: about 50 declarations in `globals.css`,
  `platform-settings.css`, `trainer-design.css`, `meal-capture.css`,
  `nutrition.css`, `coach-site.css` (fixed sidebar with
  `inset: 0 auto 0 0`, `margin-left: 236px` main column, off-canvas
  `translateX(-100%)`, toggle knob `translateX(14px)`, `text-align: left`
  tables, `border-left` separators, four-value `margin`/`padding`).
  Newer stylesheets (account settings, joining, directory, governance,
  host operations) are already logical. Inline styles: one `right: 16`
  (analytics preferences box).
- Directional icons: lucide `ArrowRight`, `ArrowLeft`, `ChevronRight`,
  `ArrowUpRight`, `LogOut` and trailing `→` / `↗` text arrows on links.

Plan:

1. **Direction resolution.** A small shared module
   (`apps/web/document-language.ts`) validates `en`/`ar`, maps language to
   direction and resolves the document language: an explicit `?lang=` on
   this request, then the `trainer_lang` cookie (set by `?lang=` or mirrored
   from the signed-in member's saved preference), then the coach website's
   language on `/coach/<slug>` pages, then `en`/`ltr`. `proxy.ts` validates
   `?lang=`, sets the cookie and forwards the choice and the page path as
   server-set headers; the root layout renders `<html lang dir>` from them
   (a failing site lookup falls back to English). The coach website root
   also carries `dir`/`lang` so a client-side navigation renders correctly,
   and a small client component keeps `<html>` in step. In the workspace the
   member's saved language is applied after sign-in and mirrored into the
   cookie; saving the preference applies it immediately. The coach website
   gains an optional `language` (`en` default) in the website editor, stored
   in the existing site JSON (no migration; old drafts parse with the
   default).
2. **Logical CSS.** Convert the physical declarations to
   `*-inline-start/end`, `inset-inline-*`, `text-align: start/end`,
   `border-inline-*`, logical four-value rewrites, and a `--inline-sign`
   custom property (`1` in LTR, `-1` in RTL) for transforms and the
   off-canvas shadow. Mirror directional icons with one rule on the lucide
   class names plus a `bidi-mirror` class for text arrows. Keep LTR data LTR:
   `code/pre/kbd/samp`, email/tel/url/number/password inputs, and `dir="ltr"`
   on displayed emails, phone numbers, IBAN/bank digits, host names and
   signed amounts where they stand alone. User-authored text (chat, website
   prose, notification copy, inputs) follows its own direction
   (`dir="auto"` / `unicode-bidi: plaintext`) so Arabic names and templates
   render correctly inside English screens.
3. **Checks.** A unit test that parses every stylesheet under `apps/web` and
   every inline style object in `apps/web` TSX and fails on physical
   left/right properties, asymmetric four-value shorthands, physical
   `text-align`/`float`/`clear` values and unsigned horizontal translations,
   with a justified allowlist that must stay current. Unit tests for the
   language resolution. A local Playwright pass (`scripts/rtl-check.mjs`,
   Chromium at `/opt/pw-browsers/chromium`) against a seeded development
   app: public, trainer, follower and admin screens in `dir=rtl` at 390px
   and 1440px, asserting no horizontal overflow, no clipped controls,
   mirrored navigation and the document direction sources.

## What was built

### Document language and direction

- `apps/web/document-language.ts` (shared, no server/browser-only imports):
  the two supported values `en`/`ar`, `directionOf`, the precedence
  `resolveDocumentLanguage({query, cookie, site})` (explicit `?lang=`, then
  the `trainer_lang` device cookie, then the coach website's language, then
  English), the `/coach/<slug>` path parser and cookie helpers. Every other
  value is ignored at every step, so nothing but `en`/`ar` is ever written
  into the page, a cookie or a header.
- `apps/web/proxy.ts`: page requests (never `/api/`) with a valid `?lang=`
  get the `trainer_lang` cookie (`Path=/`, one year, `SameSite=Lax`, `Secure`
  on HTTPS and coach domains, not HttpOnly because the workspace mirrors the
  member's saved language into it) and a server-set `x-trainer-lang` request
  header; every page request gets `x-trainer-path` (the final path, after a
  coach domain's rewrite to `/coach/<slug>/...`). The existing strip of all
  client `x-trainer-*` headers means neither can be spoofed. No change to API
  forwarding or host signing.
- `apps/web/app/layout.tsx` is now an async server component rendering
  `<html lang dir>` from `documentLanguage()`
  (`apps/web/components/public-website.ts`). On `/coach/<slug>` pages without
  an explicit choice it reads the website's language through the same
  React-cached website request the page already makes (moved from
  `app/[[...path]]/page.tsx`), so a page load still makes one API call; a
  failed lookup falls back to English and the page shows its own error.
- Signed-in members: `MemberLanguage` (`components/document-direction.tsx`,
  mounted once in the workspace shell) reads the member's saved language
  (`GET /api/v1/notifications/preferences`, per workspace membership),
  applies it to `<html>` and mirrors it into the device cookie, so the next
  server render starts in it. Saving the preference in Settings applies it at
  once. The saved preference decides inside the workspace; `?lang=` is for
  public pages.
- Coach website: `siteSchema` gains `language` (`en` default) stored in the
  existing `coach_sites` draft/published JSON, so no migration; older drafts
  and published sites read as English and older editors that omit the field
  save English. The website editor has a "Website language" select. The
  website root (`TrainerTheme`) carries `lang`/`dir` (the visitor's explicit
  choice, else the site's), `PageLanguage` keeps `<html>` in step during
  client-side navigation and restores the device choice on leaving, and the
  trainer's private preview follows the draft's language.

### Logical CSS, mirrored icons and left-to-right data

- Converted every physical declaration in `globals.css`,
  `platform-settings.css`, `trainer-design.css`, `meal-capture.css`,
  `nutrition.css` and `coach-site.css`: margins/paddings/borders to
  `*-inline-start/end`, `left/right` to `inset-inline-*`, `text-align` to
  `start/end`, the fixed sidebar (`inset-block: 0; inset-inline-start: 0;
  border-inline-end`) and content column (`margin-inline-start` at all three
  breakpoints), four-value shorthands (`margin: 0 0 0 34px`,
  `padding: 5px 8px 5px 5px`) to block/inline pairs. The one inline style
  (`right: 16` on the analytics preferences box) is `insetInlineEnd`.
- `--inline-sign` (1 in `[dir=ltr]`, -1 in `[dir=rtl]`, so nested LTR
  islands reset it) drives what has no logical form: the off-canvas mobile
  sidebar `translateX`, its shadow, the settings toggle knob and the
  decorative marketing tilt.
- Mirrored in right to left: lucide `arrow-right/left`, `arrow-up-right/left`,
  `chevron(s)-right/left`, `log-out/in`, `send`, `reply` (one CSS rule on
  lucide's class names) and trailing text arrows (`→`, `↗`) on links, now in
  `<span class="bidi-mirror" aria-hidden="true">`. Arrows inside English
  sentences ("USD → AED", "Paused → Running") follow their sentence and are
  unchanged.
- Left to right in every layout: `code, kbd, samp, pre, time`, email, tel,
  url, number and password inputs, and `.ltr-data` (CSS); `dir="ltr"` on
  displayed emails (account settings, team, invitations, governance, member
  list, website inquiries and contact link), the masked IBAN and IBAN input,
  the website editor's email/WhatsApp/link inputs, and finance balances and
  journal/statement amounts that can be negative. Names beside emails use
  `<bdi>`.
- Text people write follows its own direction: textareas and text/search
  inputs use `unicode-bidi: plaintext`; chat messages, notification titles
  and bodies (reviewed Arabic templates) and website prose use `dir="auto"`
  or `plaintext`. The `.brand-mark` "b." stays Latin (`direction: ltr`).
- Checked in Chromium 141: Arabic text renders joined with the existing
  negative heading letter-spacing (Chromium does not space cursive scripts),
  and a `plaintext` paragraph/textarea/input aligns Arabic to the right
  inside an English page. The production build keeps the logical properties
  as written (no `:dir()`/`:lang()` fallbacks).

### Checks added

- `tests/logical-css.test.ts`: parses every stylesheet under `apps/web`
  (comments blanked, media queries read, exact line numbers) and every inline
  style object in `apps/web` TSX (Babel parser bundled with the pinned
  Next.js: `style={{…}}`, style identifiers and `CSSProperties` objects;
  data objects such as an image crop `left` are not styles). It fails on
  physical left/right properties, physical `text-align`/`float`/`clear`/
  `justify-*`/position values, `to left/right` gradients, asymmetric
  four-value shorthands and corner radii, and horizontal translations or
  flips not multiplied by `var(--inline-sign)`. `ALLOWED` takes justified
  exceptions (reason required; a stale entry fails); it is empty because no
  exception was needed. A self-test covers 25 physical and 19 logical forms.
- `tests/rtl-layout.test.ts`: precedence and validation of the language
  sources, path/cookie helpers, the real proxy (`?lang=` cookie and header,
  invalid values ignored, spoofed client headers replaced, API requests
  untouched, a coach domain's rewritten path), the website language through
  the real routes (default, older drafts, invalid value refused, published
  Arabic site, older published JSON reads English), the coach website markup
  (root `lang`/`dir`, visitor choice wins, Arabic text, `dir="ltr"` email,
  preview follows the draft) and the layout/page wiring.
- `scripts/rtl-check.mjs` with `scripts/run-rtl-check.mjs`
  (`npm run test:rtl`): seeds a throwaway embedded database
  (`.data/rtl-check`, synthetic demo + the existing browser fixture), starts
  the API and `next dev` on ports 4123/3123 (override with
  `RTL_API_PORT`/`RTL_WEB_PORT`; `RTL_WEB_MODE=start` uses a production
  build), refuses to start if something already answers there, stops the
  servers' whole process groups on exit or crash, restores the
  `next-env.d.ts` that `next dev` rewrites, and runs local Chromium
  (`/opt/pw-browsers/chromium` or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`).
  API calls are spaced 600 ms apart to stay inside the normal per-member
  budget. It checks the language sources (default English, `?lang=ar`
  cookie reaches the next server render, `?lang=en`, the published Arabic
  website for a visitor without a choice, the visitor's choice beating the
  website), sets each member's language through the real Settings screen
  and confirms the server render follows it, then visits 8 public pages,
  4 coach website pages, 12 trainer and 4 Super admin pages and 9 follower
  pages at 390px and 1440px. Per screen: `<html lang="ar" dir="rtl">`,
  body direction, no horizontal overflow, no control partly outside the
  viewport unless a scroll container inside it holds it, email fields left
  to right, forward arrows and the breadcrumb chevron mirrored, workspace
  navigation against the right edge with the content column beside it
  (1440px) or off canvas on the right when closed and opening from the right
  edge (390px), and mirrored public and coach website headers. Results go to
  `test-results/rtl-check.json`. `RTL_CHECK_ONLY=sources,public,trainer,
  follower` limits a local run.

## Tests actually run (all on `hard/rtl`, Node 24.19.0)

- `npx tsc --noEmit`: passed (after the last source change).
- `node --import tsx --test tests/rtl-layout.test.ts tests/logical-css.test.ts`:
  10 tests, 10 passed.
- Mutation check of the lint test: appending `padding-right: 2px` and
  `transform: translateX(4px)` to `coach-site.css` made the logical-CSS test
  fail with exactly those two declarations and their line numbers (187, 188);
  the file was restored afterwards.
- Related existing suites plus the new ones on embedded PGlite, one process
  (`node --import tsx --test --test-concurrency=1` with rtl-layout,
  logical-css, coach-site, fix-edge, fix2-edge-deploy, accounts-web,
  governance-web, joining-web, discovery-seo, messaging-inquiries,
  messaging-templates, fix-web, fix2-web, healthkit-ui, infra-ops-web):
  96 tests, 96 passed, 0 failed, 0 skipped.
- PostgreSQL restricted-role parity:
  `/opt/tools/pg-sandbox.sh 56123 <worktree> tests/rtl-layout.test.ts
  tests/coach-site.test.ts tests/logical-css.test.ts`: runtime access
  verified (52 migrations, 52 system tables, 37 scoped tables, 13 helpers);
  7/7, 12/12 and 3/3 passed, `PG_SELECTED_FAILED_FILES=0`. The first
  attempt failed one test on a fixture that wrote `coach_sites` through
  `db.system` (the restricted runtime role may not); the fixture now uses
  the owner's tenant transaction like the website routes, and the rerun
  above passed. No product change was needed.
- `npm run build` (once): passed; all routes dynamic as before (the root
  layout now reads headers and cookies, so `/_not-found` is dynamic too); the
  built CSS keeps the logical properties.
- Right-to-left browser check, local Chromium 141 (`/opt/pw-browsers/chromium`):
  final script, two full runs. `node scripts/run-rtl-check.mjs` (Next
  development mode): "RTL check: 76 screen measurements, 0 failure(s),
  0 page error(s)", exit 0. `RTL_WEB_MODE=start node
  scripts/run-rtl-check.mjs` (the production build above, made before the
  last change to one sentence of Settings helper text): the same, 76/0/0,
  exit 0. In both, all 76 screens were `lang="ar" dir="rtl"` (37 at 390px,
  39 at 1440px), maximum horizontal overflow 0px and 0 clipped controls; the
  language-source, mobile-navigation and settings round-trip assertions
  (which record failures but no measurements) also passed. The final
  development run's server log shows 11 coach website page loads and 11
  `GET /api/v1/public/sites/alex-morgan` requests, so the layout's language
  lookup adds no API call. An earlier
  development run of an earlier script version also passed with 76/0/0.
  Two earlier attempts did not complete: one clicked "Sign in" before
  hydration (fixed in the script), and one production run never reached
  Playwright's "networkidle" on `/login` (aborted link prefetches while API
  routing is active); screens now wait for their own API requests instead.
- Mutation check of the browser check (follower screens only,
  `RTL_CHECK_ONLY=follower`, development mode): with `.main` switched back to
  `margin-left: 236px`, the mobile sidebar to `translateX(-100%)` and the icon
  mirror rule disabled, it reported 48 failures over 18 screens (content
  overlapping the navigation at 1440px, closed navigation on screen and
  16 clipped controls at 390px, breadcrumb chevron and forward arrow not
  mirrored); `globals.css` was restored afterwards. The first mutation
  attempt crashed on an unhandled promise in the script and left its own
  API/web servers running (the next attempt then found the ports taken);
  those processes were stopped, and the runner now refuses busy ports, stops
  whole process groups on exit or crash, and records interaction failures
  per screen instead of crashing.
- Not run: the whole suite on PostgreSQL (the change is not database-wide;
  no migration, grant or query changed apart from the site JSON field), the
  existing `scripts/run-browser-check.mjs` journey, and screenshots (waived).

## Remaining limits

- Copy is not translated; English text inside a right-to-left layout keeps
  its own reading order and is aligned to the right. Standalone English
  dates and times formatted with `toLocaleString()` outside a sentence can
  show their parts reordered in right to left; `time` elements, emails,
  phone numbers, IBANs and finance balances are isolated, other ad-hoc
  numbers are not yet. Translating the copy should switch date/number
  formatting to the `ar` locale at the same time.
- `?lang=` applies on a full page load (links that change language should be
  plain anchors); a client-side navigation to a `?lang=` URL sets the cookie
  but keeps the current direction until the next load.
- The join page (`/join-coach/<slug>`) follows the visitor's choice, not the
  coach website's language (it would need a second website lookup).
- In the workspace the member's saved language wins over a device `?lang=`
  choice, and it is per workspace membership (the preference row's scope).
- Email bodies keep the messaging package's behaviour (the HTML part has no
  `dir`); reviewed Arabic templates are shown with `dir="auto"` in the inbox.
- Verified in Chromium only; Safari/Firefox rendering and real device
  keyboards were not tested.

## Observed, not changed

- The sign-in form has no `method`, so a submit before React hydrates is a
  native GET that puts the email and password in the `/login` URL (seen once
  in this package's first browser run, which clicked too early; the check now
  waits for hydration). A `method="post"` on that form, or disabling it
  until hydration, would keep credentials out of URLs and logs. Left for the
  owning package.

## Upgrade and deployment

- No migration, grant, secret, setting or manual host step. The website
  language lives in the existing site JSON with an English default, so
  existing drafts and published sites render exactly as before; the language
  cookie is optional and only ever `en`/`ar`.
- A running deployment upgrades in place: English stays the default, pages
  were already dynamic, and the proxy's host signing and API forwarding are
  unchanged (`tests/fix-edge.test.ts` and `tests/fix2-edge-deploy.test.ts`
  pass).

## Files

- New: `apps/web/document-language.ts`, `apps/web/components/public-website.ts`,
  `apps/web/components/document-direction.tsx`, `scripts/rtl-check.mjs`,
  `scripts/run-rtl-check.mjs`, `tests/logical-css.test.ts`,
  `tests/rtl-layout.test.ts`, this document.
- Changed: `apps/web/proxy.ts`, `apps/web/app/layout.tsx`,
  `apps/web/app/[[...path]]/page.tsx`, six stylesheets under `apps/web/app`,
  `apps/api/src/coach-site.ts` (site `language`), and the components
  `coach-site`, `trainer-design` (`TrainerTheme` language), `workspace`
  (member language, emails, IBAN, balances), `notifications`, `acquisition`,
  `account-settings`, `joining`, `team-controls`, `workspace-governance`,
  `finance-operations`, `finance-completion`, `meal-capture`, `nutrition`,
  `training-workspace`; `package.json` (`test:rtl`).
