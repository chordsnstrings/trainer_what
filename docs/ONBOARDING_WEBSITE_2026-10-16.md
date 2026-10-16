# Onboarding to a complete website draft — 16 October 2026

## Request and audit

The owner wants AI Studio to turn onboarding answers into a complete website for the trainer's review, including their own photos, specific training services, real prices and suitable scroll modules. Baseline: `ba44008b0dc47321a0b09fb65d5d47249d97e3b8`.

The existing website assistant chooses modules and bounded copy but explicitly leaves images and detailed item content for later. It reads only the published brand, while onboarding saves draft profile/offer data separately. Coaching questions take precedence over commercial website details. Private conversation attachments have different permissions from public website photos. A responsive website preview already exists, although the full editor requires a desktop.

## Plan

1. Add a focused website interview within the existing conversation, preserving the separate My Brain teaching flow. Gather public identity, training/services, delivery, package inclusions, exact prices and billing; reuse answers already supplied and ask only for missing information.
2. Let the trainer select/upload their own website photos with public-use permission, descriptions and roles. Private chat attachments must never become public automatically. Allow an honest text-only/later choice without inventing images or proof.
3. Assemble one bounded proposal using approved public fields and actual workspace offers. Populate native sections, image/scroll modules, navigation, SEO and contact actions. Prices remain bound to persisted offers and the shared commercial policy; no automatic activation or charge.
4. Prepare and save the first website draft automatically once the interview is ready. Retain idempotent provider requests and optimistic document versions. Existing edited or published websites require deliberate replacement through the editor. Review on phones and desktop before explicit publication.
5. Verify full onboarding → photos → offers → draft → responsive review, plus isolation, stale edits, retries, provider fallback and publication boundaries. Complete normal release gates and record the exact serving release.

## Implemented behavior

- The default setup conversation now prepares a website. My Brain keeps its detailed teaching curriculum and saved coverage.
- Public identity, specific training services, online/in-person delivery, package inclusions, exact prices and monthly/upfront terms are gathered with grounded evidence. Trainers can confirm up to six separate packages, including the explicit comparable training price required for nutrition bundles.
- A native photo step supports eight uploads/library selections, descriptions, portrait/cover/training roles and public-use permission. Private chat attachments are never implicitly selected. No invented trainer imagery, credentials, testimonials or transformations.
- The existing bounded website model selects curated layouts. Code fills approved text, FAQs, photos, appropriate scroll modules, SEO, real offer bindings and native contact/navigation actions. Still/reduced-motion/mobile behavior uses the existing renderer. Unsupported empty proof/video/team/schedule sections are omitted.
- The first website draft is assembled and saved automatically after package/photo confirmation. Existing websites are preserved; AI starter in the desktop editor offers an explicit replacement path using the same public context. Responsive private review includes working internal page/section links and labels draft offers awaiting activation.
- Provider intents are stable across outer retries. Product creation is deduplicated through the existing offer API; exact amounts and all activation/payment gates remain authoritative. Document versions protect concurrent edits. Provider failure can still produce a populated template with an honest status.

## Verification checkpoint

Local typecheck and production build passed. The focused conversation/domain/starter suite passed **88 tests**. The separate website/public-page/Arabic-rendering/API boundary suite passed **41 tests** before the later multi-package addition; its website cases are included in the 88-test rerun. Production-browser desktop and Arabic-phone journeys passed: package confirmation (two different desktop prices/terms), two actual photo uploads, automatic AI assembly, scroll modules, native prices, private navigation and reload persistence. Eight screenshots were captured and desktop/home/pricing and Arabic/phone photo/pricing layouts inspected. A stale local incremental bundle was resolved with a clean build; fresh CI builds will verify the final tree. The normal CI and release gates are pending; no new release is claimed yet.

No schema migration, new animation dependency or new provider purchase is required. Verification uses isolated synthetic providers and accounts. Physical-device evidence remains distinct from browser viewport checks.
