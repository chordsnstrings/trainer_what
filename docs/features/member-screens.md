# Member app screens, phone first

Owner direction (29 September 2026, after reviewing screenshots of every
subscriber screen): "FIX all UI issues", "UI subscriber screens should really
be phone first". This page covers the member screens track (branch
`ui/member`, built on the phone-first shell of `ui/shell`,
`docs/features/phone-first.md`): what each member screen shows, where its
data comes from, and the plain-wording rules. The track was built in English
without animation and then merged into `ui/integrate`, where every string on
these screens moved into the message catalogs with Modern Standard Arabic
(docs/features/arabic.md) and the motion catalogue was applied to them
(docs/features/motion.md). See "After the merge into ui/integrate" below.

## One date and time format (`apps/web/lib/format.ts`)

Every subscriber screen formats dates and times through one module, so the
Arabic track can add locale support in one place:

| Helper | Result |
| ------ | ------ |
| `formatDate` | `29 Sep 2026`, `Tue 29 Sep`, `Tuesday 29 September` |
| `formatTime` | `14:05` (24-hour, never seconds) |
| `formatDateTime` | `29 Sep 2026, 14:05` |
| `formatWhen` | `Today, 14:05`, `Yesterday, 09:30`, `20 Sep, 09:00` for lists |
| `formatDateRange` | `29 Sep – 5 Oct 2026`, `1 – 7 Oct 2026` |
| `nextDays` / `recentDays` | day pickers (`Today, Wed 30 Sep`) instead of a date field that shows `09/29/2026` on some phones |
| `zoneName`, `timeZoneChoices` | `Gulf Standard Time`, `Dubai · Gulf Standard Time`, never `Asia/Dubai` |
| `plural`, `humanize`, `labelFor`, `formatCountdown` | `1 serving`, words for stored keys, `1:30` |

A calendar date (`2026-09-29`: a programme or meal day) is a day and is never
shifted by a time zone; an instant is shown in the zone given, else the
device's.

## Today (`member-today.tsx`, `member-today-model.ts`)

About two phone screens on a normal day: the date and a greeting, one
"what to do now" card with one primary action at the top, a compact status,
the coach's note. No navigation cards and no repeated totals (the tab bar
covers navigation).

`todayFocus` (pure, tested for every state) picks the card:

| State | Card and action |
| ----- | --------------- |
| A workout in progress | "In progress", `2 of 9 sets logged`, **Continue workout** |
| No membership, no coaching profile | "Tell your coach about you", **Start your coaching profile** (and "See membership options") |
| No membership, profile done | "Choose your coaching membership", **See membership options** |
| Access, no plan yet | "Your coach is preparing your plan", **Message your coach** (or the coaching profile when not answered) |
| Assigned programme without a calendar (`self_paced`) | the plan's title, sessions in the last 7 days, **Start a workout** |
| Programme not started | "Your programme starts Thu 1 Oct" |
| Today's planned session | its name, `4 exercises · week 1`, **Start today's session** (starts the planned session) |
| Session started / done / cancelled | **Continue workout** / "Done for today" / "No session today" |
| Rest day | **Log a meal** when nutrition is on, else a link to the plan |
| Access ended | "Your membership has ended" or "You completed your programme", **Choose your next plan** |

A new follower never sees programme buttons that lead nowhere. `todayStatus`
shows only numbers that mean something: the block day (`Day 3 of 28`),
sessions in the last 28 days and the streak once a session was due (never
`0/0` or `—`), and calories eaten against the coach's target. A training
hold replaces the card with the pause and **Message your coach**.

### One source of truth for the plan

Today, the programme tab, the timeline, progress and coaching context all
read the assigned programme and its planned sessions:

- `GET /programme/today` returns `planState` (`none`, `awaiting_coach`,
  `ready`, `self_paced`, `ended`), `intakeDone`, today's session with its
  `programId` and started `workoutId`, and `plan` for a self-paced
  programme (`apps/api/src/programme-today.ts`, `docs/features/programme.md`).
- Sessions planned after the current block count as a plan, so an assigned
  plan is never "being prepared".
- `scripts/seed-demo.ts` assigns the demo programme with its calendar
  (`scheduleProgram`), the way a coach assigns one, so the demo shows an
  active plan with sessions.
- Progress counts planned sessions still to come from today onwards, and
  shows no "0 planned sessions remaining".

## Programme tab (`member-program.tsx`)

Title "Your training plan"; the tab is labelled with the coach's
`programLabel` (default now **Programme**, the product's UAE-English
spelling). Up next with one primary action (**Start this session** /
**Continue workout**), the plan with its sessions and exercises in plain
words (`3 × 10 reps · 16 kg · rest 90 s · leave 2 reps in reserve`), and
"Coming up" with **Change** on each planned session. Change opens a bottom
sheet (move to another day, skip, prepare it voice-led); moving offers the
next 14 days as named days without days that already have a session. A
self-paced plan says "Train these sessions on the days that suit you" with
**Start workout**. The timeline groups the block by week with the current
week open.

## Coach chat (`member-chat.tsx`)

Bubbles with the coach's name and "You" (never `trainer`/`subscriber`),
"Digital coach" for qualified digital replies, `Today, 14:05` times. The
composer is a `StickyActionBar`, pinned above the tab bar and on the
keyboard while typing; attachments open in a bottom sheet. The empty state
invites a first message with three tappable prompts.

**Right to left** (screen 29 RTL showed "No messages yet"): the old screen
rendered "No messages yet" until the thread request answered, so a slow
answer looked like an empty conversation. The thread now shows "Loading your
messages…" until it answers and the empty state only after an empty answer.
Checked in Chromium with Arabic saved as the member's language: the coach's
message and the reply show, mirrored.

## Coaching profile (`/app/intake`, `member-intake.tsx`)

Opens on the questions as four short steps (About you, Your goal, Your
training week, Anything your coach should know) with a progress bar, **Back**
and **Next** in the sticky bar and **Save coaching profile** on the last
step. Every step stays mounted, so the form saves all answers at once.
Experience is three described choices; days per week is a stepper. Account
security stays in Profile and settings.

## Profile and settings (`/app/profile`)

Coaching profile link, account details, notifications (time zone as a named
picker), phone notifications ("Devices that get notifications", "Check
again"), sign-in security folded into one section, privacy requests in words
and "Your data".

**Stuck "Loading your account…" (root cause).** The account cards waited
for their first read with no time limit and no failure state, and two of
them hid a failed read behind made-up defaults ("Email: verification
needed", "0 recovery codes available", "Authenticator setup is waiting for
the security service configuration"). A read held up by a busy server or a
flaky connection (in the capture, requests queued behind the per-address
request limit) therefore looked like a page that never loads. Now every
account read goes through `accountRequest` (`components/account-request.ts`),
which ends a read after 15 seconds (`fetchWithin`, a race that works even
when a fetch ignores its abort signal) with a plain message; Account
settings, Account security and Access and recovery each show "Checking…"
while reading and a plain error with **Try again** when a read fails. Signed
in sessions read "This device" / "Another device or browser" with
`Today, 14:05` times.

## Membership (`member-membership.tsx`)

- No plan: the coach's published plans with **Join this plan** (a discount
  code behind "Have a discount code?"), or, when none is published,
  "Memberships are not open yet" with **Message your coach**.
- Active plan: name, `AED 199.00 a month`, status in words, what it
  includes, renewal date, **Stop renewal…** in a confirmation bottom sheet
  (or **Turn renewal back on**). There is no plan switch: once a member
  has paid, the plan cannot change (owner decision, 30 September 2026), so
  the member app has no Change plan entry in English or Arabic.
- The checkout card appears only while a membership checkout is unfinished
  (`GET /payments/checkout/pending`, read only), in plain words.
- Errors (`membershipError`) are plain and give the next step: payments
  unavailable → "we could not stop your renewal. Message your coach or
  contact support and we will do it for you."
- Receipts and refunds: "Receipts appear here after each payment is
  confirmed."

## Workout, guided and voice sessions

- **Report pain** is in the workout's sticky bar and opens a bottom sheet
  (verified in Chromium: the sheet opens with the text field focused).
  **Stop workout and notify coach** works straight away; the note is
  optional (`pain-report.ts` sends "Pain or a problem during the workout. No
  details given." when it is empty or very short), because stopping is a
  safety action. The guided session uses the same sheet.
- Guided session: one plain safety line, secondary controls (rest timer,
  previous exercise) and **Next exercise** only in the sticky bar. Resume and
  Previous appear only when they apply; a placeholder shows while the step
  loads (never a page with only the stop card); **Stop workout and notify
  coach** is a danger outline, not a second primary.
- Voice-led session (`/app/voice-session/<id>`): titled "Voice-led session",
  with "Text guidance" as the eyebrow when it runs in text (and the intro
  then says "Tap Report pain", never "Say"). Prepare/Start are the bottom
  action bar's one primary action; while it runs, **Report pain** and
  **Done** (or **Resume** when paused) sit in the bottom action bar, never
  below the fold. The plan list uses the catalog's set and rep plurals with
  "3 × 10" in a left-to-right isolate.
- Workout: only the set to log now shows its steppers; later sets are one
  line with **Log this set**. "Reps left (RIR)" is explained once. A logged
  set reads "Logged" (or "Saved on this phone — will sync") on one line and
  "16 kg × 10 reps · 2 left" on the next (Arabic "16 كغ × 10 تكرارات"). The
  session tools' rest presets are buttons and share the screen's one rest
  timer with the bottom bar. After a sync that sends everything, "All sets
  synced." shows and then goes. Finishing scrolls to the top at once, with
  no toast: the completion card says it (ring, then check, about 0.5 s).

## Other screens

- **Nutrition**: this week's meals come first and "Plan your next week"
  after them (first when there is no week yet); one plain reason beside an
  unavailable **Prepare my week**; `1 serving`, `About 1,500 kcal a day`,
  `Hob preparation · 20 min` (no repeated equipment), dates as `29 Sep – 5 Oct
  2026`, a named-day picker for the week start and time zone picker. Test
  data is labelled "Test data (development only)" only when the environment
  is development; otherwise a sample week says "Ask your coach before
  following it". No fixture, synthetic, AI-provider or qualification wording.
- **Log a meal**: photo, product and written entry as three clear choices;
  when photo estimates are not available the screen opens on "Write it
  down" and the unavailable choices say "Not available yet"; each method's
  main action (**Estimate this meal**, **Find product**, **Save my meal**)
  is in the sticky bar; "An estimate, then your edit."; a named-day picker
  instead of a date field.
- **Bookings**: "Times are in Gulf Standard Time", statuses in words,
  "If you miss it without cancelling, …", booking and cancelling confirmed
  in a bottom sheet, slot lines isolated for right to left.
- **Connections**: plain wording, disabled Connect only where a provider can
  be connected, statuses in words, `Last synced Today, 14:05`. Apple Health
  sync status no longer sticks on "Loading sync status…": its read has the
  same 15-second limit and a failed read shows "Check again".
- **Coaching context** (`member-context.tsx`): the coaching profile answers
  in words with a link to update them, "How you like to be coached", recorded
  training for the last 28 days with planned sessions still to come, and,
  with no device data, "Connect a device" instead of seven "Unknown" cards.
- **Galleries**: "No photos yet" with what will appear.
- **Notifications** and **Support**: categories and statuses in words,
  `Today, 14:05` times, one style for actions.
- **Not found** (`member-states.tsx`): any `/app/...` address that is not a
  member screen (`isMemberRoute`) shows "This page does not exist" with
  **Go to Today** and **See everything in More**; the top bar reads "Page not
  found" with a back button to Today.
- **Workspace could not be opened**: clearly an error (`role="alert"`) with
  **Try again**, **Sign out** and a plain next step. The offline screen is
  the PWA track's.
- The development notice stays development only (a quiet line at the end of
  the page).

Numbers that start a line (`3 exercises · week 1`, `0 of 12 sessions done`,
`2 of 3`, `1 serving · about 400 kcal`, prescriptions, progress totals) are
wrapped in `<bdi>`, so they stay in place right to left until the Arabic
track translates them.

## Checks

- `tests/member-screens.test.ts`: the format module; `todayFocus` for every
  plan state and `todayStatus`; new followers get no programme buttons;
  unknown addresses, the not-found and error screens; chat senders, the
  pinned composer and loading-before-empty; membership states and errors;
  the intake step flow; the pain report; account reads with a time limit;
  the Apple Health failure state; nutrition, voice, support, notification
  and booking wording; the stylesheet is mobile first, logical and has no
  motion.
- `tests/member-screens-api.test.ts` (embedded database): `awaiting_coach`
  → `self_paced` with the plan's sessions → `intakeDone`; a calendar makes
  the plan `ready` and today's session carries `programId`/`workoutId`;
  sessions after the block still count; the pending-checkout read.
- `npm run test:phone` covers these screens at 360 and 390 px (sideways
  scroll, tap targets, tab bar, sticky action).

### Checks run on this branch (29 September 2026)

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass.
- All test files (`node --import tsx --test tests/*.test.ts`): 1,133 tests,
  1,132 pass, 1 skipped, 0 failures; after the last wording edits the 21
  related files again: 214 of 214 pass.
- `npm run build`: pass.
- `npm run test:phone` on the production build: 39 screen measurements, 0
  failures. `npm run test:rtl` on the production build: 87 screen
  measurements, 0 failures.
- `npm run test:browser` (seeded throwaway database, local Chromium): passed.
  The check now waits for the attachment sheet to close before typing (the
  page behind a sheet is inert while it slides away), matches the time zone
  picker by the start of its label (a select's label also reads its chosen
  option) and uses the new wording. Two earlier runs timed out waiting for
  the marketing home page to go network-idle while the machine was heavily
  loaded; the same step passed in the other runs.

## After the merge into ui/integrate (29 September 2026)

Branch `ui/member` was merged into `ui/integrate` (which already held the
shell, consent, public, PWA, dark, Arabic and motion tracks). All three
intents were kept:

- **Structure and wording** of this track (Today, one plan source of truth,
  the intake steps, account reads with a time limit, chat, membership,
  nutrition, meal log, bookings, voice, connections, not-found and error
  screens, the pain sheet) are unchanged; the English wording is this
  track's, now read from the catalogs.
- **Arabic**: every member-facing string on these screens goes through
  `lib/i18n` (new namespaces `chat` and `plan`; new keys in `today`,
  `profile`, `membership`, `context`, `shell`, `support`, `bookings`,
  `prefs`, `push`, `account`, `health`, `connect`, `capture`, `nutrition`,
  `voice`, `workout`, `training`, `site`, `errors`). The pure helpers take a
  `locale` (English by default, so their tests are unchanged): `todayFocus`,
  `todayStatus`, `whenLabel`, `nextLine`, `prescription`, `sessionDay`,
  `moveChoices`, `senderName`, `chatPrompts`, `membershipError`,
  `membershipStatus`, `supportCategories`, `supportStatus`,
  `notificationCategory`, `bookingStatus`, `paymentStatus`, `missedRule`,
  `voiceReason`, `mealPreparation`, `zoneName`. The exported English maps
  (`MEMBERSHIP_STATUS`, `SUPPORT_STATUS`, `SUPPORT_CATEGORIES`,
  `NOTIFICATION_CATEGORIES`, `BOOKING_STATUS`, `PAYMENT_STATUS`,
  `CHAT_PROMPTS`) are built from the English catalog. There is one
  `lib/format.ts` (this track's formats with the Arabic track's locale
  support; `nextDays` now takes a locale and says "غدًا" in Arabic).
  Server sentences (a booking or plan-change error) are shown to English
  readers only; Arabic readers get the catalog's sentence for the error.
- **Motion**: Today's blocks settle in one after another on the first
  view (`data-stagger` on the screen wrapper, entered by `arrivalTargets`),
  the loading states are skeletons, the programme and calorie tiles carry
  bars that grow to their value (and move from the last value after a
  meal is logged), and the streak counts up once. The coaching profile
  slides each step in from the inline end (Back from the inline start),
  grows the progress segment just reached and draws a check on save. Chat
  (`MemberChat`) shows a faded "Sending" bubble, the digital coach's typing
  dots, slides new messages in and scales the send buttons (`chat-send`).
  The nutrition diary shows the latest day's calories as a ring that grows
  once, beside the diary entries that slide in. Sheets (change a session,
  stop renewal, book or cancel, leave a coach, attachments) use the shared
  bottom sheet's motion. The workout (stepper roll, drawn check on a logged
  set, rest ring, completion moment) is the motion track's, unchanged.
- **PWA and consent** pieces that lived in the replaced screens moved with
  them: the install card is on the rebuilt Today, the install row, display
  preferences (appearance and Reduce motion) and the analytics setting are
  in the rebuilt Profile and settings (the privacy card keeps
  `id="privacy"` for More), and the push prompt stays above the chat.
- Leaving a coach keeps the public track's sheet (no browser checkbox,
  the "You left" note on sign-in) with this track's layout: one line on the
  card, the full consequences inside the sheet.

The catalogs gained 424 English keys with Arabic (21 of them plurals with
all six forms; new namespaces `chat` and `plan`), and 189 existing English
values took this track's plain wording.

Checks on the merged tree (30 September 2026, Node 24, local Chromium,
fresh `.data/mm*` directories, production build unless noted):

- `npx tsc --noEmit` and `npx tsc --noEmit` in `apps/web`: both clean.
- `npm test` (all 160 test files, including `tests/i18n.test.ts` catalog
  completeness, `tests/i18n-hardcoded.test.ts`, `tests/rtl-layout`,
  `tests/logical-css`, `tests/brand`, `tests/member-*`, `tests/motion-css`,
  `tests/pwa`): 1209 tests, 1208 passed, 1 skipped, 0 failed.
- `npm run build`: passed.
- `npm run test:phone` (ports 3735/4735): 67 screen measurements, 0
  failures, 0 page errors; again with `PHONE_CHECK_LANG=ar`: 67, 0, 0.
- `npm run test:pwa` (3737/4737): 33 passed, 0 failed.
- `npm run test:motion` (3739/4739): the first run, made while the unit
  tests and the PWA check were running on the same 4-core machine, failed
  one step ("tab: programme": an 88 ms frame during the tab transition,
  59 ms of it rendering). Two later runs with the machine otherwise idle:
  35 steps, 79 and 80 animations checked, 0 failures, 0 page errors.
- `npm run test:rtl` (3743/4743): 87 screen measurements, 0 failures, 0
  page errors.

## Not done here (other tracks)

- The floating "Analytics preferences" button is the consent track's
  (`ui/consent`).
- Dark mode and the offline screen are their own tracks; Arabic and
  microanimations were applied at the merge (above).
- Server error messages passed through from the API are not all reworded
  (bookings replaces "trainer" with "coach"; membership and account errors
  have their own plain wording).

## Verification round (30 September 2026)

- **Chat**: the message leaves the composer as it is sent (it returns if
  sending fails); the sending bubble is 75 % opaque; Send reads "Send" with
  "Send to <coach>" as its name; the development note never sits between
  the thread and the composer.
- **Meal log** (`meal-capture.css`, phone first): the method list is one
  column of 56 px rows with 13 px+ text, three columns from 640 px; the two
  column layout from 900 px. When product lookup is off, the barcode tab
  shows one unavailable line and **Write what the label says instead**. The
  photo privacy note is plain ("We remove the photo's location and camera
  details first…"). Estimate text keeps its own direction (`dir="auto"`).
  Remove in Unfinished captures is a 44 px button.
- **Nutrition**: the recorded-nutrition table is a `ResponsiveTable` (one
  card per day on phones); day chips and tabs fade at the edge that hides
  more (`useEdgeFade`) and bring the current one into view.
- **Programme**: when the plan cannot load, the plan last saved on this
  phone shows with its time and **Try again** (key `trainer:overview:*`,
  cleared at sign-out); without one, the error has **Try again**.
- **Bookings**: a placeholder while loading; the slot's action is a full
  width button under its details on phones; a slot you booked says
  "You're booked" instead of places left.
- **Notifications**: Refresh is a small icon button; the list, the meal
  log's permissions and Membership receipts turn into "This is taking
  longer than usual" with **Try again** after 15 s (`LoadingOrRetry`).
- **Profile**: quiet hours are 24-hour choices every half hour; the time
  zone picker names the device's zone briefly ("Dubai · this device");
  Phone alerts fold away; **Leave your coach** is last, on its own, in the
  error colour, and its sheet says Stay / Leave with short points.
- **Connections**: Apple Health's unavailable state is one plain line;
  devices that cannot connect yet are one "More devices are coming" line.
- **Top bar**: a page heading that repeats the top bar's title is kept for
  screen readers but not shown again on phones (`is-topbar-title`).
- **Coach-authored words** (`dir="auto"`) line up with the row they sit in
  (`text-align: match-parent`), so English names in Arabic rows do not
  zigzag; timeline dates never wrap inside themselves.
- **Today**: an odd last status tile takes the full row.
- Small print on subscriber surfaces is at least 12 px (`phone-check.mjs`
  fails below that).
