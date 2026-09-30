# Arabic for subscribers (translation layer)

Branch `ui/integrate` (Track A). Everything a subscriber reads in the member
app, on a coach's website chrome, and on the joining, sign-in, legal and
suspended pages is available in Modern Standard Arabic, right to left, with
numbers, dates, prices and names kept in reading order. The trainer
workspace, the operator screens and the marketing site are unchanged and
stay English.

## How it works

- **One language setting.** Nothing new decides the language: the root
  layout resolves it as before (`apps/web/document-language.ts`: `?lang=`
  and the `trainer_lang` cookie, the coach website's language, the member's
  saved language mirrored in `trainer_member_lang`) and renders
  `<html lang dir>`. The layout also passes that language to
  `LocaleProvider`, and after hydration `<html lang>` is the source of
  truth: `useLocale()` (`lib/i18n/react.tsx`) watches it, so when
  `MemberLanguage` applies a member's saved choice or `PageLanguage` a coach
  website's, every translated component re-renders in that language. Server
  components (the coach directory) take the language as a prop from
  `documentLanguage()`; the coach website uses its own page language (the
  trainer's preview follows the draft's language); the precached offline
  page (`/app/offline`) reads the member and device cookies.
- **Catalogs.** `apps/web/lib/i18n/messages/<area>.ts` holds one area's
  English and Arabic side by side with `defineMessages(en, ar)`;
  `lib/i18n/catalog.ts` lists the namespaces (nav, common, shell, pwa, push,
  errors, auth, join, public, consent, site, offers, workout, today,
  profile, account, prefs, training, connect, health, support, bookings,
  context, membership, voice, nutrition, capture, and since the member
  screens merge chat and plan). The type of the Arabic
  object is derived from the English one, so a missing Arabic key, or an
  Arabic plural without all six forms, fails the typecheck.
- **Typed keys and values.** `useT("nutrition")` (client) or
  `translator(namespace, locale)` (server, plain functions) returns `t`.
  `t(key, params)` only accepts keys of that namespace, and requires exactly
  the `{placeholders}` the English message names (a plural also requires a
  numeric `count`). `PlainKey<E>` is the type of a key without values, for
  messages kept in state and shown later. `t.dynamic(key, fallback)` looks
  up a key built from server data (a status, a category) and falls back to
  the given text when the catalog has none.
- **Plurals.** A plural message is `{ one, other }` in English and
  `{ zero, one, two, few, many, other }` in Arabic, chosen with
  `Intl.PluralRules` (Arabic: 0 zero, 1 one, 2 two, 3–10 few, 11–99 many,
  100+ other). `#` is the formatted count. Arabic forms agree with the
  number ("تكرار واحد", "تكراران", "3 تكرارات", "11 تكرارًا", "100 تكرار").
- **Markup.** `<Rich t={t} k="key" tags={{ b: (s) => <b>{s}</b> }} />`
  renders `<b>…</b>` or any named tag in a message as a component (links,
  buttons, emphasis), so word order stays the translator's.
- **Errors.** `useErrorText()` / `errorText(error, locale)`
  (`lib/i18n/errors.ts`): English keeps the server's own sentence. Arabic
  uses the reviewed sentence for the error `code` (the `errors` namespace),
  else a plain sentence for the HTTP status, and never shows an English
  server message. Errors raised on the device (passkeys unsupported, no
  passkey chosen, analytics not saved, an unreadable attachment) carry codes
  too; problems found by a screen itself (photo too large, no camera) are
  already written in the member's language.

## Right-to-left correctness

- **Every interpolated value is isolated in Arabic** (`interpolate` in
  `lib/i18n/core.ts`): text values with FSI…PDI (their own first letter
  decides their direction, so "Alex Morgan" or an English exercise name stay
  whole), numbers with LRI…PDI. English output has no isolation marks, so
  English screens are byte-for-byte what they were where the wording did not
  change.
- **Ranges and expressions are isolated as a whole**: `formatRange(8, 12)`
  and `formatSetsReps(3, "8–12")` wrap "8–12" and "3 × 8–12" in one
  left-to-right isolate; isolating each number separately would still let
  the sentence reverse the range. Countdowns ("1:30"), clock times,
  "3/5" check-in scores, "1200 / 2000" calories and the voice audio progress
  ("3/10") are passed as one value for the same reason.
- **Names and coach content** inside chrome use `<bdi>` or `dir="auto"`
  (coach names in footers and switchers, meal and food names, invoice
  numbers); contact details, emails and barcode inputs stay `dir="ltr"`.
- **Layout mirroring** is the existing logical-property work
  (docs/features/rtl-layout.md): the tab bar, side navigation, bottom sheets,
  sticky action bars and tables follow the document direction; the markup
  order never changes (checked in `tests/rtl-layout.test.ts`).

## Formatting (`apps/web/lib/format.ts`)

Every function takes an optional `locale` (English by default, so existing
callers are unchanged):

| | English | Arabic (`ar-AE`, Latin digits) |
| --- | --- | --- |
| `formatDate` | 29 Sep 2026 | 29 سبتمبر 2026 |
| `formatDate(…, { weekday: true })` | Tue 29 Sep 2026 | الثلاثاء، 29 سبتمبر 2026 |
| `formatTime` | 14:05 | 14:05 |
| `formatDateRange` | 5 – 11 Oct 2026 | 5–11 أكتوبر 2026 |
| `formatNumber` | 1,250 | 1,250 |
| `formatMoney` (fils) | AED 1,250.00 | 1,250.00 د.إ. |
| `formatDuration` (minutes) | 1 h 30 min | ساعة و30 دقيقة |
| `formatRelative` | 5 minutes ago | قبل 5 دقائق |
| `formatRange`, `formatSetsReps` | 8–12, 3 × 10 | the same, isolated left to right |
| `zoneName` | Gulf Standard Time | توقيت الخليج (never `Asia/Dubai`) |

Arabic results are isolated so they keep their order inside a sentence.
Latin digits (`ar-AE-u-nu-latn`) match the digits coaches write in plans,
and prices use the UAE dirham. Calendar dates ("2026-09-29") are never
shifted by a time zone. Member screens no longer show ISO dates or raw zone
ids (the coaching context, nutrition weeks, check-ins, diary, invoices).

## Wording

- Modern Standard Arabic, short and plain. Tab labels are one or two words
  (اليوم، برنامجي، المحادثة، التغذية، المزيد).
- Gender-neutral where the chrome addresses the member: a verbal noun for
  actions and headings ("حفظ التفضيلات", "اختيار صورة الوجبة"), "يُرجى …"
  or "يمكنك …" for instructions. Safety instructions to stop exercising stay
  direct ("توقّف عن التمرين…"). `tests/i18n.test.ts` rejects the common
  masculine commands in the chrome.
- Units: "كغ", "غ", "مل", "سعرة" (calories, used as a unit after the
  number), "تكرار" with plural agreement.
- Brand and format names stay as written: Apple Health, Open Food Facts,
  JPEG/PNG/WebP, EAN/UPC/GTIN, HTTPS.

## Coverage

Translated (English and Arabic in the catalogs):

- Member app frame: bottom tab bar, side navigation, top bar titles, back,
  More, sign-out, loading and unavailable states, offline pill and screen,
  update toast, install card, sheet and row, push prompts and settings,
  shared controls (sheets, file inputs, steppers, tables, tabs).
- Member screens in the manifest: Today (programme, nutrition tile, end of
  programme, welcome sections, timeline), My program (plan, calendar,
  session tools, member plan, intake notice), workout logging and guided
  session, voice-led session (preparing, runner controls, status line,
  spoken replies and consent), coach chat and attachments, nutrition (meal
  plan, week view, swaps, groceries and purchase quantities, food
  preferences, diary, saved meals, trends, targets, check-ins), log a meal
  (photo, barcode, manual, review, drafts), bookings, progress, coaching
  context (including the imported health measurements' names, states and
  units), connections and Apple Health, coach galleries (client view),
  notifications (settings and inbox), support, membership (plan, upfront
  programme, premium voice, complimentary access, checkout status,
  invoices and refunds), profile and settings (account, security, passkeys,
  sessions, appearance, privacy requests, leaving a coach), training hold.
- Manifest for Arabic members: name stays the coach's, the description and
  the four shortcuts are Arabic (`APP_SHORTCUTS_AR`,
  `memberAppDescription` in `packages/contracts/src/discovery.ts`).
- Coach website chrome (navigation, buttons, empty states, memberships,
  contact, footer) in the website's language; the coach directory; joining
  (account choice, forms, invitations, coach switcher), sign-in, email link,
  recovery, passkey sign-in, the legal page frame and acceptance, workspace
  suspended and billing while suspended, membership ended and left-coach
  notices, the analytics consent bar and sheet on subscriber pages.

Not translated, and why:

- Member screens rebuilt on `ui/member` and merged here
  (docs/features/member-screens.md): Today (what to do now, status tiles,
  the coach's note, safety pause), the programme tab (up next, the plan's
  sessions and prescriptions such as "3 × 10 تكرارات · 16 كغ · راحة 90 ث",
  coming up, the change/move/skip sheets with named days), the timeline by
  week, coach chat (senders, prompts, composer, attachments sheet), the
  coaching profile steps, membership (plan, renewal, stop-renewal sheet,
  plans, discount code, unfinished checkout, errors with "what we could
  not do"), coaching context, the not-found and workspace error screens,
  profile and settings, support, notifications, bookings (book and cancel
  sheets, missed-session rule), receipts and refunds, connections and
  Apple Health status, the guided session, voice reasons, nutrition (week,
  preparation line, recipe source, next-week card and reasons, test and
  sample weeks, calorie ring) and log a meal (sticky actions, named days).

- **Trainer-written content**: plans, exercise and meal names, recipes,
  coach notes and messages, website text, offers' names and descriptions.
  They are shown as written, isolated, with `dir="auto"` where they stand
  alone.
- **Platform legal documents' bodies** (terms, privacy policy, digital
  coaching disclosure): published by the platform in English; the page
  frame, dates and the acceptance controls are translated. An Arabic legal
  text has to be published by the platform, not machine-translated here.
- **Server-generated sentences**: the coaching-context coverage lines, the
  nutrition tracker's coverage note, exception notices and a provider's
  connection summary are composed by the API in English and shown as they
  are (`dir="auto"`). A capture's failure explanation from the server is
  shown to English members only; Arabic members get the status sentence.
  Translating these needs the API to return codes and values.
- **The voice runner's spoken lines** ("Set 1 of 3. 10 reps…") come from the
  domain runner and the trainer's script and are synthesised in the
  trainer's voice; the status line and every control around them are
  translated. Arabic spoken cues follow the voice track's script language
  work.
- **Trainer workspace, operator screens and the marketing site.** The
  platform's own sign-in, recovery, email-link and legal pages and the coach
  directory use the marketing header and menu, which stay English (marketing
  text must not change); the page bodies below them are Arabic.
- **Email and push bodies** are the messaging package's reviewed templates
  (Arabic where published, docs/features/messaging.md); only the in-app
  push prompts and settings are catalog text.

## Checks

- `tests/i18n.test.ts`: every English key has Arabic of the same shape;
  plurals have all six Arabic forms; placeholders and markup tags match;
  Arabic text contains Arabic; no masculine commands in the chrome; plural
  categories and forms; isolation of values; fallbacks; error mapping;
  numbers, money, ranges, set × rep expressions, dates, times, durations
  and relative times; queued-entry and sync lines; the Arabic manifest
  description and shortcuts; member screens rendered in Arabic (member
  shell, More, offline, meal plan week, food preferences, nutrition,
  log a meal, upfront programme, invoices, voice session) with no English
  word left and no ISO date; the same week view unchanged in English.
- `tests/i18n-hardcoded.test.ts`: parses the converted member components
  (whole files, or the member functions of files that also hold trainer
  screens) and fails on JSX text, labelled attributes or prose string
  literals that do not come from a catalog. Data strings that are stored,
  not shown, are listed by file.
- `tests/rtl-layout.test.ts`: the Arabic member shell has translated tabs in
  the same markup order as English (mirroring comes from direction only).
- `npm run test:rtl` (`scripts/rtl-check.mjs`) now also fails a member
  screen whose navigation labels, top bar title or main heading are not
  Arabic, and its language step works whichever language the settings
  screen is in.
- `PHONE_CHECK_LANG=ar npm run test:phone` runs the phone check in Arabic:
  the signed-out pages with the `?lang=` cookie and the member app with the
  member's saved language, failing any screen not rendered `ar`/`rtl`, plus
  all the phone rules (overflow, 44 px targets, tab bar, covered actions)
  with the longer Arabic labels. Results go to
  `test-results/phone-check-ar.json`.

## Checks run for this change (29 September 2026, Node 24.19.0, local Chromium)

- `npx tsc --noEmit` and `npx tsc --noEmit -p apps/web/tsconfig.json`: pass.
- `node --import tsx --test --test-concurrency=1 tests/*.test.ts` (the whole
  suite, 1171 tests): 1166 passed, 4 failed. One was
  `tests/analytics-consent.test.ts` reading the old English literal in
  `workspace.tsx`; the assertion now reads the catalog key and the file
  passes (9/9). Three were in `tests/web-address-orders.test.ts`
  (`PRICE_CHANGED` 409 on a registrar purchase), which touches no file this
  change edits; the file passes on its own (31/31).
- After the last edits: `tests/i18n.test.ts`, `tests/i18n-hardcoded.test.ts`,
  `tests/rtl-layout.test.ts`, `analytics-consent`, `client-twin-adherence`,
  `client-context`, `member-shell`, `pwa`, `public-pages`, `joining-web`,
  `governance-web`, `logical-css`, `healthkit-ui`, `discovery-install`,
  `programme-today`, `meal-capture`, `nutrition-completion`,
  `voice-session`, `finance-completion`, `web-address-orders`: 193/193 pass.
- `npm run build`: pass.
- `npm run test:rtl` on the production build (`RTL_WEB_MODE=start`, ports
  3741/4741, fresh `.data/rtl-check-arabic`): 87 screen measurements,
  0 failures, 0 page errors; every follower screen's navigation, top bar
  title and heading were Arabic. The first run stopped because the language
  step looked for an exact label (the select's accessible name also holds
  the chosen option); the matcher was fixed and the check rerun. It ran
  before the last change (health measurement labels on `/app/twin`, a
  screen it does not visit); the phone checks below ran after it.
- `PHONE_CHECK_LANG=ar npm run test:phone` (production build, ports
  3741/4741, fresh `.data/phone-check-arabic`): 67 measurements, 0 failures,
  0 page errors; 66 screens rendered `ar`/`rtl` (the 67th is the
  reduced-motion step). The English phone check on a fresh database: 67
  measurements, 0 failures.
- A one-off local Chromium scan of the Arabic member and subscriber screens
  for Latin words found the imported health measurements' names, states and
  units still in English on `/app/twin`; they are translated now. The rest
  was coach or demo content, brand names, or the marketing header above.
- Not run: Safari/Firefox, a native Arabic reviewer, screenshots (not
  required).

## Adding or changing a message

1. Add the key to the English object of the area's file in
   `lib/i18n/messages/` and the Arabic next to it (the typecheck fails
   until you do). Use `{name}` for values and `#` for a plural's count.
2. Use `t("key", { name })` in the component (`useT("<area>")`). Never
   concatenate translated fragments around a value; put the value in the
   message.
3. Numbers, dates, prices and durations go through `lib/format.ts` with the
   locale; ranges and expressions through `formatRange`/`formatSetsReps`.
4. Run `node --import tsx --test tests/i18n.test.ts tests/i18n-hardcoded.test.ts`.

## Remaining limits

- Only Chromium was used for the browser checks; Safari's and Firefox's
  bidi rendering were not checked.
- Arabic wording was written for this branch and has not had a native
  reviewer's pass; the catalog keeps English and Arabic side by side for
  that review.
- The member-screens track is merged (29 September 2026): its new
  components (`member-today`, `member-today-model`, `member-program`,
  `member-chat`, `member-intake`, `member-membership`, `member-context`,
  `member-states`) are whole files in `tests/i18n-hardcoded.test.ts`.
  `bookings.tsx` is still shared with the coach's calendar and is not in
  that check; its member wording is catalog text (checked by the Arabic
  phone and RTL runs), the coach's lines stay English.

## Files

- New: `apps/web/lib/i18n/` (`core.ts`, `react.tsx`, `errors.ts`,
  `catalog.ts`, `messages/*.ts`), `apps/web/lib/format.ts`,
  `tests/i18n.test.ts`, `tests/i18n-hardcoded.test.ts`, this document.
- Changed: `app/layout.tsx` (`LocaleProvider`), `app/[[...path]]/page.tsx`
  (directory language), the member, public and joining components listed
  under Coverage, `packages/contracts/src/discovery.ts` (Arabic manifest
  description and shortcuts), `scripts/rtl-check.mjs` (Arabic chrome, either
  language's settings labels), `scripts/phone-check.mjs`
  (`PHONE_CHECK_LANG=ar`), tests that read changed source or wording
  (`analytics-consent`, `client-twin-adherence`, `joining-web`,
  `public-pages`, `rtl-layout`), and `docs/features/rtl-layout.md`,
  `phone-first.md`, `pwa.md`.
