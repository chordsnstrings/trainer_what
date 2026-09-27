# Live deployment and defect-fix verification — 27 September 2026

The owner asked for the audited errors to be fixed, for the application to be tested, and for a new DigitalOcean project with everything deployed under it. This record covers the live GymMembership deployment of `main` and the defect fixes in [PR #2](https://github.com/chordsnstrings/trainer_what/pull/2). No payment, payout, model, email or food-provider call was made. Existing DigitalOcean projects and resources were listed read-only and not changed.

## Live GymMembership deployment

- **Address.** `https://gymmembership.64.227.151.196.sslip.io`.
- **Resources.** Project `0edd5213-c97c-4d27-9429-ddc878854ddc`, SSH key `59625985` and Droplet `604067976` (blr1, `s-2vcpu-4gb`, quoted USD 24/month). The Droplet is assigned to the new project. Details are in `DIGITALOCEAN_DEPLOYMENT.md`.
- **Release.** `main` at `2708f21`, deployed by the host controller from its checked push run. Readiness answered with the matching `X-GymMembership-Release` header about five minutes after the Droplet became active.

The checks below ran from the automation environment against the live address, through its HTTPS egress proxy, with local Playwright for the browser pass. No cloud browser was used.

| Live check | Result |
| --- | --- |
| Public: readiness and release header, home, pricing, how-it-works, login, signup, HTTP→HTTPS redirect, frame/nosniff headers, anonymous 401, cross-origin 403 | 11 of 11 passed |
| First Superadmin: one-time host request, sign-in, immediate password rotation, authenticator enrollment | 6 of 6 passed |
| Superadmin settings: read, save, local validation of the application controls | Passed |
| Registration gate: `LEGAL_PENDING` without approval; `LEGAL_PUBLICATION_REQUIRED` without published legal documents | Both enforced as designed |
| Trainer signup, trainer workspace, 16-step onboarding, subscriber invitation and acceptance, subscriber workspace, subscriber denied Superadmin settings, sign-out revokes the session | 9 of 9 passed |
| Browser pass: 16 trainer, subscriber and admin screens at 1440 px and 390 px | All 32 views rendered their heading; no horizontal overflow; no server errors |

### State left on the live server

- Registration is closed again: `LEGAL_APPROVED` is false and registration answers `LEGAL_PENDING`.
- Three legal documents (terms, privacy, AI disclosure) are published as clearly labelled test placeholders. They say they are not legal documents. Reviewed documents published later supersede them.
- Synthetic test accounts under `@gymmembership.invalid`: the Superadmin, two trainer workspaces and one subscriber.
- The Superadmin's rotated password and authenticator secret were kept only in the coordinating session's private scratch file, never in Git or logs. The owner should reset them through the host `reset-mfa` path or account recovery when taking over.

### Defects observed live

| Observation | Cause | Fixed in PR #2 |
| --- | --- | --- |
| About 16 sign-ins from one tester returned 429 for every user, including the Superadmin | Anonymous rate limits were keyed on the web container's address, so the whole platform shared one budget | Yes: the web proxy signs the edge-observed client address, the API keys limits on it, and a per-account limit is added |
| The subscriber app's install icon returned 404 on every page | The icon linked to the trainer's public-site icon while the site was unpublished | Yes: the platform icon is used until the site is published |
| Saving application settings accepted blank platform name and legal version | No validation of blanks for fields with defaults | Yes: blanks are rejected; the unused legal-version field is removed |

## Defect fixes

An earlier read-only audit of `620eef1` reported defects. Nine agents rechecked all 109 high- and medium-severity items against current `main` (`2708f21`):

| Status on main | Items |
| --- | --- |
| Fixed | 26 |
| Partly fixed | 28 |
| Still present | 55 |

Twelve agents then fixed the open items in isolated worktrees, one area each: rate limiting, authentication, settings, key rotation, database integrity, deployment host and CI, ledger, payouts, coaching safety, nutrition safety, nutrition delivery and the web client. The branches were merged with conflicts resolved by hand. An adversarial review then ran 20 agents over five risk areas. It confirmed 15 findings, including one blocker, and each was fixed in a second round.

Not changed in this work:

- **Right-to-left layout.** The layout conversion was blocked by the session's permission policy and was not attempted another way.
- **Architectural isolation items.** Subscriber requests still run under a staff or owner database role in some paths. Several global tables rely on application predicates rather than row-level security. A tenant transaction can `RESET ROLE`. Bootstrap payloads are unbounded. These need a redesign of how requests choose database roles and how bootstrap data is paged.
- **Provider-dependent items.** Lean status lookups and authenticated Lean probes need a verified provider contract.

## Checks

| Gate | Result |
| --- | --- |
| Full local suite on the merged fixes (embedded PostgreSQL) | 461 of 461 passed |
| Restricted-role PostgreSQL suite, local reproduction of the CI job | Passed after moving five new test fixtures to tenant transactions; one migration-replay test is embedded-only by design |
| TypeScript and production web build | Passed |
| Deployment controller tests | 54 passed |
| GitHub CI, all three jobs (application with browser journey, PostgreSQL and container, new Compose topology) | Passed on the merged fixes |

Second-round results and the post-merge live redeployment are recorded in `CLAUDE_HANDOFF.md`.
