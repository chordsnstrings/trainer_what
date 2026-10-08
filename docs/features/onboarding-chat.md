# Conversational onboarding

Trainer setup, continued Brain teaching and client intake now default to a shared text-message interface. Short bubbles, optional quick replies, one current question, inline reviews and a persistent composer replace the default wizard. Detailed forms remain available. New platform/provider integrations are deferred.

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

## Storage and cost

Migration 091 adds personal-scope RLS and one conversation per tenant/user. Chat, archives and request receipts use records; they are excluded from the bounded workspace bootstrap catalog. The existing frontier-model adapter/accounting handles inference. No new vendor integration, background inference or artificial typing delay.

## Verification

Focused domain/API tests cover evidence grounding, short copy, multi-answer intake, no-call controls, idempotency, concurrent resend, failure/retry, teaching batches, consent withdrawal in flight and tenant/person/team isolation. The isolated browser runner exercises real API/database persistence with a deterministic local model fixture and captures trainer/client phone/desktop views. Normal repository release gates still apply.
