# Working instructions

## Start and continuity

Read `docs/PROJECT_MEMORY.md`, then the current task's section in `docs/DELIVERY_ROADMAP.md`. Read only the relevant technical, screen and release sections. The full source spec is the detailed product contract; the latest explicit user instruction governs conflicts. Keep `IMPLEMENTATION_PLAN.md` as the phase-level baseline.

This repository contains planning documents and a runnable development implementation. Read `docs/BUILD_STATUS.md` for the verified boundary. Do not claim that features, credentials, tests or deployments exist until there is evidence. When implementation begins, record the active task, commit, actual checks, blockers and next action in project memory. Keep old product decisions in Git history rather than duplicating them in every handoff.

## Astra and token use — owner preference

- Reserve Astra for consequential architecture, difficult implementation/debugging and targeted reviews of financial, safety and isolation boundaries.
- Do not use Astra for web browsing. Use an available economical research route when current external facts are required, then pass a short sourced result to implementation. If model routing is unavailable, expose that limitation instead of claiming another model was used.
- Use shell search, structured parsing, diffs and ordinary tooling for inventory, extraction, formatting and repetitive changes. Reuse verified results while they remain current.
- Give each model task one concrete deliverable and acceptance check, with the smallest sufficient context. Do not reload the complete specification for every task or paste full tool registries/logs.
- Work one bounded issue or tightly related group at a time. Batch independent reads; keep edits and dependent operations sequential. Do not start subagents or speculative parallel reviews unless the user explicitly authorizes them.
- Run checks that address changed behavior or a concrete remaining risk. Re-run a broad suite only for an affected boundary or release gate. Stop once evidence is sufficient.
- Record actual model/token/cost usage when the runtime exposes it. Never manufacture token savings, prices or usage. If a budget is supplied, enforce it; otherwise keep calls bounded and report material new spending needs.

## Implementation rules

- Deliver vertical slices: persisted behavior, authorization, UI states, events, relevant checks, deployment evidence and a concise release note.
- Keep provider adapters separate from domain rules. Stripe collects; Lean pays from the company bank; the ledger reconciles both.
- Resolve tenant context from verified host/session and enforce database isolation. Use tenant-aware cache, jobs, objects and vector retrieval.
- Store structured coaching decisions and evidence before rendering copy. Safety and data-use rights are enforced by code outside the model.
- Financial records are immutable; corrections compensate earlier entries. Stable business intent controls retries. Unknown external outcomes require reconciliation before another attempt.
- Use test providers only in explicitly isolated nonproduction fixtures. A production integration without access remains disabled with a clear status.
- Keep secrets, raw bank details and sensitive customer records out of Git, prompts, logs and screenshots. Credentials belong in the deployment secret manager.
- Make small reversible choices autonomously. Continue independent work around blocked credentials or approvals. Carry forward existing authorization instead of repeatedly asking for it.
- The owner has authorized implementation. Continue useful work autonomously; live charging, payout execution, purchases and production placement still follow the established release authority and account capabilities.
