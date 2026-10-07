# Claude handoff

## Work in progress

**Free onboarding hook + music budget ceiling (7 October 2026, branch `claude/repository-overview-osejlw`):** owner: "we are not charging the trainers anything upfront unless they want custom domain … free to onboard … AI based trainer with free onboarding at no cost to the trainer", and "I changed the daily generation cap to 5000 from 1440 but it didn't get updated". (1) Made free onboarding true in code: AI a trainer uses to set up and teach their AI (`PLATFORM_BORNE_SETUP_TASKS` in `apps/api/src/cost-accounting.ts`) is now borne by the platform and never enters the AI Coach Service Fee; subscriber-serving AI is charged as before. (2) Copy: home title/description/lede/hero line ("Free to join · No upfront cost · Built for UAE trainers"), economics band "Free to start. Your price.", a new FAQ "Does it cost anything to join?" (home, pricing, FAQ), pricing description/lede/intro/"What will I pay?", About money line, Get started lede. Kamran reads the same content, so he answers it too. (3) Music: the live Settings value `MUSIC_DAILY_CREDIT_LIMIT` is already 5000 (saved 6 October); what stops generation is the agent's separate lifetime budget in Admin Music (live: 1,440 credits / 120 requests, all 1,440 reserved by 45 requests at 32 credits, status "Total generation limit reached"), hard-capped at 1,440 in the form, API and database. Migration `089_music_budget_ceiling` plus the API and form now allow up to 1,000 requests / 20,000 credits. The owner still sets the budget in Admin Music → Budgets (5,000 credits needs ≥157 requests at 32 credits each); I did not raise the live budget, because it spends Suno credits. Checks: root and web tsc pass; platform-finance + platform-finance-bcd 30/30; music-agent 7/7 (ffmpeg installed locally); marketing-*, model-name-guard, public-pages, brand, assistant tests 102/102 after updating 3 pinned strings (hero line, economics heading, home title). Not run: brand-check word budget and browser checks (not part of CI). Next: PR, CI, merge, release header check; then the owner raises the Admin Music budget.

Earlier: the readable home walkthrough is live at `668c345` (PRs #39/#40); scroll scenes on `/` are live since PR #37.

Production music agent: `feat/production-music-agent-2026-10-06`. See [feature and activation notes](docs/MUSIC_AGENT_2026-10-06.md).

On 6 October 2026 the owner explicitly approved publishing this feature's source and sanitized handoff publicly, then deploying it. The previous public-publication approval blocker is resolved. The workspace reverted to an older snapshot; the prepared patch was restored onto main `136e7b247e03c5f3d786ef2be1aff63c9424163f`. Restored source passed fifteen music tests, TypeScript, the production build and deployment checks (155 passed / 5 skipped). Public CI and deployment are in progress. Do not claim this feature is serving until the release header confirms it.

The feature adds a persistent server worker: Seed 2.0 plans small shared batches; Suno generates instrumental songs; MP3s are downloaded, decoded, normalized, stored and served from the application. Eight genres target thirty approved songs each. Admin Music exposes status, bounded budgets, recovery and pause/start controls. Migration `088_music_agent` and runtime FFmpeg are required. New automation starts paused.

## Activation and recovery

1. Use the private music recovery checkpoint and authenticated provider history to reconcile earlier purchases. Import known paid task IDs through Admin Music. Preserve unknown paid intents; never purchase replacements for an unknown outcome.
2. Record all purchases outside application jobs as cumulative external requests and credits, including imported tasks. Counts cannot decrease. The combined cap remains 120 generation requests / 1,440 credits. Do not assume the earlier music bank is complete.
3. Verify protected music credentials, provider cost, daily limit and existing model connection/prices in Settings. Keep keys and private checkpoint contents out of Git and logs.
4. In Admin Music confirm reconciliation, save budgets, enable automatic publishing if desired, then start the agent. Check its heartbeat, provider results and stored files. Already-paid downloads continue while generation is paused.
5. Automatic checks establish playable MP3s, duration, silence and normalized loudness. Instrumentality comes from verified provider request settings. This does not claim acoustic vocal detection or a human listening review.

Claude retains the owner's authorization to finish the DigitalOcean, DNS, TLS and host work using its authenticated account access. Complete deployment, configuration and recovery through the established access paths; no fresh owner confirmation is needed for the already-authorized work.

## Release rules and current baseline

The owner says **always deploy** after normal release checks. Update this handoff with the release commit and actual verification. Never bypass failed CI, access controls or reconciliation of unknown charges. Use direct repository and deployment APIs; keep updates short.

Before this feature, PR #35 / main `136e7b247e03c5f3d786ef2be1aff63c9424163f` passed all five PR checks and all five exact-main checks and served with healthy readiness and linked assets. The coach-workflow F01–F10 fixes are in that release. Fresh coaching-prompt qualification, live-provider evidence and physical-device guided-session checks remain distinct from fixture evidence.

Read `AGENTS.md` and `docs/PROJECT_MEMORY.md`. Public product copy calls the AI a **frontier model**. Source configuration can name its actual provider/model.

Earlier product decisions and detailed historical work remain in [the previous handoff](https://github.com/chordsnstrings/trainer_what/blob/136e7b247e03c5f3d786ef2be1aff63c9424163f/CLAUDE_HANDOFF.md). This concise handoff does not override them.
