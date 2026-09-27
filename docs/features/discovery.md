# Public discovery and trainer-branded app install

Work package: `feat/discovery` (base `6fa8aba`), migration
`packages/db/migrations/059_public_discovery.sql`.

## Plan (written before implementation)

Existing code read first: `apps/web/proxy.ts` and `host-proxy.ts` (signed host
routing, custom-domain path rewriting), `apps/web/app/[[...path]]/page.tsx`
(server-rendered coach website and metadata), `apps/web/app/layout.tsx` and
`public/manifest.webmanifest` (fixed platform manifest with only an SVG icon),
`apps/api/src/host-routing.ts` (signed host proof and custom-domain mapping),
`apps/api/src/coach-site.ts` (public site, public site manifest and icon, owner
website editor, `trainer_brand_tenant()` owner check), `packages/contracts`
(`brandDesignSchema`, `resolveBrandDesign`), migration `018_brand_site.sql`
(RLS pattern for brand tables), `infra/runtime-role.sql` and
`scripts/verify-runtime-access.mjs`.

1. **One discovery predicate.** A SQL function `public_discovery_tenant(uuid)`
   (published and `lifecycle_state='active'`) is the only test used by the
   sitemap and directory queries. Workspace suspension from the governance
   package sets `lifecycle_state='suspended'`, which already fails it; any
   further exclusion (for example a moderation flag) is added by replacing this
   one function in a later migration.
2. **robots.txt / sitemap.xml** as Next metadata routes (`app/robots.ts`,
   `app/sitemap.ts`) that read the host from the proxy-set headers. The proxy
   passes `/robots.txt` and `/sitemap.xml` through unchanged on a custom domain.
   The platform sitemap lists marketing pages, the directory (when open) and
   the published site pages of discoverable coaches without a connected custom
   domain; a coach domain lists only its own published site pages. The API
   endpoint `GET /api/v1/public/discovery/sitemap` decides from the signed host.
   Private app, auth and API routes are disallowed in robots.txt, get
   `noindex` metadata, and the API and private web routes send
   `X-Robots-Tag: noindex, nofollow`.
3. **Opt-in directory.** New owner-only RLS table `coach_directory_profiles`
   (listed flag, specialties, languages, version). Owner reads and saves it
   from the website editor (`GET/PUT /api/v1/tenant/directory`), with an audit
   event. Public `GET /api/v1/public/directory` (platform host only) lists
   discoverable, opted-in coaches: name, headline, photo, specialties,
   languages and site link; text search and specialty/language filters; no
   member data. Server-rendered page `/coaches`. A Super admin switch
   `COACH_DIRECTORY_ENABLED` (default on) can close the directory.
4. **Trainer-branded install for members.** `GET /api/v1/app/install` and
   `GET /api/v1/app/manifest.webmanifest` return the workspace's name, short
   name, Design Studio colours and icons to any signed-in member, published or
   not; anonymous requests get the platform manifest (never a 404). Icons are
   served from `GET /api/v1/app/icons/:key/:file` at exactly 180, 192 and 512
   pixels (plus a maskable 512), where `:key` is a random per-workspace
   capability stored in a system-only table `workspace_app_icons`, so the icon
   works even when a browser fetches it without cookies and is never
   discoverable for unpublished workspaces. The workspace shell mounts a new
   `MemberAppManifest` component that swaps the manifest (with
   `crossorigin="use-credentials"`), icons and theme colour. The platform
   manifest gains PNG icons at real sizes.

## What was built

### Super admin

- **Directory switch.** New application setting `COACH_DIRECTORY_ENABLED`
  ("Open the public coach directory", boolean, default `true`) in
  `packages/providers/src/configuration.ts`. It appears in Settings and API
  connections with the other application switches, and its changes are in the
  existing settings change history. When it is `"false"`: `/coaches` returns
  404, `GET /api/v1/public/directory` answers 404 `DIRECTORY_UNAVAILABLE`, the
  platform sitemap omits `/coaches`, and trainers see "The platform directory is
  closed right now. Your choice is saved and applies when it reopens." Trainers'
  choices are kept.
- **Suspension hook.** `public_discovery_tenant(uuid)` (migration 059) is the
  single predicate for the directory and both sitemaps
  (`discoverable()` in `apps/api/src/discovery.ts` emits it). A workspace that
  is unpublished, closed or suspended (`lifecycle_state<>'active'`) is excluded.
  It is an invoker-rights SQL function, not executable by `PUBLIC`, and granted
  to `trainer_service` in `infra/runtime-role.sql`; the runtime verifier checks
  exactly that.
- **Search-engine hygiene for the platform.** `robots.txt` on the platform
  address disallows `/api/`, `/app`, `/trainer`, `/admin`, `/login`, `/signup`,
  `/join/`, `/join-coach/`, `/forgot-password`, `/reset-password/`,
  `/verify-email/`, `/magic-link` and `/recover-authenticator`, and names
  `<origin>/sitemap.xml`. Those pages also render
  `<meta name="robots" content="noindex, nofollow">` and the web server sends
  `X-Robots-Tag: noindex, nofollow` for them (`next.config.ts`). API responses
  now carry `X-Robots-Tag: noindex, nofollow`, set at the start of the existing
  security-header `onRequest` hook in `apps/api/src/app.ts` (so it also covers
  error responses raised after that point). Unknown platform paths are also
  `noindex`.
- **Platform manifest.** `public/manifest.webmanifest` now lists real PNG icons
  (`/icons/icon-192.png`, `/icons/icon-512.png`, maskable
  `/icons/maskable-512.png`) plus the SVG, and `layout.tsx` adds a 192 PNG
  favicon, a 180×180 `apple-touch-icon` and `theme-color`. The file is kept
  identical to `platformManifest()` in `packages/contracts/src/discovery.ts` by
  a test.

### Trainer (workspace owner)

- **Directory listing in website settings.** Below the website editor
  (`/trainer/website`) a "Public coach directory" card
  (`apps/web/components/directory-listing.tsx`) lets the owner list or unlist
  the practice, choose up to 6 specialties and up to 8 coaching languages, and
  see a preview card. It is off by default. States: not listed, waiting for
  launch (saved but storefront not launched), directory closed, listed (with a
  link to `/coaches`). Listing requires at least one specialty and one language.
- API: `GET /api/v1/tenant/directory` and `PUT /api/v1/tenant/directory`
  (`{version, listed, specialties[], languages[]}`), owner role only (staff,
  finance and subscribers get 403), inside the owner's tenant transaction with
  the existing `trainer_brand_tenant()` check, the global origin check,
  optimistic revision (`409 DIRECTORY_CHANGED`) and an advisory lock. Each save
  writes a `directory.listing_updated` event (listed, specialties, languages,
  version) to the workspace event log.
- Vocabulary (fixed, in `packages/contracts/src/discovery.ts`): 15 specialties
  (strength, weight loss, muscle gain, general fitness, running and endurance,
  HIIT and conditioning, functional and hybrid, mobility, yoga, pilates, boxing
  and martial arts, sports performance, pre and postnatal, active ageing,
  nutrition habits) and 17 languages (English, Arabic, Hindi, Urdu, Malayalam,
  Tamil, Filipino, Bengali, Persian, Turkish, French, German, Spanish, Italian,
  Portuguese, Russian, Chinese). The database checks shape and counts; the API
  checks the vocabulary.
- **Branded app for the trainer's team.** Owners, staff and finance members
  get the branded manifest too, with `start_url` `/trainer`.
- **Coach domain crawler files.** On a connected custom domain `robots.txt`
  names that domain's sitemap and also disallows `/coaches`; `sitemap.xml`
  lists only that coach's published pages (`/`, `/about`, `/memberships`,
  `/galleries` when a website gallery exists, `/contact` and each visible
  custom page) with the website's publish time as `lastmod`.

### Follower (subscriber) and visitors

- **Find a coach.** `/coaches` on the platform address
  (`apps/web/components/coach-directory.tsx`, server-rendered, plain GET form,
  works without client JavaScript) lists published, opted-in, active coaches:
  name, headline (published website headline, else the Design Studio headline
  or tagline), photo (Design Studio photo or logo, else initials), specialty
  tags, languages and a "Visit website" link (the connected custom domain when
  there is one, else `/coach/<slug>`). Search by name or headline (wildcards
  are matched literally), filter by specialty and language, 24 per page with
  previous/next links. Empty and no-match states are explained. No member
  count, revenue, email or any follower data is returned. A "Find a coach" link
  was added to the marketing header. Filtered or paged directory views are
  `noindex, follow`; the plain page has an absolute canonical URL. Unknown
  filters show a "That search could not be read" notice instead of an error.
- **Trainer-branded install before publishing.** When a signed-in member opens
  the app, `MemberAppManifest` (`apps/web/components/member-app-install.tsx`,
  mounted once in `workspace.tsx` outside `/admin`) fetches
  `/api/v1/app/install` and points `link[rel=manifest]` at
  `/api/v1/app/manifest.webmanifest` with `crossorigin="use-credentials"`, the
  `apple-touch-icon` at the 180 px icon, the favicon at the 192 px icon, and
  `theme-color` and `apple-mobile-web-app-title` at the workspace's values. The
  manifest has the workspace name, a short name (whole leading words up to 12
  characters), Design Studio `theme_color` (primary) and `background_color`
  (surface), `id` `/coach/<slug>`, `start_url` `/app` for subscribers, and
  192/512/maskable-512 icons. This works whether or not the storefront is
  published; the public website manifest and icon still return 404 until
  launch. It replaces the previous subscriber-only `ClientCoachManifest` mount,
  which only branded published workspaces.
- Icons are rendered by `renderAppIcon()` at exactly the declared size, always
  opaque: a platform-hosted logo is inset on the Design Studio surface colour
  (inside the maskable safe zone for the maskable icon), otherwise initials on
  the primary colour. A damaged stored logo falls back to initials. A design or
  name change produces new icon addresses (`?v=<revision>`), so installed apps
  refresh. Icons load without cookies from a random per-workspace key and are
  never listed publicly; on a coach domain only that workspace's icons are
  served; a closed or suspended workspace's icons return 404.
- Anonymous visitors, and members whose workspace is no longer active, keep the
  platform manifest: the member manifest endpoint answers the platform manifest
  (200, `Vary: Cookie`) instead of an error.

## Routes

| Route | Who | Notes |
| --- | --- | --- |
| `GET /robots.txt` (web) | anyone | per host; platform or coach domain |
| `GET /sitemap.xml` (web) | anyone | from `GET /api/v1/public/discovery/sitemap` |
| `GET /coaches` (web) | anyone | platform address only; 404 when closed |
| `GET /api/v1/public/discovery/sitemap` | anyone | signed host decides platform or coach domain |
| `GET /api/v1/public/directory?q=&specialty=&language=&offset=` | anyone | platform host only; strict query validation |
| `GET/PUT /api/v1/tenant/directory` | owner | revisioned, audited |
| `GET /api/v1/app/install` | signed-in member | 401 otherwise |
| `GET /api/v1/app/manifest.webmanifest` | anyone | member manifest, else platform manifest |
| `GET /api/v1/app/icons/:key/:file` | holder of key | `180.png`, `192.png`, `512.png`, `maskable-512.png` |

## Migration 059 and grants

- `public_discovery_tenant(uuid)`: STABLE SQL, invoker rights, `REVOKE ALL ...
  FROM PUBLIC`; `GRANT EXECUTE ... TO trainer_service` in `infra/runtime-role.sql`.
- `coach_directory_profiles` (tenant-scoped): RLS enabled and forced; owner
  `FOR ALL` policy scoped to `app.tenant_id`/`app.role='owner'`; `service_read`
  for the service role; `trainer_app` has SELECT, INSERT, UPDATE (no DELETE);
  `trainer_service` has SELECT only. Checks: at most 6 specialties and 8
  languages of the right shape, `listed` iff `listed_at`, and a listed row
  needs one of each.
- `workspace_app_icons` (system-only): RLS enabled and forced with a
  service-only policy, no `trainer_app` access; `trainer_service` has SELECT and
  INSERT.
- `scripts/verify-runtime-access.mjs` classifies both tables, asserts tenant
  actors cannot read `workspace_app_icons`, plans a tenant read of
  `coach_directory_profiles`, and checks the predicate's grants.

## Checks actually run

All with Node 24 (`/opt/node24/bin/node`).

- Typecheck: `node node_modules/typescript/bin/tsc --noEmit` passed (no errors).
- New tests on embedded PGlite:
  `node --import tsx --test --test-concurrency=1 tests/discovery-directory.test.ts tests/discovery-seo.test.ts tests/discovery-install.test.ts`
  18 tests, 18 passed, 0 failed (5 directory, 8 SEO, 5 install).
- Same three files in the restricted-role PostgreSQL sandbox:
  `/opt/tools/pg-sandbox.sh 56116 <worktree> tests/discovery-directory.test.ts tests/discovery-seo.test.ts tests/discovery-install.test.ts`
  runtime access verified (`migrations 46, systemTables 38, scopedTables 33,
  helpers 9`), 18 passed, 0 failed, `PG_SELECTED_FAILED_FILES=0`.
- Related existing suites on PGlite: `tests/fix-web.test.ts`,
  `fix2-web`, `fix-edge`, `fix2-edge-deploy`, `host-routing`, `coach-site`,
  `provider-configuration`, `settings-runtime`: 56 passed, 0 failed;
  `account-completion`, `integrations-completion`, `fix-settings`,
  `platform-settings`: 46 passed, 0 failed.
- Related suites in the sandbox: `coach-site` 12/12, `fix-web` 11 passed and 1
  skipped (the existing embedded-only migration replay), `host-routing` 6/6,
  `fix-settings` 5/5; `PG_SELECTED_FAILED_FILES=0`.
- Local smoke run (API on PGlite and `next dev`, loopback only, stopped
  afterwards): `/robots.txt` and `/sitemap.xml` rendered per request with the
  expected rules and URLs; `/coaches` rendered (empty state, then a listed
  coach, filtered view `noindex, follow`, bad filter notice); `/login`, `/app`
  and an unknown path had `noindex, nofollow` meta and the private ones the
  header; the member manifest and a 180×180 PNG icon were served through the
  web proxy; a local headless Chromium (not a cloud browser) confirmed that the
  signed-in app swapped in the member manifest with `use-credentials`, the
  apple icon and theme colour, that saving the directory card worked and the
  coach then appeared in `/coaches?specialty=yoga`, that anonymous visitors kept
  `/manifest.webmanifest`, that neither page overflowed at 390 px, and no
  console errors. `next build` and the whole test suite were not run (left to
  the coordinator's gates).

## Left out, and why

- **Per-listing moderation by the Super admin** (hide one coach without
  suspending the workspace): not in this package's requirements; the platform
  switch and workspace suspension cover removal. A moderation flag can be added
  in one place by replacing `public_discovery_tenant()`.
- **Canonical link from `/coach/<slug>` to a connected custom domain**: the
  platform sitemap already omits coaches with a connected domain, but their
  platform-address pages remain crawlable; adding a canonical would need the
  public site response to expose the domain (a change to `coach-site.ts`).
- **Sitemap index** for very large catalogues: one sitemap is capped at 45,000
  URLs and 1,000 coach websites; beyond that an index would be needed.
- **Translated directory labels**: labels are English; the CSS uses logical
  properties for a later right-to-left pass.
- **Per-coach opt-out from search engines** for a published website: a
  published website is public and listed in the sitemap; there is no separate
  "hide from search engines" setting.
- No worker job is needed: sitemaps, the directory and icons are computed per
  request from current data.
