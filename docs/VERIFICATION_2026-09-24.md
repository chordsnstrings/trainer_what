# Implementation verification — 24 September 2026

Code commit: `e6a539e50146049f2b30da08149a8bb79ac106c9`.

[GitHub Actions run 36030720270](https://github.com/chordsnstrings/trainer_what/actions/runs/36030720270) completed successfully. Both jobs passed. Its **browser-evidence** artifact contains screenshots, the browser report and server logs; no production customer records were used.

| Gate | Observed evidence |
| --- | --- |
| Clean install / TypeScript | Passed on the application job |
| Embedded database suite | 37 tests passed using PGlite's PostgreSQL engine |
| Network database suite | Same 37 tests passed using PostgreSQL 17.6 and the non-owner, non-BYPASSRLS runtime role |
| Production web build | Passed |
| Production container | Image built; API database readiness passed with production configuration |
| Database upgrade | Nine migrations applied to the existing local fixture; idempotent seed reported no changes |
| Browser | 22 distinct routes, zero page errors; 390px layout checks passed |
| Workout persistence | Offline set saved; offline page reload preserved the workout and queue; online replay emptied the queue; completion succeeded |
| Onboarding persistence | Identity saved through the UI, then page reload restored it; server checks also covered stale-version rejection and preview invalidation |
| Client Twin | Subscriber UI loaded persisted context; tests covered tenant/subscriber isolation, immutable snapshot content, consent revocation, freshness, baseline coverage and observation deduplication |
| Visual review | Trainer desktop/mobile, onboarding mobile and Client Twin mobile captures inspected |

## Browser journeys

- Public landing, how-it-works, scripted sample demo (including safety pause), pricing and FAQ.
- Sign in; trainer overview, Brain, subscribers, programs, finance, integrations and settings; platform admin.
- Trainer identity onboarding save and reload; mobile navigation.
- Subscriber home, program, workout, bookings, support, profile and Client Twin.

The report counts 22 concrete paths, including the fixture workout path. This does not mean all 75 source screen groups are complete.

## Verification limits

No live Stripe, Lean, model or email API was called. No funds were moved and no infrastructure was provisioned. Provider-shaped fixtures test local contracts; they do not prove account acceptance or remote API compatibility. Production secrets were not stored in Git or screenshots.

Staging, actual phone/PWA installation, broad accessibility/load testing, restore/rollback drills, provider sandbox/canary, legal/financial review and the engineering gaps in [BUILD_STATUS.md](BUILD_STATUS.md) remain open. The Docker health check establishes API/database readiness, not production release readiness.
