# Backend UI and trainer continuity — 3 October 2026

## Scope and status

Owner approved all findings in `UI_UX_AUDIT_2026-10-03.md`. Implemented on `work/backend-ui-2026-10-03`, from audit `4dd80c8` / application main `ac5d55a`. Local and full PR verification passed on `e0f7bbc2483caf31f0229c699db0349ce7a5a67d`. Owner approved release with “Put it live” on 3 October at 15:01 Asia/Dubai. PR #27 is merged; main qualification and automatic deployment are pending. One agent. No paid model calls or production test records.

## Changes

| Area | Result |
| --- | --- |
| Onboarding | About saves drain overlapping edits before Continue, Back, exit, skip or sign-out. Failed saves keep the form open. Tab-local drafts survive reload; version conflicts offer explicit recovery from the saved answers. Page/address/plan drafts remain explicit-save operations. |
| White shell | Explicit light appearance in either OS scheme. Shared spacing, buttons, fields, statuses, tabs and typography. Flat, compact navigation with one scroll area and reachable account controls. |
| Navigation | Separate trainer and role-filtered operator menus. Secondary groups expand by task. Mobile drawer supports focus containment, Escape and focus return; it sits above bottom tabs. |
| Continuity | Backend chrome remains during route validation. Filters and client-return context live in URLs; pagination depth, drafts and scroll remain scoped to the signed-in workspace. Authentication and workspace changes clear caches across tabs. Credentials are excluded from draft storage. |
| Daily work | Sidebar count and Inbox share a scoped request/cache. Reply drafts survive client navigation. Client lists, invitations, complimentary access and former clients have separate views. |
| Focused settings | Profile, Security, Notifications, Privacy and Workspace tabs. Passkeys/recovery/session controls are grouped under Security. Finance separates overview, transactions, plans, refunds and payouts. Design images have their own tab. |
| Website setup | Actual website preview, a clear builder entry and return to setup. Client-app design and website editing are labelled separately. |
| Admin and feedback | Model profiles have an H1, persistent API-key labels and aligned key/action rows. Failed key saves preserve the input. Contextual dialogs replace native backend prompts; unsaved configuration requires a discard decision. |
| Loading boundaries | Heavy operator/coaching tools load on demand. Editor, host and governance styles load through their feature boundaries; server-renderable components remain independently testable. |

## Evidence

- Root and web TypeScript: passed. Production build: passed.
- Affected web/brand/logical-CSS/offline contracts: 104 passed.
- Additional appearance, device UI and setup checks: 27 passed (some setup checks overlap the group above).
- Broad isolated Chromium pass: 52 captures, 35 desktop route/view combinations, representative screens at 390/1100/1920, OS-dark and RTL. No viewport overflow, unnamed visible fields, page errors or unexpected API errors.
- That pass verified immediate exit, overlapping saves, failed-save retry, client-return search, keyboard settings tabs, admin isolation, actual setup preview/builder return and the desktop-only editor.
- Final focused Chromium run: 13/13 workflows and 23 responsive captures passed. Includes stale-answer recovery, reply-draft restoration, unsaved-admin discard/Escape, one shared Inbox request and draft clearing on sign-out. Zero overflow, unnamed fields, page errors or unexpected API errors. The mobile drawer overlap found during follow-up is fixed.
- CI now runs `scripts/backend-ui-check.mjs` in its own loopback PGlite fixture after the existing application and builder checks. No model/provider connection tests are invoked by this journey.

Evidence paths (ignored): `test-results/backend-ui/` and `test-results/backend-ui-final/`. The browser script refuses non-loopback or production targets. This is representative usability/accessibility verification, not a full accessibility certification or a production latency benchmark.

## Final PR CI

[Run 37104076842](https://github.com/chordsnstrings/trainer_what/actions/runs/37104076842) completed successfully at 07:10 UTC on 3 October 2026, on exact head `e0f7bbc2483caf31f0229c699db0349ce7a5a67d`. All three jobs passed:

- PGlite: 1,653 tests, 1,648 passed, five skipped, zero failed.
- Restricted PostgreSQL: 1,653 tests, 1,647 passed, six skipped, zero failed.
- Root/web TypeScript, production build, deployment boundary, runtime grants/migrations, production container readiness and Compose topology.
- General browser regression (consent, onboarding, galleries/publication, private downloads, notifications, mobile layout and offline replay).
- All 16 builder journeys, including native confirmation click, Escape, focus return and retained local edits during stale-window recovery.
- Layout matrix: 1,620 checks (270 layouts × three widths × English/Arabic), zero failures.
- All 13 backend onboarding/navigation/responsive journeys. The workflow saved browser evidence as its `browser-evidence` artifact.

The first CI run found three untranslated shared confirmation titles and an obsolete member-shell source assertion. Those now use existing translated action labels and check retained member chrome/refresh state. The second run passed full suites/build/general browser regression, then found fullscreen editor isolation made the shared native confirmation dialog inert. Native dialogs are now exempt from that background isolation; the builder regression checks actual click and keyboard behavior. No tests were bypassed. Local execution became unavailable after the local verification above; all follow-ups were saved through GitHub and verified in the final full CI run.

## Release

Owner approved the previously blocked merge/deployment with “Put it live” on 3 October 2026 at 15:01 Asia/Dubai. [PR #27](https://github.com/chordsnstrings/trainer_what/pull/27) merged as `97fd03cfad066fed5a64e3bd76d20b6fa7df06f3`. [Main qualification 37118350919](https://github.com/chordsnstrings/trainer_what/actions/runs/37118350919) is running. The deployment uses the existing newest-green-main automation; no SSH or manual deployment.

The initial live readiness check returned actual HTTP 200, `{"status":"ready"}` and header `X-GymMembership-Release: ac5d55a422701237157c56447de98b8d729c5c9b`. The backend UI is not yet confirmed live. Verify the exact new release header, readiness body and deployed web assets after main qualification/automatic deployment.

Original implementation `98f7c46` had an exact local/GitHub tree match; follow-up commits are `89da01f` (translation/source checks) and `e0f7bbc` (native dialog interaction). The merge tree is the same tested application tree, `180d4c31015c24389812acf9732f78602d90cf12`.

Release evidence and handoff checkpoint: `notes/backend-ui-release-2026-10-03`, descending from the merge commit and linked from PR #27. This records approval/progress without moving the application head being qualified. Reconcile it in the next release documentation merge.
