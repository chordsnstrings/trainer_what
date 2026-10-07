# Production music agent

A durable application worker fills eight shared instrumental playlists to thirty approved tracks each. Seed 2.0 arranges varied batches; Suno renders the music. No trainer or subscriber information enters the planner. Product copy says “frontier model”.

## Bounds and recovery

- One plan contains at most six arrangements; 2,500 output tokens, a 90-second deadline, no alternate-model fallback. Reserved slots and deterministic titles are checked before generation.
- At most four queued/submitting/pending music requests. Lifetime budget set by the operator in Admin Music (default 120 requests and 1,440 credits; no ceiling in code since migration 089, 7 October 2026), including cumulative purchases outside application jobs. Daily credit limits also apply. No automatic top-ups.
- Default planning allowance: 32 calls and $1; at most eight calls per day. Input/output prices must be configured. Reservations remain charged against the allowance after unknown results.
- Persist paid intent before network submission. Never automatically resubmit a generation with an unknown outcome. An overdue provider task is retained for reconciliation after two hours.
- Interrupted/failed planning can use saved standard arrangements without another model call. Ready arrangements are reused. Filled playlists stop purchases.
- Pause blocks unsent agent purchases and automatic publication. Already-paid tasks can still finish downloading. Manual generation shares lifetime limits.

## MP3 handling

Provider results must match the expected instrumental request and title. Downloads have explicit size/URL bounds and duplicate protection. Files are stored in the application database, independent of provider URL expiry, and support authenticated byte-range playback.

FFprobe/FFmpeg check MP3 decoding, channels, sample rate and 150–360 second duration. Excessive silence or corrupt files are rejected. Accepted audio is normalized toward -16 LUFS / -1.5 dB true peak, encoded as stereo 128 kbps MP3 and stripped of metadata. Infrastructure failures retain the file for retry and do not buy a replacement.

Automatic publication records its source and check evidence. It does not invent a reviewer identity. Instrumentality is verified from provider request settings; it is not acoustic vocal detection or a listening review. Admin preview/manual approval/rejection remain available. Member playlists publish only after thirty approved tracks and retain existing shuffle/repeat behavior.

## Deployment and activation

Migration `088_music_agent` creates service-only tables under forced RLS and starts the agent paused. Runtime and CI install FFmpeg. The existing worker runs generation, local review and planning sequentially; no external cron or user device must stay open.

After release, reconcile private checkpoint tasks against authenticated provider history; import already-paid tasks and record cumulative external usage, including those imports. Configure protected provider keys, cost/daily limit and planner prices. Start in Admin Music only after reconciliation. The owner has authorized deployment and the remaining account work. Do not equate deployment with completion of the 240-song library.

Admin Music shows heartbeat/status, budgets, reservations and saved plans. Draft settings survive refresh. Pause persists. Failed/interrupted plans offer standard arrangements. Desktop and phone layouts avoid horizontal overflow.

## Verification checkpoint

Restored source passed fifteen targeted music tests, TypeScript, a production build and the deployment suite (155 passed / 5 skipped). The overdue-task test also verifies that reconciliation grants a fresh polling window without changing its original purchase timestamp. Browser qualification runs in normal CI, including four new music-agent journey checks. Publication, CI and production verification are in progress.

Provider contracts: [generation](https://docs.sunoapi.org/suno-api/generate-music), [task results](https://docs.sunoapi.org/suno-api/get-music-generation-details), [model API](https://docs.byteplus.com/en/docs/modelark/messages-api).
