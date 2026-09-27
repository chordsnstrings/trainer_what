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

The implementation is in `infra/digitalocean/` and `.github/workflows/gymmembership.yml`. Code 224b893 passed all 37 deployment checks on GitHub, including real Docker Compose configuration, ownership/retry and release-failure cases. Both application CI jobs also passed. Local verification passed 36 checks and explicitly skipped the Docker-dependent check. See [deployment evidence](VERIFICATION_2026-09-25_DEPLOYMENT.md). It has not yet provisioned a server.

1. Store the supplied DigitalOcean management token as the repository Actions secret `DO_PROVISION_TOKEN`. Never put its value in Git, documentation or logs. The setup workflow receives GitHub's temporary repository token separately.
2. Run **Set up GymMembership** from `main`; changes to `infra/digitalocean/launch.json` also trigger setup. It waits for **Application checks** to pass for that exact current `main` commit before provisioning. Pull requests cannot run the setup job or receive its deployment credential.
3. Setup creates only the new project, key and server, then verifies the server's membership in GymMembership. Ownership checkpoints live on `deployment/gymmembership-<deployment-id-prefix>` in `infra/digitalocean/ownership.json`; a workflow artifact retains another copy. These records contain IDs and status, never secrets.
4. Cloud-init installs Docker and a `gymmembership-deploy.timer`. The server checks the public repository about every five minutes. It deploys only the exact current `main` SHA with a successful completed push run of `check.yml`, downloads that commit, and rechecks approval after building it. No GitHub access token or SSH deployment credential is needed for these public-repository updates.
5. Releases are serialized on the host. The controller validates network exposure, keeps the database on its existing volume, runs migrations with the administrator, applies the non-owner runtime grants, and starts the application. It checks localhost readiness, public HTTPS and the `X-GymMembership-Release` header before recording success.

If the setup secret is missing, the workflow reports that no resources were created. Adding the secret alone does not start setup; run the workflow afterward. If the repository becomes private, the server's credential-free update route needs an explicit replacement.

## Recovery and verification

Failed migrations leave the current application running. If a new application release fails health checks, the controller attempts to restore the previous application and HTTPS configuration. It does not reverse database migrations. Future schema changes must remain compatible with the previous running release.

The controller takes a private local SQL dump before updating an existing deployment. This is a local recovery aid, not off-host backup or demonstrated restore evidence. Provider backups, retention, external monitoring and measured recovery remain operational work.

## Host safeguards

- **Retention.** After a deployment is recorded, the controller keeps only the current and previous release trees and `trainer-brain:<sha>` images. It removes other release trees and leftover `.unpack-*` directories. Image removal is never forced, so an image still used by a container remains. Build cache older than seven days is pruned. The seven newest complete `backups/<time>.sql` dumps are kept, and dumps are pruned only at this point. A dump that fails part-way is deleted, so it cannot displace a complete one. A failed or retried deployment prunes nothing, dumps included, so the dump taken before its migration survives every retry. Retention problems are logged and retried after the next successful deployment.
- **Missing runtime secrets.** New secrets are generated only on a new host. If `runtime.env` is missing but `release-state.json`, `runtime.fingerprint`, a release, a backup or the `gymmembership_postgres_data` volume exists, every cycle stops with a restore error. It does not create credentials that cannot open the existing database or the encrypted records. To recover, restore the original `runtime.env` with mode 600 from its private copy. `runtime.fingerprint` holds only a SHA-256 of the encryption key, for comparing a restored file. Keep a private off-host copy of `runtime.env`; the host does not create one.
- **Compose allowlist.** Before building, the controller checks the rendered Compose configuration:
  - Services must be exactly database, migrate, api, web, worker and edge.
  - Services must not use privileged mode, added capabilities, devices, host or shared namespaces, `network_mode`, the engine socket, security options, secrets/configs or env files.
  - Mounts are limited to the `postgres_data`, `caddy_data` and `caddy_config` volumes and the read-only edge Caddyfile.
  - Only migrate may build, only from its own release directory, and without host access.
  - The database and edge images stay pinned.
  - Networks must be private bridge networks.

  Adding a service or volume, or upgrading a pinned image, takes two `main` commits: the first extends the allowlist in `host.py` and deploys, and the second changes Compose.
- **Residual risk.** Write access to `main` still controls the server. Once a commit passes `check.yml`, its Dockerfile is built and its `host.py` becomes the root controller on the next cycle. The allowlist stops obvious Compose escalation, not a deliberate controller change. Branch protection and review on `main` remain the real control. Root SSH is key-only.
- **CI topology smoke.** The `compose-topology` job in `check.yml` builds the image and starts database, migrate, api, web, worker and a loopback HTTP Caddy edge with throwaway secrets, following the controller's order. It checks the following through the edge:
  - readiness and a web-signed host context;
  - the home page;
  - an anonymous 401;
  - a cross-origin 403;
  - a worker cycle that succeeded;
  - that no service restarted.

  Deployment therefore waits for the topology smoke as well.

On the owned host, inspect `cloud-init status --long`, `journalctl -u gymmembership-deploy.service` and `systemctl status gymmembership-deploy.timer`. Do not print runtime environment files or rendered Compose configuration, which contain credentials. Retain the new project/server IDs, selected quote, exact release SHA, migration/runtime-role evidence, HTTPS response and a subsequent Git-triggered update before declaring automatic deployment operational.

## Live deployment — 27 September 2026

The owner supplied a DigitalOcean token in the working session on 27 September and asked for a new project with everything deployed under it. The token was used only from the coordinating session, from a private scratch file, and was never written to Git, documentation, cloud-init or logs. Existing projects and resources were only listed, never changed.

| Resource | Created ID |
| --- | --- |
| Project `GymMembership` (Development, Web Application) | `0edd5213-c97c-4d27-9429-ddc878854ddc` |
| SSH key `gymmembership-8fc22b34edcc` (the committed public key) | `59625985` |
| Droplet `gymmembership-8fc22b34edcc` (blr1, `s-2vcpu-4gb`, Ubuntu 24.04, quoted USD 24/month) | `604067976` |

- **Provisioning route.** This session has no raw GitHub token and cannot set the `DO_PROVISION_TOKEN` Actions secret, so the create-only provisioner in `infra/digitalocean/provision.py` was driven locally. Every cloud call, collision check, budget check and project assignment used the repository code unchanged. Only the ownership checkpoint was kept in a private local file instead of the deployment branch; the IDs above are the durable record.
- **Address.** `https://gymmembership.64.227.151.196.sslip.io`. Caddy obtained a certificate; plain HTTP redirects to HTTPS.
- **First deployment.** Cloud-init installed Docker and the five-minute timer. The controller deployed the checked `main` commit `2708f21`, served readiness with the matching `X-GymMembership-Release` header about five minutes after the Droplet became active, and created the first Superadmin from a one-time private request (see below).
- **No SSH from the automation environment.** Outbound SSH is blocked there. The one-time Superadmin request in `host.py` (`bootstrap_pending_admin`) exists for this reason. Its password was rotated immediately through the application, so the first-boot value in instance metadata is no longer valid. The committed public key is registered on the Droplet; the DigitalOcean web console also works without it.
- **Live checks.** The results are in `docs/VERIFICATION_2026-09-27_LIVE_DEPLOYMENT.md`. Registration was opened only for the test window, using clearly labelled placeholder legal documents, and is closed again (`LEGAL_PENDING`).
- **Updates.** The server keeps deploying `main` automatically. Fixes merged into `main` reach it on the next cycle after `check.yml` passes for that commit; from then on the controller in the new release runs the host.

Infrastructure setup does not enable live commerce, payouts, nutrition, imports or real provider integrations. Existing legal/provider/feature flags stay disabled until their respective evidence exists. Real customer health-data placement and model qualification remain separate decisions.
