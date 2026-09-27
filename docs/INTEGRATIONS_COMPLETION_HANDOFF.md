# Integrations completion handoff — 26 September 2026

The integration modules and subsequent authorization/host hardening are implemented and fixture-tested. Live provider/account/device qualification and deployment have not been performed. The user waived screenshots for this completion pass.

## Wiring completed

- `registerIntegrationCompletion(app, db)` from `apps/api/src/integrations-completion.ts` registers wearable OAuth/state/sync/revoke, trainer voice enrollment/review/guided sessions, and domain request/quote/approval/ownership/DNS/TLS/renewal operations. The shared app registers it after authentication hooks and maps `ConfigurationError` to a 409 response.
- `processIntegrationJobs(db)` handles hourly wearable reads, local-first provider revocation, stale authorization leases and domain expiry. The worker runs it once per minute inside effective runtime settings without blocking the finance/email job loop. Normal synchronization skips closed workspaces and missing memberships; queued revocation continues for closed workspaces until confirmed. All integration-table work uses explicit tenant transactions; the shared runtime only needs its existing system workspace/domain directory permissions.
- `IntegrationCenter({path,role,integrations})` from `apps/web/components/integration-center.tsx` replaces the old integrations body. It covers `/trainer/integrations`, `/trainer/voice`, `/trainer/domains` and `/app/wearables`.
- `GuidedSession({workoutId})` renders `/app/guided/:workoutId`; link from active workout logging. Written guidance always works for an active entitled workout. Premium audio requires subscription `data.modules` containing `voice` or `premiumVoice:true`, verified coach voice, explicit user consent, no safety hold/takeover and configured approved voice provider.
- `IntegrationOperations()` renders a dedicated `/admin/integration-operations` view. The workspace routes it before generic admin routing and links it from superadmin tools. Routes under `/api/v1/admin/integrations/voices` and `/domains` enforce platform administrator + fresh MFA.
- Existing `/wearables/import` records the explicit accepted consent as `document_type='wearable:'+source`, the effective privacy-document version plus `integration-consent:v1`, alongside import. UI now previews the export and requires an unchecked permission box before an explicit import action. The import endpoint honors Apple import enablement, workspace closure and the same integration permission lock as withdrawal.
- Existing generic wearable/voice consent withdrawal calls `disableUserIntegrations(tx,userId,'wearable'|'voice')` and takes the same integration/training locks before disabling use. Coaching withdrawal must not mutate unrelated voice or nutrition permissions.
- `exportIntegrationData(tx,userId)` redacts tokens and authorization state; `disableUserIntegrations` immediately denies local wearable/voice use and queues provider token revocation. Preserve encrypted credentials until external revocation is confirmed or evidenced by the privacy follow-up workflow. Provider-side voice clone removal requires separate recorded provider action.

## Verified tenant host

`apps/web/proxy.ts` now owns API forwarding; `next.config.ts` no longer has an unsigned API rewrite. It strips inbound `x-trainer-*`, `Forwarded`, and `X-Forwarded-*`, then signs canonical host + method + exact path/query + timestamp with `INTERNAL_PROXY_SECRET` (separate from encryption key, at least 32 bytes). Production requests fail closed if missing. Static assets are excluded from rewriting.

API onRequest sets `request.hostContext = await resolveRequestHost(db, req)`, then runs `enforceHostTenant(context, identity)` after authenticating. Browser mutation CSRF uses `allowedRequestOrigin(context, Origin)`. Readiness-only endpoints allow the local container probe without tenant selection. Platform hosts retain the configured origin; verified custom domains have their exact HTTPS origin. Do not trust `X-Forwarded-Host` or unsignaled tenant headers.

Public `GET /api/v1/public/host` returns only the resolved HostContext. Next uses it without cookies to map a custom domain to its published tenant. Custom public routes rewrite to `/coach/:slug/...`; client/auth/legal routes stay intact; trainer/admin/signup and foreign coach/join routes are rejected. Proxy sets `x-trainer-site-slug`, `x-trainer-site-tenant`, `x-trainer-site-origin` for the SSR website. Any API fetch originating from SSR must sign its own actual method/target, not reuse the incoming page signature.

Shared auth now selects the custom host membership on login; registration is platform-only; enrollment slug and invitations must match the host; workspace switches cannot cross a custom host; platform-role sessions are refused on custom hosts. Public slug routes are restricted to the mapped tenant. A stale foreign cookie can still sign out or view the public site. Root's media/site registration and account recovery/magic-link modules must retain this host context.

## Configuration activation

The provider catalog now declares working integration workflows, but default contracts remain disabled. Even an injected successful configuration test must not activate without:

| Provider | Required approval |
| --- | --- |
| WHOOP | `WHOOP_CONTRACT_VERIFIED=true`; account authorization, approved scopes and data-use rights |
| Zepp | `ZEPP_CONTRACT_VERIFIED=true`, `ZEPP_ADAPTER_CONTRACT=canonical-observations-v1`, approved partner OAuth/API URLs and scopes |
| Voice | `VOICE_CONTRACT_VERIFIED=true`, provider `elevenlabs`, base URL, key, model, reviewed price version and positive daily USD cap |
| Domains | `DOMAIN_OPERATIONS_ENABLED=true`, approved `DOMAIN_CNAME_TARGET` |

`integrationStatus()` and shared platform-settings activation/effective resolution now enforce configured fields and explicit contract approval independently of probe status. Saving a change clears the previous revision's verification. Test validation performs no external calls for these four adapters and does not certify accounts.

Zepp contract: OAuth authorization-code + PKCE and refresh-token endpoints supplied by the approved partner; `GET {base}/v1/observations?since={ISO}&limit=25&nextToken={cursor}` returns `{records:[{id,type,value,unit,measuredAt,sourceVersion}],next_token?}`; `DELETE {base}/v1/connection` revokes authorization. Supported types are recovery_score, sleep_seconds, strain, average_heart_rate, max_heart_rate, steps, energy_kj. This is an explicit gateway contract, not a claim about an undocumented direct Zepp endpoint. Restricted observations never enter model prompts or marketing.

WHOOP now follows the researched confidential-client OAuth flow; its public OAuth guide does not document PKCE, so WHOOP requests do not send PKCE parameters. Zepp's explicit gateway contract still requires PKCE. State is single use, bound to session, workspace and initiating origin. A registered platform callback can relay only a stored state to the verified initiating custom domain; that domain's original session must redeem it. Refresh rotates both tokens, is serialized, and stores the new pair atomically. Unknown refresh outcomes stop synchronization until reconnection instead of retrying old refresh credentials. Revocation racing with authorization/refresh retains the received encrypted token only for external cleanup. A 401/404 revoke response does not falsely declare revocation complete.

Primary sources researched by the parent's economical agent (no browsing by this implementation agent):

- WHOOP OAuth: https://developer.whoop.com/docs/developing/oauth/
- WHOOP token rotation: https://developer.whoop.com/docs/tutorials/refresh-token-postman/
- WHOOP v2 resources/revocation: https://developer.whoop.com/api/
- ElevenLabs conversion: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
- Professional clone creator/verification requirements: https://elevenlabs.io/docs/help-center/product/voices/voice-cloning/can-i-create-a-professional-voice-clone-of-someone-elses-voice
- Instant-clone rights: https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/instant-voice-cloning
- Historical Zepp corporate cooperation reference, not present account approval: https://github.com/zepp-health/rest-api/wiki

No real provider request was made. WHOOP polling synchronization is implemented; webhook delivery is optional for freshness and is not claimed.

Voice usage reserves estimated character cost before dispatch, records unknown outcome before any provider POST, and uses stable server-generated text/voice/workout identity to prevent repeat billing after an ambiguous result. Generated audio proves delivery, not the actual billed charge; cost remains unknown until existing usage reconciliation records provider invoice evidence. No automatic cloning or unconsented scripts. Professional enrollment explicitly requires the trainer to create and identity-verify the clone in their own provider account and share it for this use. Accepted wearable/voice permission is pinned to effective published privacy content. Raw trainer verification samples are owner/admin-only; subscriber guidance uses narrowly selected voice metadata.

Domain registration/payment/DNS/TLS provisioning are explicit operator workflows. Exact quote approval does not call a registrar or move money. Recorded completed registration plus TXT, approved CNAME and successful HTTPS certificate validation allow host activation. Expiry disables mapping; expired renewal requires re-verification before reactivation. Apex domains without a CNAME currently need the operator to use a supported subdomain.

## Migration and runtime grants

`017_integrations_completion.sql` adds RLS-scoped `integration_connections`, `integration_oauth_states`, `trainer_voices`, `guided_audio`, `domain_orders`, plus a narrowly scoped `integration_actor_is_current()` membership check that reveals no tenant settings. Worker/admin operations select the global workspace directory and enter explicit tenant transactions; no RLS bypass or service-role SELECT/UPDATE grants on integration tables are needed. Existing tenants/memberships/domain_mappings system permissions must remain. The non-owner fixture verifies this boundary. Administrator list endpoints accept optional `?tenantId=UUID` filtering; their default list is bounded to the latest 100 workspaces and 100 results.

## Checks actually run

- Focused checks: **45/45 passed** across `tests/integrations-completion.test.ts` (16), `tests/provider-configuration.test.ts` (8), `tests/platform-settings.test.ts` (15), and `tests/host-routing.test.ts` (6). Host tests were rerun after final consent-lock wiring.
- `npm run typecheck`: passed after shared app/web/worker wiring.
- Checks cover tenant-bound credential encryption, disabled contracts, session-bound one-time confidential OAuth and explicit partner PKCE, observation dedupe/rights, revoke cleanup, verified premium voice, no automatic retry of ambiguous audio, safe workout playback, exact-price domain approval/CAS/DNS/TLS and signed-host forgery/tenant/origin denial, custom-host callback relay, callback/refresh revocation races, unknown refresh suppression, closed-workspace revocation, and downgraded non-owner worker/admin execution.
- Full-app host/auth tests verify signed/forged/forwarded hosts, public slug isolation, origin rejection, login/workspace/enrollment/invitation restrictions, platform-role restrictions, sign-out with a stale cookie, integration route registration, pinned Apple consent and withdrawal, and closure.
- These are isolated synthetic transports; provider credentials from chat were not used. Browser/build and PostgreSQL CI remain root release checks.

## Remaining shared integration work

The product schema and verified Stripe entitlement projection must carry optional `premiumVoice` on the existing workout/workout+nutrition offers before voice can be purchased through the app. The guided API gate is implemented, but a database-only entitlement is not a complete purchase path. Root was notified; do not claim premium voice is currently purchasable until that bounded commerce change is wired and tested.

Local development: API and worker load the repository-root `.env` through their launch commands. Web must receive the same `INTERNAL_PROXY_SECRET`, `PUBLIC_APP_URL`, and `API_INTERNAL_URL`; the infra owner is adding environment propagation. Keep secrets server-only. No configuration-loader change has been made in Next.
