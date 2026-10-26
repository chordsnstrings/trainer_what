# Trainer workspace (round 4, phase 5)

The coach's daily workspace: four sections, one inbox, chats as a list, a
client page with tabs, and plain words. Laptop first; on a phone (650 px and
narrower) a bottom bar replaces the side menu.

## Layout

| Section | Address | What it holds |
|---|---|---|
| Today | `/trainer` | One queue: the one decision that needs the coach now, the rest in order, and the coach's AI at work (see "Today" below) |
| Inbox | `/trainer/inbox` | Everything waiting on the coach, most urgent first, beside the chat list |
| Clients | `/trainer/subscribers`, `/trainer/subscribers/:id[/plan\|notes\|membership]` | Client list; each client page has Message, Plan, Notes and Membership tabs. Programmes and Nutrition sit under Clients in the side menu |
| My Brain | `/trainer/brain/...` | Unchanged pages with plain words |
| More | `/trainer/more` | Business (earnings and plans, business summary, bookings, support requests, grow, affiliates), My page (design, website, photos, web address), Account (security and settings, notifications, privacy, team, connections) |

- Every older address still opens (`/trainer/exceptions` is now titled "Needs
  you"; `/trainer/summary` shows the old dashboard). `sectionFor(path)` in
  `components/workspace-nav.tsx` decides which section is highlighted.
- Team coaches do not see the owner's money, page or team links; finance
  helpers see Summary, Earnings and their account only (`moreGroups(role)`).
- While the owner's page is not live, "Finish setup" in the side menu, a
  banner on the inbox and More, and the old launch checklist rows all link to
  the setup wizard at `/setup` (`SETUP_HREF`; the wizard is built separately).
- The inbox count shows on the Inbox tab and the installed app's icon
  (`setAppBadge`), refreshed every minute, after every workspace reload and
  whenever a card is handled (`trainer-inbox-changed` window event).

## One inbox

`GET /api/v1/trainer/inbox` (owner and staff; `apps/api/src/trainer-inbox.ts`)
is read-only. It merges the existing queues and returns
`{ items: InboxItem[], counts: { total, byType } }`. Each item has `id`
(`type:recordId`), `type`, `urgency` (0 most urgent), `recordId`, `version`,
`clientId`, `clientName`, `title`, `preview`, `draft` (reply drafts only),
`createdAt`, `actions` and `href`. Ties sort oldest first.

| Urgency | Type | Source | Card actions |
|---|---|---|---|
| 0 | `safety` | active `training_hold` (its safety exception is not listed twice); a safety exception without an active hold | Review (hold controls), Open chat; Reply for a report without a hold |
| 1 | `reply_draft` | open exception with a `decisionId` | Approve, Edit & send, Don't send (note required), Open chat |
| 2 | `question` | other open exceptions (questions for the coach personally) | Reply, Close without reply (note required), Open chat |
| 2 | `support` | open support thread where the member wrote last | Reply (`POST /support/:id/reply`), Open |
| 2 | `chat` | the client wrote last and no item above covers that client | Reply (`POST /messages`), Open chat |
| 3 | `plan_draft` | `plan_generation` pending review, failed, or delivered with a pending spot check | Approve (`POST /brain/plans/:id/review` with `version`; first plans only), Open |
| 3 | `followup` | `coaching_followup` in `review_required` | Open |
| 3 / 4 | `booking` | confirmed session that ended without attendance (3), or starts within 24 hours (4); staff see their own sessions only | They came / No-show (`POST /bookings/:id/outcome`), or Open |

"Feedback requests" in the owner's list are read as the members' requests
for the coach personally (question items) plus scheduled messages that need a
fresh look (follow-ups).

`GET /api/v1/trainer/chats` returns `{ chats }`, the latest message per client
(`clientId`, `clientName`, `lastText`, `lastAuthor`, `lastAt`,
`awaitingReply`), newest first, at most 200. There are no read markers:
"unread" means the client wrote last.

### Note only when rejecting

`POST /api/v1/exceptions/:id/resolve` now takes
`{ note?, approveDecision?, replyText? }`:

- `approveDecision: true` delivers the Brain's draft through the existing
  reviewed-delivery checks (consent, published Brain, client snapshot). No
  note needed.
- `replyText` sends the coach's own words as a trainer message to that client
  (with the usual coaching notification) and closes the item in the same
  transaction. No note needed. Not allowed together with `approveDecision`.
- Otherwise the item is closed without sending anything and `note` (3+
  characters) is required.
- A safety item whose training hold is still active keeps answering 409
  `EXPLICIT_HOLD_REVIEW`: the hold controls resume or end training.
- The record keeps `resolution` (the note or a fixed sentence), `resolvedBy`
  and `outcome` (`approved`, `edited`, `replied` or `closed`). An edited
  reply's message carries `exceptionId` so later "correct a real reply"
  teaching can find it.

Nothing new reaches a member without the coach pressing a button; the safety
policy, medical-advice blocks, validators and automatic-sending checks are
unchanged.

## Chats and the client page

- `/trainer/messages` lists chats WhatsApp-style (dot when the client wrote
  last); `/trainer/messages/:clientId` opens one thread. The old client
  drop-down stays only where no client is chosen.
- `CoachingMessages` (`components/training-workspace.tsx`) takes optional
  `subscriberId` and `clientName`; authors read "Client name", "You", "Your
  Brain", "Your Brain (you approved)" and "Automatic notice". "Take over" is
  "I'll reply myself"; "Return to qualified digital coaching" is "Let my
  Brain reply".
- The client page (`SubscriberDetail` in `components/workspace-clients.tsx`):
  Message (the thread), Plan (assigned programmes and the next sessions, with
  links to draft a plan with the Brain or open Programmes), Notes (the client
  context, formerly "Client twin"), Membership (status and ending the
  membership for owners).

## Today: one queue (26 October 2026)

The owner chose design B, "One queue", and then said: "our moat is the AI
training, not personal one on one training." Today is built around what the
coach's AI does and what it hands to the coach; sessions are not the
headline. `components/trainer-today.tsx`, styles in `app/trainer-today.css`.

- **Up next** shows one decision with its actions right there: an inbox card
  (`InboxCard` with `variant="focus"`; a reply draft shows the client's
  message above the Brain's draft, from the inbox item's new `ask` field), a
  "Make this a rule?" suggestion from the coach's own edits (owner only;
  `POST /brain/suggestions/:id/confirm|dismiss` with its `version`), or the
  next setup step while the page is not live. "Later today" moves it to the
  end of the queue for this session (there is no snooze on the server).
- **The card stays put.** Up next keeps the card the coach is working on
  (kept for the session, so leaving Today and coming back shows it again)
  until they finish it, move it Later or pick another. A safety report or
  anything more urgent that arrives meanwhile shows as a chip beside "Up
  next" ("Safety report from Lina · Open now") and is announced once; it
  never replaces the card or the reply being typed. The page waits for
  every source it asked for (inbox, rule suggestions, setup) before the
  first card shows; their answers are kept between visits and read again in
  the background. After a pick or a finish, keyboard focus moves to "Up
  next".
- **Then** lists the rest in queue order (`buildQueue` in
  `components/trainer-queue.ts`): safety first, then setup, then urgency,
  then whoever waited longest. A click puts a row in Up next. Rows that
  arrive while the pointer is over the list wait in a "N new · show" pill so
  nothing moves under the pointer. "Done today" lists what was finished here.
- **Done today ring**: decisions this coach finished since their local
  midnight, counted on the server and returned with the inbox
  (`GET /trainer/inbox?since=<epoch ms>` → `done.count`, `counts.rules`;
  `doneToday` in `apps/api/src/trainer-inbox.ts`). Every finished item counts
  once: resolved questions, drafts and safety items, reviewed plans, resolved
  holds, attendance, rule suggestions confirmed or dismissed, a support reply
  that answers the member (`support.replied` with `answered`), and a chat
  reply to a chat the inbox showed as waiting (new `chat.replied` event,
  POST /messages). Follow-ups and messages that answer nothing do not count.
  The ring is that count against it plus what still waits: inbox decisions
  and rule suggestions. A session that has not ended waits in the queue but
  is not a decision yet. The rail, the ticker and Today read the same shared
  store, so they always agree; a finish shows at once
  (`workspace-inbox-store.ts` `finish`) and the server's next answer
  confirms it.
- **Your AI right now**: clients mid-workout with the coach's AI (active
  workout records started in the last 3 hours, sets logged of sets planned).
- **What your Brain did**: replies it sent on its own, drafts it left for the
  coach, plans it started, wrote, sent or adjusted, rules it learned, and
  clients starting and finishing workouts, in plain words. "Writing a plan…"
  shows while a plan started in the last 30 minutes has not finished.
- **Getting better**: approved without edits for the latest week, the
  8-week bars from `GET /brain/progress`, and confirmed coaching rules.
- Nothing is estimated: every number comes from `/bootstrap`, `/trainer/inbox`,
  `/brain/suggestions`, `/brain/progress`, `/setup` and the paged
  `events`, `records` (active workouts) and `sets` lists. The live picture is
  seeded from `/bootstrap` (no extra request when a page opens) and refreshed
  once a minute while the tab is visible; after the coach finishes an item
  only the events are read again (`useLive`). The inbox is still fetched
  once per page (`workspace-inbox-store.ts`). The menu, the ticker and the
  phone tab bar subscribe to these stores themselves and the stores only
  notify on a real change, so polling never re-renders the page itself.

## Rail (26 October 2026)

Above 900 px the coaching workspace's side menu is a 72 px rail of icons that
opens over the page to 248 px on hover (after 120 ms, so passing the pointer
across does not open it) or on keyboard focus, and folds 200 ms after the
pointer leaves. Escape folds it again until the pointer or focus comes back
(WCAG 1.4.13); a mouse click inside it does not keep it open (only keyboard
focus does). "Keep the menu open" pins it at 248 px; the choice is kept on
this device. An ink pill glides to the current page and a light one follows
the pointer. Live instruments sit on the icons for owners and staff: a done
ring on Today ("3 of 7"), the Inbox count (red while a safety item waits;
it pops when a new item arrives), typing dots on My Brain while it writes a
plan, and a breathing dot on Clients while people train. Only one of those
loops runs at a time. A ticker at the foot of the rail rotates true lines
("2 clients training with your AI"). "Pause live motion" stops every loop
(WCAG 2.2.2) and is kept on this device. At 900 px and below the drawer and
the phone tab bar are unchanged. `components/workspace-navigation.tsx`,
`components/workspace-rail.tsx`, `app/trainer-rail.css`.

## Page to page, and Jump to (26 October 2026)

- The address changes at once. The page being left dims, a 2 px bar at the
  top runs while the next page loads, and the new page arrives from where it
  sits in the menu: a place further down rises from below, one further up
  drops from above (`components/workspace-transitions.tsx`,
  `app/workspace-transitions.css`). Loading shows soft blocks after 160 ms
  instead of "Loading…" (the text stays for screen readers).
- **Jump to** (Ctrl K, or Cmd K on a Mac; it also works on Arabic and
  other non-Latin keyboard layouts; or the button in the top bar) lists every
  place in this person's menu; type to filter, arrows to move, Enter to go.
  Unsaved changes are saved first, as with any link, including the Website
  Studio's draft (it now registers its save with the workspace). Keyboard
  focus lands on the new page.
- Each move between pages has an id; only the page it opened can end it, so
  a quick second click never cuts the next page's bar short. Links that
  handle the click themselves are left alone.

## Plain words

Applied to the workspace, My Brain, coaching studio, plan settings and client
notes: Needs you, My rules, Quiz questions, Practice quiz, Check my Brain, How
much my Brain does alone, Waits for me, Sends automatically, Re-checking your
changes, Your Brain / Your Brain (you approved), Let my Brain reply, Your
balance, My page. The plan settings' confidence share, spot-check share and
"young" count are under a collapsed **Advanced** block with their defaults.
Coach screens no longer show the model id (the coaching studio shows "Brain
service: Ready") or provider/model names in the usage lines of Earnings.

Arabic: these trainer screens were English-only before and stay English (the
member catalogs are untouched).

## Code map

- `components/workspace.tsx` — shell only (bootstrap, routing, side menu,
  member shell). Split on this branch with no behaviour change into
  `workspace-ui` (shared types and small components), `workspace-home`
  (summary, onboarding, brand), `workspace-brain`, `workspace-clients`,
  `workspace-training` (programmes, workout), `workspace-messages` (needs you),
  `workspace-finance`, `workspace-settings`, `workspace-admin`; new
  `workspace-nav` (sections, More, bottom bar, inbox count) and
  `workspace-inbox` (inbox, chat list, thread).
- `app/trainer-workspace.css` — side menu groups, bottom bar, inbox, chats,
  client page, More, Advanced (logical properties only).
- `components/trainer-today.tsx`, `trainer-queue.ts`, `workspace-live.ts` —
  Today, its queue order and the live picture; `workspace-navigation.tsx`,
  `workspace-rail.tsx` — the rail; `workspace-transitions.tsx`,
  `workspace-places.ts` — page-to-page motion and Jump to. Styles in
  `app/trainer-rail.css`, `app/trainer-today.css`,
  `app/workspace-transitions.css`.
- `apps/api/src/trainer-inbox.ts` — the two read endpoints.

## Checks

- `tests/trainer-inbox.test.ts` (API, PGlite and PostgreSQL restricted role):
  merge order and de-duplication, chats, access by role and workspace, the
  note-only-when-rejecting rule, reply delivery and notification, hold guard.
- `tests/trainer-today.test.ts`: queue order and Later today, the live
  picture from records and events, Jump to ranking and page direction, and
  the motion rules of the three trainer stylesheets.
- `tests/trainer-workspace-web.test.ts`: sections, More groups by role,
  address-to-section mapping, shell routes, plain-word guard, no model names.
- Check scripts updated for the renamed screens: `browser-check.mjs` (inbox
  heading, bottom bar, client Notes tab, new routes),
  `browser-completion-check.mjs` (open the chat from the list),
  `rtl-check.mjs` (trainer bottom bar direction instead of the drawer),
  `capture-app-views.mjs` (titles), `tests/e2e/scenarios/browser.e2e.ts` (My
  rules / Check my Brain tabs). These browser checks were not run here.
