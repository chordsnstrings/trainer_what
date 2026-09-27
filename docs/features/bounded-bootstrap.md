# Bounded bootstrap payloads and paging

Branch `hard/bootstrap` from `3088123`. No migration. As instructed for this package, `CLAUDE_HANDOFF.md`, `docs/COMPLETION_STAGES.md` and `docs/PROJECT_MEMORY.md` were not edited; this file is the stage record.

## Plan (written before implementation)

### What was read

- `apps/api/src/app.ts` `GET /api/v1/bootstrap`: one tenant transaction that returns `records` (1,000 most recently updated, any kind except `twin_snapshot`, `retention_policy`, `nutrition_*`), `sets` (1,000 `workout_events`), all `subscriptions`, up to 1,000 active complimentary grants, all of the caller's consents and, for non-followers, every member, 100 events, and for owner/finance 100 costs, every payout, 200 journals, every usage statement and the finance summary. Row-level security already scopes every table to the tenant and a follower to their own rows.
- `apps/web/components/workspace.tsx` reloads the bootstrap on every route change and after every action. Screens derive lists and counts from it (`records(kind)`, `state.sets`, `state.members`, `state.subscriptions`, journals, payouts, costs). The follower copy is cached for offline replay (workout and program records only).
- Existing paging: `/messages/thread` (cursor), `/notifications` (offset: duplicates when a notification arrives between pages), `/admin/operations/:view` (25 workspaces per page out of at most 500; the security audit is a fixed 200), `/admin/overview` (every workspace, one transaction and one audit event per workspace, every open exception).
- The live Messages and Programs screens already use their own endpoints (`CoachingMessages`, `TrainingPrograms`); the `Messages`/`Programs` components inside `workspace.tsx` are not routed.

### Baseline (unchanged code, `3088123`)

Large synthetic workspace (`tests/bootstrap-fixtures.ts`): 500 followers plus owner/coach/finance, 2,000 messages, 1,500 workouts, 500 programs, 500 intakes, 400 decisions, 400 exceptions (200 open), 1,350 planned sessions, 60 rules, 30 scenarios, 60 support cases, 4 products, 20 teaching sources (about 40 KB each with chunks), 5,000 set logs, 500 subscriptions, 60 complimentary grants, 2,000 events, 600 cost events, 300 journals, 400 notifications. Five timed requests after one warm-up through `app.inject`; the measuring logic is committed as `scripts/measure-bootstrap.ts` (the baseline was taken with a scratch copy of it against the unchanged API; PostgreSQL rows ran it through `/opt/tools/pg-sandbox.sh`):

| Role | Embedded PGlite bytes | PGlite median | PostgreSQL 16 restricted role bytes | PostgreSQL median |
| --- | --- | --- | --- | --- |
| Owner | 2,150,771 | 108–117 ms | 2,152,171 | 86 ms |
| Coach (staff) | 2,058,978 | 87–117 ms | 2,059,978 | 69 ms |
| Finance | 368,396 | 65–88 ms | 369,796 | 39 ms |
| Follower | 16,138 | 28–30 ms | 16,140 | 22 ms |

Owner breakdown: records 1,454,280 bytes (1,000 rows; the 20 sources alone carry full text and chunks), sets 329,494, subscriptions 159,601 (500 rows), members 78,332 (503 rows), journals 50,785, costs 40,801, events 24,885. Members and subscriptions grow linearly with followers without any cap. The 1,000-row record cap is also wrong for the screens: only 114 of the 400 exceptions were present, so the open-exception badge and attention list under-reported, and a follower's older workout could not be opened by URL.

### Design

1. **Bootstrap stays one request with the same keys and array types**, each bounded, plus:
   - `pages`: for every capped collection `{ hasMore, cursor }` (records per kind: `pages.records[kind]`).
   - `totals`: counts the screens show (records per kind, open exceptions, confirmed rules, completed workouts, set count and volume, subscribers, active subscriptions), so badges and statistics stay exact when lists are paged.
2. **Records**: an explicit catalog of the kinds the web shell reads from the bootstrap, each with its own page size and, where the screens only use one state, a status filter (open exceptions, open conflicts, active training holds). Pinned rows are added without affecting cursors: a follower's own active workouts and their set logs (offline replay), and the coaching decisions referenced by the included open exceptions. Teaching sources omit `text` and `chunks` and carry `textLength` (the only field the screen uses). Kinds outside the catalog are no longer shipped in the bootstrap; screens that need them already use their own endpoints.
3. **Stable cursors**: every page orders by an immutable key with a unique tie-break (`created_at DESC, id DESC` for records, sets, events, costs, journals, payouts, grants, consents, notifications, audit; `name, id` for members; `period` for usage statements; `id` for subscriptions). The cursor is an opaque base64url value holding the exact key (timestamps at microsecond precision, formatted in UTC by the database), so rows sharing a timestamp are neither repeated nor skipped, and rows inserted while a client pages are newer than the first page and never appear in later pages.
4. **Endpoints** (tenant transaction, so row-level security applies exactly as in the bootstrap; the same role checks as the bootstrap's inclusion rules):
   - `GET /api/v1/workspace/pages/:collection?cursor=&limit=` for `records` (`kind`, optional `status`), `sets` (optional `workoutId`), `members` (`role=subscriber|team`, `q` search; subscriber rows include membership status, complimentary access and assigned program count), `subscriptions`, `complimentary`, `consents` (own), `events`, `costs`, `journals`, `payouts`, `usageStatements`. Response `{ items, hasMore, cursor }`.
   - `GET /api/v1/workspace/records/:id` for a single catalog record (opening an old workout by URL).
   - `GET /api/v1/notifications?before=<id>` keyset paging (the `offset` form stays for older clients).
   - `GET /api/v1/admin/overview?cursor=` pages workspaces (50) with per-workspace open-exception counts; audit events are written only for the workspaces actually inspected.
   - `GET /api/v1/admin/operations/security?cursor=` pages the operator audit list; a selected workspace is looked up directly instead of only among the 500 most recent.
5. **Web**: `workspace.tsx` keeps extra pages per collection and merges them into the lists (reset when the bootstrap reloads so no stale row survives an action); "Load more" on the attention list, Brain lists, workout history, AI usage, journals, payouts, refunds, support and usage statements; the Subscribers screen uses the members endpoint with server-side search; client pickers get a server search when more followers exist than the first page; counts use `totals`; the workout screen fetches an unlisted workout and its set logs; the notification inbox and admin screens use the new cursors. The offline cache keeps the follower's workout/program records, which always include active workouts.
6. **Tests** (`tests/bounded-bootstrap.test.ts`): payload and row bounds under the large fixture per role, exact totals, cursor walks with no duplicates or gaps while rows are inserted between pages (including rows sharing one timestamp), and authorization for every paginated endpoint (a follower never receives another member's rows; roles that the bootstrap excludes get 403).

Deviation found during implementation: the plan named the operator audit parameter `cursor`; it is `rowsCursor` (the workspace pages of the same route use `cursor`). Member search sends one `q` value per word (see the proxy finding below).

## What changed

### API

- New `apps/api/src/workspace-pages.ts`:
  - `bootstrapCollections(tx, actor)` builds the bounded bootstrap collections. `GET /api/v1/bootstrap` keeps every key and array type it had and adds `pages` and `totals`.
  - Record catalog and page sizes: `rule` 100; `message` 20; `training_hold` 20 (active only); `exception` 50 (open only); `conflict` 50 (open only); every other catalog kind 50 (`beneficiary`, `brain_release`, `evaluation`, `intake`, `interview`, `product`, `program`, `refund`, `scenario`, `source`, `support`, `workout`). `decision` is only pinned. All first pages come from one `unnest … CROSS JOIN LATERAL` statement.
  - Pinned rows, which never move a cursor: decisions referenced by the included open exceptions; up to 100 confirmed rules (the scenario form and release readiness need them however many drafts are newer); and, for a follower only, up to 5 of their own active workouts with up to 500 of their set logs.
  - Other page sizes: sets 100, subscribers 100 plus the team (100), subscriptions 100, complimentary grants 100, consents 100, events 100, costs 100, journals 100, payouts 50, usage statements 24. Members named by the included open exceptions are added so the attention list can still show names.
  - Sources in the bootstrap and the paging endpoints omit `text` and `chunks` and carry `textLength` and `chunkCount`. The web's compilation picker only uses the length. The compile endpoint still reads the full rows server-side.
  - `totals` holds per-kind record counts, `openExceptions`, `openConflicts`, `confirmedRules`, `completedWorkouts`, `sets`, `setVolumeKg`, `subscriptions` and `activeSubscriptions`. For non-followers it also holds `subscribers` and `members`. A follower's totals cover only their own rows because row-level security applies.
  - Followers' queries repeat a superset of their row-level-security rule (`owner_user_id = me OR kind = 'product'`, `user_id = me`) as a planner hint. This never widens access.
  - `GET /api/v1/workspace/pages/:collection` and `GET /api/v1/workspace/records/:id`, as planned. Both use the tenant transaction and fail closed for suspended workspaces through the existing gate (423). Role rules:
    - `members` and `events`: not for followers (403).
    - `costs`, `journals`, `payouts` and `usageStatements`: owner and finance only (403 otherwise).
    - Every other collection: all roles, scoped by row-level security.
  - The records endpoint accepts catalog kinds only (400 otherwise), so `twin_snapshot`, `retention_policy`, `nutrition_*` and other kinds stay unavailable exactly as in the old bootstrap. Cursors are validated (400 `INVALID_CURSOR`), `limit` is capped at 100, and the members endpoint accepts `userId` (a single-person lookup).
- `apps/api/src/notifications.ts`: `GET /api/v1/notifications?before=<id>` pages by keyset, comparing inside the database for full timestamp precision. The id must be the caller's own notification, otherwise 400. `offset` is unchanged.
- `apps/api/src/app.ts`: the bootstrap route delegates to `bootstrapCollections`. `GET /api/v1/admin/overview?cursor=` pages workspaces 50 at a time and returns `hasMore`, `cursor` and `totals` (workspace and published counts). Each workspace carries `openExceptions` (exact) and `exceptions` (at most 20). Only the workspaces on the page are opened and audited.
- `apps/api/src/admin-operations.ts`:
  - `cursor=` pages workspaces for the operations views and returns `nextCursor`. `page=` still works.
  - `rowsCursor=` pages the security audit list (100 per page) and returns `rowsHasMore` and `rowsCursor`.
  - A selected `tenantId` is looked up directly, so workspaces older than the 500 in the picker are reachable. Before, they returned 404.

### Web

- `apps/web/components/workspace-paging.ts` holds pure helpers for merging pages.
- `workspace.tsx`:
  - Extra pages are merged into the state the screens already read. They are cleared on every bootstrap reload, and a generation counter drops pages that arrive late.
  - "Load more" buttons on: the attention list (with "Showing N of M"), sources, conflicts, rules, scenarios, evaluations, releases, refunds, ledger, usage months, payouts, workout history, AI usage and support.
  - Counts use `totals`: the overview, analytics, the exceptions nav badge, readiness, interview progress and scenario count.
  - The Subscribers screen reads `/workspace/pages/members`, with server search, "Showing N of M" and "Load more subscribers".
  - The workout screen fetches a workout that is not in the bootstrap, and its set logs, by id.
  - An exception's decision quote is fetched when it was not pinned.
  - The subscriber detail page looks up a follower's name by id.
  - Admin overview: "Load more workspaces"; totals labelled when only some workspaces are loaded.
- `member-finder.tsx` adds a server search to the client pickers in `training-workspace.tsx` (coaching messages, training progress) when more followers exist than the first page.
- `notifications.tsx` uses the `before` cursor.
- `admin-operations.tsx` uses cursor Previous/Next for workspaces and "Load older audit entries".
- `source-compilation.tsx` uses `textLength`.
- The offline cache is unchanged: it stores the follower's workout and program records, which always include their active workouts.

### Tests and tooling

- `tests/bootstrap-fixtures.ts` holds the large synthetic workspace, generated in SQL. Accounts go through the service connection and tenant rows through the owner's tenant transaction, as the restricted role requires.
- `tests/bounded-bootstrap.test.ts` has 11 tests:
  - payload and row bounds per role;
  - record columns match the table;
  - exact totals;
  - a follower pages only their own rows through every endpoint, including with an owner's cursor and by id;
  - role rules for every collection, cross-workspace isolation, invalid kinds, cursors and limits, and suspended workspaces;
  - subscriber list paging, search and membership fields;
  - message, set, notification and member walks with inserts between pages: the exact pre-existing order, no duplicates, no gaps;
  - 130 rows sharing one timestamp;
  - admin overview, operations workspace and audit cursors, and a workspace outside the 500-row picker;
  - payload unchanged after adding 300 followers and 2,000 messages;
  - web merge helpers.
- `scripts/measure-bootstrap.ts` holds the measurement.

## Results

Same fixture, five timed requests after a warm-up:

| Role | Before bytes | After bytes | PGlite median before → after | PostgreSQL 16 restricted role median before → after |
| --- | --- | --- | --- | --- |
| Owner | 2,150,771 | 436,482 (−80%) | 108–117 → 127 ms | 86 → 74 ms |
| Coach (staff) | 2,058,978 | 369,832 (−82%) | 87–117 → 97 ms | 69 → 75 ms |
| Finance | 368,396 | 154,874 (−58%) | 65–88 → 82 ms | 39 → 41 ms |
| Follower | 16,138 | 16,800 (+4%, pages and totals) | 28–30 → 26 ms | 22 → 16 ms |

- The PostgreSQL sizes after the change were 436,992, 370,042, 155,384 and 16,802 bytes.
- After adding 300 followers and 2,000 older messages, the owner payload was byte-for-byte the same size: 449,943 bytes before and after, in the test run where earlier tests had added rows.
- Latency is roughly unchanged. The new exact totals are aggregate queries. The size reduction, not speed, is the gain.

## Checks actually run

The tool path was `PATH=/opt/node24/bin:$PATH`.

| Command | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed (last run after the final code change) |
| `node --import tsx --test tests/bounded-bootstrap.test.ts` | 11 passed, 0 failed |
| `node --import tsx --test --test-concurrency=1` on 21 related files (fix-web, platform, support-preview, coaching-completion, notifications, joining-complimentary, retention, governance-step-up, fix-auth, admin-completion, governance-suspension, fix2-web, push-notifications, acquisition, host-routing, settings-runtime, branding, team-completion, accounts-web, governance-web, joining-web) | 194 passed, 0 failed |
| `/opt/tools/pg-sandbox.sh 56122 "$PWD"` on bounded-bootstrap, notifications, coaching-completion, platform, fix-web, governance-step-up, admin-completion, support-preview, joining-complimentary, retention, fix-auth and governance-suspension (plus the measurement script) | Migrations, runtime role and `verify-runtime-access` passed. 147 tests: 146 passed, 0 failed, 1 skipped (the existing embedded-only fix-web migration replay). `PG_SELECTED_FAILED_FILES=0` |
| `/opt/tools/pg-sandbox.sh 56122 "$PWD" tests/bounded-bootstrap.test.ts`, rerun after the search-term change | 11 passed, 0 failed |
| After the last code change (own-key checks for collection and kind names, with new 404/400 assertions): `tsc --noEmit`, `node --import tsx --test tests/bounded-bootstrap.test.ts` and `/opt/tools/pg-sandbox.sh 56122 "$PWD" tests/bounded-bootstrap.test.ts` | Passed; 11 passed, 0 failed on each engine (`PG_SELECTED_FAILED_FILES=0`) |
| Full embedded suite: `node --import tsx --test --test-concurrency=1 tests/*.test.ts` (88 files), run before the own-key check | 675 tests: 674 passed, 0 failed, 1 skipped (the existing PostgreSQL-only retirement race test). 548 s |
| `next build` in `apps/web` | Passed (after the final web change) |
| Local Playwright (`/opt/pw-browsers/chromium`), large fixture, built web on port 3122 and API on port 4122 | 11 of 11 checks passed (details below) |

The Playwright checks covered:

- overview totals (500 subscribers, 200 attention items, nav badge 200);
- Subscribers "Showing 100 of 500", load more to 200, and search;
- the attention list with a decision quote, and load more from 50 to 100 of 200;
- a source shown as 18,900 characters without its text;
- the ledger from 100 to 200 rows;
- analytics sets 5,000 and older workouts;
- notifications from 50 to 100 with no duplicates;
- the client picker finding "Follower 0500";
- the oldest workout opening by address;
- a subscriber detail page naming a follower outside the first page;
- the follower overview and offline cache.

The only console error in the browser run was the existing 403 from `/clients/:id/context` for a follower without shared context. The full PostgreSQL suite was not run: the change adds no migration and the database-facing files ran on PostgreSQL above.

## Remaining limits and findings

- **Existing proxy defect: spaces in query values are rejected.** `apps/web/proxy.ts` signs `nextUrl.search`, which Next writes with `+` for a space. The rewrite forwards `%20` for a space. So any proxied request with a space in a query value fails the API's host proof with 400 `HOST_SIGNATURE`. This was observed locally with the signing secret set, which production requires. It already affects the coaching feedback history search for multi-word text. It was not fixed here because it is signed-provenance code outside this package. The member search avoids it: the client sends one `q` value per word, and every word must match. A fix should make the API verify against a canonical `URLSearchParams` form of the query, or make the proxy sign exactly the target it forwards.
- Pages loaded with "Load more" are cleared whenever the bootstrap reloads, which happens after every action. The list then returns to its first page. This is deliberate, so a row changed by the action is never shown stale.
- `totals` are exact aggregate queries on every bootstrap (per-kind record counts and set count and volume). At fixture scale this cost is small. Very large workspaces may need maintained counters. No index was added (no migration): first pages sort each catalog kind by `created_at`, using the existing `(tenant_id, kind, updated_at)` index only to find the kind.
- Cursor guarantees cover rows that existed when a walk started, and inserts made afterwards with the normal `now()` timestamp. A row whose transaction started before the walk passed its position but committed later carries an older timestamp. It is not shown until the list is refreshed.
- The bootstrap no longer carries record kinds outside the catalog (for example `planned_session`, `workout_correction`, `booking`, `settings`, `onboarding_step`). No web screen read them from the bootstrap; the screens that use them have their own endpoints. Bootstrap messages are a 20-row sample; conversations use `/messages/thread`.
- The first page of subscriptions for non-followers is now ordered by id rather than `period_end`; a follower still receives their single subscription. The combined `records` array is still sorted by `updated_at`, as before; paging within a kind uses `created_at`.
- Admin overview "Open exceptions" and "Trainer liabilities" add up only the loaded workspaces. They are labelled when more workspaces exist.
- Lists outside the bootstrap keep their existing caps without cursors:
  - `/training/overview` returns every follower's id and name for the program assignment picker;
  - the invitation, former-follower and complimentary-grant screens;
  - per-workspace admin operations lists of 100–200 rows;
  - the admin workspace picker of 500.
- Admin screens were exercised through the API tests only, not the browser check.
- Deployment: no migration, no new setting or secret, no host step. An older web client still works against the new API: bootstrap keys and types are unchanged and notifications `offset` remains. An older admin screen during rollout would list only the first 50 workspaces on the overview.
