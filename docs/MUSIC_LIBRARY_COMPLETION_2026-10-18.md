# Music library completion — 18 October 2026

## Problem

Separate lifetime credit/request and planning limits could prevent the worker from filling the library despite an available daily allowance. Earlier migration 089 made those caps editable. This change removes those caps so the finite library target determines completion.

## Change

Remove lifetime credit, generation-request, planning-call and planning-USD enforcement from settings, automatic planning/queuing and purchase dispatch. The worker fills the existing target of thirty approved tracks in each of eight playlists, within the configured daily music allowance and provider balance. Eight planning calls per UTC day remain; planning resumes on a subsequent day. No provider credential, daily limit, consent or historical purchase record is changed.

Admin Music replaces lifetime-budget counters/inputs with ready playlists, checked tracks toward 240, daily music credits and daily planning calls. Usage and cumulative external purchases remain available as history. Legacy cap columns remain for rollback compatibility only; current settings omit them and ignore old submitted cap fields. No migration or manual budget update is needed. Enabled agents at the obsolete cap status recheck on the next worker tick; paused agents stay paused.

Paid-task recovery, unknown-outcome reconciliation, four-request concurrency, cached plans, MP3 decoding/duration/silence checks, loudness normalization and duplicate protection remain in force. A stored file awaiting review does not count as approved. Rejected audio leaves a gap for the worker to fill. The full library stops further agent purchases.

## Verification and release

Implementation is complete on `fix/music-library-completion-2026-10-18`, based on main `4753fe8ac3d8302dcad927cd31d91d0a66732674`. TypeScript, the production build and all **17 focused music tests** pass. Verification covers the production cap stall, old-page compatibility, immutable purchase history, daily reservation/dispatch limits, UTC rollover, paid downloads, MP3 review/streaming, replacement of a rejected track and the full-library stop. The replacement journey runs actual FFmpeg checks and authenticated byte-range playback with isolated provider fixtures. Release checks and production serving verification remain in progress.

Local Chromium download returned invalid archives; browser verification uses the existing release CI journey. These checks use isolated providers and synthetic audio, and do not measure the contents of a deployed music catalogue.
