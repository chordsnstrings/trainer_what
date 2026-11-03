# Meta app review: the owner's checklist (Connect Facebook and Connect Instagram)

**When:** only after the Connect Facebook code is deployed to trainsyou.com.
The owner said on 3 November 2026: "once done do this. don't do it before
actually completing the code". Deployment is assigned separately.

**Who:** the owner, or whoever has access to the Meta App Dashboard and
Super admin. This environment has no Meta, DigitalOcean or Super admin
access.

**Secrets:** whoever has dashboard access copies the two secrets (the App
secret and the Instagram App Secret) from the Meta App Dashboard straight
into Super admin. Never put a secret in chat, email, a document or the
repository.

**One Meta app (owner, 3 November 2026):**
- Connect Facebook and Connect Instagram both live in the
  **"trainsyou social login"** Meta app, Meta App ID `2335071867263863`.
- Instagram is in that app with Instagram App ID `2881563462229057`.
- Facebook Login for Business is already in it, with configuration
  `1420000509847051`.
- Both redirect URIs are already registered.
- The other Meta app, App ID `1653212959862915`, is not used by the
  product. Nothing needs doing there, and its ID does not go into Super
  admin.

What the code does is in [facebook-connect.md](facebook-connect.md).

| | Connect Facebook | Connect Instagram |
| --- | --- | --- |
| Where in the app | Facebook Login for Business | Instagram → API setup with Instagram login |
| ID to enter in Super admin | Meta App ID `2335071867263863` | Instagram App ID `2881563462229057` |
| Secret to paste in Super admin | App secret (App settings → Basic) | Instagram App Secret (Business login settings) |
| Login configuration | `1420000509847051` (already created) | none |
| Super admin entry | Facebook Pages (follower estimates) | Instagram (follower estimates) |
| Redirect URI (already registered) | `https://trainsyou.com/api/v1/trainer/facebook/callback` | `https://trainsyou.com/api/v1/trainer/instagram/callback` |
| Permissions in the one review request | `pages_show_list`, `pages_read_engagement`, `public_profile` | `instagram_business_basic` |
| Privacy policy URL (once for the app) | `https://trainsyou.com/privacy` | the same |
| Data deletion instructions URL (once for the app) | `https://trainsyou.com/security-and-privacy#facebook-instagram-data` | the same |

## Why the order matters (Meta's rules, from developers.facebook.com, 3 November 2026)

- **Who can sign in before review:** a Business-type app has no Development
  or Live switch; access levels alone decide that. Every permission starts
  with Standard Access, which only people with a role on the app (App roles →
  Roles) can grant. Advanced Access, needed for every other trainer, takes
  App Review plus Business Verification ("Business Verification is required to
  get Advanced Access").
- **A call before review:** Meta wants a successful call through the real
  button before it accepts an App Review request. The code's test mode allows
  that: only the coach addresses you list can connect before approval.
  Public pages make no claim that Facebook is available until approval;
  Instagram keeps its "Available soon" in the FAQ.
- **One app, one review:** Facebook's and Instagram's permissions are in the
  same app, so they go into one App Review request. Business Verification,
  the privacy policy, the icon and the category are also set once. The IDs
  and secrets still differ: Facebook uses the Meta App ID and the App secret;
  Instagram uses its own Instagram App ID and Instagram App Secret.
- **Permissions for Page numbers:** `pages_show_list` and
  `pages_read_engagement`, plus Advanced Access to `public_profile`. The Login
  for Business FAQ says the latter "is required … before they go live".
  - **Not `email`:** trainsyou has no "Sign in with Facebook" button, and we
    never read an email address from Facebook. `email` exists for such a
    button. Meta rejects requests for permissions the app does not use.
  - **Nothing else:** asking for unused permissions is the most common
    rejection, so no `business_management`, `pages_manage_*`, `read_insights`
    or `pages_read_user_content`, and no Page Public Content Access.
- **Data deletion:** an instructions URL is enough. Meta: "Developers need to
  specify either a data deletion callback instruction URL or a callback URL".
  No callback endpoint is built.
- **Redirect URIs:** Strict Mode is required for all apps. The redirect URI
  must match an entry exactly (scheme, host, path, no trailing slash, no extra
  query).

## Before you start

- [ ] The new code is live:
  - `https://trainsyou.com/security-and-privacy#facebook-instagram-data`
    shows "Your Facebook and Instagram data";
  - Super admin → Settings lists **Facebook Pages (follower estimates)**.
- [ ] Your accounts:
  - an administrator role on the "trainsyou social login" Meta app;
  - a Facebook account with full control of a Facebook Page (the Page you
    will connect);
  - an Instagram professional (business or creator) account.
- [ ] Your coach address: the workspace name in your address, such as
  `layla-strength` in `layla-strength.trainsyou.com` or
  `trainsyou.com/coach/layla-strength`.
- [ ] A trainer account for Meta's reviewers:
  - a fresh email you control;
  - make sure it can sign in with email and password alone (reviewers cannot
    use your authenticator app or passkey);
  - note its coach address too.
- [ ] The privacy policy (`https://trainsyou.com/privacy`):
  - Meta asks every app's privacy policy to say what it does with the data
    and how people can have it deleted.
  - The policy the repository publishes (7 October 2026,
    `docs/legal/uae-2026-10/privacy.en.md`, migration
    `090_publish_uae_policies.sql`) does not mention Facebook or Instagram.
  - `/privacy` is a versioned legal document, so the code does not change it.
    Publish a new version yourself, before you submit: Super admin →
    Published documents and templates → Legal document, key `privacy`.
  - **Proposed paragraph** (not applied; approve or change it first). It
    could go under section 2, "Information we receive":

    > **Facebook and Instagram (optional).** A trainer may connect their own
    > Facebook Page or Instagram professional account to fill the growth
    > estimate on their Followers and growth page. Each time they connect,
    > we read the follower count and the engagement totals of up to 12
    > recent posts once, then discard the access. We keep only these details
    > for the trainer's workspace: the Page or account name and account
    > type, followers, Page likes, post counts, average engagement, how many
    > Pages were shared and when we read them. They are used only to show
    > the trainer these numbers and the estimate. We never keep an access
    > token, user ID or Page ID, and we never fetch post content or who
    > reacted or commented. The trainer can delete these details at any time
    > with Remove saved numbers, and closing the workspace deletes them too.
    > How to delete them, and how to remove our app in Facebook's or
    > Instagram's settings:
    > https://trainsyou.com/security-and-privacy#facebook-instagram-data

## (a) Facebook Login for Business in the "trainsyou social login" app

Facebook Login for Business, its configuration and the redirect URI are
already set up (owner, 3 November 2026), so most steps are checks.

1. [ ] Open the app at developers.facebook.com/apps and check it is a
   **Business** type app: no Development/Live switch, and the App ID
   `2335071867263863` at the top. The Instagram product needs a Business
   app, so it should be one.
2. [ ] Check that **Facebook Login for Business** is in the app (Use cases,
   or the products in the left menu).
   - Business apps get it automatically and cannot use classic Facebook
     Login.
   - If the dashboard added the "Manage everything on your Page" use case, it
     also adds `business_management` by default. Keep that out of the login
     configuration and out of the review, if the dashboard allows.
3. [ ] Facebook Login for Business → **Configurations:** open configuration
   `1420000509847051` and check:
   - Access token type: **User access token**. Not "System-user access
     token", which is for continuous automated access.
   - Assets: **Pages**.
   - Permissions: **pages_show_list** and **pages_read_engagement** only.
   - If anything differs, fix it, or create a configuration with these
     settings and enter its ID in step 8 instead.
4. [ ] Facebook Login for Business → **Settings → Client OAuth settings:**
   - Client OAuth login **On**, Web OAuth login **On**, Enforce HTTPS **On**,
     Use Strict Mode for redirect URIs **On**.
   - **Valid OAuth Redirect URIs:** already registered. Check it reads
     exactly `https://trainsyou.com/api/v1/trainer/facebook/callback`, and
     press **Check URI** to confirm it is valid.
   - Embedded browser OAuth and Login with the JavaScript SDK can stay off.
   - Deauthorize callback URL: leave empty (no token is kept).
   - If a **Data Deletion Request URL** field is offered here and accepts an
     instructions page, use the deletion instructions URL. Otherwise set it in
     step 5.
5. [ ] **App settings → Basic** (once for the whole app, Instagram
   included):
   - **Display name:** probably "trainsyou social login". People see this
     name in Facebook's Business integrations and Apps and websites. The
     deletion instructions tell them to remove "trainsyou". Tell Claude the
     exact name before submitting, so the public step can match it.
   - **App domains:** `trainsyou.com`.
   - **Privacy policy URL:** `https://trainsyou.com/privacy`.
   - **Terms of service URL** (optional): `https://trainsyou.com/terms`.
   - **User data deletion:** choose "Data deletion instructions URL", then
     `https://trainsyou.com/security-and-privacy#facebook-instagram-data`.
   - **App icon:** 512–1024 px, under 5 MB.
   - **Category:** the closest fit, for example Health and fitness.
   - **Contact email:** yours. Add a Data Protection Officer only if you do
     business in the EU.
   - Save changes.
6. [ ] **Business Verification** (once for the app): start at App settings →
   Basic → Verification and finish in Meta Business Manager.
   - If the business portfolio is already verified, connect the app to it.
   - It can take days, so start early.
7. [ ] **App roles → Roles:** add anyone who will test (Administrator,
   Developer or Tester). Each one accepts the invitation, and each needs a
   Facebook account with full control of a Page.
8. [ ] **Super admin → Settings → Facebook Pages (follower estimates):**
   - **Meta App ID:** `2335071867263863`.
   - **Meta App Secret:** App settings → Basic → App secret → Show. Whoever
     has dashboard access pastes it here, and only here.
   - **Redirect URI:** `https://trainsyou.com/api/v1/trainer/facebook/callback`
     (the same as in step 4).
   - **Facebook Login for Business configuration ID:** `1420000509847051`.
   - **Meta app review approved for pages_show_list and
     pages_read_engagement:** leave **off**.
   - **Before app review: coach addresses that may connect:** your coach
     address. Add the reviewers' test trainer's before you submit the
     review, comma-separated (for example `layla-strength, meta-review`).
   - **Save**, then **Test connection**. Expect "Configuration validated …
     only the listed coach addresses can connect, and only people with a role
     on the Meta app can complete the sign-in. Public pages make no
     availability claim until approval."
   - Then **Enable integration**.
   - Test connection does not call Meta. A wrong ID or configuration only
     shows up in the sign-in in (c).

## (b) Instagram in the same app: Instagram App ID 2881563462229057

1. [ ] In the same app, open **Instagram → API setup with Instagram login →
   Business login settings:**
   - **OAuth redirect URIs:** already registered. Check it reads exactly
     `https://trainsyou.com/api/v1/trainer/instagram/callback`.
   - Check that the Instagram App ID shown is `2881563462229057`.
   - The Instagram App Secret is on the same page. It is not the App secret
     from (a), and it goes only into Super admin's Instagram entry.
   - Instagram has its own deauthorize and data deletion request fields,
     which expect callback endpoints. No callback is built, so leave them
     empty, or as they are if already filled. If the dashboard or the review
     insists on one, tell Claude.
2. [ ] Nothing more in App settings → Basic or Business Verification: (a)
   did both for the whole app.
3. [ ] **App roles → Roles:** if the dashboard offers Instagram testers, add
   the Instagram professional account you will connect. Accept the invitation
   in Instagram's settings under Apps and websites.
4. [ ] **Super admin → Settings → Instagram (follower estimates):**
   - **Instagram app ID:** `2881563462229057`;
   - **Instagram app secret:** the Instagram App Secret from step 1, pasted
     by whoever has dashboard access. Re-paste it only if you are unsure the
     saved one is current;
   - **Redirect URI:** `https://trainsyou.com/api/v1/trainer/instagram/callback`;
   - **Meta app review approved for instagram_business_basic:** **off**;
   - **Before app review: coach addresses that may connect:** your coach
     address, and the reviewers' before you submit.
   - Save, Test connection ("Configuration validated … Public pages keep
     saying available soon."), then Enable integration if it is not already
     on.

## (c) One successful sign-in through each button

Do this on `https://trainsyou.com`, not on a coach's own domain: connecting
is refused there. Sign in as yourself (your coach address is on both lists).
Use a Facebook and Instagram login that has a role on the app.

1. [ ] Open **Grow** (Followers and growth) and expand **Explore a growth
   estimate**. Connect Facebook sits right under Connect Instagram, and the
   two estimates follow. Each card shows "Testing before Meta review: only
   people with a role on the Meta app can finish connecting."
2. [ ] **Connect Instagram.** Instagram asks you to sign in and allow access.
   **Success:**
   - you return to Followers and growth with "Instagram connected. We read
     your follower count and recent likes and comments once; access was not
     kept.";
   - the card shows `@username: N followers, X% average engagement over 12
     recent posts. Read on <date>.`;
   - the follower calculator is filled ("From @username").
3. [ ] **Connect Facebook** (card "Your Facebook Page numbers"). Facebook's
   dialog asks which Pages to share and lists the two permissions. Keep both
   on, then continue. **Success:**
   - you return with "Facebook connected. We read your Page's follower count
     and recent reactions, comments and shares once; access was not kept.";
   - the card shows `From your Page <name>: N followers, X% average engagement
     over 12 recent posts. Read on <date>.`;
   - the Facebook estimate, after Instagram's, is filled from them.
4. [ ] **If anything other than "connected" comes back**, note the message and
   tell Claude; see "Open questions" below. The possible results are
   declined, expired, unavailable, permissions required, no Page, Page access
   required, busy and failed.
5. [ ] **Check Meta's counter:** App Review → Permissions and Features should
   count the calls for `pages_show_list`, `pages_read_engagement` and
   `instagram_business_basic`. The counter may take a while to update.
6. [ ] **Try Remove saved numbers once** on each card. The numbers disappear
   at once. Connect again before recording, so the recording shows a fresh
   connection.

## (d) The App Review request (one, in the same app)

Submit one request in the "trainsyou social login" app: Review → App Review
→ Requests, then add the permissions. Request Advanced Access for:
- `pages_show_list`, `pages_read_engagement` and `public_profile` (Connect
  Facebook);
- `instagram_business_basic` (Connect Instagram).

Each permission gets its own usage text and a recording (below). Advanced
Access needs the Business Verification from (a).

**Why not `email`:** trainsyou has no "Sign in with Facebook" button.
Trainers sign in with their trainsyou account, and we never read an email
address from Facebook. Meta rejects requests for permissions an app does not
use, so asking for `email` would put the whole request at risk.

**The other app:** App ID `1653212959862915` is not used by the product.
Submit nothing there.

### Reviewer instructions (paste into the request; fill in the login)

> trainsyou is a coaching platform for personal trainers in the UAE. A
> trainer (the workspace owner) can connect their own Facebook Page or
> Instagram professional account. We read its follower count and the
> engagement totals of its recent posts once, to fill an estimate of how many
> coaching subscribers sharing their link could bring. We keep only those
> numbers; no access token is stored.
>
> Test login: https://trainsyou.com/login. Email: <reviewer trainer email>.
> Password: <password>. This account is enabled for the connection before
> approval.
>
> 1. Sign in at https://trainsyou.com/login with the details above.
> 2. In the menu open Grow (Followers and growth), then expand "Explore a
>    growth estimate".
> 3. Facebook: in "Your Facebook Page numbers", under the Instagram card,
>    choose Connect Facebook. Sign in to Facebook, choose a Page you manage,
>    keep both permissions on and continue. Instagram: choose Connect
>    Instagram and sign in with an Instagram professional account.
> 4. You return to Followers and growth. The card shows the Page name or
>    username, the follower count and the average engagement over up to 12
>    recent posts. The estimates further down (Instagram's, then Facebook's)
>    are filled from them.
> 5. Choose Remove saved numbers to delete them at once.
>
> Data deletion instructions:
> https://trainsyou.com/security-and-privacy#facebook-instagram-data

### How each permission is used (one per permission field)

- **pages_show_list:**
  > When a trainer chooses Connect Facebook, we call GET /me/accounts (at
  > most two pages of 25) to list the Facebook Pages they shared in the
  > dialog, with each Page's name, tasks, follower count and Page access
  > token. We use the Page they can moderate with the most followers and
  > show its name on their Followers and growth page. Its Page token is used
  > once, in the same request, to read that Page's numbers and is then
  > discarded. We keep only the chosen Page's name and how many Pages were
  > shared. No Page ID, user ID or token is stored.
- **pages_read_engagement:**
  > With the chosen Page's token we read the Page's follower count
  > (followers_count, fan_count) once. We also read the reaction, comment and
  > share totals of its 12 most recent published posts, as summary counts
  > only: we never fetch who reacted or commented, or the post text. We work
  > out the average engagement rate and show it with the follower count to
  > the Page's admin on their Followers and growth page. There it fills an
  > estimate of how many coaching subscribers sharing their link could bring.
  > Only these numbers are stored, for the trainer's workspace, and the
  > trainer can remove them at any time.
- **public_profile:**
  > Included with every Facebook Login for Business sign-in. We use it only to
  > complete the sign-in; we do not read or store any profile field.
- **instagram_business_basic:**
  > When a trainer chooses Connect Instagram, we read their professional
  > account's username, account type, follower count and media count once,
  > and the like and comment counts of their 12 most recent posts. We work out
  > the average engagement rate and show it with the follower count on their
  > Followers and growth page, where it fills the follower estimate. We store
  > only those numbers, the username and the account type for the trainer's
  > workspace; no token or Instagram user ID is kept, and the trainer can
  > remove them at any time.

### Screen recordings (two, attached per permission)

Meta asks for a recording with each permission and wants to see the whole
flow. Attach the Facebook recording to each of its three permissions, and
the Instagram recording to `instagram_business_basic`.

- **Format:** 1080p if possible, no sound needed. Add short captions on
  screen, or describe each step in the request's notes.
- **Privacy:** use test data where you can, and show nothing secret.
- **Language:** keep the browser in English. Meta asks for screens in
  English, or captions.

**Facebook recording (covers all three permissions):**
1. Start on `https://trainsyou.com/login` with the address bar visible, and
   sign in as the test trainer.
2. Open Grow → Followers and growth and expand Explore a growth estimate.
   Show the empty "Your Facebook Page numbers" card, right under Instagram's.
3. Choose **Connect Facebook**. Show Facebook's dialog: the account, the Page
   selection ("Choose the Pages …") and the permissions screen. Keep both on,
   then continue.
   - This shows the login and the grant: `pages_show_list`, "the pages owned
     by the user are successfully connected".
4. Back on trainsyou, pause on the "Facebook connected" message and the card
   (`From your Page <name>: N followers, X% average engagement over 12 recent
   posts`).
   - This shows the Page's engagement read and displayed:
     `pages_read_engagement`.
5. Scroll past the Instagram estimate to the Facebook estimate. Show the
   followers and engagement filled "From your Page <name>". Change "Posts
   with your link each month" and show the estimate update.
6. Choose **Remove saved numbers** and show the card empty again.
7. Optional: open the deletion instructions URL, then Facebook → Settings →
   Business integrations → the app → Remove.

**Instagram recording:**
1. Sign in as above.
2. Choose **Connect Instagram**, sign in to Instagram and allow access.
3. Back on trainsyou: "Instagram connected" and
   `@username: N followers, X% average engagement`.
4. The follower calculator filled "From @username", with one input changed to
   show it update.
5. Remove saved numbers.

**Risk to know:** Meta's text for `pages_read_engagement` asks the recording
to show "a post's content … successfully displayed". We display the Page's
engagement totals, not post content. The recording and the usage text must
make clear that the Page admin sees their Page's metadata and engagement
numbers in our app, which is an allowed use ("get metadata about your Page").
If Meta pushes back, tell Claude rather than adding a feature for the review.

## (e) After approval

1. [ ] **Facebook:** once all three permissions show Advanced Access and
   Business Verification is complete:
   - sign off the Facebook figures (version `2026-11-03`; Claude shows them on
     request);
   - only then set **Meta app review approved for pages_show_list and
     pages_read_engagement** to on (Super admin → Settings → Facebook Pages);
   - Save, Test connection.
   - From that moment every trainer sees Connect Facebook and the estimate,
     and `/methodology` shows the Facebook section with its sources (also
     listed in `llms-full.txt` from then on).
2. [ ] **Instagram:** once `instagram_business_basic` shows Advanced Access,
   set **Meta app review approved for instagram_business_basic** to on. Save
   and Test connection.
3. [ ] **Test lists:** clear them if you like. After approval they are
   ignored.
4. [ ] **The reviewers' trainer account:** remove it, or keep it for later
   reviews.
5. [ ] **Every year:** Meta's Data Use Checkup for apps with Advanced Access.
   Keep the privacy policy and deletion instructions URLs working.
6. [ ] **Meta's deletion list** (App settings → Advanced → User Data Deletion
   Requests, every 21 days): nothing to do. We store no Facebook user IDs, and
   Meta says "You can disregard user IDs that do not currently appear in your
   database".
7. [ ] **If the platform address ever changes:** in the Meta app, update both
   redirect URIs, the privacy policy URL and the deletion instructions URL;
   then both Super admin redirect URIs ([infra-ops.md](infra-ops.md), "After
   a successful move").

## Open questions to check during the first sign-in

Meta's documentation leaves these open (research, 3 November 2026). Tell
Claude what you saw.

1. **Comments may need `pages_read_user_content`.** Facebook may end with
   "Your access to that Page doesn't let us read its numbers" although you
   have full control of the Page. Comment totals on the Page's own posts
   probably need that permission too. The Page reference lists it next to
   `pages_read_engagement`; the comments edge says the parent's permissions
   suffice. It is not requested now. Adding it means a code change and a
   review entry.
2. **The code may not come back.** Facebook returns straight away with
   "connection expired" or "not connected" right after you allowed it. The
   login address sends `override_default_response_type=true` so the callback
   gets a code. Meta documents this only for system-user configurations.
3. **The wrong Page may be read.** If you shared several Pages, the card
   names the one used ("the Page with the most followers of the N you
   shared"). It may not be clear whether Facebook lists only the Pages ticked
   in the dialog.
4. **Tech Provider:** if the dashboard asks you to "Become a Tech Provider"
   for the Pages use case, ask Claude before submitting. It is unclear
   whether a trainer's own Page counts.
5. **Cancel:** choosing Cancel in Facebook's dialog should return "Facebook
   was not connected". Meta's documented cancel return carries no state, and
   the code accepts that.
6. **Display names:** the deletion instructions tell people to remove
   "trainsyou". Note the name Facebook (Business integrations) and Instagram
   (Apps and websites) actually show, probably "trainsyou social login", so
   the public steps can match it.
7. **Instagram's deletion field:** if the review requires Instagram's data
   deletion request URL (a callback) and not the app-level instructions URL,
   a small callback endpoint would be needed.

## Sources

Meta for Developers, retrieved 3 November 2026:
- [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business): configurations, `config_id` in place of `scope`, Advanced Access to `public_profile`.
- [Manually Build a Login Flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow): the dialog, the code exchange, the identical redirect URI.
- [Permissions Reference](https://developers.facebook.com/docs/permissions): `pages_show_list`, `pages_read_engagement`, the screencast requirements and allowed uses.
- [Access Levels](https://developers.facebook.com/documentation/development/graph-api/overview/access-levels) and [App Types](https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/app-types): Standard and Advanced Access; Business apps.
- [Business Verification](https://developers.facebook.com/documentation/development/release/business-verification).
- [Data Deletion Callback](https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/data-deletion-callback) and [App Dashboard Basic Settings](https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/basic-settings): an instructions URL or a callback; icon, category, privacy policy.
- [Facebook Login Security](https://developers.facebook.com/docs/facebook-login/security): Strict Mode and exact redirect URIs.
- [Pages API use case customization](https://developers.facebook.com/documentation/development/create-an-app/pages-use-case): `business_management` added by default; Tech Provider.
- [Instagram Platform Overview](https://developers.facebook.com/docs/instagram-platform/overview) and [Business Login for Instagram](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login): the Meta App ID for Facebook Login for Business and a separate Instagram App ID and secret in the same app, Instagram's own redirect URIs.
- [Graph API changelog, version 26.0](https://developers.facebook.com/docs/graph-api/changelog/version26.0): the pinned version.
