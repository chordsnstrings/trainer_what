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

Choose a modest CPU-only instance and an available region after retrieving the actual account's current sizes, prices and regional availability. Record the selected region, recurring estimate, resource IDs and deployment commit before reporting the deployment complete. No size, price, region, domain or running resource has been verified yet. Use new persistent database storage; keep database/API ports private and expose only the intended HTTPS entry point and restricted administration path. Confirm backups and recovery for this new environment.

Existing nutrition, legal, commerce and payout flags remain explicit runtime controls; infrastructure authorization does not prove model fidelity or payment-provider account compatibility. Do not copy chat-supplied Stripe credentials or fixture identities into the deployment. Provisioning infrastructure does not approve placing real customer health data into an unreviewed location. Required photo/barcode workflows remain implementation work under 043.

## Verification and handoff

Record only new-resource identifiers, URLs, region, instance specification, observed monthly estimate and release commit. Verify migration completion, the non-owner database role, API/database readiness, web loading, HTTPS, worker connectivity and access restrictions. Use synthetic or fresh test data for first checks. Record backup/restore evidence separately from readiness. Provide the new project's URL and application endpoint once they actually exist.

## Current access result

On 25 September 2026, this workspace's unauthenticated connectivity check to `https://api.digitalocean.com/v2/account` timed out at proxy CONNECT (HTTP 000). The supplied token was not transmitted or tested. No authenticated DigitalOcean request, create call or existing-resource mutation occurred, and no cloud resource IDs or charges have been established.

The user installed DigitalOcean at 12:40 Asia/Dubai, and plugin metadata confirmed `installed: true`. Its advertised capability is provisioning a DigitalOcean droplet as a remote workspace. However, this active session's exposed tool registry and callable tool names still contain no DigitalOcean provisioning commands; no matching executor skill was exposed either. Installation is confirmed and must not be requested again. Resume in a refreshed turn, inspect the newly available capabilities, and continue the authorized deployment. The earlier network timeout does not establish token invalidity. Preserve the resource boundary above; never invent a created resource or use unrelated providers as a workaround.
