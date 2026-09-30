# Trainer workspace (round 4, phase 5)

The coach's daily workspace: four sections, one inbox, chats as a list, a
client page with tabs, and plain words. Laptop first; on a phone (650 px and
narrower) a bottom bar replaces the side menu.

## Layout

| Section | Address | What it holds |
|---|---|---|
| Inbox | `/trainer` | Everything waiting on the coach, most urgent first, beside the chat list |
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
- `apps/api/src/trainer-inbox.ts` — the two read endpoints.

## Checks

- `tests/trainer-inbox.test.ts` (API, PGlite and PostgreSQL restricted role):
  merge order and de-duplication, chats, access by role and workspace, the
  note-only-when-rejecting rule, reply delivery and notification, hold guard.
- `tests/trainer-workspace-web.test.ts`: sections, More groups by role,
  address-to-section mapping, shell routes, plain-word guard, no model names.
- Check scripts updated for the renamed screens: `browser-check.mjs` (inbox
  heading, bottom bar, client Notes tab, new routes),
  `browser-completion-check.mjs` (open the chat from the list),
  `rtl-check.mjs` (trainer bottom bar direction instead of the drawer),
  `capture-app-views.mjs` (titles), `tests/e2e/scenarios/browser.e2e.ts` (My
  rules / Check my Brain tabs). These browser checks were not run here.
