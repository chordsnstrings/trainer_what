# Visual coach website builder

Owner direction: 2 October 2026. A professional desktop-only editor, responsive visitor websites, extensive reusable modules and economical Seed 2.0 starter assembly. The active implementation checkpoint and release evidence are in `CLAUDE_HANDOFF.md`.

## Editing and content

The editor at `/trainer/website` replaces the old fixed-field website form. The workspace is designed for desktop widths of at least 1,100 px; narrower devices display a desktop-required screen. Desktop users can inspect desktop, tablet and phone website previews. The visitor website itself stays responsive.

Pages, a searchable module library and reusable sections sit beside the canvas. Trainers can insert and reorder sections, select their content and design controls, duplicate sections/pages, arrange nested custom elements, change layout variants, set responsive overrides and undo/redo edits. Pages have independent titles, addresses, navigation visibility, search descriptions, social images and indexing controls. Renaming a page preserves a redirect. The website has its own theme and shared header/footer; it does not overwrite the member app's design.

There are 38 section families and 270 curated layouts (at least six per family):

| Purpose | Families |
| --- | --- |
| Introduce the trainer | Hero, introduction, about, coaching team, image and text |
| Explain the coaching | Benefits, services, how it works, schedule, community, nutrition approach, coaching experience |
| Offer coaching | Programmes, programme details, membership pricing, booking, call to action, comparison |
| Show real evidence | Photo gallery, progress stories, testimonials, partner logos, facts and figures, qualifications |
| Share content | Video, text/article, coach's statement, featured image, useful resources, FAQ |
| Help visitors act | Contact/enquiry, start a conversation, social links, page navigation, footer, announcement |
| Compose layouts | Divider/space and custom columns with nested headings, text, images, buttons, videos and spacers |

Five complete four-page starting designs are provided: Editorial, Strength, Minimal, Warm and Performance, plus a blank canvas. Proof sections start without invented testimonials, qualifications, figures or client outcomes. Native programme/pricing sections use actual published workspace offers. Contact forms feed the existing enquiry inbox; settings and inquiries remain accessible at `/trainer/website/settings`.

## Drafts, publication and compatibility

The shared contract is `packages/contracts/src/site-builder.ts`. `site.builder` is optional in the existing site document. A legacy website continues to render unchanged until a builder draft is published. Conversion preserves existing text, pages, media, SEO and contact fields. Saving a migrated draft never changes the published legacy site.

Draft writes use the existing optimistic `version` check. The desktop editor serializes autosaves and keeps edits made during an in-flight save. A conflict requires resolution rather than silently overwriting another tab. Publishing is an explicit action after the newest draft is saved. The existing workspace launch and commercial gates remain in force.

The API retains the latest 20 immutable publication snapshots. Restoring an earlier publication only replaces the draft; publishing remains a separate action. Deleted offer/gallery references in an old snapshot may need repair before that restored draft can be published. Migration `083_site_builder_history` adds owner-only database policies for history and AI proposal records, publication immutability, and bounded-query/idempotency indexes.

Public projection strips hidden pages, globally hidden sections/elements, reusable draft sections, hidden-page redirects and inactive legacy prose. Media becomes public only when actually referenced by published visible content or an existing public gallery/brand surface. Media ownership is checked on edits and publication. Privacy erasure removes affected current references and snapshots. Publication also checks deep visible page copy through the existing wording policy.

## AI starters

`GET /api/v1/tenant/site/starter/options` reports assistant availability. `POST /api/v1/tenant/site/starter` accepts an owner-scoped request ID, brief, optional template, language and current site version. It returns a proposed builder document; it does not write `coach_sites` or publish.

The generator resolves the existing configured Seed 2.0 connection or a tested Seed profile independently of the active coaching model. It respects the global integration switch and never falls back to a more expensive model. Model/provider names stay out of trainer UI.

One request is capped at 3,000 output tokens, 60 seconds, 5 pages and 24 sections. The model selects catalogue module/layout IDs and bounded plain-text fields. Code constructs and validates the final document; the response cannot provide executable code, custom CSS, arbitrary embeds, invented prices or evidence. Only the trainer's public brand and entered brief go into the prompt. Existing cost events and daily call limits apply.

Persistent request IDs prevent duplicate paid retries, including unknown outcomes. Equivalent requests can reuse a tenant/catalogue/brand/model-scoped result. If no eligible connection exists or the answer is invalid, the API returns a clearly labelled ready-made template. Manual templates and editing work without AI.

## Routes and verification

Public pages keep `/coach/<trainer>/<page>` and the existing trainer/custom-domain routing. Server-rendered metadata includes per-page title, description, canonical URL, social image and noindex. Sitemaps include actual visible indexable pages; removed default pages and redirects are not listed. Arabic uses the shared document language and RTL layout.

Video support is a click-to-load allowlist for YouTube and Vimeo, with optional poster and caption. Video files are hosted with those services; this release does not add video uploads or arbitrary iframe/HTML/script embedding. This is a page builder; it does not add a separate blog/CMS or an independent booking/payment engine.

Targeted suites cover contracts/catalogue, persistence/tenant isolation/media/history, mocked AI generation, assembled cookie/CSRF and legacy conversion journeys, discovery and go-live checks. `npm run test:site-builder` starts the isolated synthetic local fixture and executes the desktop editor/public mobile journey in local Playwright. It uses an existing web production build. The GitHub application job runs that journey after the existing browser check. No browser test uses a real trainer account or calls a live model.

## Module expansion — 2 October 2026

The catalogue adds 154 layouts using 38 shared composition recipes in `packages/contracts/src/site-builder-layouts.ts` and scoped `site-builder-layouts.css`. Existing layout IDs and saved content remain valid. Media, collection, editorial, enquiry, FAQ, process and column compositions respond to the builder container, so editor previews match public breakpoints. Four-column presets create four independent editable columns.

**Before & after gallery** is the existing stable `transformation` family, now explicitly labelled and searchable by multiple words (for example, “before after”). Its six layouts pair before/after photos for each client, retain contextual copy and image descriptions, and offer the coach a dedicated “Add client transformation” flow. Seed prompt `site-starter-v2` maps requests for coached-client transformations to this family while leaving photos and proof copy for the coach; no fabricated outcomes, testimonials or member records enter generation.

Editor panels use consistent 16 px inline and 20 px block padding, with explicit canvas gutters, roomier page rows and aligned inspector controls. Contact image placeholders use their aspect ratio without forcing the layout wider or overlapping the form. The layout matrix script checks all variants at 1280/768/390 px in English and Arabic; the editor journey checks panel gutters, search and existing save/publish interactions. No new database migration or paid provider call is required.
