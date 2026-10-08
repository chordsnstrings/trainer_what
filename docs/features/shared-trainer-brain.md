# One trainer Brain across channels

Status: live, 8 October 2026. [PR #52](https://github.com/chordsnstrings/trainer_what/pull/52) merged as `5a0749a8bc3e970543234b0f12bcd18502a27a93`; [serving verification](https://github.com/chordsnstrings/trainer_what/actions/runs/37818441259) confirmed HTTP 200 and that exact release at 17:45:03 UTC / 21:45:03 Dubai. Owner direction: one consistent Brain across all channels, including the trainer's decisions, tone, actual wording and continued teaching.

## Findings before this change

The expanded coaching interview covers 18 core topics / 34 decision points, with relevant method branches. A separate seven-topic one-on-one interview and phrase banks already drive workout narration. Chat drafts use the published rules and the member's training facts; qualified automatic replies use trainer-approved action text. Plan and nutrition workflows have their own checked material. Corrections, reviewed examples and background rechecks already support continued teaching.

The missing connection was a common published communication snapshot. Ordinary subscriber chat did not receive the confirmed one-on-one profile. This change connects that profile; recent conversational turns beyond the existing member facts remain a separate improvement. Existing checks establish grounding, valid prescriptions and handover behavior; they do not establish that a real trainer would choose the same sentences. The general published Brain has a 38-rule limit; interview decision points and compiled rules are different measures.

## Delivery contract

- Store the trainer's confirmed communication profile alongside the rules in the published Brain release. Draft answers and unapproved teaching never become subscriber context.
- Use the same published method and communication snapshot in subscriber intake (written and spoken), chat, programme generation and adjustments, nutrition guidance, and workout narration. Channel adapters control format and length; domain permissions, numeric limits and validated plans still govern actions.
- Carry the shared version through checks and request receipts. Editing communication joins the existing review/recheck/publish loop. Preserve the previous published snapshot until replacement passes its applicable checks. Retain nutrition's separate reviewed-week and permission requirements.
- Keep cloning the sound of a voice separate from deciding what to say. Existing speech rights and subscriber voice access are unchanged.
- Expose the shared communication profile in Brain review so continued teaching has one discoverable home. Reuse existing confirmed style material and preserve historical releases.
- Verify actual shared inputs, draft/published separation, change detection, isolation, forbidden phrases and existing release gates. Do not equate these checks with measured real-trainer fidelity.

## Further fidelity work

Representative trainer-written replies, subscriber-specific conversational memory and blinded trainer grading of unfamiliar multi-turn situations should measure decision agreement and wording separately. Interview completion is not an accuracy percentage. These need explicit coverage and evidence before claiming the assistant reproduces a trainer's real-life coaching.

## Version and channel behavior

The shared contract is `trainer-brain-context-v1`. Each new Brain release captures the saved phrase banks and confirmed one-on-one answers. Model requests receive only model-permitted rules; all published rules remain available to action selection and plan retrieval, rather than a channel-specific rule shortlist. Qualification digests pin the shared snapshot and each changed prompt version. A newly published Brain invalidates older automatic contracts until their applicable checks pass; nutrition still requires its existing reviewed sample week before activation. No qualification, provider permission or acoustic voice consent is fabricated.

The migration backfills only currently published releases, using the same tenant's approved style. It restores forced RLS before commit. An archived release without a stored communication profile has the neutral default, not today's trainer personality. Manual voice sessions with no published Brain retain their existing confirmed-style behavior. Active sessions keep their immutable script; new sessions record their Brain release ID. Safety, numerical instructions and neutral UI/status wording remain code-owned. Decorative defaults and trainer/model prose respect a common whole-word exclusion check in English and Arabic.

A failed or stale Brain check keeps the last published version. Working answers do not start publication; saved phrase-bank edits and explicit style confirmation request the usual background check. The common editor is available from the conversation's Brain review and the detailed Brain workspace. The existing seven questions, exact phrase banks and always/never phrases are the communication training material; this does not fine-tune model weights or prove that unseen responses match the human trainer.

## Validation and access

Root TypeScript and 219 focused/affected-domain checks passed. All six PR gates passed on `abcaf83a7489e4175f6caf3c6520360df566eaa4`: [application, PostgreSQL/container and browser checks](https://github.com/chordsnstrings/trainer_what/actions/runs/37809780857) and [phone/desktop conversation checks](https://github.com/chordsnstrings/trainer_what/actions/runs/37809780961). The full application suite recorded 1,766 passed / 0 failed / 5 skipped; PostgreSQL recorded 1,765 passed / 0 failed / 6 skipped. Fresh CI production builds passed. Browser evidence includes saving shared communication answers, phone/desktop layouts, files/calls and subscriber/guided-workout journeys. An outdated expected list of qualification-pin fields was corrected before release; no gate was bypassed.

All five [exact-main production checks](https://github.com/chordsnstrings/trainer_what/actions/runs/37814120364) passed before the [serving watcher](https://github.com/chordsnstrings/trainer_what/actions/runs/37818441259) confirmed `x-gymmembership-release: 5a0749a8bc3e970543234b0f12bcd18502a27a93` with HTTP 200 at 17:45:03 UTC on 8 October 2026. This receipt applies to the feature release; subsequent documentation updates do not change that observed release.

Open **My Brain → Conversation options → Brain review → Your communication style**, or the detailed Brain workspace's **Communication style** tab. New context/prompt pins require applicable automatic qualifications to pass again; **Check my Brain** is available. No claim is made that every live workspace has already requalified. Nutrition retains its reviewed-week activation step.

Real-provider/account acceptance and physical iPhone/Android audio remain unverified. Browser fixtures and context consistency do not establish human-trainer fidelity.
