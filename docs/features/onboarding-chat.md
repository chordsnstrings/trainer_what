# Conversational onboarding

Trainer setup, continued Brain teaching and client intake now default to a shared text-message interface. Short bubbles, optional quick replies, one current question, inline reviews and a persistent composer replace the default wizard. Detailed forms remain available. Trainer setup, Brain teaching and subscriber intake share private file references and an optional hands-free voice conversation.

## Engine

Each turn uses the app's active model profile and its existing compatible/native adapter. `onboarding_reply` is a configurable profile budget: default 4,096 tokens, 30 seconds (60 for Seed; request-style time multipliers still apply). Nullable optional fields, omitted empty maps, fenced JSON and compatible text blocks are normalized before schema validation. Invalid facts/evidence, empty replies, reasoning-only output and truncated JSON remain withheld; no automatic paid retry repairs output. Public wording remains model-neutral. New conversations open with one question.

- GET /api/v1/onboarding-chat resumes the signed-in person's workspace conversation. No model call on load.
- POST /messages accepts a stable request UUID and conversation version. Persist first; at most one bounded inference for free text. Exact quick choices use code. Evidence-grounded fields retain source message and quote.
- POST /actions handles pause, resume, ask later, reviewed profile/page and offer drafts, food preferences, batched teaching compilation, rule approval, practice answers, authored situations and supervised publication.
- GET /history loads older transcript pages. Active context includes bounded recent messages, saved facts and a small set of confirmed trainer rules.
- Durable request rows deduplicate retries, including across server restarts. Failed reply retries preserve the original message and teaching source. Interrupted actions require checking saved state before another action.
- Readiness, consent, role/tenant scope, privacy screening, health holds, validation, version checks and publishing gates run outside the model. Actions forward only to fixed existing authenticated endpoints. No model-selected URLs.
- Coach teaching remains draft until reviewed, approved and qualified through the existing Brain workflow. Compiling is explicit and batched (up to 20 sources).
- Client data never becomes shared trainer teaching. Coaching permission precedes private chat. Nutrition questions require included nutrition access and both processing/model permissions. Withdrawal invalidates in-flight chat and clears its transcript. Account/workspace erasure covers the new records.
- Member profile confirmation uses the existing intake endpoint. The existing plan scheduler handles first-plan creation and review. The UI distinguishes saved intake from an assigned workout.

## Files and familiar messaging

The browser chooses a WhatsApp-inspired green web palette, an iMessage-inspired iOS palette or an Android Messages-inspired blue palette. New bubbles enter briefly; typing appears only during a real pending reply. Reduced motion disables animation. Reading older messages preserves the scroll position and shows a jump-to-latest control. Delivery ticks mean saved, never an invented human read receipt.

`POST /attachments` requires rights confirmation, an upload UUID and at most 5 MB. Messages accept up to three private attachment IDs. PDF, DOC/DOCX, XLS/XLSX, CSV/TSV, text/Markdown, RTF, ODT/ODS, PPTX, structured programme JSON and JPEG/PNG/WebP use bounded local readers. Unsupported/encrypted/unsafe files fail with an explanation. The production `FILE_IMPORTS_APPROVED` gate remains mandatory. New runtime readers are `antiword` and `python3-xlrd`.

The original bytes are discarded after extraction. Images are resized, metadata-stripped JPEG copies; local English OCR may be inaccurate. People can preview extracted text before sending. A model receives bounded excerpts, with truncation marked, and sanitized images only when the active profile enables vision. Files are untrusted reference material; sample plans and photos do not establish personal facts. Sent teaching text becomes reviewable interview material; subscribers' files remain personal. Full attached text passes the existing health screen, including content beyond the model excerpt. Rights confirmation does not approve generated Brain rules.

Uploads are private to tenant plus uploader, excluded from bootstrap and covered by privacy erasure. Withdrawal followed by regrant cannot revive an in-flight upload. Up to 60 references are retained per person; unbound uploads older than one day are removed on their next upload. Removing a sent reference does not retract reviewed teaching or independently saved profile evidence.

## Hands-free calls and trainer voice creation

`GET /calls/options` reports the actual approved voice/STT capability. `POST /calls` requires explicit speech-processing consent. The guide is clearly labelled Kamran AI, using the configured platform Kamran Cartesia voice for a consistent call. The model continues to follow the active app profile on every turn, including Seed 2.0. Missing provider/voice contracts leave a clear text fallback.

One Start call gesture opens the microphone and unlocks playback. An AudioWorklet and speech-band gate collect replies locally; a natural pause sends one PCM WAV turn automatically. Playback then returns to listening, without hold-to-talk or a send button. Capture is discarded while the AI speaks/thinks; Skip this reply ends playback. This is sequential hands-free turn-taking, not simultaneous interruption or a realtime duplex stream. Mute disables the microphone track; hangup, navigation/backgrounding, unmount and the 30-minute limit stop tracks and playback. A call remains active when its dialog is minimized into Messages.

Calls support English and Arabic transcription. Audio-processing consent explains the chosen provider's retention terms; Cartesia zero-retention is not implied. Call transcripts persist in the same private conversation; microphone recordings are not retained by the call service. A stable UUID deduplicates STT, model and speech requests, including lost responses. Unknown paid outcomes are never automatically regenerated. Calls allow at most 80 turns, and end/withdrawal prevents late audio or transcripts from being restored. Reply audio is stripped on call end, a new call or withdrawal.

Trainers may separately opt in to creating their own Quick Cartesia voice, accepting the existing four rights/use/deletion statements. Only microphone segments from their listening turns are collected, capped at 60 seconds. At 45 seconds the sample is sent to the existing encrypted clone workflow; a manual hangup can submit an already collected sample of at least 10 seconds. Abandoning the app discards an unfinished local sample. An interrupted empty call draft can resume; a draft containing recordings is never overwritten. The trainer must still preview and activate the resulting voice at `/trainer/voice`; no automatic activation or expanded subscriber use is granted. Pro training remains in the existing dedicated workflow.

## Storage and cost

Migration 091 adds personal-scope RLS and one conversation per tenant/user. Chat, archives and request receipts use records; they are excluded from the bounded workspace bootstrap catalog. The existing frontier-model adapter/accounting handles inference. Migration 092 gives attachments, calls and speech receipts the same personal RLS boundary. Speech/transcription reserve against the existing workspace voice cap before provider send. Trainer onboarding speech costs are platform-borne setup costs; subscriber speech retains ordinary voice accounting. Existing Cartesia/STT adapters are reused; there is no background inference or artificial typing delay.

## Verification

Focused domain/API tests cover evidence grounding, short copy, multi-answer intake, no-call controls, idempotency, concurrent resend, failure/retry, teaching batches, consent withdrawal in flight and tenant/person/team isolation. The isolated browser runner exercises real API/database persistence with a deterministic local model fixture and captures trainer/client phone/desktop views. Additional checks cover file rights/isolation and extraction, consent races, VAD/PCM duration, bounded vision context, full-file health screening, stable voice request replay, concurrent delivery, voice budget refusal, withdrawal during transcription and opt-in clone drafts. The browser journey uses synthetic microphone PCM, real browser capture/worklets/playback and isolated model/STT/TTS/clone fixtures; it does not prove physical iPhone/Android audio routing or live provider/account acceptance. Normal repository release gates still apply.
