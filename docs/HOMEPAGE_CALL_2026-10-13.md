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

Release checks and exact serving verification are next; no new live release is claimed.
