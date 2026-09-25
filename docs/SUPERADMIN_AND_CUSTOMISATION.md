# Superadmin settings, trainer design and meal capture

Application implementation: 25 September 2026. Deployment is stopped at the owner's request and belongs to the separate Claude handoff. These instructions do not launch infrastructure or enable live transactions.

## First Superadmin

The host still needs its PostgreSQL runtime connection, migration connection, exact `PUBLIC_APP_URL` and `SECURITY_ENCRYPTION_KEY`. Generate and retain the encryption key through the host's secret mechanism; it must be 32 random bytes encoded as base64. It protects both authenticator secrets and saved provider credentials. It cannot be changed from the application or recovered from the database alone.

Apply migrations through `012_meal_capture` and the grants in `infra/runtime-role.sql`. For the first administrator, create a private mode-600 file containing a new password of at least 16 characters, then run:

```bash
BOOTSTRAP_ADMIN_EMAIL=admin@example.com \
BOOTSTRAP_ADMIN_NAME='Platform administrator' \
BOOTSTRAP_ADMIN_PASSWORD_FILE=/private/first-admin-password \
npm run admin:bootstrap
```

The command requires `DATABASE_URL`, refuses to promote an existing email or create another administrator when one already exists, and creates a private administration workspace. Remove the one-time password file after success. Sign in at `/login`, enroll an authenticator at `/admin/security`, then open `/admin/settings`. Existing verified accounts can still be managed through the privileged `operator:role` command.

## Settings operation

Superadmin alone can manage the integration catalog. Saving, testing and disconnecting always require recent MFA, including in development. Ordinary trainer and subscriber APIs never return these configuration records.

1. Open the integration and enter its nonsecret fields and credentials. Empty replacement inputs preserve stored credentials; use the explicit remove control to clear one.
2. Save. A change to configuration invalidates the previous test. Another administrator's concurrent edit produces a conflict and offers a reload.
3. Run the connection test. The screen states what was actually checked.
4. Enable the configured integration when its test and required policy controls permit it. The next API request and worker cycle read the new settings without a process restart.

Saved configuration overrides inherited environment values, including explicit blank or disabled values. An inherited connection is labeled as inherited and is not presented as tested through the settings screen. Platform identity and feature controls do not require an external connection test.

Temporary API failures keep the current workspace route and offer Retry; only an expired or invalid session redirects to login. Verified users have separate request budgets even when sharing the application proxy; anonymous and stricter security-route limits remain enforced.

Secrets are encrypted with authenticated encryption and never returned by the settings API. The immutable audit lists actor, operation, revision, changed field names and sanitized test outcome. It contains no credential values. A missing or changed encryption key disables only the affected connection; the administrator can still sign in and replace its credentials. Recovery of older authenticator secrets still requires the original host key.

| Connection | Implemented behavior | Test boundary |
| --- | --- | --- |
| Application | Name, support email, legal version, reviewed feature controls, meal photos and food lookup | Local validation; a flag records an operator decision |
| Stripe | Existing Checkout, subscription, refund and signed webhook adapters use saved credentials | Read-only account access; no charge/refund and no proof of webhook delivery |
| Lean | Existing gated company-bank instruction adapter uses saved credentials | Configuration and public endpoint validation only; account-specific transport, recipient eligibility and bank finality remain unverified |
| AI model | Configurable compatible endpoint, model, usage prices, daily request cap and image capability | Read-only model-list request; no generated answer or proof of nutrition quality |
| Transactional email | Existing outbox/worker adapter uses saved endpoint, key and sender | Configuration validation only; no email sent and no delivery/domain verification |
| Apple Health | Enable/disable existing numeric export import | Local import capability; no native HealthKit connection |
| WHOOP, Zepp, voice, custom domains | Credential preparation and explicit unavailable status | Adapters/orchestration are not implemented; saving keys does not activate them |

Endpoint-based integrations require public HTTPS. Requests reject local/private destinations, DNS answers and redirects. The application base URL stays in host configuration because it controls request origins and server routing.

Disabling Stripe stops new commerce while preserving its credentials for signed lifecycle events already owed to existing subscribers. Disconnect explicitly removes its credentials and therefore requires coordination with webhook operations. Neither action rewrites ledger history. Failed/blocked jobs are not automatically replayed merely because settings change; inspect their existing state before retrying.

## Trainer Design Studio

Owners open `/trainer/design`; existing brand and brand-onboarding routes also open the studio. Four presets can be personalised through primary/accent/background colours, local font choices, spacing, buttons and corners. The app derives readable text colours. Trainers can set their name, headline, story, welcome message, program label, logo, portrait and cover image, and reorder the client home sections.

Images currently use public HTTPS URLs with visible fallbacks. File uploads, hosted custom fonts, arbitrary CSS and custom-domain purchase are not part of this editor. Client navigation and essential account, privacy and safety controls remain available.

Desktop/mobile and client/storefront previews use the same theme components as the real views. Save persists the design for that tenant and applies it to the client app and public storefront. Revision checks prevent a stale studio tab from replacing a newer save. Older branding forms preserve the stored design.

## Meal photos and barcodes

Subscribers with workout + nutrition open `/app/nutrition/log`. Manual entry remains available when a provider is unavailable. Camera use requires browser permission and a supported device; barcode digits can always be typed when camera detection is unsupported.

- **Photo:** choose a JPEG, PNG or WebP photo, grant separate photo-analysis consent, add useful context, receive editable food/portion/nutrient estimates, then explicitly confirm the diary entry. Nutrition and nutrition-AI permission are also required. Unknown facts stay unknown. The configured model must support image input; enable both the model image setting and application meal-photo control after qualification.
- **Barcode:** scan or type a supported GTIN, look up Open Food Facts, compare the returned product with the package, select its gram/millilitre basis and consumed amount, edit facts and confirm. The source, retrieval time and available revision accompany the entry. The application food-lookup control enables this adapter; no provider API key is required by this implementation.
- **Manual:** enter the meal, portion and optional approximate calories without an AI request. Existing diary corrections and summaries continue to apply.

Images are decoded, checked for type/dimensions/animation and re-encoded without EXIF/GPS before model access. The server accepts at most 2 MB and 16 megapixels and reduces dimensions to 1536 pixels. Private transient media is held in the tenant-scoped database, removed on completion/failure/cancellation/consent withdrawal and excluded after its 24-hour expiry. Worker cleanup removes expired content; no public image URL is issued. Confirmed diary facts retain their source and user confirmation, without the original photo.

Stable request identities prevent the same capture from repeating paid analysis, including after cancellation/expiry. Consent, profile, entitlement and draft state are rechecked after analysis. Duplicate confirmation has one diary effect; model usage remains accounted for even if an estimate is rejected. Local erasure removes captures, and privacy export includes the subscriber's unexpired capture data. Backup/provider retention remains an operational responsibility.

## Verification and screenshots

`npm run check` runs TypeScript, the integration suite and a production web build. The existing browser smoke checks core journeys. `node scripts/capture-app-views.mjs` starts an isolated synthetic local app and captures the public, trainer, subscriber and Superadmin views at desktop and mobile sizes. It also verifies settings persistence, credential masking/MFA and the application of a saved trainer design. Browser installation is a local tooling prerequisite; the runner does not use a cloud browser.

The gallery identifies synthetic fixtures and unavailable-provider states. Screenshots demonstrate rendered implementation, not live provider readiness. See `BUILD_STATUS.md` for the checks actually observed for this release.
