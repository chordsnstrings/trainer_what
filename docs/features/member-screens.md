# Member app screens, phone first

Owner direction (29 September 2026, after reviewing screenshots of every
subscriber screen): "FIX all UI issues", "UI subscriber screens should really
be phone first". This page covers the member screens track (branch
`ui/member`, built on the phone-first shell of `ui/shell`,
`docs/features/phone-first.md`): what each member screen shows, where its
data comes from, and the plain-wording rules. New copy on this branch is
English; the Arabic track translates it and the motion pass animates it after
the merge into `ui/integrate`. This track adds no animation.

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
  (or **Turn renewal back on**), and plan switches when the coach offers
  them.
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
  previous exercise) and **Next exercise** only in the sticky bar.
- Voice-led preparation shows one plain reason when the coach's voice is not
  available (`voiceReason`), never the list of internal checks; the page is
  titled "Workout guide" and says "Guided session" when it runs in text.

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

## Not done here (other tracks)

- The floating "Analytics preferences" button is the consent track's
  (`ui/consent`).
- Arabic copy, dark mode, the offline screen and microanimations are their
  own tracks; strings added here are English.
- Server error messages passed through from the API are not all reworded
  (bookings replaces "trainer" with "coach"; membership and account errors
  have their own plain wording).
