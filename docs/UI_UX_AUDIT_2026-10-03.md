# Backend UI/UX audit — 3 October 2026

**Scope:** trainer workspace, setup and Super admin. Source: deployed main `ac5d55a422701237157c56447de98b8d729c5c9b`. Audit branch: `audit/backend-ui-2026-10-03`. Audit only; application code and production remain unchanged.

## Assessment

The application has useful workflows, but inconsistent presentation and navigation make them harder to use. Fix shared foundations first, then simplify high-frequency screens. The existing six-step setup, unified inbox, client hub, website builder and business controls should remain the functional base.

The most urgent finding is functional: **“Save and continue later” can lose the last onboarding edit.** Styling alone will not deliver smooth onboarding.

## Prioritized findings

| Priority | Finding and evidence | Required change |
| --- | --- | --- |
| P0 | `/setup/about`: type a new name and immediately click “Save and continue later”; returning shows the old name. Reproduced with the real local API. `AboutStep` delays persistence by 800 ms and clears its timer on unmount; the exit, step links and Continue do not await pending persistence. | Centralize dirty/saving/saved/error state. Flush and await pending changes before step changes or leaving. Keep failed edits recoverable. Cover immediate Continue, Back, exit, retry and refresh. Audit manual-save Page/Plan fields through the same contract. |
| P1 | Background is off-white (`--paper: #f3f4f0`), and the workspace automatically follows OS dark mode. This conflicts with the requested white backend. | Use a workspace-specific white canvas and white navigation. Reserve subtle neutral tints for hover/selection; use borders sparingly. Define the backend appearance explicitly. |
| P1 | Sidebar is 236 px wide with 23 px side padding, large identity spacing and a 123 px promotional footer. At 1440×1000 its navigation needs 967 px inside a 666 px scroll area. Both sidebar and navigation enable scrolling. Trainer and admin links share the same rail. | Flatten the rail, remove the promotional footer, compact the workspace switcher and use one scroll area. Group navigation by task with expandable secondary links. Provide separate role-aware admin navigation, consistent active ancestors and `aria-current`. Keep sign-out/account controls reachable. |
| P1 | Spacing is independently defined across screen families: content 34/44 px, base cards 28 px, settings panels and setup panels use other values. Nested cards add another frame and inset. | One spacing scale (4/8/12/16/24/32/48), common page gutters, header/action alignment and form widths. Use sections and dividers where another card adds no meaning. Tables can use more width than forms. |
| P1 | Controls mix shared `.button`, raw controls and feature-specific implementations. Sampled button heights vary; Design includes 14–42 px controls, Settings 42/48 px. The shared Button only supports a secondary boolean. | Shared Button/IconButton, field, select, checkbox, switch, tabs, badge and feedback primitives. Explicit sizes, primary/secondary/quiet/destructive variants, icon alignment, loading/disabled/focus states. Standardize controls by role, rather than making tabs, links and actions identical. |
| P1 | Setup competes with the full navigation and six step cards. The Page step previews legacy headline/bio instead of the new multipage builder output. “Design” and “Website” do not clearly explain their separate styling targets. | A focused setup layout with one primary action and visible save state. Keep resume, prefill and optional skips. Show the actual website preview and return safely from builder editing. Name client-app design and website design distinctly. Separate required launch tasks from later improvements. |
| P1 | Trainer routing reloads workspace state; the code caches state only for members. Client search is local `useState("")`, so it resets when the list unmounts. Sidebar inbox count and inbox contents poll separately. | Retain the trainer shell during transitions. Scope cached state by user/workspace; refresh in the background. Preserve filters, pagination, scroll and selected client in URL/state. Share inbox data and invalidate it after actions. Maintain permission checks and tenant isolation. |
| P1 | Client administration combines the list, invitation form, invitations and complimentary access on one long page. Settings measured about 3,769 px tall at desktop width; Design about 2,311 px. Finance mixes plan configuration and daily money views. | Make frequent tasks prominent. Move occasional creation/configuration into focused panels or subpages. Group Settings into Profile, Notifications, Security, Team and Connections. Separate finance overview, plans, transactions/refunds and payouts while preserving existing ledger behavior. |
| P1 | Admin model profiles use a card within a card, no page-level H1, and three API-key fields with placeholder-only labels. Field/save/test/activate controls wrap awkwardly. Operators also see coaching navigation. | A dedicated operator shell and consistent page headers. Align configuration forms and actions, use persistent field labels, and make configured/tested/active/error states clear. Group workspaces, operations, finance, integrations and system settings by operator task. |
| P2 | Global table typography uses 10 px headers/12 px cells; secondary navigation uses 11.5 px text and 9 px group titles. Feedback includes native alerts/confirms and several unrelated notice/loading patterns. | Improve reading hierarchy and touch targets. Reuse labelled dialogs, drawers, inline validation, toasts, skeletons and actionable empty states. Keep keyboard focus, focus return, live announcements, reduced motion and RTL consistent. Destructive actions need explicit, contextual confirmation. |
| P2 | Thirty CSS files are imported globally. Feature CSS also modifies shared navigation. Global workspace and public/member styles share foundations, increasing regression risk. | Consolidate backend tokens and primitives; scope feature styles. Load heavy feature code/styles where used. Measure transitions before claiming performance gains. Protect member branding, public website layouts and the desktop-only editor boundary during the refactor. |

## Recommended navigation and workflows

- **Trainer rail:** Today/Inbox, Clients, My Brain, Website, Business, Settings. Contextual children expand within their group. Messages remain reachable from Inbox and the client hub; bookings remain a visible daily task.
- **Onboarding:** account → coach profile → website starter/preview → teach/check Brain → plan → launch readiness. Save on every transition. Present platform-blocked tasks separately from trainer actions. After launch, open the daily inbox with a contextual next step.
- **Daily loop:** prioritized inbox → client context → respond/review/book → return to the same queue position. Preserve drafts and filters. Show clear success/error state and the next useful action.
- **Admin rail:** Overview, Workspaces, Operations, Finance, Integrations, System. Show only permitted destinations. Use a distinct platform identity and no coach setup language.

## Execution order and acceptance

1. **Save reliability and shared foundation:** fix the reproduced persistence gap; introduce backend tokens, white shell, navigation and core controls. Pilot on Inbox, Clients, Setup and admin model profiles.
2. **Workflow migration:** apply those primitives to Brain, messages, bookings, finance, website/settings, design/media, account/team and integrations. Restore navigation context; shorten long forms and repetitive copy.
3. **Admin and remaining surfaces:** migrate operator dashboards, configuration, finance, alerts, support and governance. Standardize loading, empty, error, confirmation and mobile states.

Use one agent and targeted reads. Reuse components and safe mechanical replacements. Test changed behavior rather than adding tests for each spacing rule. Run one final full CI qualification after the migration.

Acceptance: white workspace at light/dark OS settings; one sidebar scroll area; consistent controls and page gutters; no lost onboarding edits; preserved list/draft context; clear role boundaries; no viewport overflow at 390/1100/1440/1920; keyboard/RTL/focus checks; existing billing, publication and permission behavior retained. The website editor remains desktop-only.

## Evidence and limits

- Source review: shared shell, navigation, controls, CSS, routing, setup persistence, inbox polling, client search, settings, finance and operator configuration.
- Broad local Chromium pass: 33 captures across 25 route paths at 1440/1100/390, including an OS-dark sample. Zero page errors, HTTP errors or measured horizontal overflow. Some captures show asynchronous loading; a targeted settled-state pass added 10 captures across six representative paths, with zero page/HTTP errors or overflow. The onboarding save-loss issue reproduced in both passes.
- Save-loss reproduction uses only a throwaway seeded PGlite database. No production records, model requests or provider changes.
- Reports/screenshots: ignored local `test-results/ui-audit-2026-10-03/`, `test-results/ui-audit-2026-10-03-settled/` and `test-results/ui-audit-source.json`.
- This is a source and representative visual/flow audit, not a full accessibility certification, production latency benchmark or exhaustive state-by-state acceptance run. Absence of overflow does not establish good visual design. Fixture banners, provider availability and Next dev indicators are not production findings.

## Implementation references

- `apps/web/app/globals.css`, `trainer-workspace.css`, `platform-settings.css`, `setup-wizard.css`, `layout.tsx`.
- `apps/web/components/workspace.tsx`, `workspace-nav.tsx`, `workspace-ui.tsx`.
- `apps/web/components/setup-wizard.tsx`, `setup-wizard-model.ts`, `workspace-inbox.tsx`, `workspace-clients.tsx`.
- `apps/web/components/workspace-settings.tsx`, `workspace-finance.tsx`, `model-profiles.tsx`.

## Implementation follow-up

The owner approved “Fix all”. Findings are implemented on `work/backend-ui-2026-10-03`; see [verification and release status](VERIFICATION_2026-10-03_BACKEND_UI.md). The audit above remains the original evidence, rather than a description of the new UI.
