# Backend UI and trainer continuity — 3 October 2026

## Scope and status

Owner approved all findings in `UI_UX_AUDIT_2026-10-03.md`. Implemented on `work/backend-ui-2026-10-03`, from audit `4dd80c8` / application main `ac5d55a`. Local verification passed. PR #27 has CI follow-up in progress; merge approval, main qualification and automatic deployment are pending. One agent. No paid model calls or production test records.

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

## Release

Implementation `98f7c4680de565a1a885aabd2129e85089ef9dac` is saved in [PR #27](https://github.com/chordsnstrings/trainer_what/pull/27); its Git tree exactly matched the locally staged tree. Initial [CI run 37101590592](https://github.com/chordsnstrings/trainer_what/actions/runs/37101590592) passed Compose topology but found three untranslated dialog titles and an obsolete member-shell source assertion. The follow-up reuses existing translated action labels and verifies retained member chrome/refresh state. CI must pass on the updated head. Local execution became unavailable after the completed local verification above.

Automatic approval review rejected the production-triggering PR #27 merge and requires specific user approval. Do not retry or bypass the rejected merge. Main remains `ac5d55a`; the backend changes are not live. After approval and green checks, deployment follows the existing newest-green-main automation and needs exact live release-header verification; no manual server deployment.
