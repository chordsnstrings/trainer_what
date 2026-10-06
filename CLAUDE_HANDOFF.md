# Claude handoff

## Work in progress

**Scroll scenes (6 October 2026, Claude, branch `feat/scroll-scenes-2026-10-06`, not built):** owner asked to apply the scroll-scenes skill to the home page. Audit and plan done (6 agents, read-only; baseline screenshots under the session scratchpad). Plan for `/` only (owner: be frugal, home page first): hero `depart`; journey walkthrough custom scroll-scrub pin (480svh desktop / 500svh phone, old autoplay clock stands down, Play/Replay become scroll jumps, short viewports below ~700px keep today's autoplay); subscribers tiles `assemble` (move the `li`, not the hover tile); control flow `beats` (4 beats in place); economics bands `rise` (address input excluded); closing `reveal`; calculator, FAQs, Kamran untouched. Review fixes adopted: track height via `::after`, `data-scene-live` so p=1 leaves no styles, site reduce-motion cookie (`html[data-reduce-motion]`) also respected by the player, crawlers/webdriver skip scenes. **Waiting on the owner's approval before any code.**

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
