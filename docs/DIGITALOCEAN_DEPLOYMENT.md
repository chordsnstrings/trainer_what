# DigitalOcean deployment

The owner authorized new infrastructure on 25 September 2026 at 12:35 Asia/Dubai. At 13:24 they chose a single-server start, deferred a dedicated VPC and cloud firewall, and required the new project to be named **GymMembership**. Existing projects and resources remain outside the write scope. This authorization persists; do not repeat permission, installation or network-toggle requests.

## Resource boundary

- Create a new project named exactly `GymMembership`, a new SSH key and a new Droplet. If an unrelated project already has that name, stop for reconciliation; never adopt it.
- Keep a durable manifest of IDs returned by successful create responses. Subsequent writes must use those owned IDs. Names and tags alone do not establish ownership.
- Assign only the new Droplet to the new project. Never modify an existing project, its membership, its default status, or an existing Droplet, key, database, volume, bucket, firewall or domain.
- Use DigitalOcean's default networking for this initial host without changing the network. A dedicated VPC and cloud firewall are expressly deferred. The database, API and worker must not publish host ports; web binds to loopback behind HTTPS.
- Read only metadata needed to check access, availability, cost, collisions and this deployment's state. Never import unrelated customer data, secrets or backups.
- Checkpoint an attempted create before sending it. An ambiguous outcome blocks another create until reconciled. Retain successful response IDs even if later setup fails; reruns resume those resources instead of creating duplicates.

## Prepared footprint

`infra/digitalocean/launch.json` selects Bangalore (`blr1`), Ubuntu 24.04 and `s-2vcpu-4gb`: 2 vCPU, 4 GB RAM and 80 GB local disk. The authenticated DigitalOcean size listing on 25 September quoted **USD 24/month for compute**. The provisioner checks availability and rejects a compute quote above USD 24 before creating resources. This is not an all-inclusive bill or a purchase record.

The host runs the existing Next.js web, Fastify API, PostgreSQL 17.6, migration job and worker with Docker Compose, plus Caddy for HTTPS. Fresh database administrator/runtime passwords and an account-encryption key are generated on the new host. Runtime secrets remain in `/opt/gymmembership/runtime.env` with private file permissions. The provisioner's DigitalOcean token and GitHub token are never placed in cloud-init, an image or the application's environment.

The planned temporary URL is `https://gymmembership.<new-public-ip>.sslip.io`. It is an intended address format; an actual URL is reported only after creation. Caddy certificate issuance and external HTTPS readiness still require live verification.

## Setup and automatic Git deployment

The implementation is in `infra/digitalocean/` and `.github/workflows/gymmembership.yml`. All 36 local deployment unit tests passed, including ownership/retry and release-failure cases. It has not yet provisioned a server; CI and live verification remain pending.

1. Store the supplied DigitalOcean management token as the repository Actions secret `DO_PROVISION_TOKEN`. Never put its value in Git, documentation or logs. The setup workflow receives GitHub's temporary repository token separately.
2. Run **Set up GymMembership** from `main`; changes to `infra/digitalocean/launch.json` also trigger setup. It waits for **Application checks** to pass for that exact current `main` commit before provisioning. Pull requests cannot run the setup job or receive its deployment credential.
3. Setup creates only the new project, key and server, then verifies the server's membership in GymMembership. Ownership checkpoints live on `deployment/gymmembership-<deployment-id-prefix>` in `infra/digitalocean/ownership.json`; a workflow artifact retains another copy. These records contain IDs and status, never secrets.
4. Cloud-init installs Docker and a `gymmembership-deploy.timer`. The server checks the public repository about every five minutes. It deploys only the exact current `main` SHA with a successful completed push run of `check.yml`, downloads that commit, and rechecks approval after building it. No GitHub access token or SSH deployment credential is needed for these public-repository updates.
5. Releases are serialized on the host. The controller validates network exposure, keeps the database on its existing volume, runs migrations with the administrator, applies the non-owner runtime grants, and starts the application. It checks localhost readiness, public HTTPS and the `X-GymMembership-Release` header before recording success.

If the setup secret is missing, the workflow reports that no resources were created. Adding the secret alone does not start setup; run the workflow afterward. If the repository becomes private, the server's credential-free update route needs an explicit replacement.

## Recovery and verification

Failed migrations leave the current application running. If a new application release fails health checks, the controller attempts to restore the previous application and HTTPS configuration. It does not reverse database migrations. Future schema changes must remain compatible with the previous running release.

The controller takes a private local SQL dump before updating an existing deployment. This is a local recovery aid, not off-host backup or demonstrated restore evidence. Provider backups, retention, external monitoring and measured recovery remain operational work.

On the owned host, inspect `cloud-init status --long`, `journalctl -u gymmembership-deploy.service` and `systemctl status gymmembership-deploy.timer`. Do not print runtime environment files or rendered Compose configuration, which contain credentials. Retain the new project/server IDs, selected quote, exact release SHA, migration/runtime-role evidence, HTTPS response and a subsequent Git-triggered update before declaring automatic deployment operational.

## Current evidence and activation boundary

Authenticated DigitalOcean app account/region/size reads succeeded at 13:11 Asia/Dubai. The app lacks project creation/assignment and cloud-init parameters. The owner requires direct DigitalOcean API access and explicitly prohibits cloud-browser use. The final direct request to `https://api.digitalocean.com/v2/account`, using the supplied token, returned HTTP 200 with `Content-Type: text/html` and a 195-byte Site Unavailable page instead of account JSON. Token validity is therefore unverified; no create request was made. The prepared GitHub Actions workflow uses the official API for setup, but its `DO_PROVISION_TOKEN` repository secret is not configured and the GitHub connector has no secret-setting operation. That route needs one-time operator secret entry; do not request browser sign-in or repeat network/admin setting requests.

**No real cloud resources have been created.** The new setup code has no published CI, cloud-init, HTTPS, restore or automatic-update evidence yet. The supplied DigitalOcean token has not received a valid API response. Existing application CI evidence is recorded in `BUILD_STATUS.md`; it does not verify this deployment controller.

Infrastructure setup does not enable registration, nutrition, imports, live commerce or payouts automatically. Existing legal/provider/feature flags remain disabled until their respective evidence exists. Real customer health-data placement and model qualification remain separate decisions. Required meal-photo and barcode work remains open under 043; running a server does not complete those integrations.
