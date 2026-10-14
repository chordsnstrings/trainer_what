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

## Local verification and CI corrections

- TypeScript and production build passed locally.
- All 56 website-builder tests passed, including contracts, rendering, editor history, API persistence/tenant media ownership, assembled authentication/CSRF and starter generation. Media tests verify publication and rejection of another tenant's photo.
- The 282-preset matrix passed 1,692 renders at 1280/768/390 px in English and Arabic with no overflow failures.
- Hydrated Chromium checks passed all twelve presets; independent modules; forward/reverse scrolling; navigation; sticky-header clearance; section exit; English/Arabic phones; eight scenes; long-copy, short-screen and reduced-motion fallbacks; reading control; static editing; nested zoomed preview; focused-link preservation; cleanup. Desktop and phone screenshots were inspected.
- The full authenticated editor/publication journey passed all 17 checks, including adding both modules, modifying scene copy/buttons and pace, reloading the saved draft, playing Preview and publishing the journey. Printing checks also verify that cinematic, portrait and split variants retain every scene in readable flow.
- All 11 marketing-assistant tests passed after updating the historical catalogue assertion.
- Initial PR CI exposed a historical marketing-assistant assertion hard-coded to 270 layouts/38 families. Public facts already derive the correct catalogue totals; the assertion now follows the catalogue and still checks that the spoken answer passes factual screening. No database permission or production behavior was relaxed. All gates subsequently passed on the final head.
- Corrected head `14c0047946da81efe41399cc4ff97011638bd4ff` passed all 1,900 application tests (five skipped), all 1,899 PostgreSQL tests (six skipped), the production build, 17 builder journeys, 1,692 layout renders and motion/print checks. The application job reached its 35-minute limit during the later onboarding browser journey. Its budget was increased to 45 minutes, retaining every test and browser step; all gates subsequently passed on the final head. This addresses a measured CI time limit, not a waived functional failure.

## Release checks

[PR #68](https://github.com/chordsnstrings/trainer_what/pull/68) merged as `932498b18c3ba0f0d4907b22a4982673d3b762c4`. All seven [PR gates](https://github.com/chordsnstrings/trainer_what/actions/runs/38564301416) passed on `40e0acc4d15acbd37638e6b22f1f4fda3df0fef0`; the merged tree exactly matches the checked tree `30a3ca06ff3c043ac63fee40f95f74edced95cb5`. All seven [exact-main gates](https://github.com/chordsnstrings/trainer_what/actions/runs/38568962618) passed. Application: **1,900 passed / 0 failed / 5 skipped**; PostgreSQL: **1,899 passed / 0 failed / 6 skipped**, on PR and main. Build, all browser journeys, the full layout matrix and hydrated scroll/print checks passed.

The first main wildcard-edge build hit a Go checksum-server HTTP/2 `INTERNAL_ERROR` while verifying `github.com/yuin/goldmark@v1.8.2`. Only that infrastructure job was retried, on unchanged code; it passed. Checksum verification remained enabled and no failed gate was waived. [Serving verification](https://github.com/chordsnstrings/trainer_what/actions/runs/38574329818) passed and confirmed `932498b18c3ba0f0d4907b22a4982673d3b762c4` at **13:50:36 UTC**. Independent readiness and homepage requests at **13:51 UTC / 17:51 Dubai** returned HTTP 200 and the exact release; readiness returned `status: ready`. Implementation, merge, deployment and serving verification are complete. The full receipt is `docs/BUILDER_SCROLL_RELEASE_2026-10-14.json`. This records the verified feature SHA; the documentation-only follow-up changes no application behavior and follows ordinary automatic CI separately.

The normal Playwright CDN archive was unavailable locally; an isolated npm-distributed Chromium 153 binary provided local browser verification, without adding a project dependency. CI continues to use its existing pinned Playwright browser. No paid model/provider call, live trainer content change, billing operation or database migration is part of this feature. Physical iPhone/Android testing is distinct from the automated viewport checks. Video scrubbing, global smooth scrolling and reference spa assets are outside this image-module implementation. Runtime token/cost totals were not exposed and are not estimated.
