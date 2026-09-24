# Trainer Brain Platform

A UAE-first, trainer-branded coaching platform. The implementation sequence, full product scope, dependencies, and launch gates are in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). The original Astra 6 master build specification remains the detailed product contract and must be supplied separately to the implementation team.

## Current state

Planning and feasibility. Application code, infrastructure, Stripe configuration, and production deployment have not been implemented.

## First milestone

Validate the existing Stripe account's ability to onboard the intended UAE trainer types and pay them monthly to UAE IBANs after reconciliation. Use **Stripe test mode** and document the results in the [Stripe feasibility protocol](docs/STRIPE_FEASIBILITY.md). Do not infer payout eligibility from a bank account number alone. Then establish staging, authentication, tenant isolation, the event/financial ledgers, and a complete trainer-to-subscriber coaching path.

## Credentials

Keep secret and restricted keys in a managed secret store, scoped to the environment and service. Use the variable names in [`.env.example`](.env.example) for local development; never commit values or paste them into issues, logs, or chat. The publishable key is intended for client-side use, but should still be environment-specific. Live charging and payouts remain disabled until the plan's finance, legal, safety, and launch gates are evidenced.
