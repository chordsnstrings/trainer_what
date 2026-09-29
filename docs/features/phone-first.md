# Phone-first subscriber surfaces

Owner direction (29 September 2026, after reviewing screenshots of every
subscriber screen): "UI subscriber screens should really be phone first",
"FIX all UI issues" and "we should do PWA for ease of access at least".
This page is the contract for the member app shell and the shared phone-first
controls built on branch `ui/shell`. Later tracks (PWA, content screens)
build on these pieces instead of adding their own.

The trainer and operator workspace (`.workspace.platform-ui`, the sidebar
and hamburger drawer in `components/workspace.tsx`) is not part of this
rebuild and keeps its behaviour.

## Rules for every subscriber surface

Member app, coach website, joining, sign-in, legal and account pages:

- Design for a 390x844 phone first; 360x740 must also work with no sideways
  page scroll. Laptop is the enhancement.
- New or changed CSS is mobile first: base rules are the phone layout and
  larger screens are added with `min-width` queries (768 px tablet, 1024 px
  laptop). Do not patch a desktop layout with `max-width` overrides.
  `app/phone-first.css` holds the shared rules; `tests/member-shell.test.ts`
  fails if it gains a `max-width` media query.
- Logical properties only (`tests/logical-css.test.ts`), existing tokens
  (`--ink`, `--muted`, `--line`, `--white`, `--paper`, `--brand-*`).
- 16 px side gutters (`--member-gutter`), one primary action per screen in
  thumb reach, safety controls always visible.
- Forms: one column, labels above fields, field text at least 16 px (no iOS
  zoom), the right `type`/`inputmode`/`autocomplete`/`enterkeyhint`,
  controls at least 44 px (48 px for primary) and 8 px apart, no
  hover-only affordances. Dialogs and pickers open as bottom sheets on
  phones. Tables become stacked cards on phones or scroll inside their own
  region with a visible cue.
- Respect `prefers-reduced-motion`; size images to avoid layout shift.
- Copy is plain and specific: no developer words, raw keys, IDs, IANA time
  zone names or seconds in times.

## The member shell (`components/member-shell.tsx`)

The workspace renders every subscriber page inside
`<TrainerTheme className="workspace member-shell">` and `MemberShell`
(trainers keep `PlainShell` with the sidebar). The navigation rules are pure
functions in `components/member-nav.ts`.

| Width | Navigation |
| ----- | ---------- |
| Below 1024 px | Compact top bar + fixed bottom tab bar |
| 1024 px and up | Full-height side navigation + the same top bar (titles, back); no tab bar |

**Bottom tab bar** (`nav.member-tabbar`, "Main navigation"): five
destinations, icon and short label, 64 px tall plus the home indicator
(`env(safe-area-inset-bottom)`), `aria-current="page"` on the current tab:

1. Today (`/app`)
2. The programme, labelled with the coach's `programLabel`
   (`resolveBrandDesign`), `/app/program`; workouts, guided and voice
   sessions and the timeline sit under it
3. Chat (`/app/chat`) with an unread badge
4. Nutrition (`/app/nutrition`, including Log a meal), or Progress when
   nutrition is off for this member. The bootstrap now returns
   `memberApp.nutrition` for subscribers (`hasNutritionAccess`, the same
   membership modules the Today screen uses).
5. More (`/app/more`)

There is no hamburger drawer for members. The tab bar hides while the
on-screen keyboard is open.

**Unread badge**: there is no server read state for messages yet, so the
badge counts coach and qualified digital replies newer than both the last
time this member opened Coach chat on this device
(`localStorage` `member:chat-seen:<tenant>:<user>`) and the member's own
latest message (`unreadCoachMessages`). The count comes from the
bootstrap's recent messages and refreshes on every navigation.

**More** (`/app/more`, `MoreScreen`): a one-tap grouped list with icons
and one plain line each: Training and coaching (Progress or Nutrition,
Timeline, Log a meal, Bookings, Coaching context, Coaching profile, Coach
galleries), Updates and help (Notifications, Connections, Support), Your
account (Membership, Profile and settings, Privacy and your data), Switch
coach (only for someone with more than one coach) and Sign out.

**Compact top bar** (`header.member-topbar`, sticky, pads
`env(safe-area-inset-top)`): on Today the coach's identity; elsewhere the
page title (`memberPageTitle`: a workout shows its own name) and, on every
sub-page, an in-app back button (`a.member-back`, 44 px) to the parent
screen (`memberBackTarget`: timeline and workouts to the programme, guided
and voice sessions to their workout, Log a meal to Nutrition, everything
else to More). The back target is the parent screen, not browser history,
so it works the same in the installed app, after a deep link and after a
reload. The member's avatar links to Profile and settings. There is no
"Workspace > page" breadcrumb.

**Side navigation** (1024 px and up): sticky and full height with its own
background; the coach's identity at the top, the destinations grouped, one
item highlighted (`activeDestination`: Log a meal never also lights
Nutrition), each with its own icon (`MEMBER_ICONS`), the member's own name
and a Profile and settings link at the bottom, and Sign out. No trainer
copy ("Built around you", "Your methods", "Published").

**Refreshing**: a member keeps the frame while a page reloads its data
(a short segment travels along the top bar's bottom edge); the full-screen
loader is only for the first load. Next renders the catch-all page afresh
for every path, so the workspace keeps the member's last bootstrap in this
tab's memory (`memberStateCache` in `workspace.tsx`, members only): the
next page opens at once on it and updates when the bootstrap answers, and a
failed refresh says the last loaded workspace is still shown. It is set only
by `load` in the browser and cleared on sign-out, a 401 and a suspension;
switching coach reloads the page. The trainer workspace is unchanged. The
development notice moved to a quiet line at the end of the page.

**Installed app (standalone)**: `app/[[...path]]/page.tsx` sets
`viewport-fit=cover` for `/app` routes; the top bar, tab bar and sticky
bars pad the safe-area insets; the page never rubber-bands
(`overscroll-behavior-y: contain` on the root while the member shell is
shown); a link to another site opens outside the app
(`useExternalLinksOutsideApp`); every sub-page has the in-app back button.
The PWA track builds on this (manifest, service worker, offline screen,
install prompt).

## Bottom insets for fixed UI

Fixed member UI publishes its size on `<html>`; any other fixed element
(toasts, the analytics consent bar, the install and update prompts) uses
`--member-bottom-inset` to stay clear:

| Property | Meaning |
| -------- | ------- |
| `--member-tabbar-height` | The tab bar plus the home indicator; 0 from 1024 px and while typing |
| `--member-action-bar-height` | A mounted `StickyActionBar`, measured with `ResizeObserver`; else 0 |
| `--member-keyboard-inset` | How far the on-screen keyboard overlaps the page (`visualViewport`) |
| `--member-bottom-inset` | Their sum: use it for `bottom`/`inset-block-end` and bottom padding |

`<html data-keyboard="open">` marks an open keyboard (`useKeyboardInset`,
shared and reference counted). Page content already pads itself by
`--member-bottom-inset`. The analytics consent bar from the root layout
sits on the same value itself (`analytics-consent.css`,
docs/features/analytics-consent.md): flush above the tab bar and any action
bar, hidden while the keyboard is open.

## Shared controls (`components/phone-ui.tsx`)

| Piece | Use it for | Contract |
| ----- | ---------- | -------- |
| `StickyActionBar({ label, note, children })` | The screen's main action (workout log/finish, guided session, intake save; next: meal log save, join and checkout continue) | Fixed above the tab bar, or on the keyboard while typing; publishes `--member-action-bar-height`; a region named by `label`; `note` is one short line (rest timer, next set, why an action waits). Put safety buttons first and the primary last; the primary gets the larger share. Buttons outside a form use `form="<id>"`. |
| `BottomSheet({ open, onClose, title, description, footer })` | Dialogs, pickers and confirmations | Native modal `<dialog>`: the page behind is inert (focus stays inside), Escape and the 44 px close button call `onClose`, a tap on the backdrop closes, focus returns to the opener; `data-autofocus` marks the field to focus. Bottom sheet on phones, centred dialog from 768 px. |
| `FileInput({ label, hint, buttonLabel, accept, multiple, capture, disabled, disabledReason, onFiles })` | Chat attachments, Apple Health import, photos | Replaces "Choose File / No file chosen": a 48 px styled button with the native input laid transparently over it (keyboard, forms and `setInputFiles` keep working), the chosen names below and the reason beside it while disabled. |
| `NumberStepper({ label, name, defaultValue, min, max, step, decimal, unit, inputLabel })` | Reps, weight, reps in reserve, small counts | 44 px minus and plus buttons, a 16 px+ text field with `inputmode="numeric"` or `"decimal"`, wide enough for "102.5" and three-digit reps at 360 px; `name` makes `FormData` read it; "12,5" is read as 12.5. |
| `ResponsiveTable({ label, columns, rows, empty })` | Progress by exercise and any data table | Phones: one card per row with "label: value" lines. From 768 px: a real table scrolling inside its own focusable region with a fade and "Scroll for more" at whichever edge still hides columns, in either reading direction. |
| `ScrollTabs({ label, tabs, selected, onSelect, idPrefix })` + `tabPanelProps` | Section tabs (Nutrition) | One row that scrolls sideways on phones (never wraps), 44 px tabs, `role="tablist"`, arrow keys follow the reading direction, Home and End. |

Member-wide rules in `phone-first.css`: 16 px/48 px fields, 48 px primary
and 44 px secondary buttons, 44 px text buttons and disclosure rows,
readable disabled buttons (muted text, dashed edge, full opacity) with
`.control-reason` text beside them, checkbox labels that wrap beside a
22 px box, headings that never touch the control above, helper text spaced
from the next field, and unclassed buttons styled as secondary buttons
(zero specificity, so a component's own button styles win).

## Screens changed on this branch

- **Workout** (`/app/workouts/:id`): the title, then Guided session and
  Voice-led session as two styled buttons with one line explaining them,
  then the exercises. Each set has Weight (kg), Reps and Reps left (RIR)
  steppers, a 48 px "Log set N" button and "Add a note"; "Reps left (RIR)"
  is explained in each exercise card. A logged set shows the values
  actually saved ("Logged: 16 kg × 10 reps · 2 left"). Logging starts the
  prescribed rest timer; the notice says "logged" when the set reached the
  server and "saved on this device" only when it is still queued. The
  sticky bar keeps **Report pain** and the next action (Log set N, or
  Finish workout once every set is logged); the note shows the rest timer
  and the next set. Report pain opens a bottom sheet whose button is **Stop
  workout and notify coach** (it replaced `window.prompt`). "Finish workout
  now" stays in the page for finishing early; Session tools moved below the
  exercises. The prescription reads "3 × 10 reps" in either direction.
- **Guided session**: styled buttons in a two-column grid, a large rest
  timer, the pain report in a bottom sheet, plain copy for missing trainer
  voice, a sticky bar with Report pain and Next exercise (Log my sets on
  the last one), and "1 of 3" isolated for right to left.
- **Progress**: `ResponsiveTable`, "1 completed session"/"2 completed
  sessions", no "0 planned sessions remaining", one date format
  ("29 Sept 2026"), a session history list with plain statuses and an empty
  message.
- **Coach chat** and **Connections**: `FileInput` for attachments and the
  Apple Health export (with how to export it); disabled Connect buttons are
  readable and say why.
- **Coaching context**: the preferences form is one column with labels
  above fields and no nested border.
- **Coaching profile** (`/app/intake`) opens on the intake questions (not
  account security) with Save in a sticky bar; **Profile and settings**
  (`/app/profile`) keeps account, notifications and privacy and links to
  the coaching profile; its "Privacy and your data" card is `#privacy`.
- **Nutrition**: `ScrollTabs`; meal plan days scroll sideways on phones.
  **Log a meal**: 44 px Remove buttons, the nutrient labels clear of the
  helper text, and a reason beside a disabled Use camera.
- **Bookings**: the time zone reads "Gulf Standard Time", not
  "Asia/Dubai"; Download calendar no longer touches the text above.
- **Sign-in, recovery and email-link pages**: "Return to sign in" sits
  apart from the form's button.

## Motion (microanimations)

Owner direction (29 September 2026): "polish and incorporate
microanimations that allow the user to feel interactive ... not too heavy -
simple microanimations that actually make it feel more interactive."

Rules: small and quick; only `transform` and `opacity` move (colours
cross-fade, the refresh segment moves by background position), so nothing
reflows; presses answer in 90 ms and spring back; arrivals take 240-280 ms
and ease out; leaving takes 180 ms; nothing loops except progress; nothing
delays input or focus. Every animation and transform transition sits inside
`@media (prefers-reduced-motion: no-preference)` and every scripted one goes
through `playMotion`, which does nothing with reduced motion: then the app
is the same, only still (a sheet closes at once). Directional movement
multiplies by `--inline-sign`, so it mirrors right to left. The trainer
workspace and the marketing site are not animated by this.

Tokens (`phone-first.css` `:root`, mirrored by `MOTION` and `EASE` in
`components/motion.ts`): `--motion-press` 90 ms, `--motion-fast` 140 ms,
`--motion-enter` 240 ms, `--motion-slide` 280 ms, `--motion-exit` 180 ms,
`--ease-out`, `--ease-in`, `--ease-spring` (a small overshoot for
confirmations).

| Where | What moves |
| ----- | ---------- |
| Buttons (member app, sign-in and joining pages, coach website, sheets) | Dip to 97 % on press and spring back; steppers' plus and minus dip further. Touch screens never keep the hover lift after a tap. |
| Bottom tab bar | The pill grows in behind the icon of the tab you move to and the icon pops once; a press dips the icon; colours cross-fade. Only when the tab changed (`shellChanges`): moving within a tab replays nothing. |
| Unread badge | Pops in when the count goes up, not on every page. |
| Top bar | The new page's title slides in from the reading direction's end; the back button fades in when it first appears; the refresh segment travels. |
| Page content | Each new page settles in block by block (`playArrival`: fade and an 8 px rise, 28 ms apart, the first five staggered). The frame stays still. |
| More | Rows tint on press, the icon tile dips, the chevron nudges toward where the row leads. |
| Side navigation (1024 px and up) | Hover and current colours cross-fade; the new current item's icon pops. |
| `StickyActionBar` | Slides up from behind the tab bar when it appears. |
| `BottomSheet` | Slides up over a fading dim (a centred dialog rises and scales in from 768 px); slides away faster before it closes (`data-closing`), then returns focus. A grab handle marks it as a sheet (closing stays the button, Escape or the dim, never a swipe). |
| `NumberStepper` | The number ticks the way it changed: up for more, down for less. |
| `FileInput` | The chosen file names fade in. |
| `ScrollTabs` | The underline grows from the tab's centre; the new panel settles in; the row scrolls the tab into view smoothly. |
| Workout | A set you just logged glows once and its check pops; the next set to log scrolls into view (clear of the top and sticky bars); a rest timer fades in. |
| Notices, disclosures, check boxes | Notices drop in; a `details` body unfolds; a box you tick pops (boxes already ticked when a page opens stay still). |

For other tracks: use the tokens in new CSS and put movement inside the
no-preference query; play scripted motion with `playMotion` (never
`element.animate` directly); mark any fixed element you render inside page
content with `data-fixed-ui` (or use `StickyActionBar`), so `playArrival`
never moves it with its parent.

## Public, joining and sign-in pages

Branch `ui/public` applies the same rules to what a subscriber sees before
and around the member app. Styles are in `app/subscriber-public.css`
(sign-in, joining, legal, paused coaching, footer), `app/coach-site.css`
(a coach's website) and `app/coach-directory.css`, all mobile first with
`min-width` queries only (the website editor keeps one older
`max-width` rule of its own). No new motion was added; buttons, the sticky
bar and sheets keep the shared microanimations.

- **Frame** (`components/public-pages.tsx`, moved out of `workspace.tsx`):
  sign-in, recovery, email-link, joining and legal pages render in
  `AuthPage` (`components/auth-page.tsx`): one heading block and one card in
  a 16 px-gutter column, no trainer story beside it. Only trainer sign-up
  (`/signup`) keeps the trainer-marketing story and footer.
- **Header**: on a coach's address, a coach's join page (`/join-coach/<name>`)
  and an invitation (`/join/<link>`) the header is the compact
  `.subscriber-header` with the coach's identity, from the first paint (an
  invitation fills in the coach once it is read). Joining pages drop "Join
  coaching" (the page is the join flow) and the sign-in page drops "Sign in".
- **Footer** (`components/subscriber-footer.tsx`): Find a coach (platform
  address only), Member sign in, Terms, Privacy, Digital coaching and
  Analytics preferences, with the platform's or the coach's name. It
  replaces the trainer-marketing footer on the directory, sign-in, joining
  and legal pages and the coach website's own footer.
- **Sign in**: email (`type=email`, `autocomplete=email`) and password
  (`current-password`), "Forgot your password?" under the password, one
  48 px Sign in button. The authenticator code (`one-time-code`) appears only
  after the API answers `MFA_REQUIRED`. Passkey, "Email me a sign-in link"
  and "Lost your authenticator app? Use a recovery code" sit together as
  matching secondary actions. The bottom offers "Find a coach" (and, when
  registration is open, trainer sign-up as "Are you a coach?"); on a coach's
  address, "Join <coach>".
- **Ended or missing membership** (`MEMBERSHIP_ENDED`, `NO_MEMBERSHIP`, also
  from Apple or Google sign-in): a neutral panel, not a red error, with what
  to do next: rejoin this coach (on a coach's address) or find a coach, and
  how an invitation works.
- **After leaving a coach**: `LeaveTrainer` stores a short note in this
  tab's `sessionStorage` (`account:left-coach`, read once, ignored after
  10 minutes) and opens `/login?left=1`, which says "You left <coach>",
  whether renewal was cancelled, that the account stays open, and offers
  Find a coach (or Back to the website on a coach's address).
- **Joining** (`AccountJoinForm` in `components/joining.tsx`, used by
  `/join-coach/<name>` and a signed-out invitation): headed "Join <coach>"
  with one line on what happens; the choice "I'm new here" / "I already
  have an account" as two full-width cards (title and one short line, never
  wrapping); a new account enters name, email and a new password
  (`new-password`, "At least 12 characters."); an existing account enters
  email and its password (`current-password`) and sees the authenticator
  field only when asked. No "Forgot your password?", no "Welcome back", no
  trainer copy. The terms checkbox names and links only published documents
  (below). On phones "Join <coach>" is in the `StickyActionBar`; from
  768 px it is inside the form. A disabled button stays readable (muted
  text, dashed edge) with the reason beside it. `POST /auth/enroll` now
  takes `name` only for a new account (`NAME_REQUIRED` otherwise), like
  `/invitations/accept`.
- **Invitations**: closed, expired, replaced and already-used invitations are
  one short state each with the way forward; a signed-in invited account
  joins with one button (sticky on phones); the wrong account is told which
  address the invitation is for.
- **Terms that are not published yet**: `GET /api/v1/public/legal-status`
  (`legalStatus` in `apps/api/src/legal.ts`) lists the registration
  documents (terms, privacy policy, digital coaching disclosure) and whether
  each is published, and `joiningOpen`, decided exactly as acceptance is
  recorded: with strict security (production) joining is refused until
  `LEGAL_APPROVED=true` and every document is published; in development an
  unpublished document is recorded as `<key>:development-draft`. Forms
  (`components/legal-acceptance.tsx`) ask people to accept only the
  published documents, say plainly which ones are not published yet, and
  while joining is closed show "Joining opens once the platform publishes
  its approved terms" and disable the action. If the status cannot be read,
  the form asks for all three and the API decides, as before.
- **Legal pages** (`/terms`, `/privacy`, `/ai-disclosure`): a styled 44 px
  "Home" link, the document's plain name (no "Platform document" label),
  16 px text with 16 px gutters, "in effect from 29 Sept 2026" (no times),
  the earlier-versions picker only when there is more than one version. An
  unpublished document says it is still being approved and that nobody is
  asked to accept it; a failed load offers Try again.
- **Coach directory** (`/coaches`): one-column search (16 px fields,
  `inputmode=search`), Clear filters as a button, and an empty state with
  next steps (open a coach's link or invitation, or sign in) and a button.
- **Coach website** (`CoachWebsite` in `components/coach-site.tsx`): a
  compact header (identity, then the pages as one sideways-scrolling row
  with the current page marked); one column; the home page is the hero
  (cover image when there is one), "Meet your coach" with the coach's photo
  or an intentional placeholder in the coach's colours (initials on a tinted
  panel, same box, no layout shift) and a short excerpt that is never the
  home introduction repeated, then "How to start" in three steps. About
  shows the photo or placeholder and the coach's text, or a plain line
  when there is none. Memberships lists plans as cards; with no plans it
  says so and offers "Contact <coach>" as the next step. Galleries without
  photos show a placeholder and one line. Contact has icon rows for email,
  WhatsApp, Instagram and YouTube (opening outside the app), a styled form
  with the right keyboards and autofill, the consent checkbox as a 22 px box
  in a 44 px row, and "Message sent" afterwards. On phones the main action
  (Start coaching or Join <coach> once plans are listed, Contact otherwise;
  Send message on the contact page) is in the `StickyActionBar`, with
  Contact as the secondary; from 768 px it is in the page and the header.
- **Paused coaching** (`components/workspace-suspended.tsx`,
  `suspensionCopy`): a member reads "Coaching with <coach> is paused" and
  that the coach's coaching workspace is paused, never "<name> is
  suspended". Check again and Sign out come first; other coaches are
  full-width buttons; support is a real link (`mailto:` the platform's
  `SUPPORT_EMAIL`, else the About page's company section). Membership and
  payments (`suspended-member-billing.tsx`) matches what the member has:
  renewal and refund text only with a live membership ("You have no paid
  membership with <coach>, so nothing is charged while coaching is paused"
  otherwise), plain refund states, Download my data, and deletion as a quiet
  link that confirms in a bottom sheet.
- **Leaving a coach** (`LeaveTrainer`, member app): "Leave <coach>" opens a
  `BottomSheet` with what happens, an optional note for the coach and
  "Stay with <coach>" / "Leave <coach>", replacing the required checkbox and
  the browser's "Please check this box" tooltip.

## Checks

- `tests/member-shell.test.ts`: tabs, current tab and side item, back
  targets, More groups, titles, the unread count, distinct icons, the
  rendered frame (one current tab, back on sub-pages, no drawer, no trainer
  copy), the controls' markup and helpers, the mobile-first stylesheet and
  the installed-app wiring.
- `npm run test:phone` (`scripts/run-phone-check.mjs` seeds a synthetic
  database and starts the servers; `scripts/phone-check.mjs` can also run
  against running servers with `TEST_APP_URL`): signs in as the synthetic
  member and visits 17 member screens plus a workout and its guided session
  at 360x740 and 390x844 as a touch phone. It fails on sideways overflow, a
  missing tab bar, anything other than one `aria-current` tab, a tab under
  56 px, a tap target under 44x44 px (links inside running text are exempt,
  a checkbox counts its label), or anything fixed covering the tab bar, the
  sticky primary action or the first primary button. Before signing in it
  visits the signed-out pages (directory, the synthetic coach's website
  pages, `/join-coach/alex-morgan`, an invitation from the synthetic owner,
  sign-in, recovery, email link and the three legal pages) at both sizes
  and fails on sideways overflow, a tap target under 44 px, a field under
  16 px, a covered sticky action or the trainer-marketing footer. Results
  go to `test-results/phone-check.json`.
- `tests/public-pages.test.ts`: the legal status and its gate, enrol with a
  name for new accounts only, forms never asking to accept an unpublished
  document, the short join flow, no trainer-marketing footer or story for
  subscribers, the footer links, the directory's empty state, the coach
  website (one action, no repeated intro, empty states), legal pages,
  leaving (bottom sheet, one-time confirmation) and the mobile-first
  stylesheets.
- `tests/member-motion.test.ts`: the motion tokens match between CSS and
  `motion.ts`; durations stay short; outside the no-preference query the
  stylesheet has no animation or transition at all; every animation names
  keyframes that exist and keyframes move only transform and opacity; the
  arrival skips and enters fixed UI; `shellChanges`; nothing plays without
  a browser or with reduced motion; the sheet's close sequence.
- `npm run test:phone` also opens the app with reduced motion and fails if
  a tab tap or opening a sheet starts any animation, or if Escape does not
  close the sheet at once. It waits for finite animations to finish before
  measuring.
- `npm run test:browser` (`scripts/browser-check.mjs`) expects a seeded
  database and, in this container, the local Chromium: seed a throwaway
  one with `PGLITE_DATA_DIR=.data/browser-check NODE_ENV=development node
  --import tsx scripts/seed-demo.ts`, then run the check with the same
  `PGLITE_DATA_DIR`, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium`
  and free `BROWSER_WEB_PORT`/`BROWSER_API_PORT`. `RTL_WEB_MODE=start`
  runs `test:rtl` and `test:phone` on the production build (much faster
  than development mode).
- `scripts/rtl-check.mjs` knows the member shell (side navigation on the
  right, tab bar with a current tab, mirrored back chevron, `/app/more`).
- `scripts/browser-check.mjs` and `browser-completion-check.mjs` use the new
  labels (Log set 1, Finish workout now, nutrition tabs, Photos or PDFs).

## Not done here (other tracks)

- The Today screen's content (contradictory plan states, repeated
  navigation cards and stats, length) is the Today/content track; the tab
  bar now covers the navigation those cards duplicate.
- Dark mode and translated Arabic copy for member screens, coach website
  and joining pages, public legal pages, meal logging and barcode review
  copy, notification and support labels, membership and checkout states,
  and the offline and workspace-unavailable screens are listed for their
  own tracks.
