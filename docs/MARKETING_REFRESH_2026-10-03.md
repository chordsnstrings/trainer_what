# Marketing refresh — 3 October 2026

Owner approved the marketing audit fixes, review and deployment. PRs [#29](https://github.com/chordsnstrings/trainer_what/pull/29) and [#30](https://github.com/chordsnstrings/trainer_what/pull/30) are deployed as `f114d16145cdad0ffa2bfdec91524b2e20742441`, verified 4 October 2026. All four exact-main release jobs passed. The earlier checkpoints below remain historical; the final deployment evidence follows them. Next: subdomain audit, then custom-domain audit, read-only.

## Changes

| Audit gap | Implemented change |
| --- | --- |
| Test policies exposed publicly | Explicit test placeholders return `LEGAL_NOT_PUBLISHED`, including historical version requests. Version lists exclude them. Legal status and consent resolution use the same filtered document lookup. Published records remain immutable. |
| Security overclaims | Describe permission checks and audit logs. Fresh authenticator checks are conditional on enforcement. No security setting changed. |
| AI naming | Retain provider-neutral “frontier model” wording only when the active profile is qualified. No provider, qualification or activation changed. |
| Old setup checklist | Public setup follows the actual six wizard steps and their approximately 15-minute estimate. Save/resume and bank details at first payout are clear. |
| Wrong scenario minimum | Supervised setup: eight confirmed quiz answers and three coach-owned cases. Automatic sending still requires 20 cases and passing release checks. |
| Basic website copy | Desktop-only drag-and-drop editing, multiple pages, navigation, responsive previews and separate member-app styling. |
| Missing catalogue | Counts derive from the builder: 270 layouts, 38 families. Heroes, programmes, prices, video, galleries, FAQs, contact forms and other sections are covered. |
| Missing AI starters | Explain assembly from existing modules, review before publishing and manual templates without AI. |
| Missing transformations | Paired before/after photos and captions, AI module selection and coach-supplied, permissioned client evidence. No invented outcomes. |
| Missing recovery tools | Autosave, undo/redo, reusable sections, publication history and restore to draft. Publishing remains deliberate. |
| Old address examples | Public display follows the configured platform root; path-based addresses remain the fallback. Host routing and domain provisioning are untouched. |
| Old product illustrations | Current Inbox/Clients/My Brain/More labels and a responsive desktop-builder illustration. All are labelled sample data. |
| Missing voice features | Personal narration in the coach’s style; own-music mode with short cues, tap-to-talk and device limits. |
| Stale Arabic claim | Core member controls support English/Arabic and RTL; coach content and marketing are not automatically translated. |
| Missing contact identity | Clear unpublished company/contact status, working sign-in and registration/early-access links. No invented identity or email. |
| Stale search/assistant facts | Registry-derived metadata, FAQs, JSON-LD, full-site text and bounded assistant facts share the updates. Setup labels/timings are included in text discovery. |
| Unknown registration state | If platform settings cannot be read and no successful cached value exists, marketing shows early access rather than inviting registration. |

## Verification

- 29 public API, document-history and subscriber public-page checks pass with isolated fixtures.
- 53 focused marketing, assistant, frontier, model-name and logical-CSS checks pass across the final focused runs: the 52 passing checks were followed by the corrected metadata check. The earlier failure was an overlong UAE description; no test limit was relaxed.
- Root TypeScript and the production build pass.
- Local Chromium: 12 pages at 390 and 1440 px, plus the settings-unavailable state: 25 checks, no page errors, horizontal overflow or broken in-page anchors. Setup has six steps, transformation FAQ opens, company links follow registration state and all three unpublished policy screens render correctly. API guards were tested separately against the database.
- Visually reviewed desktop product illustrations/builder card and the phone setup page. Evidence: `docs/evidence/marketing-refresh-2026-10-03.json`.
- During implementation verification: no paid/live model calls, production records, domain operations or deployments. The later authorized deployment is recorded below.

## Owner inputs still required

- Reviewed terms, privacy notice and digital coaching disclosure. Existing test versions remain stored but cannot function as public policies.
- Verified company identity and public support email in platform settings.
- Current live frontier qualification is off. Public copy must not claim active frontier use until an operator has actually qualified and enabled it.

No invented legal text, contact data or model qualification substitutes for these inputs. Registration, commerce and external-service gates remain in force.

## Release review — 4 October 2026

Owner requested review, then deployment at 00:43 Asia/Dubai. Reviewed public policy reads/history, consent callers, registration fallback, address display, shared content/assistant facts, UI changes and the successful CI run `37148643762` on `2bc26b8`.

Found and corrected one release blocker: filtering test policies also blocked existing members withdrawing consent. The privacy route now records a withdrawal marker without requiring publication; notification preferences do the same for marketing opt-out. New grants still require real published documents. Existing cleanup, isolation, locking and immutable history remain intact. Reproduced HTTP 409 before the fix. Regression checks cover all seven consent types and notification preferences under production security, plus blocked re-grants.

All 30 targeted privacy/public-page/notification/suspension checks pass. Root TypeScript passes. No web rendering changes were made during this review. No further release blockers found in the reviewed diff. Approved policies/company/contact remain owner inputs; their missing states stay explicit. The prior four-job CI result covers the pre-review-fix head; the release still requires full checks on the exact merged main commit before automatic deployment.

## Deployment checkpoint — 4 October 2026

PR #29 merged as `012ff78e3841f468e152a64edb29893cb51c7cd0`. Main run `37153199581` caught a permission error in the new regression fixture, which inserted/read tenant consent records through the system role. The application correctly restricts that role.

PR #30 (`6b2c3be33115c3e51fd4efc21be3672ae9aefee7`) moves those fixture operations to tenant scope, without changing application permissions, runtime code or assertions. Both regressions and root TypeScript pass locally; PR run `37154122810` is pending. Automatic approval review rejected the merge, requiring separate owner approval for this new PR. Deployment has not occurred. Next: owner approval for PR #30, passing checks, merge, exact-main qualification, then public verification.


## Approved release continuation — 4 October 2026

Owner explicitly approved PR #30 with “Yes” at 08:46:40 Asia/Dubai. All four PR jobs passed in run `37154122810`. Merged as `f114d16145cdad0ffa2bfdec91524b2e20742441`; tree `ee13360226cc06a5ac8c1233e6ac81c4e10a4c56` matches the checked PR head. Exact-main push qualification `37178154258` is running. Existing automatic deployment follows successful qualification; production verification remains pending.


## Verified production release — 4 October 2026

- Approved PR #30 merged at 04:50:20 UTC as `f114d16145cdad0ffa2bfdec91524b2e20742441`; its tree matches the checked head exactly.
- Main [qualification 37178154258](https://github.com/chordsnstrings/trainer_what/actions/runs/37178154258) passed at 05:24:04 UTC, attempt 2. PGlite: 1,652 pass/5 skip. Restricted PostgreSQL: 1,651 pass/6 skip. All final checks have zero failures. TypeScript/build, browser regression, 16 builder journeys, layout matrix, backend/subscriber UI, container readiness and Compose topology passed.
- First database attempt: an unchanged account fixture generated a previous-period authenticator code across a 30-second clock boundary (`tests/accounts-membership-exit.test.ts:773`, `MFA_REQUIRED`). Only that failed job was retried successfully. Both new withdrawal regressions passed in both attempts. No production code, security settings, workflow or permission changes were made for the retry. The timing-sensitive fixture is a follow-up.
- Existing automatic deployment returned healthy HTTP 200 readiness and the exact new release header at 05:29:21 UTC. One earlier probe returned 502 at 05:28:41 UTC during rollout.
- Public verification completed 2026-10-04 05:31:19 UTC: 23 requests, 12 content/state checks, all passed and carrying the exact release header. Thirteen public pages/text endpoints return 200. Builder/transformations/setup/Arabic/voice/discovery copy is current and provider-neutral. Latest and historical test policies return 404 `LEGAL_NOT_PUBLISHED`; registration remains closed. Configured subdomain examples and explicit unpublished company/support states are correct.
- These were signed-out, read-only production checks. Authenticated workflows are covered by isolated CI. No paid/live model calls, production fixtures, DNS/domain operations, cloud browser, SSH or manual deployment were used.

Exact evidence: `docs/evidence/marketing-release-2026-10-04.json`. Handoff, project memory and release evidence are saved on `notes/marketing-release-2026-10-04`; reconcile these notes into the next application release. Owner inputs above remain outstanding. Next work is the read-only subdomain audit, then custom-domain audit.
