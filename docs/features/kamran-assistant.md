# Kamran marketing voice call

## Current behavior — live 13 October 2026

The current voice update is deployed from PR #63 as `fdd9e080bc4b52d3d8d8a19bfeaf30e485e2145a`, extending the hands-free call and navigation shipped in PR #61. Exact readiness was verified at 08:46:15 UTC / 12:46:15 Dubai. All eight final-head PR gates and seven exact-main gates passed. [Serving proof](https://github.com/chordsnstrings/trainer_what/actions/runs/38370740876).

The owner now requests a continuous hands-free call and guided marketing navigation, superseding the original home-only hold-to-talk interaction documented below. Audit and ordered acceptance: `../HOMEPAGE_CALL_2026-10-13.md`.

- Start on the homepage with **Talk to Kamran → Start call**. The one start gesture unlocks audio and requests echo-cancelled microphone capture. Local speech detection ends each utterance after a pause, up to 20 seconds; silence makes no provider call. No press-and-hold is needed.
- **Mute**, **Let me speak**, **End call** and minimize/expand stay available. When the browser confirms echo cancellation, speaking interrupts waiting cues or an answer. Otherwise use Let me speak during playback to avoid speaker feedback. One additional utterance during a pending request is retained, then sent serially. The old response remains in captions but its audio and navigation are suppressed. There is no automatic paid request retry.
- The assistant host lives in the shared platform layout. Client navigation across registered marketing pages preserves microphone permission, audio context, tab-local history, visit limits and in-flight requests. Leaving marketing pages, closing the panel, backgrounding or the 15-minute timeout stops tracks and audio. Delayed permission/decode/network callbacks cannot restart an ended call.
- A checked `navigate` destination ID can open a relevant read-only page while the reply speaks. The panel compacts automatically to leave the page visible. **Show relevant pages as we talk** disables this behavior, including in the model context. Current page is sent as an allowlisted ID. Navigation is suppressed after interruption or manual page changes during a slow response. Model URLs are never used. Signup is an explicit link, with no form submissions or automatic account navigation.
- `POST /public/assistant/cues` accepts only English/Arabic language. Two brief code-owned lines in the configured voice are cached and shared: first eligible around 1.5 seconds, second around 8 seconds. At 18 seconds a truthful delay notice replaces further scheduling. Ready audio, caller speech, mute or end cancels cues immediately, including delayed decoding.
- Migration 096 stores **generic cue clips only**, keyed by a hash of voice/model/connection/language/text. It stores no visitor speech or transcript. The existing daily platform cap reserves the optional synthesis and conservative real-answer headroom atomically with a one-time claim. Concurrent requests share that claim; failed/unknown preparation is never repurchased. Attempted TTS is counted even on failure. Tenant roles cannot access the cue table. No new provider credentials or live settings changes are needed.

Verification uses real local Chromium worklet/capture/playback with synthetic microphone and provider fixtures at 390 and 1280 px. It covers slow replies, retained additions, serial turns, waiting-cue and answer interruption, route/context continuity, guidance off/on, mute and cleanup. It does not establish physical iPhone/Android echo cancellation, live latency, or the quality of the selected voice. No paid live provider call was made for this change.

## Shared noise handling — live, 13 October 2026

The shared microphone layer now uses locally hosted neural speech detection plus RNNoise where 48 kHz processing is available. Browser echo cancellation and suppression remain enabled. Strong, sustained speech is required to cancel an answer; a brief provisional interruption pauses and then resumes the same audio position. Quiet words retain their leading audio. Models load from the site, and classifier/worklet failures close the microphone with a clear restart path. Required detection never silently falls back to the previous energy-only gate. See `../VOICE_NOISE_2026-10-13.md` for audit, benchmark evidence and the remaining physical-device/nearby-voice limits. The exact serving release and hosted audio assets are verified.

## Phone audio routing audit — 5 November 2026 (read-only; no code changed, nothing deployed)

**Owner, 5 November 2026:** "The Kamran voice on the marketing page when responding uses internal phone speakers as opposed to phone speakers. Is that a bug? Audit, explain". Read as: on a phone, replies come from the earpiece, or sound like a phone call, instead of the loudspeaker.

**How it was audited:** our code, WebKit and Chromium source (main and Safari release branches), WebKit/Mozilla bug threads and field reports. Eight agents did the audit; three independent reviewers then checked it (source, evidence, fix) and each found it "partly holds". Their corrections are applied below. No phone was used. CI cannot reach this code, because Chromium has no `navigator.audioSession`.

**Verdict: a real problem caused by our design. Apple's iPhone audio policy then decides route and volume, and a page cannot override it while it holds the microphone.**
- **What our code does:**
  - Since PR #61 (13 October 2026) the call keeps an echo-cancelled microphone open during every reply, for voice barge-in.
  - Right after `getUserMedia` it sets `navigator.audioSession.type = "play-and-record"` and keeps it until hang-up.
  - `onboarding-call.tsx` does the same. The pattern came from 304f550 (8 October).
  - Before 13 October the panel was hold-to-talk and released the microphone before each reply.
- **Why it affects every iPhone browser:** a page that captures audio puts the shared iOS session into PlayAndRecord (voice chat). Every iOS browser and in-app browser (Instagram, Facebook) uses WebKit.
- **What replies sound like:** call audio.
  - Call volume, saved separately from media volume. The volume buttons then change call volume, which does not go to zero.
  - Mono, with a lower sample rate on iOS 26.4+ (WebKit 311451).
  - On iOS 27.0.x, crackle while the echo-cancelled microphone is open (WebKit 326286; no fix listed in Safari 27.1 or 27.2).
- **Earpiece vs loudspeaker is unresolved and depends on the iOS version.**
  - Open-source WebKit asks for the loudspeaker (`DefaultToSpeaker`) unless the page picks the receiver, and ours never does. But Apple-internal code runs on every session activation, and shipping iOS has not always followed the open-source options.
  - Receiver output during capture is reported on iOS 15.0–15.3 (WebKit 230902, fixed in 15.4), on 18.5 (295889) and in LiveKit #1836 (March 2026).
  - Loudspeaker output is reported on 18.6, 18.7, 26.2 and 27.0.1.
  - Take the owner's description literally until the phone check below.
- **Bluetooth:** with AirPods, a car or a wired headset connected, the open microphone can force hands-free (HFP) call quality, or move output from the headset to the phone (WebKit 282939, 283103).
- **Android:**
  - Chrome, Samsung Internet and WebView use the loudspeaker in communication mode, near call volume.
  - Firefox for Android may use the earpiece (Mozilla 1626081, from 2020; not checked).

**Second defect: a repeat call in the same tab fails on WebKit.** This comes from source and has not been reproduced or reported yet.
- `end()` in the panel and `closeAudio()` in the onboarding call set `"ambient"` and never `"auto"`. `closeAudio()` also runs on unmount, even when no call ran.
- WebKit rejects audio `getUserMedia` while a non-record type is set (`MediaDevices.cpp`, Safari 16.4–27). The next call then shows "AudioSession category is not compatible with audio capture."
- Affected: every iOS browser and Mac Safari. Triggers are a second call, and a restart after the turn limit, after the 15-minute cap or after leaving the tab.
- It probably survives a reload in the same web process: the override is kept per process, and `Page::didChangeMainDocument` does not clear it.
- `setAudioSessionType` skips the assignment when the getter already reads the same value, so it cannot reset the override.
- Quick check: in Mac Safari, start a call, end it, start again.

**Recommended fix (staged; not built):**
1. **Stage 1, clean-up in both calls:**
   - Add `forceAudioSessionType()`, which always assigns.
   - Set `"auto"` just before `getUserMedia`, and at hang-up instead of `"ambient"`.
   - Keep the `"play-and-record"` after `getUserMedia` for now. Removing it changes the iOS 17–26 session mode (WebKit 316800 ties VideoChat mode to call volume), and it is reported to restore headset routing (282939).
   - Add a fake-navigator unit test, and confirm on Mac Safari.
2. **Stage 2, iPhone half-duplex replies.** Marketing panel first, behind a flag that tests can set, off until a device check.
   - **Gate:** iOS WebKit (reuse `isIos` from `apps/web/components/pwa.ts`) with no headset input (enumerate audio inputs; re-check on `devicechange`).
   - **Each reply:** finish or queue any utterance in progress, stop the microphone, set `"playback"`, play the reply, set `"auto"`, re-open the microphone.
   - **Expected, to be checked on a device:** loudspeaker at media volume, no call processing, no iOS 27 crackle.
   - **Risks:**
     - Field reports say `"playback"` right after the microphone stops "only helps sometimes".
     - Measure the settle time; reports say several hundred ms, not 150 ms.
     - If the route sticks, decode and play each reply in a fresh AudioContext or an `<audio>` element.
     - The override only wins if no other tab holds the microphone or play-and-record.
   - **Costs on iPhone:**
     - No voice barge-in during a reply; **Let me speak** does that.
     - About 0.5–1 s before the microphone is live again.
     - The microphone indicator turns off and on each turn.
   - **Permission:** no new prompt if the microphone is off for under 1 minute. The 10-minute window after a tap exists only from safari-7624. Keep Mute as `track.enabled = false` and re-open even while muted, so the grant never ages.
   - **Unchanged:** headset users, Android and desktop keep full duplex.
   - **Onboarding call later:** its replies (up to about 900 characters, 60–75 s) exceed the 1-minute window.
   - **CI:** `onboarding-chat-check` runs an iPhone user agent in Chromium, so decide what the gate does there. Add a half-duplex variant to `marketing-call-check`.
3. **Rejected:**
   - a `MediaStreamAudioDestinationNode` into `<audio>` with `setSinkId`: iOS 26+ only, mixed evidence, still call audio;
   - `mediaSession.setMicrophoneActive(false)`: unmute needs a tap and the volume is not fixed;
   - `"playback"` with a live microphone: unsupported;
   - half-duplex everywhere: loses barge-in on Android and desktop for no gain.

**Phone check needed from the owner (current live build, about 2 minutes):**
- First reproduce it as it happened: same app, same Bluetooth or car state, same sequence.
- Note iPhone or Android, the model, the iOS version and which app opened the link. Read the version from Settings → General → About, because the Safari user agent is frozen on iOS 26+.
- During a reply, cover the top earpiece slot, then the bottom grille. If only the top sounds, it is the receiver. If covering the bottom cuts it sharply, it is the loudspeaker.
- Press volume up. If it stops above zero, that is call volume.
- Listen for crackle.
- Then start a second call in the same tab.

**Uncertainties:**
- The owner's device and browser are unknown.
- Receiver vs speaker is decided inside iOS or in Apple-internal WebKit.
- Whether `DefaultToSpeaker` is honoured under iOS 27's LongFormAudio policy cannot be read from source.
- Switching category under one running AudioContext is untested per iOS version.
- Capture and re-prompt behaviour in in-app browsers is unverified.
- The mapping from WebKit branch to Safari version is inferred.
- No routing claim has been checked on hardware.

## Historical first implementation (1 October 2026)

The original implementation and qualification record follows; its hold-to-talk, home-only, automatic signup and pending-release descriptions are historical and superseded above.

Status: implemented on `r5/kamran` (from `r5/models` `e44c771`); not merged, not deployed, off by
default. Owner decisions (1 October 2026): the assistant speaks as the owner in the first person
("I'm Kamran, I built trainsyou") with a visible "AI voice" label; voice only; home page only;
explains why the platform exists, how it works, pricing and earnings from the site's own content
and calculators; takes interested visitors to Start coaching; AED 10 daily cap.

Code: `packages/domain/src/marketing-assistant.ts` (prompt `marketing-assistant-v1`, calculation
tool, reply checks), `marketing-assistant-text.ts` (limits and code-owned words, the only part the
page loads), `packages/providers/src/marketing-assistant.ts` (one model call through the active
profile), `packages/contracts/src/marketing.ts` (`marketingAssistantFacts`, `ASSISTANT_FACT_PAGES`),
`apps/api/src/marketing-assistant.ts` (routes, cap, limits, speech), migration
`082_marketing_assistant.sql`, settings group `marketing_assistant`
(`packages/providers/src/configuration.ts`), `apps/web/components/marketing/assistant-button.tsx`
(the button), `assistant-panel.tsx` + `app/marketing-assistant.css` (loaded on the first tap),
`apps/web/components/marketing-assistant-admin.tsx` (`/admin/marketing-assistant`). Tests:
`tests/marketing-assistant.test.ts`, `tests/model-name-guard.test.ts`.

## What the visitor sees

- A small round microphone button at the bottom corner of the home page only (bottom-right;
  bottom-left in right-to-left layouts through `inset-inline-end`). It is rendered outside `main`,
  so it adds no words to the page's word budget.
- The first tap loads the panel's code (dynamic import) and its stylesheet; nothing else loads
  before. The panel is at most 360 px wide and 40% of the screen's height, above the button, so the
  page stays readable. It shows "Kamran, who built {APP_NAME}", an "AI voice" label, a one-line
  microphone notice ("Uses your microphone while you hold to talk. Audio and words are not
  stored."), the conversation as captions (`dir="auto"` per line), and one "Hold to talk" button
  (pointer hold, or hold Space or Enter). Escape closes it. A language button switches what the
  speech-to-text listens for (English or Arabic; Arabic by default when the browser's language is
  Arabic); the reply follows the visitor's language.
- Recording stops at 20 seconds; under 0.4 seconds is ignored ("Hold to talk."). The reply plays
  as cue-sized clips (one per sentence) one after another; the audio context is started inside the
  press so phones allow playback.
- When the visitor wants to start, the reply says so and, after it has played, "Taking you to
  Start coaching…" shows with a "Stay here" button; after 3 seconds the page goes to `/signup`, or
  `/get-started#early-access` while registration is closed (the same rule as the page's primary
  action).
- Ten turns per visit; then "That's all the questions I can take this visit."
- While the call panel is open, `assistant-button.tsx` sets `html[data-mk-call]`, and every Brain
  showcase on the page (the field and the board on `/`, and on any page the call navigates to, the
  playground and the anatomy) stops drawing until it closes; closing the panel removes the attribute
  and they resume. It is one of the showcases' pause reasons, and the showcase check (step 6) tests
  it ([brain-showcase.md](brain-showcase.md), "What runs, and when it stops").

## One turn (`POST /api/v1/public/assistant/turn`)

Body `{visit (uuid made by the page), audio (base64), type, durationMs, lang: en|ar, history (at
most 6 earlier turns, held by the page)}`. In order:

1. Switched on, AI model connected, trainer voice connected with Cartesia, speech-to-text connected
   and a voice found; else `404 ASSISTANT_OFF`.
2. Audio checked like voice replies (`decodeSpeech`, 640 KB; declared length at most 20.5 s by the
   body schema; a WAV clip's header length too). Compressed phone recordings (WebM/Opus, MP4/AAC)
   are not refused for their size: they are billed at their conservative length
   (`billableSpeechMs`, the bytes at 6 kbit/s). Final integration review, 1 October 2026: the
   earlier check refused any compressed clip longer than about 2 s as too long.
3. The turn's most possible cost (`turnReserve`: the whole prompt as input tokens at one per byte,
   at the cache-write price when higher, 1,500 output tokens, at USD 5 / 30 per million when the
   profile has no prices; the billed speech seconds; a 320-character reply spoken; never below
   AED 0.25) is reserved against today's cap in one statement (`reserveTurn`), so turns running at
   the same time can never take the day over the cap. Refused: `429 ASSISTANT_CAP` with
   `hiddenUntil` (next midnight, UAE); the page hides the button until then (`localStorage`). The
   actual cost replaces the reservation when the turn ends (a failed model call counts at its
   most).
4. 40 turns per network address per UAE day and 10 per visit: `429 ASSISTANT_LIMIT` (the
   reservation is released). Counters are kept as HMAC-SHA-256 of the day and the value (keyed with
   `SECURITY_ENCRYPTION_KEY`), so they change every day; rows older than yesterday are deleted on
   each write. Route rate limit 12 a minute. The audio is then transcribed by the speech-to-text
   account (Cartesia `ink-whisper` in the chosen language), at most 300 characters kept, and the
   audio buffer is zeroed after use.
5. The model call (`marketingAssistantModel`, 1,500 answer tokens, 20 s) through the active model
   profile. System message: the rules, then the site facts between `<<<SITE_FACTS` and
   `SITE_FACTS>>>`; user message: JSON with the earlier turns and the visitor's words, labelled
   untrusted. The model answers `{reply, lang, calc, handoff}`.
6. Checks (`screenAssistantReply`) before anything is spoken; a failed reply is replaced by a
   code-owned line (below).
7. Speech in the chosen voice: each sentence a clip (`replyClips`, at most three), synthesised in
   parallel through Cartesia `/tts/bytes` with the line's own language.
8. Counts and cost added to the day; the response is `{heard, caption, lang, audio: [base64 mp3
   clips] | null, audioType, handoff: {href,label} | null, turnsLeft}`.

## Grounding and numbers

- **Site facts** (`marketingAssistantFacts`): the intro, sections and FAQs of `/`, `/how-it-works`,
  `/trainer-brain`, `/pricing`, `/faq`, `/get-started`, `/about`, `/security-and-privacy`, the
  intros and FAQs of the two calculator pages, and one line per feature page, from the marketing
  registry through `marketingPageFor` (so the "frontier model" lines appear only while that flag is
  on). Shared FAQs once. About 23,000 characters (about 6,000 tokens). Since 28 October 2026 the
  facts get the platform's `registrationOpen` too, so answers that wait for publishing (sign-ups,
  subscriber payments and the AI model) follow the same gates as the pages: "Yes. Subscribers pay
  you by card in AED." appears only once all three are on. They also carry each section's note, the
  status lines ("Live today: …", "Not on yet: …") and `/pricing`'s "Not on yet" chips after the
  blocks they qualify ([marketing-site.md](marketing-site.md), "What is live: gates and flags").
- **The model never does arithmetic.** For an estimate it fills `calc` and writes placeholders;
  `computeAssistantCalc` runs the site's own calculators (`estimateEarnings`,
  `estimateFollowerConversion` with the Super admin's follower model) and code fills them in:
  earnings `{revenue} {commission} {commissionRate} {takeHome} {sessions}` (everyone on one monthly
  price; no nutrition tier, voice add-on or sessions); followers `{cautious} {typical} {strong}`
  (paying subscribers at month 12) and `{strongRevenue}`. Inputs the visitor did not give are the
  calculators' defaults.
- **Number check:** every number the model wrote itself (placeholders removed) must appear in the
  site facts or be one of the calculation's inputs; every calculation input must be a number the
  visitor said (digits, "10k", simple English number words, Arabic-Indic digits), a calculator
  default or a site number. Spelled-out large numbers ("thousands") not in the facts are refused.
  Placeholders must belong to the requested calculation.
- **Other checks:** model, vendor or hosting names (`ASSISTANT_VENDOR_WORDS`, English and Arabic
  spellings), "frontier" while the flag is off, named competitors, links, emails, phone numbers,
  guarantees and approval claims (`proseIssues`), medical advice (`givesMedicalAdvice`, declines
  pass), more than 320 characters or three sentences.
- **Replacement lines** (code-owned, English and Arabic): number problems get "I can work that out
  with the earnings calculator: tell me your subscribers and your monthly price."; everything else
  "I can only speak to what's on this site. Ask me how it works, about pricing, or what you could
  earn." A sign-up request still hands off. A model error or an unreadable reply speaks the second
  line.

## Spend, privacy and settings

- Settings, Home page voice assistant (`marketing_assistant`, Super admin controls):
  `MARKETING_ASSISTANT_ENABLED` (default off), `MARKETING_ASSISTANT_DAILY_AED` (default 10, 0.5 to
  1000), `MARKETING_ASSISTANT_VOICE_ID` (blank: the account's voice named "Kamran", looked up at most
  every ten minutes).
- Cost per turn: model tokens at the active profile's price (`usage.cost` from the one request
  path), speech-to-text seconds × `STT_USD_PER_HOUR`, text-to-speech characters ×
  `VOICE_USD_PER_1000_CHARACTERS`, converted at `FINANCE_USD_TO_AED`. Table
  `marketing_assistant_days` (per UAE day: turns, tokens, USD per part, AED total, replaced replies,
  hand-offs, refusals). These costs are not yet in platform finance (remaining work).
- Nothing a visitor says or hears is stored: no audio, transcript or reply; counters hold only the
  day-keyed hash. `GET /api/v1/public/platform` carries `assistant: true|false` (on, connected and
  under the cap); `GET /api/v1/public/assistant` returns `{available, hiddenUntil?, limits}`.
- `/admin/marketing-assistant` (Super admin): readiness with reasons, the switch, the cap, a voice
  picker listing the Cartesia account's own voices (`ownVoices`, default "Kamran"), and today's
  counts and costs. It saves through `PUT /api/v1/admin/settings/marketing_assistant`.

## Live Seed check (1 October 2026)

`seed-2-0-pro-260328` on ModelArk through the app's real request path and checks, 35 visitor
questions (purpose, how it works, pricing, earnings and follower calculations, a follow-up
calculation, three Arabic questions, off-topic, medical, three prompt-injection attempts, "which
AI", a competitor, "are you a real person?", sign-up interest, data safety, social proof, a promise
request). Script and results stay outside the repository
(`scratchpad/round5-evals/kamran/`).

| Run | Prompt | Passed | Safety failures | Replaced by a safe line | p50 / p95 | Cost |
|---|---|---|---|---|---|---|
| 1 | first draft | 35/35 | 0 | 2 (declined guarantees) | 4.2 / 6.4 s | USD 0.129 |
| 2 | final (`marketing-assistant-v1`) | 35/35 | 0 | 2 (declined guarantees) | 5.2 / 10.1 s | USD 0.129 |
| 3 | final, after declined guarantees pass the check (the 2 cases) | 2/2 | 0 | 0 | 5.9 / 7.7 s | USD 0.008 |

About 6,300 input and 190 output tokens per turn (about USD 0.004, AED 0.015, before speech).
Highlights: "50 clients at 300 dirhams" became `calc` and "AED 11,250 before other costs" (the
calculator's figure); 10k followers gave typical 16 and best case 166 subscribers at month 12, both
named; Arabic questions were answered in Arabic with the calculator's numbers; off-topic, medical,
injection, vendor and competitor questions were declined in one sentence without naming anything;
"are you a real person?" got "I am an AI voice of Kamran, not Kamran speaking live"; "how do I sign
up" and "let's do it" handed off; "how many trainers use it?" invented no number. The scorer was
first too strict about declined guarantees ("we never guarantee earnings"); the reply check was
changed to let a declined guarantee through (a promise is still replaced) and the scorer to match.
Total live spend for this work: about USD 0.28.

No live Cartesia call was made (the key helper has no Cartesia key); speech is tested with fixture
providers only.

## Remaining

- Real-device check of hold-to-talk and playback (iPhone Safari, Android Chrome) and of the voice
  named "Kamran" on the production Cartesia account.
- Arabic polish of the code-owned lines; the platform finance view does not include these costs yet.
