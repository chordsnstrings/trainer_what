# ADR 001 — Initial implementation choices

Date: 24 September 2026. Status: implemented development baseline.

## Toolchain and runtime

Use npm workspaces and the npm lockfile rather than introducing pnpm/Turborepo for four shared packages and three apps. Node 24 is pinned in CI/container configuration. Next.js 16, React 19, Fastify 5 and Zod 4 are pinned to the versions actually installed. This is a routine tooling change from the preferred stack, not a change to product scope.

Local development uses PGlite, a real embedded PostgreSQL engine, with serialized transactions and a process lock. Production requires network PostgreSQL and a non-owner, non-superuser role. Tests exercise SQL/RLS/triggers against PGlite; they do not prove network-pool concurrency, operational recovery or managed PostgreSQL compatibility.

## Storage

Identity, memberships, money, subscriptions, bookings, consent and event/job boundaries have relational tables. Evolving coaching documents use versioned, tenant-scoped JSON records validated by Zod at API boundaries. Financial closes and rule revisions are protected history. High-volume entities and retrieval should move to dedicated schema/indexes as their measured use requires it.

The bootstrap is bounded to recent records. This is a pilot implementation, not a proven large-tenant query architecture. Object storage/vector search were not provisioned or simulated.

## Coaching

Model evidence requires explicit model-use permission. Wearable imports initially allow rendering and deterministic features only. Teaching compilation cites source IDs; held-out scenarios are excluded from compiler input. Releases pin rules and their evaluation digest. Model-generated replies and programs remain supervised, with current consent/release checked again at approval. The safety keyword gate is a conservative first layer and requires a much broader assessed policy before autonomous coaching.

## Finance

Stripe and Lean are separate adapters around one journal. Provider completion and bank finality remain distinct. Lean is disabled until account-specific contract verification. Manual settlement/destination/outcome review makes the unfinished automation visible and reviewable. It does not establish provider capability or authorize actual transfers.

## Deployment

Supply one container image for web/API/worker plus separate migrations. On 25 September 2026 the owner chose a new GymMembership project and a single new DigitalOcean server, deferring dedicated VPC and cloud firewall work. The initial configuration selects blr1, s-2vcpu-4gb and a USD 24/month compute cap. A GitHub setup workflow and host updater for successful checked main commits are implemented locally; CI and live deployment remain unverified. Migration credentials are absent from runtime services; provider credentials are absent from the web service. Customer-data residency, off-host backups, availability design and the source's eventual DOKS/managed services topology remain separate release work. See DIGITALOCEAN_DEPLOYMENT.md.
