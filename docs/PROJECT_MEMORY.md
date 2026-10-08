# Project memory

## Current work — 8 October 2026

Conversational onboarding: implement trainer setup, continued Brain teaching and client profiles as short text-message conversations. Reuse the existing frontier-model adapter; one bounded inference per substantive reply, code-only controls, batch rule compilation. Remember grounded facts and transcript with person/workspace isolation. Permissions and approvals stay explicit. Branch `feat/conversational-onboarding-2026-10-08`, base `6b8ed72`. Implementation is in PR #48. TypeScript, 16 focused API/domain checks, 19 layout/paging regression checks, production build and phone/desktop browser journeys passed; normal release gates are tracked on that PR. Local execution is unavailable. After merge, the existing checked-main controller deploys and the read-only Verify serving release workflow checks the public release header. See Claude handoff and docs/features/onboarding-chat.md for the release boundary and entry points.

## Earlier work — 7 October 2026

UAE policies and signup: the owner explicitly authorised publication now with missing business details updated later. English only; no named hosting location. Migration 090 publishes the approved three-policy pack and enables the existing legal setting; consent and signup enforcement remain intact. Policies use existing in-account Support/Privacy tools. No company/contact information is invented. PR #44 is live in release `02601ce22c004c60d377f0f3e4955da5337ccdfb`, verified 7 October at 12:47 Dubai time. All five PR/main checks passed, alongside the 26 focused checks and TypeScript. Readiness and `/signup`/policy pages return 200; password signup and trainer/client joining are open; all three policies are version 2 and match the approved text. No production test accounts were created. Lawyer review and later document versions remain follow-up work.

## Earlier work — 6 October 2026

Production music automation. See [music agent](MUSIC_AGENT_2026-10-06.md) and [Claude handoff](../CLAUDE_HANDOFF.md). The owner approved public source/sanitized-handoff publication and deployment. The prepared implementation was restored after a workspace reset; restored-source TypeScript, production build, fifteen music tests and deployment checks passed. Public CI and deployment are underway. New migration starts automation paused until earlier paid work is reconciled.

Home page scroll scenes are on branch `feat/scroll-scenes-2026-10-06` (draft PR #37), built and checked and awaiting owner review. They are off for reduced motion, the site toggle, crawlers and webdriver. See [scroll scenes](features/scroll-scenes.md).

Previous verified release: PR #35, main `136e7b247e03c5f3d786ef2be1aff63c9424163f`. All five PR checks, all five exact-main checks, readiness and public assets passed. Coach-workflow F01–F10 changes are live there. Fresh prompt-v6 qualification, live-provider checks and physical-device guided-session checks are still separate deliverables.

## Standing owner decisions

- Always deploy completed changes after normal release checks. Keep Claude handoff current. Give short updates and avoid redundant checks.
- Use a clean, minimal white interface, consistent buttons, spacing and navigation. Smooth trainer onboarding and daily use matter.
- Trainers teach their own coaching AI. They are not expected to build software. The desktop-only visual website editor assembles varied modules; published multipage sites remain responsive. Include transformation galleries.
- Coaching includes structured workouts and nutrition appropriate to the subscription tier. Guided voice is an add-on. Public AI copy says **frontier model**; the configured implementation uses the intended Seed connection.
- Cartesia provides the configured coaching voice. Web guided sessions use explicit progress confirmation, music between cues and practical remote controls. Ambient gym noise must not create repeated AI calls or advance exercises.
- Music is a shared reusable instrumental bank: eight genres, thirty songs per playlist, shuffle/repeat, durable MP3s. The lifetime generation budget is set in Admin Music (originally 120 requests / 1,440 credits; since 7 October 2026 the operator sets any positive budget, with no ceiling in code: "we should be able to set it ourselves", migration 089), including earlier external purchases. Reconcile unknown paid intents before new purchases.
- Free onboarding is a lead hook (7 October 2026): trainers pay nothing to join, set up or teach their AI; the platform bears that AI usage. Commission and card fees come out of subscription revenue; a trainer's own domain is the only optional purchase. Public positioning: an AI trainer platform, free to join.
- Stripe collects; Lean pays through the company bank. Financial history is immutable. Preserve tenant isolation, consent and safety boundaries outside the model.
- Keep credentials, private account records and recovery archives out of Git, prompts and logs. Use existing authenticated APIs and host access. Do not use a cloud browser for this repository work.

Historical decisions remain in [the prior project memory](https://github.com/chordsnstrings/trainer_what/blob/136e7b247e03c5f3d786ef2be1aff63c9424163f/docs/PROJECT_MEMORY.md) and are not silently overridden by this shorter checkpoint.
