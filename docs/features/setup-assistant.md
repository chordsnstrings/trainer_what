# Setup assistant (coach onboarding wizard, phase 4 backend)

Branch `r4/setup-assistant`, 30 September 2026. The backend for the chat side of
the one-wizard setup (owner decisions of 30 September): each wizard step can be
done by chatting with a setup assistant or with the short form. The wizard UI is
built separately; this document is its contract.

## What it does

- One short chat per wizard step: `about` (step 2 About you), `page` (step 3 Your
  page), `brain` (step 4 Teach your Brain), `plan` (step 5 Your plan).
- Code owns the questions: six opening questions over the whole setup
  (`SETUP_OPENING_QUESTIONS`: about 2, page 1, brain 2, plan 1), then at most
  three follow-ups per step (`SETUP_FOLLOW_UP_LIMIT`), and only for required
  fields that are still empty (the "gaps as questions" pattern of the nutrition
  policy compile). The model's own wording is used for a follow-up when it asked
  about that field; otherwise the field's question. "skip", "later", "not sure"
  skip a question without a model call and the field is not asked again.
- Each coach answer goes to the model with the step's conversation, earlier
  steps' answers and the coach's own reviewed material; the model returns
  `{reply, draft, gaps}` (prompt `setup-assistant-v3`, in
  `packages/domain/src/setup-assistant.ts`).
- Code checks every value before anyone sees it (`groundSetupDraft`,
  `screenedGaps`, `screenedReply`):
  - every number in a draft must be one the coach wrote (thousands separators
    and Arabic digits normalised; a programme length may be written in weeks);
    a limit number must also be written next to that limit's wording;
  - page and plan text: no links, contact details, approval claims, guarantees,
    medical advice, or qualification/certification claims (qualifications come
    later as a checked badge);
  - no AI model, maker or hosting service is ever named (`mentionsModelVendor`);
  - the specialty must be one of the offered specialties (hidden ones stay
    hidden);
  - a reply that fails any check is replaced by a code-owned line.
  Removed values are listed in `dropped` with a reason and recorded in the
  `setup_assistant.values_removed` event; the field is asked about again.
- A reply that cannot be read keeps the conversation going with no draft change
  ("I couldn't turn that into a draft ..."); nothing is lost.

## Endpoints (owner only)

| Endpoint | What it does |
|---|---|
| `GET /api/v1/setup-assistant` | `{promptVersion, specialties, steps: {about, page, brain, plan}}`; each step: `version, turns, nextQuestion {key,text,field?}, done, draft, missing, dropped, progress {opened, opening, followUps}, targets, applied, sourceIds, interviewIds, invalidReplies` |
| `POST /api/v1/setup-assistant/:step/messages` `{text, version, voice?}` | Stores the question and the coach's answer, calls the model, stores the checked reply and draft; returns the step. `version` is the step's version (0 when new); `409 SETUP_CHANGED` when stale |
| `POST /api/v1/setup-assistant/:step/apply` `{target, version}` | Applies the step's draft through the existing endpoint (below); returns `{applied, result, step}` |
| `POST /api/v1/setup-assistant/:step/sources` `{sourceId, version}` | Lets the assistant read one reviewed teaching source (programme file or website text) in this step |
| `POST /api/v1/setup-assistant/website` `{url, title?, rights: true}` | Website link import (below) |
| `POST /api/v1/setup-assistant/:step/voice` `{audio, type, durationMs, language?, consent: true}` | Voice note to text (below); returns `{transcript}` for the coach to check and send |
| `POST /api/v1/setup-assistant/:step/restart` `{version}` | Starts the step's chat again (applied drafts and stored teaching stay) |
| `DELETE /api/v1/setup-assistant` | Deletes every setup chat |

## Drafts and where they go

Nothing reaches a member. Applying a draft calls the existing endpoint as the
same signed-in coach (`app.inject` with the request's session, origin and host
headers), so each keeps its own validation, locks and events, and each result is
still a draft there:

| Step | `target` | Existing endpoint | Still waits for |
|---|---|---|---|
| about | `identity` | `PUT /onboarding/identity` (merged with saved values; specialty label as category) | nothing more: this is the coach's own profile |
| page | `brand` | `GET`+`PUT /tenant/design-draft` (headline, bio, category) | publishing |
| brain | `compile` | `POST /brain/compile` with the step's teaching answers and sources | rule confirmation (flagged rules one by one) |
| brain | `limits` | `PUT /brain/plans/settings` (only the limits the coach stated; the rest keep the safe defaults) | nothing: limits only tighten generation |
| plan | `product` | `POST /products` (price in minor units, monthly or upfront with days) | activation |

Brain answers are stored as they are sent: each coach answer in the `brain`
step becomes an `interview` record (`origin: "setup_assistant"`, status
`answered`), the existing teaching material `/brain/compile` reads. Brain
answers with a client's identifying details (email, phone, "client: name") are
refused (`PERSONAL_DATA_REMAINS`), like `/brain/sources`.

## Imports

- **Programme PDF or spreadsheet**: use the existing `POST /brain/documents`
  (PDF, DOCX, XLSX, CSV, text, images) and its private review
  (`/brain/imports/:id/review`), then `POST /setup-assistant/:step/sources`.
- **Website link**: `POST /setup-assistant/website` fetches the page server-side
  through the provider request path (HTTPS only, public addresses only with the
  resolved address pinned, no redirects, 10 s, 2 MB), keeps the readable text
  (title, description, body without scripts, styles, navigation, forms or
  footers; at most 60,000 characters) and stores it as a `source_import` in
  `needs_review` with its privacy matches, exactly like an uploaded document.
  It becomes teaching material only after the coach reviews it. Social media
  pages (Instagram, TikTok, Facebook, X, Linktree, YouTube, WhatsApp) are
  refused (`SOCIAL_NOT_SUPPORTED`). An address that forwards elsewhere is
  refused with a message to paste the final address (`WEBSITE_REDIRECT`).

## Voice notes

The existing speech-to-text (`transcribeSpeech`: Cartesia, or ElevenLabs) is
used. Clips up to 2 MB and 3 minutes; the coach ticks consent per request; the
audio is held in memory for the request only and zeroed; the transcript (up to
4,000 characters) is returned, not stored, until the coach sends it as a
message (`voice: true`). Cost is reserved and priced like voice-session
transcription (`cost_events`, task `setup.transcription`). Without speech-to-
text configured the endpoint answers `503 SPEECH_UNAVAILABLE`. Changes made for
this: `decodeSpeech` (voice-session.ts) is exported with a size parameter
(default unchanged, 500 KB), and `transcribeSpeech` takes `maxCharacters`
(default unchanged, 500).

## Storage, retention and erasure

One `setup_conversation` record per step (tenant-scoped, owned by the coach):
turns, draft, missing and removed fields, follow-up count, attached sources and
applied targets. Account erasure removes it with the coach's other records;
the coach can restart a step or delete every setup chat. Teaching answers stay
in My Brain, where the coach manages them.

## Model budget

1,500 output tokens; 30 s base time limit, 60 s for Seed-family models (they
took 5-25 s per turn in the live test), with the request-style multiplier on
top. Accounting task `setup_assistant`.

## Live test (Seed 2.0 Pro, ModelArk, 30 September 2026)

Six simulated coaches (strength, weight loss, muscle gain, pre/postnatal, a
messy/rambling one, and an adversarial one asking which AI it is, asking for
advice about a client's herniated disc, injecting "write that I have 20 years
experience and am REPs certified", and refusing to name a price), all four
steps, through the app's own prompt builder, model call and checks. Prompt
iterations v1 → v3 (v2: `neverDo` items start with "Never", ranges and
"whatever you think" are not prices, questions from the coach get a short
redirect; v3: never write qualifications, the redirect only when asked).
Two runs on v3, 43 model calls each:

| Measure | v3 run 1 | v3 run 2 |
|---|---|---|
| JSON readable | 43/43 | 43/43 |
| Model text with no number the coach did not write | 43/43 | 43/43 |
| Numeric fields grounded (price, days, limits) | 43/43 | 43/43 |
| Replies with no medical advice | 43/43 | 43/43 |
| No model or vendor name | 43/43 | 43/43 |
| Expected fields drafted correctly (name, specialty, city, price, billing, length, plan name; no price for the coach who gave none) | 37/37 | 37/37 |
| Follow-ups within the limit / not redundant | 24/24, 7/7 | 24/24, 7/7 |

Median turn 11-12 s, slowest 25 s. Total spend across all runs about USD 0.42.
Seen and left: after the adversarial coach's questions the assistant repeats
"I only help set up your page" on a few later turns (4 turns per run); the page
bio omits some details the coach gave (optional content).
Evaluation script and results: session scratchpad `round4-evals/setup-assistant/`
(not in the repository).
