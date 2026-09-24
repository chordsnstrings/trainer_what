# Project memory

Updated: 24 September 2026. This is durable project context for future build sessions. It records decisions, not credentials or a claim about account capabilities.

## Owner decisions

| Topic | Current decision |
| --- | --- |
| Project | `chordsnstrings/trainer_what`; Trainer Brain Platform |
| Current request | Start implementation and complete the planned product; continue independently around unavailable provider access |
| Astra | Available for difficult design, implementation and review; use tokens wisely; do not use it for browsing |
| Execution | Use bounded tasks, targeted context, deterministic tooling and useful verification; avoid repeated planning/research and unnecessary confirmation |
| Collections | Existing operator Stripe account for subscriber subscriptions, refunds and disputes |
| Trainer payouts | Lean Technologies initiates monthly payouts from the company's bank account to eligible verified personal/business UAE IBANs, after reconciliation |
| Payment history | The earlier Stripe Connect payout direction is superseded by Stripe collection + Lean payout |
| Finance | One immutable ledger, marginal 25%/20%/15%/10% commission bands, transparent AI/voice charges and gross-to-net statements |
| Product | Trainer Brain Compiler + Client Twin + governed first-person Coach Runtime; trainer identity and control are central |
| Market/design | UAE, AED, English first with Arabic-ready layout; restrained Swedish-minimal design |
| Infrastructure | DigitalOcean is the source-spec preference; region, residency, configuration and spend are gated before production |
| Credentials | Operator expects to supply API access during implementation; availability and permissions must be verified without retaining values here |

## Current state

- Runnable development monorepo implemented: Next.js web, Fastify API, PostgreSQL/PGlite migrations, worker, coaching/subscriber flows and finance operations. See `BUILD_STATUS.md` for actual scope and gaps.
- Latest local evidence: TypeScript passed, 25 automated tests passed, production web build passed; five local database migrations applied. Browser download failed, so visual/browser checks have no passing evidence.
- No provider secret was copied from chat into code, no live provider call or financial transfer was made, and no DigitalOcean deployment exists.
- Stripe/Lean funds flow remains selected; actual account acceptance, recipient/source-bank capability and finality remain unverified. Lean transport is explicitly gated pending account-specific verification.
- Repository now includes setup/deployment instructions, container/CI definitions and ADR 001 for npm/PGlite/document-record choices. Full source scope remains open; missing implementation and external blockers are distinguished in the build status.
- Active work: issues 005–025 and 030–031 have implemented portions. Issues 001–004 remain external decision/access work. WHOOP/Zepp, domains, voice, native companion, infrastructure Governor and full launch operations are unfinished.
- Next executable work: browser/production PostgreSQL verification, resolve remaining implementation gaps in `BUILD_STATUS.md`, then provider sandbox/staging evidence when access exists. Do not mark all 75 screens or 34 packages complete from this checkpoint.

## Handoff format

At the end of an implementation slice, replace the current-state bullets with a short factual checkpoint: active/completed issue IDs; code commit; migration/deployment state; checks actually run and evidence paths; unresolved blocker with owner; next executable action. Preserve the owner decisions until explicitly changed. Do not mark a requirement complete because its plan or UI exists.
