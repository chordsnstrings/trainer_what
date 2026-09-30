# Optional analytics consent

Branch `ui/consent` (base `c856d9d`). No migration and no API change.

The owner reviewed every subscriber screen at phone width and found the
floating "Analytics preferences" button on top of page content on about 25
member screens (Ask digital coach, the pain report text box, Stop workout
and notify coach, checkbox labels, the empty support message). The
instruction: "Ensure the button for analytics closes completely once the
user makes a choice", and the subscriber screens are phone first.

## Behaviour

One component, `AcquisitionConsent` in `apps/web/components/acquisition.tsx`,
mounted once in the root layout, serves the marketing site, coach websites,
sign-in, joining and legal pages, and the member app (and the trainer
workspace, which shares it).

**Before an answer** the visitor sees a slim bar along the bottom
(`ConsentBar`):

- One plain sentence, a real underlined link to the privacy policy
  (`/privacy`), two equal choices, "Allow analytics" and "No thanks" (the
  same outlined style, 48 px tall, side by side on a phone), and a 48 px
  Close button (an icon with the accessible name "Close").
- It never covers content: a spacer after the page (`.consent-bar-space`)
  reserves the bar's height, so the end of every page scrolls clear of it.
  In the member app it sits above the bottom chrome: its bottom edge is
  `var(--member-bottom-inset, 0px)` (the tab bar, any sticky action bar
  and the open keyboard, as published by the phone-first member shell), so
  it stacks above them and never hides a primary or safety action. With
  nothing below it, it adds `env(safe-area-inset-bottom)` itself. While
  it shows, `--consent-bar-block-size` on `<html>` carries its height.
- While the on-screen keyboard is open (`data-keyboard="open"` on
  `<html>`) the bar steps aside and returns afterwards.
- On marketing pages it waits for the first scroll, so it never covers the
  hero's call to action or the relay on the first screen (unchanged). The
  marketing sentence is unchanged; other surfaces say "Optional analytics
  count which links bring people here. They never include your health or
  coaching information."

**Any answer ends it for good on that site.** Allow, No thanks and Close
each save an answer in the browser (`localStorage["analytics-preference"]`
= `allowed`, `declined` or `dismissed`; a preference, never an
identifier). After it:

- the bar and every analytics control are gone on every page and after a
  reload; nothing about analytics is fixed or sticky on the screen (the old
  floating "Analytics preferences" button no longer exists anywhere);
- Close leaves analytics off, exactly like No thanks, without a server call;
- a server consent that later lapses does not bring the prompt back:
  analytics simply stay off until the visitor turns them on again;
- if the browser refuses storage, the answer still holds for the visit.

**Changing the answer later** is possible only from:

- a plain footer link "Analytics preferences" on public pages: the
  marketing footer (unchanged) and the shared subscriber footer
  (`components/subscriber-footer.tsx`) on the coach directory, the coach
  website (not in the trainer's private preview) and sign-in, joining and
  legal pages. It opens the
  preferences sheet (`ConsentSheet`): a native modal `<dialog>` that is a
  bottom sheet on phones (full width, rounded top corners, safe-area
  padding, contained overscroll) and a centred 480 px dialog from 760 px.
  It shows whether analytics are on or off, the first and last tagged
  source when on, "Allow optional analytics" and "Continue without
  analytics" in one equal style (or "Withdraw analytics consent"), and a
  48 px Close. Escape, Close and a tap on the backdrop close it; closing it
  before any answer counts as Close. Its opening motion respects
  `prefers-reduced-motion` and the member's "Reduce motion" choice
  (`app/motion.css`, docs/features/motion.md).
- Motion of the bar (subscriber pages only; the marketing site's bar is
  unchanged): it slides up when it first shows; after any answer it slides
  away (200 ms, taking no taps and hidden from assistive technology while it
  goes) and is then removed from the page, so nothing about analytics stays
  behind. With reduced motion it goes at once. The consent check and the
  motion check (`npm run test:motion`) both assert the bar is gone from the
  page after an answer.
- Profile > Privacy in the member app (`/app/profile#privacy`, the card
  "Privacy and your data"): "Optional site analytics" shows "On for this
  browser." or "Off for this browser." and one button, "Turn on analytics"
  or "Turn off analytics" (`AnalyticsSetting`). The trainer workspace's
  settings card "Your data" carries the same switch; the member app's More
  list links "Privacy and your data" to this card. The member app's own
  footers have no analytics control.

A choice in one control reaches the others at once (the
`analytics-preference-change` event) and other tabs through storage. The
server contract is unchanged: no analytics identifier before opt-in, an
HttpOnly cookie after it, and withdrawal deletes the linked history.

## Styles

`apps/web/app/analytics-consent.css`, imported by the root layout, mobile
first (base rules are the phone layout; 760 px and 1150 px add the one-row
desktop bar and the centred dialog), logical properties only, the platform
tokens (`--white`, `--ink`, `--line`, `--mint`, `--error`), so the controls
follow the trainer workspace into dark mode and stay light on public pages.
The old marketing-only bar rules left `marketing.css`.

Measured on the production build (`scripts/consent-check.mjs`): the bar is
142 px tall at 390×844 (coach website and member app), 162 px at 360×740
and 65 px at 1440 (one row).

## Checks

- `tests/analytics-consent.test.ts`: every answer (allow, decline, close)
  is saved and ends the prompt, blocked storage keeps it for the visit, the
  bar's visibility rules, the bar and sheet markup (equal choices, 48 px
  Close, real privacy link, no floating button or "Details"), Profile >
  Privacy, the footer entry points, and the mobile-first CSS.
- `tests/brand.test.ts`: the new stylesheet is a platform stylesheet (no
  ink bands, no lime text).
- `scripts/browser-completion-check.mjs`:
  - `checkAcquisitionConsent` (1440, marketing): no prompt before a scroll,
    then the bar (48 px equal choices, Close, privacy link, the end of the
    page clear of it); No thanks sets no identifier and nothing floats,
    after a reload too; the footer link opens the sheet for opt-in, the
    readback and withdrawal, and the sheet closes with each answer.
  - `checkConsentOnPhone` (390×844 and 360×740): on a coach website the bar
    shows at once, sits on the bottom edge, fits without horizontal scroll,
    leaves the hero's call to action and the end of the page uncovered;
    Close ends it on every page and after a reload; the footer link opens a
    bottom sheet. In the member app the bar sits on
    `--member-bottom-inset`, No thanks ends it on /app, /app/program,
    /app/chat and /app/profile, and Profile > Privacy turns analytics on
    and off. "Sits on" is measured against what is on screen: the top of a
    visible fixed tab bar or sticky action bar (the coach website's Join
    bar included), else the screen edge; the end of the page is where its
    last footer or main's content ends, without the bottom padding they
    reserve for those bars.
  Both run in `npm run test:browser` and on their own with
  `node scripts/run-consent-check.mjs` (`RTL_WEB_MODE=start` uses the
  production build).
- `scripts/brand-check.mjs`: the bar after a scroll is at most 72 px at
  1440 (48 px choices) and 180 px at 390 with 48 px controls, the end of
  the home page is clear of it, and after No thanks (1440) or Close (390)
  no analytics control floats, after a reload too.

Run on 29 September 2026 in the `ui/consent` worktree (local Chromium,
synthetic PGlite data, production build): `npx tsc --noEmit` and
`npx tsc --noEmit -p apps/web/tsconfig.json` clean; `npm run build` passed;
`tests/analytics-consent.test.ts` 9/9 and, with `brand`, `logical-css`,
`rtl-layout`, `acquisition`, `accounts-web`, `coach-site`,
`marketing-site`, `fix2-web`, `governance-web`, `bounded-bootstrap` and
`joining-web`, 117/117; `node scripts/run-consent-check.mjs` passed;
the brand check (`scripts/run-brand-check.mjs`, `RTL_WEB_MODE=start`)
passed on 112 screens; the full browser check
(`scripts/run-browser-check.mjs` on a freshly seeded demo database)
passed on 69 routes with no page errors.

## Verification round (30 September 2026)

- The privacy policy link in the member app (bar, sheet, Profile > Privacy)
  is `/privacy?from=app`, so the page leads back into the app.
- After an answer the bar fades where it is and is then removed.
- Behaviour is tested with React DOM in local Chromium
  (`tests/react-dom-behaviour.test.ts`): after "No thanks" or Close the bar
  and its spacer leave the page, the answer is stored, no consent is sent
  to the server, and the bar stays gone after a reload.
