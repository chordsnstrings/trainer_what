# Marketing refresh — 3 October 2026

Owner approved the marketing audit fixes. Branch: `work/marketing-refresh-2026-10-03`, based on the saved subscriber release notes and verified live application `e5757e4`. This work is not deployed. Subdomain and custom-domain audits are next, read-only.

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
- No paid/live model calls, production records, domain operations or deployments.

## Owner inputs still required

- Reviewed terms, privacy notice and digital coaching disclosure. Existing test versions remain stored but cannot function as public policies.
- Verified company identity and public support email in platform settings.
- Current live frontier qualification is off. Public copy must not claim active frontier use until an operator has actually qualified and enabled it.

No invented legal text, contact data or model qualification substitutes for these inputs. Registration, commerce and external-service gates remain in force.
