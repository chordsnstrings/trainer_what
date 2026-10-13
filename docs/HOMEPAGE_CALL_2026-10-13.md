# Kamran marketing call — audit and delivery plan

Owner request (13 October): bring brief voice fillers to the homepage, replace hold-to-speak with a natural call, and guide visitors through the marketing site without breaking the conversation.

## Audit

- Production is serving PR #60, `037ffde82526d23b1060ccdfbe99572b5c20ae5a`. Readiness returned HTTP 200 and that exact header at 01:47:28 UTC on 13 October. Main checks 38286474178 and serving verification 38289860471 passed. Previous signed-in call/UI/photo delivery is live.
- `marketing/assistant-panel.tsx` still uses press/release MediaRecorder, waits for complete STT → model → TTS, and mounts under the home page only. Previous wait cues are confined to `OnboardingCall`.
- The only navigation action is signup via `window.location.assign`; it reloads the document and loses the call. There is no current-page context or checked destination contract.
- Public calls have existing day/visit/address caps and transient transcripts. Optional cue preparation must use these platform spending boundaries, never authenticated coaching endpoints. Unknown synthesis outcomes must not be retried.
- The existing audio worklet, speech detector, PCM conversion and wait-cue scheduler can be reused. Automatic capture must remain bounded, serial, cancellable and echo-aware.

## Ordered implementation and acceptance

1. Move the lazy assistant host to the persistent platform layout, scoped to marketing paths and excluded from trainer domains/workspaces. Preserve call, audio unlock and memory through client navigation.
2. One Start call action, automatic silence-ended speech, mute/resume, interrupt/skip and end controls. Retain one bounded spoken addition during a pending response; no concurrent paid turns or automatic transport retries. Stop all tracks/audio on close, exit or backgrounding.
3. Prepare two neutral, selected-voice English/Arabic cues once per voice/configuration. Persist only generic cue clips and purchase state; share cached clips, reserve under the daily cap with answer headroom, and never repurchase an uncertain preparation. Cancel cues for speech, ready response, mute and end.
4. Add a fixed marketing destination contract and current-page context. Open relevant pages during a reply with client navigation; no model URLs, external destinations, forms or automatic signup. Keep signup an explicit button.
5. Verify API caps, cache races/failures and destination validation; real local Chromium capture/playback on phone and desktop, slow replies, interruptions and route continuity. Inspect screenshots and normal release gates.
6. Publish, merge under standing release authority, and verify the exact serving SHA. Record real evidence and remaining physical-device/provider acceptance separately.

## Verification

Implementation is complete. TypeScript, the production build and 72 focused checks passed. The first expanded static run exposed two obsolete assumptions (the old three-root motion-token selector and a marketing import list without Next navigation); these were updated to include the persistent assistant root/router while retaining token and animation-library checks. All 72 then passed.

Real Chromium microphone/worklet/API/database journeys passed at 390 and 1280 px, with three automatic turns, an 18-second synthetic model wait, selected-voice cached cues, spoken additions serialized behind the first turn, answer interruption, current-page context, manual and guided navigation without reload or reacquiring microphone access, guidance off/on, mute, hangup and late microphone-permission cleanup. Screenshots were inspected. Review led to automatic compact call controls on guided navigation so the destination stays visible, and caption-list scrolling now follows layout changes without scrolling the page.

No live paid provider call was made. Fixture audio is synthetic; actual selected-voice quality, live latency and physical iPhone/Android echo/audio routing remain unmeasured. No model/token/cost telemetry for this assistant coding session is exposed.

PR #61 is published. Its first PostgreSQL gate found that the separate production runtime-role reset script lacked the new cue-cache grant, although migration 096 granted it. Added the same narrow SELECT/INSERT/UPDATE grant there; tenant access remains revoked. The exact privilege verifier is retained. The next PostgreSQL run passed the grant verifier and all new call tests, then exposed one additional historical motion-root assertion in marketing-journey.test.ts. Updated that selector while preserving exact token-value/single-definition checks. The full gates rerun on the corrected head. All eight final-head PR gates and all seven exact-main gates passed. PR and main application: 1,854 passed / 0 failed / 5 skipped; PostgreSQL: 1,853 passed / 0 failed / 6 skipped. The separate conversation gate passed 126 tests and complete browser journeys. No failed gate was bypassed.

## Live receipt

PR #61 merged as `68a0507ef44fbd07b6bf07e8ab965ff858a4b725`. Serving workflow [38341867707](https://github.com/chordsnstrings/trainer_what/actions/runs/38341867707) passed. Direct readiness returned HTTP 200, ready status and that exact SHA at 03:34:53 UTC / 07:34:53 Dubai on 13 October. The assistant availability endpoint returned true. A read-only 390 px production browser smoke confirmed the new Start call panel and its layout after an initial page-load timeout; no microphone or paid call was started. [Exact-main checks](https://github.com/chordsnstrings/trainer_what/actions/runs/38339800701) passed. Implementation and deployment verification are complete. This is the feature release receipt; the documentation-only follow-up changes no application behavior and runs ordinary automatic checks separately.
