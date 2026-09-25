# DigitalOcean deployment boundary

Owner authorization: 25 September 2026, 12:35 Asia/Dubai. Create a completely new DigitalOcean project, instance and supporting resources for `chordsnstrings/trainer_what`. The owner explicitly authorized the necessary new infrastructure. This authorization persists; do not ask for it again merely because an older planning document described access, budget or provisioning approval as pending.

## Absolute resource boundary

- Create a new project with a unique `trainer-brain` name and deployment suffix. Never repurpose an existing project, even if its name looks related.
- Create new compute, private network, database storage, firewall and deployment access credentials. Never reuse existing droplets, databases, VPCs, volumes, buckets, SSH keys, firewalls, load balancers or domains.
- Do not modify, restart, resize, move, attach/detach, transfer, delete or change access to any resource that existed before this deployment. No account-wide settings changes.
- Keep a durable manifest of IDs returned by this deployment's successful create responses. A name or tag alone is not sufficient evidence of ownership. Any later write must target a manifest-owned ID; no wildcard or account-wide write operations.
- Assign only newly created resources to the newly created project. Scope new firewall rules to the new instance IDs, not broad tags that could match another project. Never change an existing project's membership or default-project status.
- Read metadata only where necessary to verify account access, available services/prices or avoid collisions; never retrieve unrelated customer data or existing secrets. Do not import old project configurations, backups or database contents.
- A timeout after a create call is an unknown outcome: reconcile the attempted creation before retrying. Do not create duplicates or use bulk cleanup. Any cleanup must be confined to IDs proven to belong to this deployment.

## Prepared initial deployment

Deploy the verified application to a new, isolated environment first. It contains the Next.js web service, Fastify API, PostgreSQL 17, migration job and background worker described in `compose.yaml`, behind HTTPS. Use separate fresh database administrator/runtime credentials and an independently generated account-encryption key. The DigitalOcean management token must stay outside the repository, container image and application runtime.

Choose a modest CPU-only instance and an available region after retrieving the actual account's current sizes, prices and regional availability. Record the selected region, recurring estimate, resource IDs and deployment commit before reporting the deployment complete. On 25 September, the authenticated size listing returned `s-2vcpu-4gb` at USD 24/month and `s-4vcpu-8gb` at USD 48/month, with both available in Frankfurt, Bangalore, Singapore and New York 3. These are compute quotes, not purchases or an all-inclusive deployment estimate; no region/size is selected. Use new persistent database storage; keep database/API ports private and expose only the intended HTTPS entry point and restricted administration path. Confirm backups and recovery for this new environment.

Existing nutrition, legal, commerce and payout flags remain explicit runtime controls; infrastructure authorization does not prove model fidelity or payment-provider account compatibility. Do not copy chat-supplied Stripe credentials or fixture identities into the deployment. Provisioning infrastructure does not approve placing real customer health data into an unreviewed location. Required photo/barcode workflows remain implementation work under 043.

## Verification and handoff

Record only new-resource identifiers, URLs, region, instance specification, observed monthly estimate and release commit. Verify migration completion, the non-owner database role, API/database readiness, web loading, HTTPS, worker connectivity and access restrictions. Use synthetic or fresh test data for first checks. Record backup/restore evidence separately from readiness. Provide the new project's URL and application endpoint once they actually exist.

## Current access result

At 13:11 Asia/Dubai on 25 September 2026, the DigitalOcean app's commands became available. Authenticated account information returned `status: active`, and region and size listings succeeded. This verifies communication through the connected app. It does not verify the separately pasted token, which was not transmitted or tested. No create call or existing-resource mutation occurred; no new resource IDs or charges have been established.

The app exposes account, Droplet, SSH key, image, region, size and related operations. It does not expose project creation, project assignment, VPC creation or firewall creation, and its Droplet create parameters do not include a project, VPC or cloud-init user-data option. Do not create a Droplet into an existing default project/network as a shortcut around the owner's isolation requirement.

Direct shell HTTPS to `api.digitalocean.com` still fails at proxy CONNECT (HTTP 000). The owner is the workspace administrator and confirms Work network access has always been enabled; the supplied screenshot shows it enabled. Their Business workspace navigation does not show the previously suggested Permissions & roles section. Do not repeat the installation, toggle or generic administrator requests. The exact reason for the shell restriction is not established.

The supported cloud browser was checked for the missing project operations. `https://cloud.digitalocean.com/projects` displayed “Site Unavailable — Unable to access this site” before and after one reload. No sign-in or website mutation occurred. This is a browser access failure, not evidence of token invalidity or bot detection. Continue using the working app for supported reads; full isolated provisioning needs a supported route for the missing project/network/firewall and host-configuration operations.

## Git deployment requirement

At 12:47 Asia/Dubai on 25 September, the owner required Git updates to deploy automatically to DigitalOcean. The repository currently has application and PostgreSQL/container checks but no deployment workflow or configured host/credentials. This requirement is pending, not implemented.

The intended release boundary is: a push to `main` passes both existing check jobs, then deploys that exact tested commit to the new manifest-owned environment. Restrict deployment credentials to that environment, pin host identity, serialize releases, check migrations and application readiness, and retain recovery evidence. Pull requests must not receive deployment credentials. Record an actual successful Git-triggered release before calling automatic deployment operational.
