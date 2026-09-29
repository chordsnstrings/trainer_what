# Installable member app (PWA)

Owner direction (29 September 2026): "we should do PWA for ease of access at
least", with "UI subscriber screens should really be phone first". Built on
branch `ui/pwa` on top of the phone-first shell (`ui/shell`,
[phone-first.md](phone-first.md)); the earlier install pieces are described
in [discovery.md](discovery.md).

Goal: a member adds their coach's app to the home screen in a few taps; it
opens straight into Today, looks and behaves like an app, works on a weak
connection and updates safely.

## What installs where

| Where | Manifest | Id | Opens | Icons |
| ----- | -------- | -- | ----- | ----- |
| Member app, signed in (`/app`) | `GET /api/v1/app/manifest.webmanifest` (per member, `Vary: Cookie`) | `/coach/<slug>` | `/app?source=pwa` (Today) | the coach's: 192 and 512 "any", 512 maskable, 180 for iOS, 96 px shortcut icons |
| Coach website (`/coach/<slug>` or the coach's own domain) | `GET /api/v1/public/sites/<slug>/manifest.webmanifest` | `/coach/<slug>` | `/app?source=pwa` | the coach's: 192, 512, maskable 512, 180 |
| Everything else (marketing, sign-in, the trainer workspace) | `/manifest.webmanifest` (`app/manifest.ts`, `platformManifest`) | `/app` | `/app?source=pwa` | the platform's |

- **One app per coach.** The coach website and the member app of a coach share
  the id `/coach/<slug>`, so installing from either gives the same app, and
  two coaches' apps install side by side. The platform manifest keeps the id
  `/app`, the id browsers derived from its earlier `start_url`, so apps
  installed before this change keep their identity.
- **Launch marker.** `start_url` carries `?source=pwa` and shortcuts
  `?source=shortcut`; the app ignores the query (the service worker caches by
  path).
- **Member manifest fields** (`memberAppManifest` in
  `packages/contracts/src/discovery.ts`): `name`, `short_name` (whole leading
  words up to 12 characters, so it fits under the icon), a description that
  names the coach ("Your training, meals and messages with <coach>."),
  `scope` `/`, `display` `standalone`, the coach's `theme_color` (Design
  Studio primary) and `background_color` (surface), `lang` and `dir` from the
  member's saved language (Arabic is `rtl`; anything else is English),
  `categories` health, fitness, lifestyle, and `launch_handler`
  `navigate-existing` (a second launch reuses the open window).
- **Shortcuts** (long-press the icon), only for what this member can use:
  Today's workout (`/app/program`, where Today's "Start session" goes), Log a
  meal (only with nutrition in their coaching, `hasNutritionAccess`), Coach
  chat, Book a session (only when the coach has had a booking slot in the last
  30 days or has one coming). Each has a 96 px icon: the feature's symbol
  (Lucide dumbbell, utensils, message-circle, calendar-check; ISC licence) on
  the coach's primary colour, inside the maskable safe zone. A member whose
  saved language is Arabic gets Arabic shortcut names and descriptions and
  an Arabic app description (`APP_SHORTCUTS_AR`, `memberAppDescription`;
  the coach's name stays as written, isolated). The coach's team
  (owner, staff, finance) opens `/trainer` and gets no shortcuts: the trainer
  workspace only gains installability.
- **Icons** (`apps/api/src/app-icons.ts`, `renderAppIcon`): exact sizes,
  opaque, the coach's logo on the brand surface (inside the circle of radius
  0.4 for the maskable one), otherwise the initials on the primary colour.
  The coach website's icons now use the same renderer (before: rounded
  transparent corners and no maskable icon). Member icon addresses stay
  capability keys (`/api/v1/app/icons/<key>/<file>`), unchanged.
- **Not added:**
  - *Screenshots for the richer Android install sheet*: they would have to
    show the member app, which is coach-branded and personal; a generic
    screenshot would show another brand or made-up data, and rendering one per
    coach needs a screenshot pipeline. Left out.
  - *`share_target` for meal photos*: a POST share target needs the service
    worker to take the file, hold it until the member is signed in and
    confirms, check type and size, and hand it to the meal log without a
    cross-site request forgery path. It is a follow-up; today the member
    opens Log a meal and picks the photo.

## iOS and Android differences

| | iPhone and iPad (Safari) | Android and desktop Chromium |
| - | - | - |
| How to install | Share, Add to Home Screen, Add (our sheet shows the 3 steps) | Our "Install the app" button opens Chromium's own prompt (`beforeinstallprompt` is kept from the moment the app loads); without it, the browser menu |
| Title under the icon | `apple-mobile-web-app-title` (the coach's short name, set by `MemberAppManifest`) | `short_name` |
| Icon | `apple-touch-icon` (the coach's 180 px) | manifest icons (maskable where the launcher masks) |
| Full screen | `apple-mobile-web-app-capable`, `mobile-web-app-capable`, status bar style `default` (dark text on the light top bar) | `display: standalone` |
| Launch colour | The first paint uses the coach's surface colour (below) | manifest `background_color` (the same surface) |
| Push | Only in the installed app, iOS 16.4 or later; the prompts say so | In the browser or the installed app |
| App badge | Where supported (installed, iOS 16.4+) | `navigator.setAppBadge` where supported |

Other iPhone browsers are told to open the page in Safari; social apps'
built-in browsers (Instagram, Facebook, WhatsApp, TikTok, Snapchat, LinkedIn,
LINE, X), common for links shared in the UAE, get "open this page in Safari
or Chrome" with a **Copy link** button (`inAppBrowser` in
`components/pwa.ts`).

**No white flash on launch.** `MemberAppManifest` remembers the coach's
surface colour (`member-app:launch`, a brand colour, not personal data) and
a tiny script at the top of `<head>` (`LAUNCH_COLOUR_SCRIPT`,
`app/layout.tsx`) paints `/app` pages in it before anything else, matching
the launch screen. It is removed with the personal caches. The remembered
colour is the coach's light surface, so the script skips it when the
member's mirrored appearance (`trainer_member_scheme`,
docs/features/dark-mode.md) is Dark, or System on a dark device: that first
paint keeps the dark palette instead of light text on a light surface. The
offline screen follows the same appearance (`member-neutral` wrapper).

## Install experience (`components/pwa-ui.tsx`)

- **More** and **Profile and settings** have "Install the app" ("Open <coach>
  from your home screen"). Hidden in the installed app (`display-mode:
  standalone` or `navigator.standalone`).
- **Today** shows a one-time inline card, "Add <coach> to your home screen",
  with Install the app and Not now, only when all hold (`showInstallCard`):
  the member has used the app (a second visit in a new browser session, or a
  logged set or completed workout), the analytics question is answered (a
  saved choice under `analytics-preference`, or consent on), the app is not
  installed, and it was not dismissed. Not now, or closing the steps it
  opened, is remembered per member on this device
  (`member-app:install-dismissed:<tenant>:<user>`, ids only). It is part of
  the page (never over content) and never on the workout, guided or voice
  screens.
- **The sheet** (`InstallSheet`, the shared `BottomSheet`): the 3 illustrated
  iPhone steps; open in Safari or your browser with Copy link; the browser
  menu steps; after Chromium's prompt is accepted, "<coach> is on your home
  screen" with the notifications offer.

### Motion (docs/features/motion.md)

- The "New version ready" toast slides up and fades in; "Later" slides it
  away before it is removed.
- The install card on Today rises in the first time it shows in a tab;
  "Not now" sinks it away, then removes it.
- The top bar's "Offline" pill drops in when the connection goes; when it
  returns, the pill turns into "Back online" (English and Arabic) for about
  two seconds and fades out.
- A member's "Saved" confirmations are toasts above the tab bar, the action
  bar and the analytics bar; they slide up and dismiss themselves after
  four seconds and never take taps.
- With reduced motion (the device's or the member's "Reduce motion"
  choice) all of these appear and go at once.

## Service worker (`apps/web/public/sw.js`)

- **Versioned by release.** `next.config.ts` makes one id per build (the
  build id, `APP_RELEASE` plus the build time), baked into the bundle as
  `NEXT_PUBLIC_APP_RELEASE`. Every page registers `/sw.js?v=<release>`
  (`registerServiceWorker`, shared with the push settings), so each release
  installs a new worker.
- **Caches:** `trainer-shell-<release>` holds build assets (`/_next/static/`,
  cache first) and the offline page; `trainer-pages-<release>` holds member
  app pages opened on this device (network first). Install precaches
  `/app/offline`, `/app` and the assets both reference. Activation deletes
  every other `trainer-` cache (including the old `trainer-workout-shell-v1`).
- **Navigation:** `/app` pages: the network, else this page's saved copy,
  else the app home, else the offline page. Other pages of the site: the
  network, else the offline page (never saved). The browser's own error page
  never shows while the worker runs.
- **Never cached:** `/api/`, `/app/notifications`, `/trainer/notifications`,
  other origins and anything but GET. Push stays payloadless with the neutral
  "Coaching update" text and the server-resolved open address (unchanged).
- **Updates:** the first install takes over at once; a new release waits.
  Members see a small "New version ready" toast with **Reload** (and a close
  button), above the tab bar, any action bar and, while it shows, the
  analytics consent bar (`--consent-bar-block-size`). It never shows on the
  workout, guided or voice screens, and Reload refuses to discard typed,
  unsaved input ("Save or clear what you typed first, then reload."). Only
  the tab where Reload was tapped reloads; nothing reloads by itself. The
  trainer workspace and public pages keep the earlier behaviour: a new
  worker takes over at once, without a reload.
- **Personal pages are cleared** (`clearPersonalCaches`: deletes every
  `trainer-pages-*` cache and the old workout cache from the page, and tells
  the worker `CLEAR_PERSONAL`) on sign-out, switching coach (both switchers),
  leaving a coach, an ended session (401) and signing out of a suspended
  workspace. Together with the existing `clearLocalData` (the saved member
  state `trainer:offline` and other `trainer:` keys), a shared phone never
  shows the previous person's app. Unsynced workout and meal entries stay,
  scoped to their member, as before. The build shell and the offline page
  stay: they hold no personal data.

## Offline

- **Offline screen** (`OfflineScreen`): "You're offline", when this phone last
  had the member's data ("Last updated 5 minutes ago."), what still works (a
  workout opened on this phone: sets are saved here and sync later; meals
  too) and Try again. It is separate from the server-error screen ("Your
  workspace is temporarily unavailable."), which now shows only when the
  server answered with an error. The workspace shows it when there is no
  connection and no saved member state; the service worker shows the same
  screen at `/app/offline` (under `/app`, so a coach's own domain passes it
  through). Both are translated (docs/features/arabic.md); the precached
  offline page switches to the member's saved language, else the device's
  `?lang=` choice, from the language cookies once it loads.
- **Offline indicator:** a small "Offline" pill in the member top bar (with a
  screen-reader sentence), instead of the notice block the member app used
  to show. The trainer workspace keeps its notice.
- **Queued entries** read "Saved on this phone — will sync" (Arabic
  "محفوظ على هذا الهاتف، وستتم مزامنته", from the `pwa` catalog; a set's
  label,
  "2 set logs saved on this phone — will sync", "1 meal saved on this phone —
  will sync", the voice session's count) and clear when the queue syncs.
  Workout set logging already used the device queue (`offline-queue.ts`,
  `drainWorkoutQueue`), as did meals and voice-led sets; nothing new was
  needed there.

## Notifications

- Permission is asked only from the member's own tap after a meaningful
  moment, never on load: in the sheet after installing, and in Coach chat
  once the coach (or a coach-reviewed digital reply) has written
  (`PushPrompt`: "Know when <coach> replies", Turn on notifications or Not
  now, remembered per member). The settings card in Profile is unchanged.
- On an iPhone outside the installed app the prompt explains that
  notifications need the app on the home screen (iOS 16.4 or later).
- The installed app's icon badge shows unread coach messages
  (`navigator.setAppBadge`, cleared at 0 and while Coach chat is open) where
  the browser supports it.

## Security of cached pages

- Member pages in the cache are the app's HTML frame (the workspace renders
  in the browser from `/api/v1/bootstrap`, which is never cached). The
  member's data kept for offline use is the existing `trainer:offline` state
  (12 hours, workouts and programmes only), cleared with the pages.
- Personal caches are keyed by release and removed on every way out of a
  session (above). The shell cache and the offline page are the same for
  everyone.
- The member manifest remains cookie-scoped (`private, no-cache`, `Vary:
  Cookie`); its shortcuts and language come from this member only. Icon
  addresses are capability keys that work without cookies and never reveal
  the coach's slug.

## Checks

- `tests/pwa.test.ts` (node): the member manifest (id per coach, launch
  marker, maskable icon, lang and dir, shortcuts per enabled feature with 96
  px icons, none for the team), the coach website and platform manifests,
  in-app browser and install-route detection, the install card and update
  toast rules, wording, cache names, the leave-then-clear order, the launch
  script, and the service worker itself in a sandbox with fake caches and
  network: precache, first install versus update, activation clean-up,
  `CLEAR_PERSONAL`, the offline fallbacks and what is never intercepted.
- `tests/discovery-install.test.ts`: the served member manifest (start URL,
  shortcuts, a booking slot adds Book a session, saved Arabic gives `ar`/
  `rtl`, the team gets none, shortcut icons are 96 px opaque on the primary
  colour) and the coach website manifest and icons.
- `npm run test:pwa` (`scripts/run-pwa-check.mjs` seeds a fresh database and
  starts the production build, so run `npm run build` first;
  `scripts/pwa-check.mjs` runs against `TEST_APP_URL`): local Chromium with a
  fresh (non-incognito) profile; CDP `Page.getInstallabilityErrors` must be
  empty and `Page.getAppManifest` must parse without errors for the coach
  website and the signed-in member app, with the expected fields; the iOS
  meta; this release's worker controls `/app` and precached the offline
  page; offline reload of `/app` and an unvisited member page show the app
  (with the Offline pill) or the offline screen, never the browser's error
  page; `/app/offline` says what still works; registering a newer worker
  shows the toast and Reload switches to it; sign-out removes every page
  cache and the saved member data and keeps the shell. Results:
  `test-results/pwa-check.json`.

## Checks run on this branch (29 September 2026, Node 24, local Chromium)

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: no
  errors.
- 19 related test files, 169 tests, 0 failures: `pwa` 15,
  `discovery-install` 8, `discovery-seo` 12, `discovery-directory` 5,
  `coach-site` 12, `brand` 12, `member-shell` 14, `member-motion` 9,
  `logical-css` 3, `rtl-layout` 9, `push-notifications` 7, `fix-web` 12,
  `fix2-web` 4, `governance-web` 7, `joining-web` 6, `accounts-web` 3,
  `notifications` 9, `nutrition` 15, `healthkit-ui` 7.
- `npm run build`: passed; the build id and the release baked into the
  bundle are the same value.
- `npm run test:pwa` on the production build: 33 checks passed, 0 failed.
- `npm run test:phone` (`RTL_WEB_MODE=start`): 39 screen measurements, 0
  failures, 0 page errors.
- `npm run test:browser` (seeded throwaway database, production build):
  passed on the final build. Three earlier runs on this branch timed out
  waiting for network idle on the marketing home page while the machine's
  load average was about 10; the unchanged `ui/shell` commit failed the same
  way once under the same load and passed once, so this is load-related, not
  a change in behaviour.
- Not run: the whole `npm test` suite, `test:rtl`, the PostgreSQL sandbox and
  a real iPhone or Android device (installing to a real home screen, iOS
  push and the app badge were not tried on hardware).
