# Kamran's AI voice on the home page (round 5, branch `r5/kamran`)

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

## One turn (`POST /api/v1/public/assistant/turn`)

Body `{visit (uuid made by the page), audio (base64), type, durationMs, lang: en|ar, history (at
most 6 earlier turns, held by the page)}`. In order:

1. Switched on, AI model connected, trainer voice connected with Cartesia, speech-to-text connected
   and a voice found; else `404 ASSISTANT_OFF`.
2. Today's spend + AED 0.25 (one turn's reserve) above the cap: `429 ASSISTANT_CAP` with
   `hiddenUntil` (next midnight, UAE). The page hides the button until then (`localStorage`).
3. 40 turns per network address per UAE day and 10 per visit: `429 ASSISTANT_LIMIT`. Counters are
   kept as HMAC-SHA-256 of the day and the value (keyed with `SECURITY_ENCRYPTION_KEY`), so they
   change every day; rows older than yesterday are deleted on each write. Route rate limit 12 a
   minute.
4. Audio checked like voice replies (`decodeSpeech`, 640 KB, billable length at most 20.5 s), then
   transcribed by the speech-to-text account (Cartesia `ink-whisper` in the chosen language), at
   most 300 characters kept. The audio buffer is zeroed after use.
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
  on). Shared FAQs once. About 23,000 characters (about 6,000 tokens).
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
