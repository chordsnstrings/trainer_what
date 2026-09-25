# Settings, trainer design and meal capture verification

Date: 25 September 2026. Change set based on `8f1a999409796f42c6d706f96e0db506a722b124`. Published implementation commit and CI results will be recorded after the final source update.

## Delivered behavior

- Encrypted Superadmin credentials and nonsecret configuration, recent MFA, revision conflicts, immutable sanitized audit, safe checks, explicit activation/disconnect and inherited-environment status.
- Runtime configuration reaches the API, model/food/commerce adapters, readiness report and worker without process-wide environment mutation. Host-only first-admin bootstrap avoids dependency on an already-configured email service.
- Trainer Design Studio themes the real client app and public storefront, with readable colours, fonts, layout, personal copy and public image URLs. Storefront enrollment points to the chosen coach. Mobile tables retain keyboard-accessible scrolling.
- Meal photo and barcode drafts, separate photo consent, private re-encoded media, editable estimates, serving calculations, explicit subscriber confirmation, diary provenance, cost-preserving idempotency and erasure/expiry handling.
- Per-user rate limits use verified sessions rather than the proxy's shared address. Anonymous limits and lower security-route limits remain enforced. Temporary bootstrap failures offer retry; only authentication failure redirects to login.

## Observed local checks

| Check | Result |
| --- | --- |
| TypeScript | Passed after the final API and UI recovery changes |
| Full automated suite | 91 passed, 0 failed, 0 skipped; final run 36.2 seconds |
| Migrations | All twelve exercised by embedded PostgreSQL tests, including settings and private capture tables |
| Production web build | Initial new-feature build passed; final targeted screenshot build is in progress |
| Settings/brand browser checks | Actual local API: MFA, role denial, save/reload, credential masking/clear, audit, welcome/navigation/palette persistence all passed |
| Meal browser checks | Actual local API: synthetic photo draft confirmed once, barcode serving scaled from 250 ml to 120 kcal and confirmed, both entries displayed in the diary |
| Full screenshot inventory | 250 initial captures across 94 routes; final replacements resolve one mobile overflow, storefront CTA and rate-limited captures; retry states are being added |
| Deployment boundary regression | 36 local passes, 1 Docker-only skip; no infrastructure operation was performed |

The rate-limit tests exercise normal limits against a real local API: one user's exhausted budget does not affect a different user at the same proxy address; rotating valid sessions does not reset that user's allowance; arbitrary cookies/forwarded headers do not evade anonymous limits; the stricter security route still blocks excess attempts.

Meal tests verify decoded type/dimension/metadata handling, unknown product facts, cross-user isolation, no diary entry before confirmation, single paid analysis across concurrent retry, source-preserving corrections/Twin totals, entitlement denial, invalid-output accounting, consent withdrawal during generation, photo-only withdrawal preserving unrelated plans, and expired/cancelled intent tombstones.

Screenshots use a production Next build, local Chromium and isolated synthetic development data. Stored fixture credentials are masked or removed before capture. A seeded public storefront exercises the renderer without qualifying or publishing a real coach. No real photo, provider API, email, payment or bank account was used. These checks do not establish actual device camera support or model/food-provider quality.

## CI and release boundary

GitHub application and PostgreSQL/container verification of the final source is pending. The application workflow now retains full screenshot evidence alongside the existing core browser smoke. See `BUILD_STATUS.md` for the current observed result rather than treating workflow configuration as a pass.

Deployment remains stopped; Claude owns that separate handoff. The provisioning workflow is manual-only, and no DigitalOcean resource was created or changed. WHOOP, Zepp, voice and domain adapters remain unavailable; their credential editors cannot activate them. Configured vision/food access, coach qualification and account-specific Stripe/Lean contracts remain separate activation requirements.
