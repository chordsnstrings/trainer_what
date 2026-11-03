# Connect Facebook (Facebook Page numbers and a Facebook estimate)

Built on 3 November 2026. It ships dormant, apart from the public data
deletion instructions:
- on deploy, `/security-and-privacy#facebook-instagram-data` appears, and
  the same text joins `llms-full.txt` and the assistant's facts;
- nothing else changes for trainers or public visitors until the owner saves
  the Facebook settings in Super admin, and then only for the coach
  addresses on the test list (see "Test mode").

The owner's Meta steps are in [meta-app-review.md](meta-app-review.md).

**Owner request (3 November 2026):** "let's add option to connect facebook as
well", next to Connect Instagram on Followers and growth. The owner chose
"Page numbers + own estimate":
- a trainer connects their Facebook Page, and we read its followers and
  recent engagement once and save only the numbers;
- a Facebook version of the subscriber estimate, on researched Facebook Page
  reach figures (assumptions version `2026-11-03`).

The owner signs the figures off before anyone else sees them. Trainers see
the Facebook card and estimate only while Connect Facebook is available to
their workspace; numbers saved earlier stay removable after that. The public
`/methodology` section and its sources (in `llms-full.txt` too) appear only
once Meta app review is recorded as approved.

Research (Meta Graph API and the Facebook benchmarks, retrieved 3 November
2026 from developers.facebook.com and the cited publishers) is summarised
below. The full notes were the build's input and are not in the repository.

## What it does

- **On `/trainer/growth` (Grow in the workspace menu, owner only), inside
  "Explore a growth estimate":**
  - a "Your Facebook Page numbers" card right under the Instagram card, with
    Connect Facebook (or Refresh from Facebook) and Remove saved numbers;
  - then the calculators: Instagram's follower estimate, then the Facebook
    Page estimate, filled from the saved numbers ("From your Page …");
  - the Facebook card and estimate show while `GET /api/v1/trainer/facebook`
    says `available`;
  - once it no longer does (taken off the test list, approval withdrawn,
    the integration off), numbers saved earlier stay on the card with
    Remove saved numbers, without Connect or the estimate, so they can
    always be removed (`facebookSection` returns `saved`).
- **Reads once, keeps numbers:** the Page's follower count and the reaction,
  comment and share totals of up to 12 recent posts are read in the callback.
  Then the tokens are dropped. No token, Page ID or Facebook user ID is
  stored.
- **Same Meta app as Instagram, separate values:** the "trainsyou social
  login" app (Meta App ID `2335071867263863`, Facebook Login for Business
  configuration `1420000509847051`), with its own settings, routes, records
  and redirect URI. Instagram uses that app's Instagram App ID
  `2881563462229057`. The other Meta app (`1653212959862915`) is not used.

Code:
- `apps/api/src/facebook.ts`: routes, the Graph reader and the error
  mapping;
- `apps/api/src/marketing.ts`: `metaConnectAccess`, shared with Instagram;
- `packages/providers/src/configuration.ts`: the provider and its fields;
- `packages/domain/src/facebook-calculator.ts`: the estimate;
- `apps/web/components/trainer-growth.tsx`: the card and the order of the
  cards and calculators (`GrowthEstimatesView`);
- `apps/web/components/marketing/facebook-calculator.tsx`: the calculator;
- `apps/web/components/marketing/site.tsx`: the `/methodology` section and the
  deletion instructions' contact line.

## Flow

Facebook Login for Business with a **user access token configuration**
(the Pages asset; `pages_show_list` and `pages_read_engagement`). Graph API
`v26.0` is pinned in one constant (`FACEBOOK_GRAPH_VERSION`), because an
unversioned call follows the App Dashboard's default.

1. **`POST /api/v1/trainer/facebook/authorize`.**
   - Who and where: the owner only, rate limited to 10 per 10 minutes, and
     refused on a coach's custom domain (`403 PLATFORM_HOST_REQUIRED`), so one
     platform-address redirect URI is enough.
   - Refusals: `409 FACEBOOK_UNAVAILABLE` unless `metaConnectAccess` allows
     this workspace; `401 SESSION_REQUIRED` without the session cookie.
   - It replaces any earlier state with a single-use `facebook_oauth_state`
     record (state hash, session hash, 10-minute expiry).
   - It returns the dialog address:
     `https://www.facebook.com/v26.0/dialog/oauth` with `client_id`,
     `redirect_uri`, `state`, `response_type=code`, `config_id` and
     `override_default_response_type=true`. No `scope` is sent: the
     configuration names the permissions.
2. **Facebook's dialog.** The person signs in, chooses the Pages to share and
   grants both permissions (Login for Business grants all or nothing).
3. **`GET /api/v1/trainer/facebook/callback`** (no-store, no-referrer):
   - **State:** the signed-in owner and the session must match; the state is
     deleted whatever happens. A cancel arrives without a state and gives
     `declined`.
   - **Access:** `metaConnectAccess` is asked again, as approval or the test
     list may have changed since authorize.
   - **Code exchange:** `GET /oauth/access_token` with the identical
     `redirect_uri`. Its address holds the secret and the code, so it is never
     logged.
   - **Permissions:** `GET /me/permissions` must show both permissions
     granted, since one can be removed later in Facebook's settings.
   - **Pages:** `GET /me/accounts`
     (`id,name,tasks,access_token,followers_count,fan_count`), at most two
     lists of 25. The next list is fetched from the cursor only, because
     Meta's `next` link carries the token.
   - **Which Page:** a usable Page has a Page token and the `MODERATE` task.
     The one with the most followers is used.
   - **Followers:** `followers_count`, else the Page re-read with its own
     token, else `fan_count`.
   - **Posts:** `GET /{page}/published_posts` with
     `shares,reactions.limit(0).summary(total_count),comments.limit(0).summary(true)`,
     `limit=12`. `limit(0)` means nobody who reacted or commented is fetched.
     Reels are not in this edge.
   - **Signing:** every Graph call after the exchange sends the token as
     `Authorization: Bearer` with `appsecret_proof` (HMAC-SHA256 of the token,
     keyed with the app secret). Each call has a 15 s timeout through
     `providerRequest`, which refuses redirects.
   - **Saved:** the snapshot replaces the earlier one, with the event
     `facebook.snapshot_saved`. The callback redirects to
     `/trainer/growth?facebook=connected`.
4. **`DELETE /api/v1/trainer/facebook`** removes the snapshot and any pending
   state at once (event `facebook.snapshot_removed`).
5. **`GET /api/v1/trainer/facebook`** returns `{ available, testing,
   snapshot, followerModel }`. The snapshot comes back whether or not this
   workspace may still connect.

Events carry no numbers: `facebook.authorization_started`,
`facebook.snapshot_saved` and `facebook.snapshot_removed` record only that
something happened (Instagram's three events likewise).

## Outcomes

`/trainer/growth?facebook=<outcome>`. The wording is `FACEBOOK_OUTCOMES` in
`trainer-growth.tsx`. An unsuccessful outcome keeps the earlier numbers.

| Outcome | When |
| --- | --- |
| `connected` | Numbers read and saved |
| `declined` | The person cancelled, or Facebook returned an error instead of a code |
| `expired` | No signed-in owner or session, a return with neither state nor error, an unknown, used or expired state, or a token Meta reports as expired (code 190 or 102, except subcodes 459, 464 and 492) |
| `unavailable` | Not available to this workspace (any more) |
| `permissions_required` | A permission is not granted, or code 10, 200–299 or subcode 492 (with any code, 190 included) on the person's token |
| `no_page` | No Page was shared |
| `page_access_required` | No shared Page gives a Page token with `MODERATE`, or code 10, 200–299 or subcode 492 (with any code, 190 included) on a Page token |
| `busy` | Meta's rate limits (codes 4, 17, 32, 341, 613, 80001), the code exchange included |
| `failed` | Anything else, including a checkpointed or unconfirmed account (subcodes 459 and 464) and a Page with no follower count |

A failed read logs only the outcome, Meta's error code and subcode, and its
trace ID: never an address, a token or Meta's message.

## Data kept

The `facebook_snapshot` record of the workspace (`FACEBOOK_RECORD_KINDS` also
has `facebook_oauth_state`):

| Field | Meaning |
| --- | --- |
| `pageName` | The Page used, at most 60 characters, control characters removed |
| `followers` | Followers |
| `pageLikes` | `fan_count`, or null |
| `engagementRatePct` | Mean (reactions + comments + shares) per sampled post ÷ followers × 100 (`facebookEngagementRate`); null without followers or posts |
| `postsSampled` | Recent posts that came with totals (at most 12) |
| `pagesShared` | Pages returned in the sign-in (at most 50 are read) |
| `fetchedAt` | When they were read |

Not kept: the person's token and the Page tokens (local variables of
`readFacebookSnapshot` only), the Page ID, the Facebook user ID, post IDs and
content, and who reacted or commented.

The numbers live in this record alone. The workspace events carry no
numbers (Instagram's neither), so Remove saved numbers and workspace closure
leave no copy in the event log.

**Deletion:**
- Remove saved numbers deletes the record at once.
- Closing the workspace deletes all its records except the retained financial
  kinds (`privacy-lifecycle.ts`).
- Removing the app in Facebook's settings ends the permission only. Nothing is
  stored that Meta's callback could match, so there is no deauthorize or
  deletion callback.
- Meta's 21-day deletion list (App settings → Advanced → User Data Deletion
  Requests) can be disregarded. Meta: "You can disregard user IDs that do not
  currently appear in your database".

**Public instructions:**
`https://trainsyou.com/security-and-privacy#facebook-instagram-data`
(`/security-and-privacy`, section `facebook-instagram-data`; keep the id
stable). It covers:
- what is kept;
- Remove saved numbers (open Grow, expand Explore a growth estimate) and
  workspace closure;
- removing the app in Facebook's settings (Business integrations or Apps and
  websites) and in Instagram's (Apps and websites);
- that saved numbers stay until removed;
- the support contact as `/about` shows it (`SupportContact` in `site.tsx`).

It is not gated: the Meta app uses it as its data deletion instructions URL
(App settings → Basic, once for Facebook and Instagram), and Meta checks it
before review. It is also in `llms-full.txt` and the assistant's facts.

The legal documents (`/privacy`, `/terms`) are versioned and were not
changed. Meta also asks the privacy policy to explain deletion, so
[meta-app-review.md](meta-app-review.md) ("Before you start") proposes a
short paragraph for the owner to approve and publish in Super admin →
Published documents and templates.

## Settings

Super admin → Settings → **Facebook Pages (follower estimates)** (provider
`facebook`, category marketing):

| Key | Label | Notes |
| --- | --- | --- |
| `FACEBOOK_APP_ID` | Meta App ID | Required; digits only. The Meta App ID at the top of the App Dashboard, not the Instagram App ID: `2335071867263863` ("trainsyou social login") |
| `FACEBOOK_APP_SECRET` | Meta App Secret | Required; sealed like other secrets. The App secret from App settings → Basic, pasted by whoever has dashboard access; never in the repository or chat |
| `FACEBOOK_REDIRECT_URI` | Redirect URI | Required; `https://<platform address>/api/v1/trainer/facebook/callback`, identical to the Meta entry (already registered for trainsyou.com; also listed by the Host page's address move) |
| `FACEBOOK_LOGIN_CONFIG_ID` | Facebook Login for Business configuration ID | Required; digits only. `1420000509847051` (already created) |
| `FACEBOOK_APP_REVIEW_APPROVED` | Meta app review approved for pages_show_list and pages_read_engagement | Default false. Set only after Advanced Access and the owner's sign-off on the figures |
| `FACEBOOK_TEST_WORKSPACES` | Before app review: coach addresses that may connect | Up to 50 comma-separated coach addresses (workspace slugs) |

**Activation:**
- Approved: all four required values plus the approval.
- Testing: all four values and a non-empty test list, without approval.
- The connection check validates without an external request in either case;
  otherwise it is `unavailable`.
- Super admin's activation (`platform-settings.ts` `isActive`) accepts
  testing too, so saved settings can switch on before review. The order is
  Save, Test connection ("Configuration validated"), then Enable integration.

## Test mode (both Meta connections)

Meta lets only people with a role on the app grant a permission before
Advanced Access. It also asks for a successful call through the real button
before it takes an App Review request. Until 3 November 2026 Connect
Instagram was hidden until approval, so nobody could make that call.

- `integrationCapability("facebook" | "instagram")` returns
  `testing: true` when configured, not approved, and the provider's test list
  (`FACEBOOK_TEST_WORKSPACES`, `INSTAGRAM_TEST_WORKSPACES`) is not empty.
- `metaConnectAccess(db, actor, provider)` decides per workspace:
  - approved: every workspace;
  - otherwise: only a workspace whose slug is listed, with `testing: true`.
  - The slug is read with `db.system(…, { tenantId })`, as go-live does.
  - GET, authorize and callback use it for both providers.
- The card shows "Testing before Meta review: only people with a role on the
  Meta app can finish connecting."
- `publicAvailability()` keeps `instagram` and the new `facebook` flag on
  approval only. A test list never changes a public claim.
- Public pages make no availability claim for Facebook until approval (no
  "Available soon" either). Instagram keeps its "Available soon" in the FAQ.
  Super admin's Test connection says the same for each provider.

## The Facebook Page estimate

`packages/domain/src/facebook-calculator.ts`, version `2026-11-03`. These are
cited defaults with no platform settings. A change is a reviewed code change
with a version bump; the shape is ready for settings later.

The calculator is `components/marketing/facebook-calculator.tsx`. Its
headline is active subscribers after 12 months, because a Page's first month
is usually fewer than 1. Every assumption, label and source is on
`/methodology#facebook-assumptions` once it is shown. The calculator links
there only then; while testing it says "Its sources and methodology are
published when this estimate goes live."

- **Channels:**
  - **Posts carrying your link:** followers × post reach for the Page size ×
    the link share × engagement scaling. Repeat link posts reach the same
    followers. Your own average link-post viewers replace this audience.
  - **Call-to-action Reels whose comment keyword sends the link by
    Messenger** (one private reply per comment, within 7 days). With the
    keyword off, they count only through Page visits.
  - **The Page's own link** (action button, website, pinned post): only when
    you enter monthly Page visits.
- **Not counted:** Stories, Groups, links in comments, other post types, ads.
- **Figures:**
  - post reach by Page size 4.35 / 3.4 / 2.7 / 1.5 / 0.5% (Socialinsider,
    brand Pages, January 2025–August 2026);
  - link share 16.67 / 25.64 / 25.64% and Reel share 45.83 / 70.51 / 70.51%
    (Socialinsider's format figures, as ratios);
  - link click 1 / 2.5 / 2.8% (Echobox publishers, a dated proxy; cautious is
    our assumption);
  - Messenger open 18 / 30 / 45% (vendor claims, proxy);
  - Page link 1 / 2 / 3% (the link-in-bio rule of thumb, used as a proxy);
  - new people each month 0 / 1.5 / 8%;
  - engagement benchmarks 0.25 / 0.21 / 0.17 / 0.15 / 0.125% (Reels figures
    scaled to all formats), scaling at most ×2;
  - comments per Reel viewer 0.46%, keyword factor ×2.0278.
- **Shared with the follower calculator:** visit to paid and cancellations
  come from the follower model, so one "Marketing estimates" change moves
  both.
- **Worked example:** 7,000 followers, AED 199, 4 link posts and 4 keyword
  Reels a month, 30% cancellations a year.
  - Strong case: fewer than 1 in the first month, 5 active after 12 months,
    AED 995 a month.
  - Typical: 2 active, AED 398. Cautious: fewer than 1.
  - Instagram's strong case with its own starting numbers gives about 116.
  - Each estimate is shown on its own and never added to the other: many
    people follow on both.

### `/methodology` section

`FacebookAssumptions` in `components/marketing/site.tsx`, anchor
`#facebook-assumptions`. It renders only while `availability.facebook` is
true. Until then `/methodology` is unchanged.

- **Contents:**
  - the version and the retrieval date;
  - every assumption with its label: `[Measured]`, `[Proxy]`,
    `[Vendor claim]`, `[Rule of thumb]` or `[Our assumption]`, combined with
    "; " where several apply;
  - its sources (links to the Sources list);
  - what is counted and what is not;
  - the research's honesty notes and source caveats;
  - a worked example computed live;
  - a change-log line.
- **Visit to paid:** its row reads the platform's follower model and is
  marked "Adjusted by the operator" when changed.
- **Sources:** the ten sources only this estimate cites
  (`FACEBOOK_ONLY_SOURCES`, in `packages/contracts/src/marketing-content.ts`)
  join the Sources list with the section, because their "Used for" lines
  give its figures. `llms-full.txt` leaves them out too until then.

## Checks

Package runs on 3 November 2026, as each package reported them:
- **Domain:** `tests/marketing-facebook-calculator.test.ts` 13 of 13; the
  source and Instagram tests unchanged (133 of 133 across 11 files).
- **API:**
  - `tests/facebook-api.test.ts` 8 of 8: routes, state, outcomes, the reader,
    error mapping, test mode, settings and saved-settings activation;
  - `tests/marketing-api.test.ts` 12 of 12, with the Instagram test mode;
  - `tests/platform-address-web.test.ts` 3 of 3.
- **Methodology and deletion instructions:** two tests in
  `tests/marketing-site.test.ts`:
  - "/methodology shows the Facebook Page estimate only once
    availability.facebook is on…": both states, every row labelled and
    sourced, model values, caveats, worked example, the operator mark and the
    site scans;
  - "the Facebook and Instagram data deletion instructions stay at…": anchor,
    content, contact both ways, `llms-full.txt` and copy limits.
  - Results: 10 files (`marketing-site`, `marketing-home`,
    `marketing-pricing`, `marketing-assistant`, `marketing-frontier`,
    `marketing-brain-pages`, `marketing-journey`, `brand`, `public-pages`,
    `discovery-seo`) gave 123 tests, 123 passed, 0 failed (197 s);
    `npx tsc --noEmit -p tsconfig.json` exited 0.
- **Trainer card and calculator:** `tests/trainer-growth.test.ts` (the UI
  package's).

These are the build's runs, before the review fixes of 3 November 2026
(events without numbers, saved numbers removable after access ends, 492,
`llms-full.txt` sources, the page order and wording). The runs after those
fixes, the full suite and the web build will be recorded in
`docs/COMPLETION_STAGES.md`.

## What waits

- **Owner, after deployment:** the Meta steps in
  [meta-app-review.md](meta-app-review.md), all in the one "trainsyou social
  login" app:
  - check its settings (configuration `1420000509847051` and both redirect
    URIs are already there);
  - enter the Super admin values;
  - one sign-in through each button;
  - one App Review request for `pages_show_list`, `pages_read_engagement`,
    `public_profile` and `instagram_business_basic`, and Business
    Verification once.
- **Owner, before the review request:** approve and publish a privacy
  policy paragraph on Facebook and Instagram data (proposed in
  meta-app-review.md, "Before you start").
- **Owner, before approval is recorded:** sign off the Facebook figures.
  Recording approval also publishes the `/methodology` section and shows
  Connect Facebook to every trainer.
- **To verify during the first successful sign-in** (open questions in Meta's
  docs):
  - whether comment totals on the Page's own posts need
    `pages_read_user_content` (not requested);
  - whether the callback gets `?code=` with
    `override_default_response_type=true`;
  - whether `/me/accounts` lists only the Pages ticked in the dialog;
  - whether the Pages use case asks for Tech Provider status;
  - the app's display name as Facebook and Instagram show it (probably
    "trainsyou social login"), since the deletion steps say "remove
    trainsyou".

  Details are in meta-app-review.md, "Open questions".
- **Not built:** reading real reach (`read_insights`, more review), revoking
  the grant after the read (`DELETE /me/permissions`, optional), and a data
  deletion callback.
