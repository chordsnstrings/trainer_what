# Website builder preview motion — 16 October 2026

## Report and reproduction

The owner reported that motion did not work in website-builder preview. Baseline: `bb17457d9e3a099c7f4136a188cee5f2b8d52f0e`. Reproduced with the actual production-built Website Studio, synthetic local coach and default scroll journey: at a 1280 × 720 laptop viewport, Phone preview has a 575px-high scrolling area and switches to static cards. Desktop preview and the same phone preview in a taller window animate.

The fit check counted the controls' reserved space twice. `copy.scrollHeight` includes the copy's bottom padding, but the check subtracted another 120px. Ordinary phone copy therefore exceeded an artificially small 253.75px limit. The JavaScript phone test also used the section's width after gutters, while CSS uses the entire website container; a 700px website could be incorrectly treated as a phone.

## Correction

- Count the controls' padding once, retaining the existing phone photo-space allowance, actual text-overflow fallback and short-screen protection.
- Use the same 640px website-container boundary as the stylesheet.
- In private preview, explain why motion is paused when a section is disabled, phone stacking is selected, the device requests reduced motion, the viewport is short, or the copy is too tall. Messages are English/Arabic, disappear on recovery, stay out of edit cards and public websites, and are hidden when printing.
- Preserve ordinary scrolling, static editing, saved settings, reduced-motion preference, reading mode, scene focus protection and public rendering. No dependency or migration.

## Verification

The new hydrated regression failed before the application change (`data-motion=false`, expected `true`) and passed after it. The focused renderer/scroll suite passed 13 tests; typecheck and production build passed. Hydrated checks cover all twelve presets, forward/reverse scenes, real images, sticky geometry, printing, Arabic/phone layouts, true long-content and short-screen fallbacks, reduced motion, zoom, focus and cleanup. The new checks also cover ordinary scene text with an action in the 575px-high phone preview, the 700px container boundary and preview-only fallback explanations.

All 17 actual editor journeys passed. The motion journey verifies image-layer transforms after a real wheel event, scene changes in both directions, pinned-stage geometry and scene buttons at desktop, tablet, phone and 75% zoom, plus separate private-preview navigation and return to static editing. Desktop and phone screenshots were inspected. The editor uses synthetic placeholders; the hydrated renderer also verifies routed synthetic image assets. No live trainer content, paid model call or billing operation was used for testing.

## Verified release

[PR #70](https://github.com/chordsnstrings/trainer_what/pull/70) merged as `e8760ff1f8170df3865ff734e9b35726c92b1822`, with the exact tree of checked head `f171349fa7cbc1a0c4cc318bb757f63c644a2394`. All seven [PR gates](https://github.com/chordsnstrings/trainer_what/actions/runs/38899493510) and seven [main gates](https://github.com/chordsnstrings/trainer_what/actions/runs/38903865774) passed on their first attempts. Application: 1,911 passed / 0 failed / 5 skipped; PostgreSQL: 1,910 passed / 0 failed / 6 skipped on both runs. The editor, layout and hydrated motion checks passed in both release runs. No failed gate was waived.

[Serving verification](https://github.com/chordsnstrings/trainer_what/actions/runs/38908432521) confirmed the exact release at **13:39:10 UTC** on 16 October. Independent readiness/homepage HTTPS requests at **13:40:40–41 UTC / 17:40 Dubai** returned HTTP 200 and the same release; readiness returned `status: ready`. Receipt: `docs/BUILDER_PREVIEW_MOTION_RELEASE_2026-10-16.json`. Implementation, merge, deployment and serving verification are complete. Physical-device acceptance remains separate from browser viewport evidence. The documentation-only receipt follow-up changes no application behavior and follows ordinary automatic checks separately.
