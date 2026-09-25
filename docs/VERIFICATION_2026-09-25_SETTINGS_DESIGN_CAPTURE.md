# Settings, trainer design and meal capture verification

Date: 25 September 2026. Change set based on `8f1a999409796f42c6d706f96e0db506a722b124`. Implementation commit: `f903fcdc7c8324806d2d3352c1475bb0eb79c05d`. Final harness correction: `e5a1df5eeedfc2bdf6d89530605d8b844176763d`. CI run: https://github.com/chordsnstrings/trainer_what/actions/runs/36126911122.

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
| Migrations | All twelve exercised by embedded and PostgreSQL 17.6/non-owner runtime tests, including settings and private capture tables |
| Production web build | Final corrected production build passed locally and in GitHub |
| Settings/brand browser checks | Actual local API: MFA, role denial, save/reload, credential masking/clear, audit, welcome/navigation/palette persistence all passed |
| Meal browser checks | Actual local API: synthetic photo draft confirmed once, barcode serving scaled from 250 ml to 120 kcal and confirmed, both entries displayed in the diary |
| Full screenshot inventory | 252 final local captures across 94 routes; zero remaining layout/navigation/browser errors, including corrected storefront, mobile table and explicit desktop/mobile retry states |
| Deployment boundary regression | 36 local passes, 1 Docker-only skip; no infrastructure operation was performed |

The rate-limit tests exercise normal limits against a real local API: one user's exhausted budget does not affect a different user at the same proxy address; rotating valid sessions does not reset that user's allowance; arbitrary cookies/forwarded headers do not evade anonymous limits; the stricter security route still blocks excess attempts.

Meal tests verify decoded type/dimension/metadata handling, unknown product facts, cross-user isolation, no diary entry before confirmation, single paid analysis across concurrent retry, source-preserving corrections/Twin totals, entitlement denial, invalid-output accounting, consent withdrawal during generation, photo-only withdrawal preserving unrelated plans, and expired/cancelled intent tombstones.

Screenshots use a production Next build, local Chromium and isolated synthetic development data. Stored fixture credentials are masked or removed before capture. A seeded public storefront exercises the renderer without qualifying or publishing a real coach. No real photo, provider API, email, payment or bank account was used. These checks do not establish actual device camera support or model/food-provider quality.

## Screenshot deliverables

- `test-results/app-views/GymMembership_App_Views.html`: self-contained searchable gallery, 252 views across 94 routes; desktop/mobile filters and image dialog verified.
- `test-results/app-views/GymMembership_Screenshots.zip`: 252 PNGs, manifest and functional results; integrity verified. No server logs, databases or credentials.
- Local browser functional checks include real settings persistence/clear/audit, MFA/role restrictions, saved trainer theme, photo and barcode confirmation/diary effects, and recovery from a synthetic 429 without a login redirect.
- Gallery, archive and selected screenshots were saved for the owner. These generated artifacts remain outside Git; CI retains its own screenshots as workflow artifacts.

## CI and release boundary

The PostgreSQL/container job 108045034032 passed with 91 tests, a production image build and ready response. The application job 108045033829 passed TypeScript, 91 tests, production build, all 37 deployment boundary checks, existing core browser smoke and 252 screenshots with zero layout/browser errors. Both jobs passed on e5a1df5. Artifact 10860192604 (`browser-evidence`, 69,659,294 bytes) retains the CI gallery/screenshots and core browser evidence. See `BUILD_STATUS.md` for the current observed result rather than treating workflow configuration as a pass.

Deployment remains stopped; Claude owns that separate handoff. The provisioning workflow is manual-only, and no DigitalOcean resource was created or changed. WHOOP, Zepp, voice and domain adapters remain unavailable; their credential editors cannot activate them. Configured vision/food access, coach qualification and account-specific Stripe/Lean contracts remain separate activation requirements.
