# Project memory

Updated: 24 September 2026. This is durable project context for future build sessions. It records decisions, not credentials or a claim about account capabilities.

## Owner decisions

| Topic | Current decision |
| --- | --- |
| Project | `chordsnstrings/trainer_what`; Trainer Brain Platform |
| Current request | Complete the whole implementation plan before starting application implementation |
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

- Repository contents: implementation plan and supporting planning documents; no application, production deployment or passed product tests yet.
- Plan covers all 34 initial work items, 75 source screen groups, technical contracts, external dependencies, release evidence and operational handoff.
- Stripe/Lean funds flow is selected. Actual provider acceptance, source-bank compatibility, beneficiary requirements, authorization and final payment confirmation remain to be proven.
- Other open inputs: approved domain/brand assets, infrastructure budget/region, model and email providers, wearable/voice permissions, reviewed legal/tax policy, commission allocation details and pilot participants.
- Next work: issues 001–004 plus the independent foundation work in 005–009, as described in `DELIVERY_ROADMAP.md`.

## Handoff format

At the end of an implementation slice, replace the current-state bullets with a short factual checkpoint: active/completed issue IDs; code commit; migration/deployment state; checks actually run and evidence paths; unresolved blocker with owner; next executable action. Preserve the owner decisions until explicitly changed. Do not mark a requirement complete because its plan or UI exists.
