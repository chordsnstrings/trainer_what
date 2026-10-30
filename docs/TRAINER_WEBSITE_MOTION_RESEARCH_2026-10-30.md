# Trainer websites: research and motion direction — 30 October 2026

**Status update, 30 October 2026:** the owner approved the three-study proposal (“let's do it”). Those three working studies are now [published for review](TRAINER_MOTION_STUDIES_2026-10-30.md). Production integration remains later work; browser/device smoothness and owner design acceptance are outstanding. The research, proposals and evidence limits below record the planning stage; recommendations awaiting approval at that point must be read alongside this later authorization.

The owner rejected all ten Atlas samples. Smooth, expressive animation is the priority; 3D is optional. A changed palette, font and object do not establish a different website. The next collection must differ in what visitors encounter, how the story develops and what the movement helps them understand.

## Evidence and limits

Reviewed six live trainer/coaching sites through their public page content: The Body Coach, Magnus Method, Kira Stokes, Ultimate Performance, Luke Worthington and Matt Roberts. Also reviewed the creators' case studies for Malta Personal Trainer and PTD Fitness, plus Phive's live page content, Büro's project description and published motion recordings.

For Phive, downloaded public showcase recordings and inspected chronological frames from the homepage scroll, header, responsive typography and class-detail sequences. These establish visible states and transition order, not the live site's frame pacing or response to a user's input. Also inspected four studio presentation clips; those contain promotional compositions and must not be mistaken for live UI captures. Malta Personal Trainer's live URL returned HTTP 503; its entry below relies on its creator's case study.

No cloud browser was used. No local Browser tool was exposed in this session. No live interactive playback, phone performance trace, Lighthouse run or conversion experiment was performed. Encoded recording frame rates are not website performance measurements. Competitor testimonials, numerical results, awards and business claims are not independently verified here.

## What actual trainer sites establish

The right input to the design is the trainer's audience, offer, voice, evidence and available media. Discipline alone is insufficient: two strength coaches may need entirely different sites.

| Reference | What the reviewed page or case study actually emphasizes | Proposed improvement through motion | Consequence for our structure |
| --- | --- | --- | --- |
| [The Body Coach](https://www.thebodycoach.com/) | A recognizable coach, food and fitness together, workout/app screens, beginner entry and member stories. | Follow one ordinary day: the same media frame moves from workout to food to support, with clear pauses for reading. | Demonstrate the coaching experience early; do not bury it beneath a generic philosophy section. |
| [Magnus Method](https://www.magnusmethod.com/) | Coach authority, a named method, app access and separately packaged programmes. | A selected programme expands from its cover into its actual weekly structure, with a reversible transition back to the collection. | Programme discovery can organize the site; each offer needs meaningful differences. |
| [Kira Stokes](https://www.kirastokes.com/) | Trainer personality, method, workout media, challenges and community. | Let a coaching clip lead into a brief explanation of the cue, followed by a clearly related workout preview. | Energy should come from the coach's real movement and voice. |
| [Ultimate Performance](https://ultimateperformance.com/) | Method, client stories, progress evidence and consultation. | Keep one consenting client's image and identity continuous while context, milestones and coaching decisions change around it. | A case study can lead the narrative. Do not manufacture results or animate bodies into supposed outcomes. |
| [Luke Worthington](https://www.lukeworthington.com/) | Specialist physical preparation for actors and productions; role-specific services and professional authority. | An editorial project index opens into a focused dossier; a production timeline reveals preparation decisions and approved media. | A specialist portfolio needs a case-led information structure, not a general fitness funnel. |
| [Matt Roberts](https://mattroberts.co.uk/) | Film-led introduction, private training/club experience, services and enquiry. Public HTML includes a hero video. | A wide film crop settles into an intimate portrait; subsequent image changes are slow and spatially consistent. | Premium private coaching can use fewer, longer editorial chapters and a discreet consultation path. |
| [Malta Personal Trainer — creator case study](https://hellohumans.agency/work/malta-personal-trainer/) | Audience/brand discovery, an approachable active identity, purposeful transitions and mobile bookings. | A compact session walkthrough leads into location and booking without a long pinned sequence. | Brand and booking requirements should determine motion intensity and mobile flow. |
| [PTD Fitness — creator case study](https://www.growww.global/case-studies/ptd-fitness) | A training system, video/client proof and a qualification journey. | Keep the selected goal visible as relevant evidence and service details change, preserving orientation through qualification. | Goal-led routing can be the architecture. Do not borrow the agency's revenue claims or outcome guarantees. |

The third column is our proposal, not a claim that those sites currently implement that animation. These references are useful for content and journey design; this review does not rank their live animation quality.

## Motion reference: Phive

[Phive](https://phive.pt/en/) is a fitness-club reference, not a personal-trainer template. [Büro's project account](https://www.burocratik.com/work/phive) describes variable typography, location films and a dual purpose: visitor impression and practical member access.

The [published UI recordings](https://www.awwwards.com/sites/phive-clubs) show several different forms of choreography:

| Recorded sequence | Visible relationship | Transferable principle |
| --- | --- | --- |
| [Homepage scroll](https://assets.awwwards.com/awards/element/2025/06/68553b9c56927325087914.mp4) | Media, a large brand statement, image clusters and oversized words form distinct chapters. | Change pace and composition between chapters; avoid identical entrances throughout. |
| [Header](https://assets.awwwards.com/awards/element/2025/06/68552c02b6672257149897.mp4) | A type band separates to expose moving footage; colour and imagery change together. | Make the transition explain a relationship between two states. |
| [Typography](https://assets.awwwards.com/awards/element/2025/06/685531b8315b4590193973.mp4) | Words change proportion, grow across the frame and yield to gym imagery. | A headline can be a bridge into the next subject. |
| [Class detail](https://assets.awwwards.com/awards/element/2025/06/6855335fa79d6210214822.mp4) | A media grid leads into a concentrated detail view and returns to the collection. | Preserve context when moving between discovery and detail. |

Our interpretation: the useful ingredient is coordinated change and continuity. Copying Phive's yellow palette, stretched letters or decorative plates across ten sites would repeat the original mistake. Borrow the quality of relationships; design our own forms around each trainer's story.

## Why the rejected Atlas did not meet the brief

Source reviewed in the Atlas checkout corresponding to published commit `[private source revision retained in Site history]`:

- `samples.mjs` and the shared assembly use the same seven section families, with broadly repeated content roles. Changing their order and presentation did not create ten genuinely different journeys.
- `dist/app.js` primarily reveals elements once through IntersectionObserver. `dist/styles.css` applies a common fade and 30px upward movement. This is an entrance treatment, not a whole-page motion composition.
- `dist/scenes.js` concentrates custom movement on decorative WebGL objects. Its fixed per-frame interpolation factor also makes settling dependent on frame cadence.
- Source, DOM and geometry checks establish technical properties. They cannot establish visual distinction, desirable pacing or perceived smoothness.

The successful publication remains a factual historical event. Design acceptance failed. The 55-variant prototype catalogue is not an approved production baseline.

## What “extremely smooth, with oomph” means here

1. **Continuity.** A recognizable image, title, frame or navigation anchor survives a transition. Visitors understand where the next view came from.
2. **Coordinated timing.** Media, text and background participate in one composition. Their movements overlap deliberately instead of each starting an unrelated reveal.
3. **Decisive changes in scale.** Use a few memorable transitions: a film becomes a portrait, a client card opens into a story, or a training week unfolds. Surround them with readable stillness.
4. **Immediate control.** Slow scrolling, a fast flick, reversal and a mid-transition stop must all produce coherent states. Long lag does not qualify as smoothness.
5. **Purposeful hierarchy.** The coach, method, proof and next action remain more important than the effect. Paragraphs and forms do not need continuous movement.
6. **Consistent frame pacing.** Performance must be observed and measured on the actual implementation. Adding a smooth-scroll library is not a result.

Initial tuning proposals, not measured values: control feedback around 120–200ms; image/detail transitions around 400–650ms; occasional large editorial transitions around 700–900ms. Scroll-linked chapters use progress and reading space rather than a forced playback duration. Avoid stacking smooth-scroll inertia and long scrub catch-up on the same movement. Native touch scrolling is the baseline.

## Three motion studies to validate before expanding to ten

These are proposed studies, not newly built samples. Each must cover arrival, the signature transition, a readable settled state and a usable next action. A 20–40 second review recording is a demonstration format, not a mandated time visitors must spend.

### A. Coach documentary

**Best inputs:** an expressive trainer, approved short footage, portrait and a clear coaching belief.

| Beat | Composition and movement | Meaning |
| --- | --- | --- |
| Arrival | An intimate full-width coaching clip, concise title and visible enquiry. No loading spectacle. | Meet the person. |
| First scroll | The media frame contracts into an editorial portrait position while the title settles into a smaller identity label. Keep the subject's crop stable. | The person in the film is the person explaining the method. |
| Method | Related footage or stills change beside short coaching principles; only the active relationship moves. | Understand how coaching feels. |
| Release | The frame rejoins normal flow; a client account and offer follow at a calmer pace. | Move from personality to evidence and action. |

Use a matched still when video is unavailable. A phone uses a compact crop and short transition rather than a miniature desktop scene.

### B. Client case journal

**Best inputs:** public-use permission for a real client story, dated evidence and a specific coaching approach.

| Beat | Composition and movement | Meaning |
| --- | --- | --- |
| Arrival | Lead with the client's goal and context, an approved portrait and a direct route to coaching. | Establish relevance. |
| Open story | The chosen client card expands into a reading view; name and portrait keep their identity and position relationship. | Follow one person rather than scan interchangeable quotes. |
| Milestones | A small progress rail changes alongside actual dated media, coach decisions and client comments. Hold each state long enough to read. | Explain the process behind the evidence. |
| Exit | The story resolves into the applicable service and consultation. | Connect proof to the offer. |

Never morph a person's body, invent metrics or imply an outcome guarantee. Without client permissions/evidence, select a method demonstration instead of fabricating a case study.

### C. A week with your coach

**Best inputs:** a defined coaching service, an actual weekly process and approved product/session material.

| Beat | Composition and movement | Meaning |
| --- | --- | --- |
| Arrival | Present the visitor's practical problem and the service. | Establish fit quickly. |
| Week unfolds | A weekly view expands into one session, a check-in and the next adjustment; the same day marker persists. | Show what the customer actually receives. |
| Interaction | Selecting a day changes its content in place. Scrolling can advance the overview, but selection remains usable without animation. | Give visitors control over exploration. |
| Decision | Bring the demonstrated service into its real availability and enquiry/offer action. | Make the next step concrete. |

Show only supported service features. Product screens need actual approved data or explicitly labelled demo data, never invented functionality.

## Ten structurally different directions for the next collection

The earlier request for ten remains the intended collection size. The three studies above calibrate execution quality before expanding it. These are narrative proposals rather than ten new samples or final visual identities.

| Direction | Distinct organizing structure | Signature movement | Needed material / fallback |
| --- | --- | --- | --- |
| 1. Coach documentary | Coach introduction → lived method → evidence → offer | Film-to-portrait continuity | Trainer footage; portrait-led editorial fallback |
| 2. Client case journal | Client index → one journey → coaching decisions → consultation | Card-to-story expansion with dated milestones | Consented cases; use method demo if unavailable |
| 3. Training week | Service fit → interactive week → support → enrolment | Week-to-day expansion and persistent day marker | Confirmed weekly process and service details |
| 4. Private practice | Personal letter → experience → selected services → private enquiry | Large photographs settle into quiet editorial spreads | Strong portraits and an individual voice |
| 5. Find your starting point | Goal choice → relevant approach/proof → fitting offer | Selected goal becomes the next chapter's anchor | Real offer differences; direct browse always available |
| 6. Inside a session | Session opening → warm-up/work/feedback → coaching rationale → booking | A session frame carries changing cues and annotations | Approved session footage or still sequence |
| 7. Performance dossier | Specialist brief → project index → preparation case → enquiry | Index-to-dossier transition and preparation timeline | Approved specialist projects and credentials |
| 8. Movement club | Upcoming session → people/place → recurring schedule → join | Media mosaic resolves into the current event or timetable | Real community media, location and schedule |
| 9. Programme premiere | One programme → intended participant → curriculum → commitment → purchase/enquiry | Programme cover opens into its actual curriculum | A defined programme; no fabricated scarcity |
| 10. Learn with the coach | Useful lesson → lesson collection → teaching philosophy → coaching | A lesson thumbnail expands into demonstration and returns in place | Approved educational content; still/diagram alternatives |

The distinction test: remove colour, fonts and names. The order of information, composition, interaction and reason for each transition must still make the directions recognizably different.

## How modular composition should work

Retain reusable engineering, but choose the story before choosing sections.

**Conversation inputs:** audience, visitor's main question, coach voice, business model, actual offers, primary action, available photographs/video, usable proof, and an optional visual preference. These belong to a confirmed public website brief, not automatically to the private coaching Brain.

**Composition order:** select a narrative → check its media/evidence prerequisites → choose compatible chapters → compose the transitions between them → write grounded content → generate responsive/static alternatives → show an editable whole-site draft.

A reusable chapter needs a contract containing:

- purpose and content/asset slots;
- entry state, readable state and exit state;
- the identity of any image/title/frame carried into the next chapter;
- allowed predecessor/successor relationships;
- scroll span, motion profile and active-media limit;
- phone/touch and reduced-motion behaviour;
- editable content, crop/focal point, variant and trainer locks.

A shared-element transition is valid only when its two chapters reference the same semantic item. Arbitrary section rearrangement cannot silently break continuity. Compatible swaps can preserve the transition; incompatible edits should select a suitable alternate transition and show it in preview.

Seed selects authored narrative and chapter recipes and fills confirmed content. It does not generate arbitrary executable animation code. The trainer primarily edits wording, assets, offers, emphasis and tone, then reviews the whole site. Advanced rearrangement can remain available with compatibility checks.

A media-poor conversation must still produce an attractive complete draft by choosing a photo/editorial or teaching structure. Do not make the user wait for expensive media generation to see a website. Avoid empty proof sections and placeholder clinical/business claims.

## Proposed implementation and acceptance

[GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) supports coordinated timelines, pinning and scroll-linked progress. Use it where chapter composition warrants it; ordinary control feedback can stay in CSS. [Lenis](https://github.com/darkroomengineering/lenis) is an optional enhancement to evaluate for desktop wheel input. Keep native touch as the baseline and test keyboard, anchors, navigation, modals and reduced motion. Neither library is an aesthetic or performance guarantee. Three.js is not a default dependency of a trainer site.

Prefer transforms and opacity for most motion. Profile masks, large images, changing type and filters instead of assuming they are cheap. Reserve image/video dimensions, decode near-needed media, keep visible media bounded and pause hidden work. [MDN's animation performance guidance](https://developer.mozilla.org/en-US/docs/Web/Performance/Guides/Animation_performance_and_frame_rate) explains the rendering cost: a 60Hz frame interval is about 16.7ms. At 120Hz the interval is about 8.3ms. Those are frame budgets, not measured results for this work.

A study is ready for design review only when:

1. **Distinctness:** its grayscale wireflow differs from the other studies; the dominant story, first interaction and main transition are different.
2. **Playback:** actual browser review covers slow scroll, fast flick, reverse, stop, resize/orientation, refresh mid-page and back navigation. No jumps, oscillation, blank pin states or clipped reading states.
3. **Phone behaviour:** inspect at least a supported iPhone/Safari and a mid-range Android/Chrome, plus desktop wheel and trackpad. A desktop recording is insufficient.
4. **Performance evidence:** attach a trace for each target device/refresh mode showing frame pacing and dropped frames during the busiest transition. Initial acceptance target: at least 95% of frames presented on time in a repeatable warmed 10-second sequence, no animation-attributable task over 50ms, and no repeated stutter visible on review. Report cold-load behaviour separately. Use real presentation evidence, not only a requestAnimationFrame average; tune/degrade the effect when the target is missed.
5. **Reading and control:** CTAs work immediately, paragraphs settle, navigation can bypass chapters, forms retain normal focus/scroll behaviour, and reduced motion exposes the full story and all actions.
6. **Content fit:** real trainer media and facts carry the experience; temporary demonstration material is clearly identified. No copied competitor copy, stock testimonial presented as real or decorative animation compensating for missing content.

The numeric tuning and acceptance targets above are proposals for the next build, not claims about any reference or existing sample.

## Review sequence and durable state

Research and planning are complete. Next proposed step: agree the motion direction through these references, then build the three distinct working studies for review before producing ten complete sites. The production generator remains a later integration stage under the [original website audit](WEBSITE_CREATION_AUDIT_PLAN_2026-10-29.md), with this document superseding its assumption that 3D is central.

All ten existing [Atlas prototypes](TRAINER_SITE_SAMPLES_2026-10-29.md) are rejected. Preserve their source and factual publication receipts for history, but do not integrate their catalogue as an approved design system. Reuse the existing independent Site identity if subsequent sample work is authorized.

Updated documentation belongs on `docs/handoff-review-2026-10-29`, [draft PR #107](https://github.com/chordsnstrings/trainer_what/pull/107). No merge to main, production app/generator change, paid Seed call, tenant migration or deployment is part of this research stage.
