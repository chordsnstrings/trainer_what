# Dark mode for subscribers

Owner direction (29 September 2026, after reviewing screenshots of every
subscriber screen): "FIX all UI issues". The screenshot review found that
"every dark variant renders in the light theme": subscribers had no dark
mode at all (only the trainer workspace, `.workspace.platform-ui`, followed
the device). Branch `ui/dark` (from `ui/shell`) adds it.

## Where it applies

| Surface | Appearance |
| ------- | ---------- |
| Member app (`.trainer-theme.member-shell`) | The member's choice: Match this device (default), Light or Dark |
| Coach website (`.trainer-theme.coach-website`) | The choice mirrored on this device, else the device |
| A coach's sign-in, recovery and joining pages (`.trainer-theme.public`) | The same |
| Member app first load, "temporarily unavailable" and suspended screens (`.member-neutral`, `/app` paths only) | The same, with the neutral dark palette (the coach's brand is not known yet) |
| The optional analytics panel while one of the above is dark | Neutral dark |
| Marketing site, directory, the platform's own sign-in and joining pages (`.public.platform-ui`) | Always light (docs/features/brand.md, unchanged) |
| Trainer, team and Super admin workspace (`.workspace.platform-ui`) | Follows the device, as before (unchanged) |
| Design Studio preview inside the trainer workspace | Always light (unchanged) |

## The member's choice

- **Profile and settings > Display preferences** (`DisplayPreferences` in
  `components/appearance.tsx`, card `#display`, members only): a labelled
  radio group "Appearance" with Match this device, Light and Dark, each a
  56 px row with an icon and one plain line. A tap applies at once; the
  choice is then saved, and if saving fails the previous choice returns
  with "Your display preference could not be saved. Check your connection
  and try again." Success says "Display preference saved."
- **Stored per member** with the member's other preferences for this coach:
  `theme` (`system` | `light` | `dark`, default `system`) in
  `notification_preferences.data` (JSON; no migration).
  `PUT /api/v1/preferences/appearance` `{ theme }` merges only that field
  in one statement (under the same advisory lock as the notification
  form), bumps the version and returns the full preferences; the
  notification form takes the newer version and value from the
  `member-preferences-saved` event, so the two cards never conflict.
  `GET/PUT /api/v1/notifications/preferences` carry `theme` too.
- **Mirrored on the device** in the `trainer_member_scheme` cookie (one
  year, `SameSite=Lax`, `Secure` on https; only the three values are ever
  written or read, `color-scheme.ts`). The catch-all page reads it
  (`memberColorScheme` in `components/public-website.ts`) so the server
  render of the coach website, the member app's first loading screen and
  the `color-scheme`/`theme-color` metas already use it: no light flash
  for a member who chose Dark. The member app reads the saved choice on
  every visit (`MemberAppearance`, sharing one preferences request with the
  member language) and updates the mirror, so a choice made on another
  phone arrives too. The cookie stays after sign-out: it is a display
  preference on this device, not an identity.

## Colours

`brandDarkPalette(theme)` (`packages/contracts/src/branding.ts`) derives the
dark palette from the coach's Design Studio colours:

- **Surfaces**: `paper` near black with a trace of the primary (luminance at
  most 0.012), `card` 7 % lighter; `line` is a quiet separator.
- **Text**: `ink` near white (warmed by a light surface), at least 7:1 on
  paper, card and tint; `muted` at least 4.5:1 on the same three.
- **The coach's primary**: made lighter with the same hue and saturation
  (HSL) until it reads 4.5:1 on paper, card and tint. It fills buttons and
  meters and colours links, outline buttons and the current tab
  (`primary` and `link` are the same colour). `onPrimary` is black or white,
  whichever reads better (at least 4.5:1). Nordic `#244c46` becomes
  `#7fc2b8` with black text; Coastal `#253d80` becomes `#9db0e3`.
- **Accent** keeps the coach's accent (avatar, chips) with black or white
  text; **tint** mixes 16 % of the accent into the card (selected rows,
  badges, the member's chat bubbles) with ink text at 4.5:1.
- **Field edges** at least 3:1 on paper and card (WCAG 1.4.11): member
  fields now use `--field-border`, which equals `--line` in light, so the
  light appearance is unchanged.
- **Status**: success `#7fcb9f`, warning `#e0b25c`, error `#f08a80`
  (the platform's dark set), 4.5:1 on the surfaces and on their own tints;
  a filled danger button has dark text.
- **Browser colour** (`themeColor`) is the card colour, which is the top
  bar; **logo plate** is the coach's own surface, the one their logo was
  designed on, shown behind the logo so a dark logo on a transparent
  background stays visible.

`tests/appearance.test.ts` checks all of this for the four presets, eleven
extreme colours (black, white, pure primaries, grey, near white) and a coach
whose own surface is dark.

**How it is applied** (`app/appearance.css`): `TrainerTheme` keeps setting
the light tokens inline (`brandCssVariables`, unchanged) and, when it gets a
`colorScheme`, also sets `--dark-*` (`brandDarkCssVariables`) and
`data-color-scheme`. While the surface is dark, one block of rules points
the ordinary tokens (`--paper`, `--white`, `--ink`, `--muted`, `--line`,
`--green`, `--mint`, `--brand-*`, `--focus`, the status tokens, meal
logging's `--panel`/`--accent`/`--accent-soft`) at the dark values and sets
`color-scheme: dark` (native date pickers, selects, check boxes and
scrollbars follow). The block exists twice with identical declarations: for
`data-color-scheme="dark"`, and inside `@media (prefers-color-scheme: dark)`
for `"system"` (the test keeps them identical). `!important` is needed only
to outrank the inline light values. The document behind a dark surface is
dark too (`:root:has(...)`), so overscroll and short pages never show
white. An explicit Light choice sets `color-scheme: light`.

Everything else already used tokens, so the shell and the shared controls
follow without their own dark rules: the bottom tab bar and its badge, the
top bar and its refresh line, the side navigation, More, `StickyActionBar`,
`BottomSheet` (sheet, grab handle and dim), `FileInput`, `NumberStepper`,
`ResponsiveTable` (its scroll fade uses the card colour), `ScrollTabs`,
badges, notices, disabled buttons (muted text on the card, dashed edge),
meters, the workout log, the guided and voice-led runners and meal logging.
Shadows under the tab bar and action bar use `--shadow-ink` (black in dark,
never a light glow). Focus rings: members keep the white-and-black double
ring, which shows on any surface. Changing the appearance in Display
preferences crossfades the page's colours over 200 ms (a View Transition,
opacity only; instant with reduced motion); the radio itself answers the
tap at once (docs/features/motion.md, "m").

## Browser colour and installed app

- **Coach website and a coach's own address** (`generateViewport`): the
  coach's primary for `prefers-color-scheme: light` and the dark top bar
  colour for `dark` when the choice is System; one colour for an explicit
  Light or Dark. `color-scheme` meta: `light dark`, `light` or `dark`.
- **Member app**: `MemberAppearance` sets the same pair (or one colour) on
  the page's `theme-color` metas in place and restores them on sign-out;
  `MemberAppManifest` no longer sets `theme-color` for subscribers (the
  trainer workspace keeps the trainer's colour in both schemes).
  `/app` pages get the `color-scheme` meta from the mirrored choice.
- **Coach-branded public pages** rendered in the workspace
  (`useSubscriberThemeColor`) follow the same rule.
- **Manifests are unchanged**: `theme_color` is still the coach's primary
  and `background_color` the light surface; the light `theme-color`
  matches them. The Web App Manifest has no standard per-scheme colour, so
  the splash screen stays light; the page sets the dark bar colour as soon
  as it loads.

## For other tracks

- Put a subscriber screen inside the member shell, the coach website or a
  coach-branded `TrainerTheme` and use tokens: it is dark-ready. Never
  hard-code a light colour on a subscriber surface; `scripts/dark-check.mjs`
  flags large light surfaces and any text under AA.
- A subscriber screen rendered outside those (a future install screen)
  wraps itself in `<div className="member-neutral" data-color-scheme={scheme}>`
  with `useColorScheme()` from `components/appearance.tsx` (the neutral
  dark palette, no brand needed). The PWA track's offline screen is wrapped
  this way (`memberScreen` in `components/workspace.tsx`).
- The PWA track's launch colour (`--member-launch`, the coach's light
  surface) is skipped by the launch script when the mirrored choice is
  Dark, or System on a dark device, so that first paint keeps the neutral
  dark palette (`LAUNCH_COLOUR_SCRIPT` in `components/pwa.ts`). Using the
  brand's dark paper there instead would need a second remembered colour.
- A trainer surface never passes `colorScheme` to `TrainerTheme`.

## Checks

- `tests/appearance.test.ts`: the palette's contrast for every preset and
  extreme colour, hue kept, only validated colours emitted; the stylesheet's
  two blocks identical, every inline light colour overridden, every dark
  value defined, no platform, marketing or workspace selector, no motion,
  no `max-width`; the neutral palette's contrast; only subscriber surfaces
  get `colorScheme` (member shell, coach-branded public pages, the public
  coach website; not the Design Studio preview); the cookie, parsing and
  `theme-color` pairs; the Display preferences markup and plain words; the
  API saving per member without touching other preferences, rejecting
  anything but the three values.
- `scripts/dark-check.mjs` (`npm run test:dark`, through
  `scripts/run-dark-check.mjs`, ports 3126/4126; local Chromium only): a
  touch phone at 390x844 and 360x740 with the device in dark mode visits
  all 17 member screens, a workout, its guided and voice-led sessions, the
  pain report sheet, a workout after logging a set and the five coach
  website pages; then the side navigation at 1280x900, the "temporarily
  unavailable" screen, the member's choice (Dark on a light device: at
  once, saved, after a reload and on the first paint; Light on a dark
  device) and the platform's public pages (still white with a Dark choice
  mirrored). It fails on a surface that is not dark, text below AA
  (disabled controls included), a field edge below 3:1, a large light
  surface other than an image, a logo or a button, a wrong browser colour
  or sideways scrolling. Results go to `test-results/dark-check.json`;
  `DARK_CHECK_SHOTS=<dir>` keeps screenshots.
- `scripts/brand-check.mjs`: the member app and the coach website now must
  follow a dark device with every text at AA, and carry the coach's
  primary for light and a dark colour for dark (one `theme-color` per
  scheme) instead of one colour for both.

## Not covered

- A trainer's own address is not visited by the browser checks (it needs
  host mapping), so a coach's sign-in and joining pages there are covered
  by the unit test and the shared stylesheet only.
- On the platform address, `/join-coach/<slug>` and `/join/<token>` are
  coach-branded (`components/public-pages.tsx`) and follow the member's
  choice through `TrainerTheme`. `generateViewport` no longer treats them as
  always-light platform routes: `/join-coach/<slug>` takes that coach's
  browser colours like the coach website, and `/join/<token>` gets the
  choice's `color-scheme` meta, with the browser colour set once the
  invitation's coach loads (`useSubscriberThemeColor`).
- Light-mode field edges on member screens stay as before (`--line`, below
  3:1 on some brands); dark mode meets 3:1.

## Checks run (29 September 2026, branch `ui/dark`)

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass.
- `node --import tsx --test` on 19 files (`appearance`, `notifications`,
  `fix-web`, `discovery-install`, `coach-site`, `support-preview`,
  `messaging-inquiries`, `joining-web`, `accounts-web`, `governance-web`,
  `marketing-site`, `brain-plans`, `push-notifications`, `branding`,
  `logical-css`, `rtl-layout`, `member-motion`, `brand`, `member-shell`):
  185 tests, 0 failures.
- `npm run build`: pass.
- `npm run test:dark` on the production build (`RTL_WEB_MODE=start`):
  61 screens, 2,894 text elements scanned, 0 failures, 0 page errors. The
  first development-mode runs found field edges at 1.32:1 on every member
  form in dark (member fields used `--line`; now `--field-border`) and the
  Display preferences rows laid out by the shell's generic radio rule (now
  scoped); both fixed before the passing run.
- `npm run test:phone` on the production build: 39 measurements, 0
  failures (Display preferences adds no small tap target).
- `npm run test:brand` on the final production build: 112 screens pass,
  including the new dark and browser-colour assertions for the member app
  and the coach website.
- The dark and phone checks ran on a build made just before a
  formatting-only pass (Prettier) over the new files; the final build and
  the brand check ran after it.
- Not run: `test:rtl`, `test:browser`, the full repository suite and the
  PostgreSQL suite.
