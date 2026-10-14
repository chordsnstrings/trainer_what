# Builder scroll modules — 14 October 2026

## Request and audit

The owner supplied `be-relax-last .html` and requested its scroll effect as reusable website-builder modules, with an explanation, plan and implementation. Baseline: `9df624b0f122c694f91d094564b5fcef083afaf2`; current previously verified application: `bf17118fc1ba7ffa6aad2e88e2cd16a488236af2`.

The reference is a standalone spa site with five image scenes. It uses long scroll segments, a pinned image/copy stage, crossfades, image zoom/drift, portrait perspective and scene navigation. Its optional video path is unused by those scenes. Its global fixed layers, wheel interception and perpetual animation work do not fit a builder where multiple effects can share a page. Spa branding, copy and embedded photos are not imported. The new native React implementation reproduces the interaction with independent section-scoped state; no reference engine code or third-party animation package was copied.

The current builder already provides a bounded shared schema, section/item identities, reusable sections, revisioned optimistic saves, tenant-owned media, safe actions, a common editor/public renderer and a zoomed nested preview scroller. The design extends these paths rather than adding a separate document or publishing system.

## Implementation plan and delivered structure

1. Add two catalogue families (twelve presets) and optional bounded `section.scroll` settings. Keep version 1 documents valid and unchanged when settings are absent; no migration. Journeys reuse `content.items` with an eight-scene maximum, native image/action fields and optional 0–100 photo focal coordinates.
2. Add native inspector controls for scene content/order/photos/buttons, pace, intensity, enabled state, scene navigation and phone presentation. Reuse media selection, link validation, undo, duplication and saved sections. Editing remains static so scenes stay selectable.
3. Render readable cards on the server. Enhance only suitable viewports into a section-bounded sticky stage. Passive scrolling schedules one animation frame when needed; no event cancellation, body scroll manipulation, perpetual loop or per-frame React rendering. Cleanup removes observers, callbacks and listeners. Offscreen modules skip transforms; hidden documents stop updates.
4. Measure the actual scroll container, sticky header, CSS zoom and longest copy. Re-evaluate after resizing, font loading, reduced-motion changes and preview zoom. Short screens, oversized text and phone stacking preferences retain normal document flow. Inactive animated scenes are inert and hidden from assistive technology; navigating dots updates the actual scroll position. Focused scene links force a readable layout if scrolling would hide them. A visitor-controlled reading mode, print styles and server markup retain all content.
5. Verify schema round trips, safe media/actions, saved/reused/duplicated identities, renderer regressions, real editor saves/publication and hydrated motion at desktop/phone widths, including Arabic. Run the ordinary PR and main release gates, then verify the exact serving SHA under the owner's standing deployment authority.

| Family | Layouts | Intended use |
| --- | --- | --- |
| Scroll journey | Cinematic, portrait, split, reversed, centered, minimal | A sequence of photos, copy and optional calls to action |
| Scroll image | Zoom in, zoom out, drift up, drift left, drift right, still | One photograph with an introduction and native buttons |

## Verification checkpoint

- TypeScript and production build passed locally.
- All 56 website-builder tests passed, including contracts, rendering, editor history, API persistence/tenant media ownership, assembled authentication/CSRF and starter generation. Media tests verify publication and rejection of another tenant's photo.
- The 282-preset matrix passed 1,692 renders at 1280/768/390 px in English and Arabic with no overflow failures.
- Hydrated Chromium checks passed all twelve presets; independent modules; forward/reverse scrolling; navigation; sticky-header clearance; section exit; English/Arabic phones; eight scenes; long-copy, short-screen and reduced-motion fallbacks; reading control; static editing; nested zoomed preview; focused-link preservation; cleanup. Desktop and phone screenshots were inspected.
- The full authenticated editor/publication journey passed all 17 checks, including adding both modules, modifying scene copy/buttons and pace, reloading the saved draft, playing Preview and publishing the journey. Printing checks also verify that cinematic, portrait and split variants retain every scene in readable flow.
- Local implementation and verification are complete. PR/main release gates and exact serving verification are next; no merge, deployment or serving release is claimed at this checkpoint.

The normal Playwright CDN archive was unavailable locally; an isolated npm-distributed Chromium 153 binary provided local browser verification, without adding a project dependency. CI continues to use its existing pinned Playwright browser. No paid model/provider call, live trainer content change, billing operation or database migration is part of this feature. Physical iPhone/Android testing is distinct from the automated viewport checks. Video scrubbing, global smooth scrolling and reference spa assets are outside this image-module implementation. Runtime token/cost totals were not exposed and are not estimated.
