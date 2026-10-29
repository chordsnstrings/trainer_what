# Trainer website creation — audit and proposed plan

Date: 29 October 2026 (Dubai). Reviewed source: `56acf157b945483a733b71988a351909a4097206`.
Status: **proposal for owner review; implementation has not started**.

Owner request: simplify creation while improving visual quality. The onboarding conversation should collect website details, photos and videos, then leave a complete, extensive, editable website with distinctive Three.js and scroll experiences. Audit and plan first; obtain approval before implementation.

## 1. Outcome and recommendation

A trainer should finish the conversation with a coherent private website to review, then make changes in ordinary language or directly on the preview. Choosing modules, arranging rows and configuring animation should be advanced controls.

Keep the useful internal primitives and existing commercial/publishing boundaries. Replace the default experience with a complete-site composition system: public brief, media understanding, art direction, page narrative, section-specific writing, media placement and coordinated motion. A structured site document remains the persisted source of truth. The model proposes validated content and design choices; an application-owned renderer implements them.

The visual target is a distinctive trainer brand with deliberate typography, photography, video and genuine 3D where it supports the story. Trainer sites may have their own identities; the onboarding and editing product retains trainsyou CI. Adding effects alone will not fix generic composition or repeated copy.

## 2. Audit findings

This is a source and existing-test audit. No new browser journey, device measurement, production data change, paid model call or application test run was performed for this audit. Findings about generic composition follow directly from the generation code; current rendered visual quality still needs a representative benchmark.

| Finding | Evidence in the current implementation | Consequence |
| --- | --- | --- |
| Automatic onboarding generation already exists | [prepareOnboardingWebsite](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/apps/api/src/onboarding-website.ts#L85) saves the first private draft after confirmed website facts, offers and photos. The October 16 implementation is [documented](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/docs/ONBOARDING_WEBSITE_2026-10-16.md). | This is an upgrade of an existing path. Rebuilding the chat-to-draft connection would duplicate work. |
| Generation mainly chooses catalogue entries | [Starter plan and prompt](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/packages/providers/src/site-builder-starter.ts#L19) select existing templates, modules and variants; one response has a 3,000-token budget, at most five pages and 24 sections. | It has little representation of overall narrative, bespoke composition, scene choreography or asset direction. Larger budgets alone would not solve that. |
| Much of the generated copy is overwritten | [populateSiteStarter](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/packages/providers/src/site-builder-content.ts#L15) replaces titles, bodies and item content with fixed rules, repeated bio/services and stock FAQs. Page descriptions reuse the bio. | Even a varied AI layout receives similar content and rhythm. This is a direct cause of template-like results. |
| The composition model cannot inspect the supplied pictures | [Model request](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/packages/providers/src/site-builder-starter.ts#L271) passes photo roles and descriptions, not image inputs. [Photo selection](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/apps/web/components/onboarding-website-photos.tsx#L8) asks the trainer to assign roles and descriptions. | It cannot make informed choices about composition, negative space, useful crops, contrast or which image can carry a hero. |
| The automatic media flow is photo-only | [Website interview](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/packages/domain/src/website-interview.ts#L4) supports eight photos with portrait/cover/training roles. The composition filter excludes video. The manual builder separately supports [YouTube/Vimeo embeds](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/packages/contracts/src/site-builder.ts#L59). | Video exists in the manual editor but does not become a first-class onboarding input or generated website asset. Uploaded video, processing, posters and cinematic background clips need new work. |
| Style is optional; motion has narrow semantics | Style and motion fields exist in setup schemas but are absent from [required website facts](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/packages/domain/src/website-interview.ts#L33). The output primarily adds photo scroll modules. | The system can finish without learning meaningful visual preferences. “Cinematic” is mostly a module setting, not whole-site direction. |
| Generated cinematic motion is downgraded on phones | [Content population](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/packages/providers/src/site-builder-content.ts#L87) sets scroll sections to `mobile: "stacked"`, although the renderer can animate narrow layouts. | A phone visitor can receive still stacks even when cinematic motion was chosen. Mobile needs its own designed treatment. |
| No Three.js website runtime is present in the inspected path | [Web dependencies](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/apps/web/package.json) have no Three.js dependency; [scroll renderer](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/apps/web/components/site-builder-scroll.tsx#L51) animates DOM photographs and CSS properties. | Real 3D requires a scene contract, assets, rendering lifecycle, loading strategy and fallback support. |
| Chat stops short of ongoing website revision | [First-draft guard](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/apps/api/src/onboarding-website.ts#L89) preserves any existing edited/published site and directs replacements to the editor. [Phone quick edit](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/apps/web/components/website-quick-edit.tsx#L126) covers headline, intro and contact details; detailed design remains in the desktop editor. | Later changes are fragmented. The trainer cannot routinely revise a complete site through the same conversational experience. |
| Good foundations already exist | [Structured documents](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/packages/contracts/src/site-builder.ts#L6), optimistic versions, own-media checks, real offer bindings, [20 publication snapshots](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/apps/api/src/site-builder-storage.ts#L13), responsive rendering and explicit publication. [Tests](https://github.com/chordsnstrings/trainer_what/blob/56acf157b945483a733b71988a351909a4097206/tests/onboarding-website.test.ts) cover replay, ownership, actual prices and failures. | Preserve these controls. Extend visual and editorial acceptance rather than replacing working commerce and publishing infrastructure. |

The underlying document supports many more pages/sections than the AI starter. The five-page/24-section limit is a generation policy, not the platform's maximum. “Extensive” should mean complete and useful for that trainer, with page-specific content and working journeys; it should not mean automatically filling every available page.

## 3. Proposed trainer experience

1. **One conversation with an emerging preview.** Reuse existing profile and offer facts. Ask about audience, positioning, public coaching approach, tone, services, goals for the site and preferred language. Collect exact offer terms through the current commercial flow. A preview can start before those commercial details are complete; unavailable offers remain unpublished.
2. **Add media in the conversation.** Accept photos, portrait and landscape videos, existing supported video links, logos and optional inspiration references. Suggest roles, crops and short descriptions from the supplied assets; ask the trainer only where meaning or public-use rights are unclear. Keep public website permission explicit and separate from private Brain/chat attachments.
3. **Recommend a visual direction automatically.** Choose a coherent direction based on the trainer and available media. Offer a small “try another direction” control rather than forcing a template-selection exercise. Defaults should be useful when a trainer has no design preference.
4. **Finish the whole draft.** Generate the homepage and appropriate supporting pages, copy, navigation, actual offer components, contact flow, media placement, mobile composition and motion. Every included page has a purpose and distinct content. Omit unsupported proof rather than inventing credentials, testimonials or results.
5. **Edit the finished result.** The primary view is the website plus a conversation. Examples: “Use my running video first”, “Make it more editorial”, “Shorten the homepage”, “Make a page for online coaching”, “Keep this section exactly as it is”. Clicking text/media enables direct edits. Preview changes, undo and restore remain available. Page/module controls move under Advanced.
6. **Publish deliberately.** Review mobile and desktop and resolve actual readiness issues. Existing legal, payment, Brain and workspace publication requirements remain authoritative. A website can be ready as a private draft while public launch remains blocked by an existing platform gate.

The generated website should be editable on a phone, including media replacement and section-scoped conversation. The trainer should not need a desktop merely to finish onboarding.

## 4. Visual and motion system

Build coordinated art directions with internal composition rules rather than exposing a larger module catalogue. Directions govern type scale, grid, whitespace, image treatment, colour, pacing, page transitions and which scene types are appropriate. Each has several compositions; a shared direction must not imply identical sites.

Initial benchmark briefs: a strength coach, a Pilates/mobility coach and an endurance coach. Each receives a complete site from different supplied facts and media. The owner can judge whether they feel individually designed before broader generator work proceeds.

Proposed scene families:

| Scene | Intended role | Inputs and limits |
| --- | --- | --- |
| Cinematic introduction | Establish trainer identity and atmosphere | Genuine trainer video or still, clear text hierarchy, visible action; muted decorative playback with a poster and user control |
| Three.js spatial composition | A distinctive opening or chapter transition | Typed camera/material/geometry parameters, approved assets or reusable procedural geometry; real perspective and lighting |
| Scroll-led coaching story | Explain the approach through chapters | Coordinated text, photographs and optionally a camera path; native scroll, readable sections and direct navigation |
| Media-led evidence | Show supplied work and real client stories | Approved assets and factual captions; no generated transformations or outcome claims |
| Programme exploration | Explain who each offer serves | Actual product bindings with readable comparisons and working joining actions; animation cannot hide prices or controls |

Start with one main WebGL scene per page, composed into a shared lifecycle, and use lighter DOM motion elsewhere. Additional scenes require a demonstrated visual purpose and measured budget. This is a proposed scope decision, not a browser limit.

Keep important content, navigation, forms and purchase actions in semantic HTML. Lazy-load 3D after the useful first frame; render while visible and active, cap rendering resolution, release GPU resources and provide a designed still/DOM version for reduced motion or unavailable/lost WebGL. Phones get a deliberate portrait composition and appropriately simplified 3D rather than automatically disabling the entire signature experience. Never intercept the user's wheel/touch scrolling.

Three.js's own [render-on-demand guidance](https://threejs.org/manual/pages/rendering-on-demand.html) supports avoiding unnecessary continuous rendering. Its [responsive-design guidance](https://threejs.org/manual/pages/responsive.html) informs canvas size and resolution management. These are implementation references, not evidence of current performance.

## 5. Proposed technical design

**Public brief and asset manifest.** Add a versioned website brief: confirmed public facts and their source, page objectives, chosen direction, content approval, asset roles and editable preferences. Store image/video metadata, focal points, renditions, posters, rights, public/draft state and processing status separately. Never expose private training material just because it informed the trainer's Brain.

**Video processing.** Keep the existing image library compatible. Add resumable direct uploads and durable object storage for video, plus bounded validation/transcoding jobs, mobile/desktop renditions, poster selection and captions for substantive spoken content. Native player and decorative background modes have different controls. Keep existing embed links usable. This needs storage, delivery and processing cost measurement; the current image upload endpoint is not a video pipeline.

**Staged generation.** Replace the single catalogue-selection call with resumable stages: brief validation; asset understanding; sitemap and narrative; visual/scene composition; section-specific writing; deterministic assembly and checks. Stages are logical jobs, not a requirement to use autonomous agents. Reuse existing results and re-run only affected stages. Record per-stage model usage, cost, status and input revision; preserve the project's rule against blindly retrying unknown paid outcomes.

**Structured output.** Extend the persisted site format with explicit direction, semantic content and validated scene parameters. Support existing version-1 sites alongside the new format. Keep stable page/section/asset IDs and native action/product references. Models do not emit executable JavaScript, arbitrary shaders or unrestricted HTML. Unique results come from stronger content and composition, not unrestricted code execution.

**Purpose-written content.** Preserve approved AI-written text for each section instead of overwriting it with repeated stock copy. Validate factual claims and identifiers separately. Deterministic code continues to supply prices, billing terms and commercial actions. Set content budgets by page purpose; use the supported document size and actual editorial needs rather than blindly raising all limits.

**Renderer.** Preserve the existing public/preview renderer relationship. Add lazy scene islands using Three.js with an application-owned runtime. Centralise viewport, scroll progress, visibility, reduced motion, pause/resume, context loss and cleanup. Load these assets only on sites that use them; trainer/subscriber app bundles should not inherit the new rendering cost.

**Conversational editing.** Add a scoped patch proposal against an exact site revision. The proposal identifies affected pages/content/media/scenes and explains the change. Direct edits and “keep this” locks survive subsequent generation. Ambiguous scope gets a short clarification; a local edit cannot silently replace the whole site. Existing optimistic versions, history and draft-before-publication rules remain.

**Quality pass.** Check factual grounding, completeness, unique section purpose, duplicate copy, real offer/action bindings, media readiness, responsive composition, overflow, contrast and motion fallbacks. Use actual browser captures and owner review for visual judgement. Passing a schema or a screenshot-diff test does not prove tasteful design.

## 6. Implementation sequence after approval

| Phase | Deliverable | Acceptance before proceeding |
| --- | --- | --- |
| 1. Establish the visual standard | Three representative complete trainer-site concepts, including real scroll/Three.js behaviour and phone compositions | Owner agrees the outputs look individually designed and are worth generating automatically |
| 2. Public brief and media intake | Conversational brief, asset understanding, image/video intake and resumable media processing | A trainer supplies content in chat without assigning every layout/asset role manually; private media stays private |
| 3. Complete-site generation | Staged composer, new document support, page-specific copy, scene runtime and actual product/contact integration | One complete onboarding-to-preview journey produces the approved visual standard without opening the module editor |
| 4. Review and continued editing | Preview-led conversation, direct edits, scoped patches, locked choices, phone editing and revision recovery | Replacing a video or changing one page preserves unrelated work and real commercial terms |
| 5. Migration and measured pilot | Existing-site opt-in, replay/cost checks, browser/device tests and controlled release | Existing sites still work; new-site quality and performance meet the agreed acceptance criteria |

Do not rewrite the existing editor or migrate every live site at the start. Retain Advanced editing and the legacy renderer while the new path proves itself. Content migration and site redesign are explicit draft operations.

## 7. Definition of done

- The trainer completes onboarding and reaches a populated, navigable private website without dragging modules or correcting placeholder sections.
- The site has appropriate supporting pages, genuine visual differentiation, section-specific copy, working native offers and contact/join actions.
- Submitted photos and video are deliberately placed; video processing can resume; a failed enhancement leaves a usable preview with accurate status.
- Genuine Three.js and coordinated scroll effects work on the agreed desktop and phone test matrix. Reduced-motion, no-WebGL, context-loss and no-JavaScript paths preserve readable content and essential actions.
- Chat edits and direct edits persist across reloads; unrelated and locked content survives regeneration; conflicts and undo work.
- Price and billing facts come from actual offers. Private media, unpublished pages, unapproved claims and cross-tenant assets never leak.
- Existing websites, domains, publication history and customer joining remain intact.
- Visual acceptance compares the three distinct benchmark briefs; it is not inferred from module counts or successful file generation.
- Proposed performance targets: LCP <= 2.5 seconds, INP <= 200 ms and CLS <= 0.1 at the 75th percentile once representative field data exists. Before that, use repeatable mobile lab journeys and browser traces, explicitly labelled as lab results. These thresholds follow [Web Vitals](https://web.dev/articles/vitals); they are targets, not present measurements or promises.
- Measure generation time, model calls/cost, video processing/storage/delivery and edit cost during the pilot. Reuse cached asset analysis and apply scoped edits; do not estimate spend from an arbitrary number of agents.

## 8. Scope and next decision

Requested now: audit and plan. Completed here: source audit, architectural recommendation, proposed experience, phased delivery and acceptance criteria.

Awaiting owner approval: the proposed direction and first implementation phase. No application code, dependencies, infrastructure, media processing or production settings have been changed for this proposal.

The handoff, project memory and completion record are updated in the same documentation review branch. A prior attempt to move main for the handoff-only update was rejected by automatic approval review because main can trigger deployment and CLAUDE.md separately assigns deployment. Documentation remains on a review branch; no merge or deployment is attempted as part of this planning request.
