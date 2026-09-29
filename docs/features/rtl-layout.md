# Right-to-left (Arabic-ready) layout

Work package branch: `hard/rtl` (base `3088123`). Migration: none.

## Plan (written before implementation)

(Kept as written. Review round 1 changed two points: the member's saved
language is mirrored into its own cookie, not `trainer_lang`, and the website
language is stored only when it is Arabic. See "Review round 1" below.)

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
  the two supported values `en`/`ar`, `directionOf`, the two cookies, the
  precedence `resolveDocumentLanguage` and `pageLanguage` (below), the
  `/coach/<slug>` and workspace path parsers and cookie helpers. Every other
  value is ignored at every step, so nothing but `en`/`ar` is ever written
  into the page, a cookie or a header.
- Two cookies, kept apart (review round 1):
  - `trainer_lang`, the visitor's explicit device choice. Only an explicit
    `?lang=` sets it (proxy.ts).
  - `trainer_member_lang`, the signed-in member's saved language. The
    workspace mirrors it so the next server render of the workspace starts
    in it. It is a preference, not a choice. It never overrides `?lang=`,
    the device choice or a coach website's own language.
- Precedence (`pageLanguage`):
  - Coach website pages (`/coach/<slug>/...`, including a coach domain's
    rewritten paths): `?lang=`, then `trainer_lang`, then the website's own
    language (English when it has none), then `trainer_member_lang` (only
    when the website cannot be loaded), then English.
  - Workspace pages (`/trainer`, `/app`, `/admin` and below):
    `trainer_member_lang` first (the workspace applies the saved language
    anyway, so the server render matches), then `?lang=`, `trainer_lang`,
    English.
  - Other public pages (marketing, sign-in, directory, join): `?lang=`, then
    `trainer_lang`, then `trainer_member_lang`, then English.
- `apps/web/proxy.ts`: page requests (never `/api/`) with a valid `?lang=`
  get the `trainer_lang` cookie (`Path=/`, one year, `SameSite=Lax`, `Secure`
  on HTTPS and coach domains; not HttpOnly because the page reads it back
  when it leaves a coach website client-side) and a server-set
  `x-trainer-lang` request header. Every page request gets `x-trainer-path`
  (the final path, after a coach domain's rewrite to `/coach/<slug>/...`).
  The existing strip of all client `x-trainer-*` headers means neither can be
  spoofed. No change to API forwarding or host signing.
- `apps/web/app/layout.tsx` is now an async server component rendering
  `<html lang dir>` from `documentLanguage()`
  (`apps/web/components/public-website.ts`, which feeds the request's
  headers and cookies to `pageLanguage`). On `/coach/<slug>` pages without
  an explicit choice it reads the website's language through the same
  React-cached website request the page already makes (moved from
  `app/[[...path]]/page.tsx`), so a page load still makes one API call. A
  failed lookup falls back to the member's language or English, and the page
  shows its own error.
- Signed-in members: `MemberLanguage` (`components/document-direction.tsx`,
  mounted once in the workspace shell) applies the mirrored
  `trainer_member_lang` at once, reads the member's saved language
  (`GET /api/v1/notifications/preferences`, per workspace membership),
  applies it to `<html>` and mirrors it into `trainer_member_lang`
  (`rememberMemberLanguage`). Saving the preference in Settings does the
  same at once. It never writes `trainer_lang`. The saved preference decides
  inside the workspace; `?lang=` is for public pages.
- Coach website: `siteSchema` gains an optional `language` (`en` | `ar`) in
  the existing `coach_sites` draft/published JSON, so there is no migration.
  Only a website switched to Arabic stores the key: the schema drops an
  English value, so English websites keep exactly the keys the previous
  release accepts (see "Upgrade and deployment"). A website without the key
  is English. The website editor has a "Website language" select. The
  website root (`TrainerTheme`) carries `lang`/`dir` (the visitor's explicit
  choice, else the site's). `PageLanguage` keeps `<html>` in step during
  client-side navigation. On leaving it restores the device's language
  (`trainer_lang`, else `trainer_member_lang`, else English). The trainer's
  private preview follows the draft's language.

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
- Left to right in every layout: `code, kbd, samp, pre`, email, tel,
  url, number and password inputs, a web address typed after a fixed prefix
  (`.input-affix`, the `/coach/` + address field on sign-up) and `.ltr-data`
  (CSS); `dir="ltr"` on
  displayed emails (account settings, team, invitations, governance, member
  list, website inquiries and contact link), the masked IBAN and IBAN input,
  the website editor's email/WhatsApp/link inputs, and finance balances and
  journal/statement amounts that can be negative. Names beside emails use
  `<bdi>`.
- Times (review round 1): `time` keeps its own character order with
  `unicode-bidi: plaintext` (a numeric date and time reads left to right, an
  Arabic-formatted one right to left), but its box follows the page.
  Margins and alignment resolve against the layout's direction
  (`text-align: -webkit-match-parent`, then `match-parent` for Firefox). A
  timestamp pushed to the end of a row (`.ps-audit-list time`,
  `margin-inline-start: auto`) therefore stays at the end in right to left.
  The first version forced `direction: ltr` on `time`, which resolved its
  logical margins on the wrong side.
- Keyboard (review round 1): the Design Studio tab row mirrors, so in right
  to left ArrowLeft moves to the next tab and ArrowRight to the previous one
  (ARIA tabs pattern). Home/End are unchanged.
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
  data objects such as an image crop `left` are not styles). Since review
  round 1 it follows every object a style expression can evaluate to: both
  branches of `a ? {…} : {…}`, `open && {…}`, spreads inside a style object
  and named style objects reached through other names. Call arguments are
  data and are not followed. It fails on
  physical left/right properties, physical `text-align`/`float`/`clear`/
  `justify-*`/position values, positions inside the `background`, `mask`
  and `border-image` shorthands (`url(...)` and quoted strings ignored),
  `to left/right` gradients, asymmetric four-value shorthands and corner
  radii, and horizontal translations or flips not multiplied by
  `var(--inline-sign)` (`translate*`, `scale*`, `scale`/`translate`
  properties, and the first coefficient and x offset of `matrix()` /
  `matrix3d()`). `ALLOWED` takes justified exceptions (reason required; a
  stale entry fails). It is empty because no exception was needed. A
  self-test covers 34 physical and 27 logical CSS forms, and inline style
  objects in seven shapes next to a data object and a call argument that
  are not styles.
- `tests/rtl-layout.test.ts`: precedence and validation of the language
  sources (including the member cookie and workspace order), `pageLanguage`
  for coach website, workspace and other pages (a member's default English
  never hides an Arabic website; explicit choices need no website lookup; a
  failed lookup falls back), `rememberMemberLanguage` writing only
  `trainer_member_lang`, path/cookie helpers, the real proxy (`?lang=` cookie and header,
  invalid values ignored, spoofed client headers replaced, API requests
  untouched, a coach domain's rewritten path), the website language through
  the real routes (no key by default or for English, so the stored draft and
  published JSON keep exactly the previous release's keys; invalid value
  refused; Arabic stored, published and previewed; switching back removes
  the key; JSON with `"language":"en"` from the first build still reads),
  the coach website markup
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
  website, and since review round 1 the signed-in coach with a default
  language on the same device: `trainer_member_lang=en`, no `trainer_lang`,
  their own Arabic website rendered `ar`/`rtl` by the server and in the
  browser while `/trainer` stays English), sets each member's language
  through the real Settings screen and confirms the server render follows
  it, then visits 8 public pages, 4 coach website pages, 14 trainer and
  6 Super admin pages and 9 follower pages at 390px and 1440px. Per screen:
  `<html lang="ar" dir="rtl">`, body direction, no horizontal overflow, no
  control partly outside the viewport unless a scrollable (`overflow-x`
  auto/scroll) container inside it holds it (an `overflow` hidden/clip
  ancestor counts as clipping since review round 1), email fields left to
  right, an address prefix left of its input, audit timestamps at the end
  of their row (1440px), forward arrows and the breadcrumb chevron mirrored,
  workspace
  navigation against the right edge with the content column beside it
  (1440px) or off canvas on the right when closed and opening from the right
  edge (390px), and mirrored public and coach website headers. Follower
  screens use the phone-first member shell (docs/features/phone-first.md):
  its side navigation must sit against the right edge at 1440px, a bottom
  tab bar with one `aria-current` tab must show at 390px (no drawer), and a
  sub-page's back chevron must mirror; `/app/more` is checked too. Since the
  Arabic catalogs (docs/features/arabic.md) a follower screen also fails when
  a navigation label, the top bar title or the main heading is not Arabic,
  and the language step finds the settings controls in either language.
  Results go to
  `test-results/rtl-check.json`. `RTL_CHECK_ONLY=sources,public,trainer,
  follower` limits a local run.

## Review round 1 (adversarial review of `e26c10f`)

| # | Finding | Outcome |
| - | ------- | ------- |
| 1 (major) | The workspace wrote the member's language, including the default "en" of a member who never chose one, into `trainer_lang`, which then overrode every Arabic coach website on that device, the coach's own included. | Fixed. `trainer_lang` is written only by `?lang=`. The member's language goes to `trainer_member_lang`, which ranks below the website's language on coach pages, below the device choice on other public pages, and first only on workspace pages (`pageLanguage`). Regression tests in `tests/rtl-layout.test.ts` and in `scripts/rtl-check.mjs` (signed-in coach, same browser context). |
| 2 (major) | Every website saved after the upgrade stored `"language":"en"`, which the previous release's strict schema rejects, so an operator rollback made recently edited websites unavailable. | Fixed for English websites. `language` is optional and English is never stored. The stored draft/published JSON keeps exactly the previous release's keys, verified against the base `3088123` schema. A website switched to Arabic still carries the key; see "Remaining limits". |
| 3 (minor) | `time` was forced `direction: ltr`, so its logical margins resolved on the wrong side (audit timestamps mid-row in right to left). | Fixed. `time` uses `unicode-bidi: plaintext` with `text-align: -webkit-match-parent` / `match-parent`. Chromium probe: the timestamp is at the row end in both directions at 1440px, and indented and aligned on the right at 390px in right to left. Numeric order kept. The audit of the other forced-LTR selectors found no other logical margin, padding or alignment rules on them. |
| 4 (minor) | The Design Studio tab row mirrors, but ArrowRight still meant "next". | Fixed. In right to left, ArrowLeft moves forward. |
| 5 (minor) | The sign-up `/coach/` + address field followed the page direction ("your-name /coach/"). | Fixed. `.input-affix` is left to right in every layout; rtl-check asserts that the prefix is left of the input. |
| 6 (minor) | The inline-style lint missed conditional, logical and spread style objects, `background`/`mask` positions and `matrix()` flips. | Fixed (see "Checks added"). A mutation probe with all four forms in a temporary component made the test fail with exactly those four declarations. |
| 7 (minor) | rtl-check treated `overflow-x: hidden/clip` ancestors as scroll containers. | Fixed. Only auto/scroll count as reachable; a hidden/clip ancestor counts as clipping. The trainer route list gained `/trainer/website/preview` and `/trainer/team`, and the admin list `/admin/infrastructure` and `/admin/support`. |

### Tests actually run for review round 1 (Node 24.19.0)

All after the last source change unless stated.

- `npx tsc --noEmit`: exit 0.
- `node --import tsx --test tests/rtl-layout.test.ts tests/logical-css.test.ts`:
  12 tests, 12 passed, 0 failed.
- Mutation checks of the new unit tests (each restored afterwards):
  - Ranking the member's language above the website's language, and making
    `rememberMemberLanguage` write `trainer_lang`, failed 3 of the 9
    rtl-layout tests: precedence, `pageLanguage` and the mirror.
  - A temporary component with a conditional style object, a spread
    conditional, a `background: … right 8px center` and a
    `matrix(-1,0,0,1,0,0)` failed the logical-CSS test with exactly those
    four declarations.
- Rollback probe: `siteSchema` output for `{}`, `{language:"en"}` and
  `{headline, language:"en"}` was serialised and parsed with the base
  `3088123` `siteSchema` (copied from `git show 3088123:…` into a temporary
  test file, removed afterwards). All three parsed (`success=true`, no
  `language` key). `{language:"ar"}` is still rejected by the old schema, as
  documented.
- Chromium stylesheet probe (real `globals.css` + `platform-settings.css`,
  `/opt/pw-browsers/chromium`):
  - RTL 1440px: the audit timestamp is at the row end, the same 1165px
    from the text as in LTR, with `margin-right` auto (it was mid-row, 12px
    from the text, before the fix).
  - RTL 390px: `margin-right: 34px`, and the text is aligned right.
  - `2026-09-27 10:30` keeps its order. An Arabic-formatted time reads
    right to left.
  - The `/coach/` prefix is left of the input in both directions (right of
    it in RTL before the fix).
  - Standard `match-parent` alone is ignored by Chromium 141, hence the
    prefixed keyword.
- Related suites on embedded PGlite, one process
  (`node --import tsx --test --test-concurrency=1` with rtl-layout,
  logical-css, coach-site, discovery-seo, notifications, fix-edge,
  fix2-edge-deploy, accounts-web, governance-web, joining-web,
  messaging-inquiries, messaging-templates, fix-web, fix2-web, healthkit-ui,
  infra-ops-web): 107 tests, 107 passed, 0 failed, 0 skipped.
- PostgreSQL restricted-role parity: `/opt/tools/pg-sandbox.sh 56123
  <worktree> tests/rtl-layout.test.ts tests/coach-site.test.ts
  tests/logical-css.test.ts tests/notifications.test.ts
  tests/discovery-seo.test.ts tests/fix-edge.test.ts
  tests/fix2-edge-deploy.test.ts`:
  - Runtime access verified: 52 migrations, 52 system tables, 37 scoped
    tables, 13 helpers.
  - Per file: 9/9, 12/12, 3/3, 9/9, 12/12, 7/7 and 6/6 passed.
  - `PG_SELECTED_FAILED_FILES=0`, exit 0.
- Full right-to-left browser check, development mode
  (`node scripts/run-rtl-check.mjs`, local Chromium 141):
  - Result: "RTL check: 85 screen measurements, 0 failure(s), 0 page
    error(s)", exit 0, 44m18s wall time.
  - All 85 screens were `lang="ar" dir="rtl"`: 41 at 390px and 44 at 1440px.
  - Maximum horizontal overflow 0px, and 0 clipped controls under the
    stricter auto/scroll rule.
  - The signed-in coach's own Arabic website was `ar`/`rtl`.
  - The `/signup` address prefix was left of its input at both widths.
  - The seeded data has no integration audit entries, so the audit-timestamp
    assertion did not apply in this run. The stylesheet probe above covers
    it.
  - This run used the previous form of the regression block, which waited
    only for `trainer_member_lang`. That wait was then made non-fatal (below).
- `npm run build`: exit 0 (Next 16.3.6, Turbopack, all routes dynamic). The
  built CSS keeps
  `time{text-align:-webkit-match-parent;text-align:match-parent;unicode-bidi:plaintext}`
  and `.input-affix,.ltr-data{direction:ltr;unicode-bidi:isolate}`.
- Language sources against that production build
  (`RTL_WEB_MODE=start RTL_CHECK_ONLY=sources node scripts/run-rtl-check.mjs`,
  final script):
  - With the code: "3 screen measurements, 0 failure(s), 0 page error(s)",
    exit 0. The three screens were `/?lang=ar`, the signed-in coach's own
    Arabic website and a fresh visitor on the Arabic website, all
    `ar`/`rtl`.
  - Mutation, with the first commit's behaviour restored (the workspace
    writing the member's language into `trainer_lang`): 6 failures, all on
    the signed-in coach's website:
    - member cookie not English;
    - explicit choice written;
    - server rendered English;
    - document `en`/`ltr`;
    - body not right to left;
    - header not mirrored.

    An earlier attempt of that mutation crashed on the then-fatal cookie
    wait. The wait now records a finding instead. The code was restored and
    rebuilt, and the final run above passed.
- Not run in this round: the whole suite on PostgreSQL (no migration, grant
  or query changed; the only API change is the site JSON field's parsing), a
  full production-mode browser run of every screen, and
  `scripts/run-browser-check.mjs` (the reviewer ran it on `e26c10f` and it
  passed).

## Tests actually run for the first commit `e26c10f` (Node 24.19.0)

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

- Subscriber copy is now translated (docs/features/arabic.md): member app,
  coach website chrome, joining, sign-in, legal frame and suspended pages
  use the Arabic catalogs, and their dates, numbers, prices, ranges and
  names are formatted in `ar-AE` (Latin digits) and isolated. The trainer
  workspace and operator screens are still English inside a right-to-left
  layout when a coach chooses Arabic: English text keeps its own reading
  order, and standalone dates formatted with `toLocaleString()` there can
  show their parts reordered. Trainer-written content and server-generated
  sentences stay as written (with `dir="auto"`).
- `?lang=` applies on a full page load (links that change language should be
  plain anchors); a client-side navigation to a `?lang=` URL sets the cookie
  but keeps the current direction until the next load.
- The join page (`/join-coach/<slug>`) follows the visitor's choice, not the
  coach website's language (it would need a second website lookup).
- In the workspace the member's saved language wins over a device `?lang=`
  choice, and it is per workspace membership (the preference row's scope).
  A member who never saved a language gets English in the workspace (the
  preferences API returns its default), even on a device where a visitor
  chose Arabic with `?lang=ar`.
- `trainer_member_lang` is not cleared at sign-out. On a shared device the
  last member's language stays the fallback for public pages without an
  explicit choice (never for a coach website that loads, and never over
  `?lang=` or `trainer_lang`), and for the first render of the next
  member's workspace until their own saved language loads.
- Operator rollback (`rollback_release`) to a release before this package:
  English websites (all existing ones, and any saved after the upgrade that
  stay English) are stored with exactly the previous release's keys and keep
  working. A website switched to Arabic after the upgrade carries
  `"language":"ar"`, which the previous release's strict schema rejects: its
  public pages show "This coaching website is temporarily unavailable" and
  its editor cannot save until `restore_release` (or a forward deploy).
  Removing that risk entirely needs a release whose readers tolerate the key
  before any release writes it, or a column added by a migration; this
  package has no migration and ships reader and writer together.
- `time` alignment uses `text-align: -webkit-match-parent` (Chromium,
  Safari) with `match-parent` for Firefox; only Chromium was checked.
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
  language lives in the existing site JSON and is stored only when it is
  Arabic, so existing drafts and published sites render exactly as before,
  and English websites saved after the upgrade keep exactly the keys the
  previous release accepts (checked by parsing this schema's output with the
  base `3088123` schema; see the rollback limit above for Arabic websites).
  Both language cookies are optional and only ever `en`/`ar`.
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
- Review round 1 changed: `apps/web/document-language.ts`,
  `apps/web/components/public-website.ts`,
  `apps/web/components/document-direction.tsx`,
  `apps/web/components/notifications.tsx`, `apps/web/proxy.ts` and
  `apps/web/app/layout.tsx` (comments), `apps/api/src/coach-site.ts`,
  `apps/web/app/globals.css`, `apps/web/components/trainer-design.tsx`,
  `tests/rtl-layout.test.ts`, `tests/logical-css.test.ts`,
  `scripts/rtl-check.mjs`, this document.
