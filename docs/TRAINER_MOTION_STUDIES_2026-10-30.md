# Trainer motion studies — 30 October 2026

Three working studies implement the owner's approved research direction. They are the first review gate before rebuilding the requested collection of ten. Smooth coordinated motion is the priority; 3D is optional.

Open Trainer Studies — Volume 02 (private preview shared separately)

## Three compositions

| Study | Structure and motion | Try |
| --- | --- | --- |
| Mara Vale — coach documentary (private preview shared separately) | A full-frame gym film contracts into an editorial coach introduction; method rows and practice notes follow. The same frame connects the introduction and the person. | Scroll slowly, stop halfway and reverse. On phone the film transition is shorter and the introduction remains in normal flow. |
| Common Ground — client journal (private preview shared separately) | A warm editorial cover leads into three chapters. A persistent image, chapter number, narrative word and progress rail change together. The story is explicitly fictional. | Move through BEGIN, RETURN and LIVE in both directions; try chapter buttons. On phone a compact sticky image accompanies sequential chapters. |
| Dayform — a week with your coach (private preview shared separately) | Seven overlapping cards unfold into a week. Day selection reveals detail. Busy-week mode replaces titles, durations, items, media and notes for all seven days. | Unfold the week; select days by click or arrow/Home/End keys; toggle busy week while retaining the selected day. |

These differ in information order, reading rhythm, interactions and media continuity. Each route has a separately authored structure and phone composition. Shared elements are review controls, media lifecycle, motion preference and enquiry demonstrations.

## Implemented behavior

- Native scrolling and local GSAP 3.13.0 / ScrollTrigger. No scroll-inertia library, Three.js or WebGL on these routes.
- Coordinated, reversible scroll timelines and settled reading states. Rapid day selections replace the current short detail animation.
- A local pause setting; device reduced motion takes priority. Complete static compositions retain content and working interactions.
- Local muted inline video and matched posters, with offscreen/hidden-tab pause and save-data/reduced-motion handling. Fonts and runtime assets are local.
- Semantic controls and keyboard day selection. Actual native browser focus remains unverified.
- Preview-only enquiries: no messages, bookings, payments or contact-detail persistence. Only the motion preference is stored locally.

The brands and trainer/client identities are fictional. Stock performers do not represent or endorse them. The journal is not a real testimonial and the week is example website content, not an exercise prescription. Asset credits identify Mixkit, Pexels and font licences. GSAP restricts certain visual animation builder uses; review the intended production architecture before choosing its licence/deployment model.

## Modules for later Seed composition

[Machine-readable contracts](trainer-motion-studies/contracts.json) describe three narrative recipes and four coordinated chapter/interaction types: film introduction, three-chapter story, calendar unfold and day explorer. They specify assets, entry/readable/exit states, phone alternatives, reduced motion and persistent interaction state.

Choose a narrative from the confirmed public brief first, based on audience, offer, evidence and actual media. Shared-media transitions need compatible identities/crops; incompatible edits should select compatible transitions. Missing consented client evidence should select another narrative, not invent results.

These are prototype contracts. No production Seed planner, onboarding flow, trainer editor or tenant migration is connected. The rejected seven-family/55-variant catalogue remains historical.

## Release

The independent owner-private review Site was successfully published on 30 October 2026. The exact checked source was pushed and packaged before publication. Preview links and private source/deployment identifiers are retained in the conversation and private Site history, outside this public repository.

The root gallery presents the new studies. /archive/ (private preview shared separately) retains the original ten with rejected-prototype notices. Old routes remain for historical comparison.

## Verification actually performed

| Check | Result and scope |
| --- | --- |
| Generated-source checks | 226 assertions: structure, local assets/anchors, distinct recipes, seven-day data and arithmetic layout constraints at representative widths. |
| DOM interaction checks | 184 assertions with linkedom 0.18.12: day/keyboard navigation, busy-week data, dialogs, preview enquiries, motion/reduced-motion changes and storage failure. |
| GSAP timeline checks | 231 assertions with the actual engine and plain-property targets at synthetic dimensions: initial/final states, monotonic film scale, coordinated chapters, progress, calendar positions and reverse calculations. |
| CSS and text | 556 selectors / 1,557 declarations parsed; ten representative solid text/background pairs at least 4.77:1; 40 headline font-advance estimates without overflow. Not whole-page accessibility or image-overlay contrast qualification. |
| Historical archive | Eight retained assembly/source/geometry check groups passed after the gallery move. |
| Media and publication | Inspected video/poster frames and the native Sites-generated root-gallery preview image. Native tools confirmed successful publication and exact source provenance. |

[Machine-readable receipt](trainer-motion-studies/verification.json). Source checks are retained in `scripts/build-studies.mjs`, `scripts/check-studies.mjs`, `scripts/check-study-interactions.mjs`, `scripts/check-study-timelines.mjs`, `scripts/check-study-css.py` and `verification/motion-studies-*.json`.

**Still unverified:** actual live scrolling/sticky geometry, three-page desktop/phone rendering, native-dialog focus, touch flick/stop/reverse response, video decoding cost, GPU behavior and device frame pacing. No local Browser tool was exposed and the repository prohibits cloud-browser use. The native gallery preview image is a static artifact, not live interactive acceptance. No 60 fps, field-performance target, full WCAG qualification or owner design acceptance is claimed.

## Next review gate

Review the deployed pages on desktop and phone with slow/fast scroll, stop, reverse, resize, reduced motion and media failure. Confirm comfortable readable states, responsive touch and resilience to asset changes. Record playback/frame-pacing evidence and owner feedback before accepting a benchmark.

Refine the chosen motion language before expanding to ten. Production integration is later work, preserving tenant permissions, confirmed facts, consent/media rights, commercial bindings, draft revisions and publishing history.

Documentation and the handoff remain on `docs/handoff-review-2026-10-29` in [draft PR #107](https://github.com/chordsnstrings/trainer_what/pull/107). This release publishes the independent review Site; it does not deploy the trainsyou application.
