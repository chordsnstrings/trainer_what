# GymMembership deployment verification

Verified source: `224b893ec8c44e591d6a001cf5e695e8b5e96e44`, published to `main` on 25 September 2026. This checkpoint verifies the deployment implementation and application checks; no DigitalOcean resource or live endpoint exists yet.

| Evidence | Result |
| --- | --- |
| Local deployment suite | 36 passed; one real Docker Compose configuration check explicitly skipped because Docker is unavailable in the workspace |
| [Set up GymMembership run 36121575880](https://github.com/chordsnstrings/trainer_what/actions/runs/36121575880) | Job `108028062069`: all 37 deployment checks passed, including real Docker Compose parsing; no skipped tests |
| [Application checks run 36121575906](https://github.com/chordsnstrings/trainer_what/actions/runs/36121575906) | Both application job `108028061912` and PostgreSQL/container job `108028062822` passed |
| Application coverage | TypeScript, both database test suites, production web/container builds, browser smoke and production API readiness passed; API returned `{"status":"ready"}` |
| Browser evidence | Artifact `10858441546`, named `browser-evidence`, belongs to the application run above; no new visual review is claimed |
| Actual provisioning | Skipped: the setup job received an empty `DO_PROVISION_TOKEN`; it made no resource create call |

The 37 deployment checks cover exact-current-main CI selection, durable pending-create checkpoints, unknown outcomes across independent runners, resource ownership and identity, compute limits, private runtime configuration, archive boundaries, real Compose configuration, failed-migration preservation, application/HTTPS rollback and release identity. Mock resource IDs and URLs printed by tests are fixtures, not DigitalOcean resources. Real cloud-init, certificate issuance, an off-host restore and a subsequent live Git update remain unverified.

The direct workspace request to `https://api.digitalocean.com/v2/account` used the supplied token and returned HTTP 200, `Content-Type: text/html`, with a 195-byte “Site Unavailable” page. It did not return DigitalOcean account JSON, so token validity remains unverified. No token value is retained in this report or repository. The connected DigitalOcean app supports account/Droplet/key operations but does not expose project creation/assignment or cloud-init; the connected GitHub tool cannot set Actions secrets. Cloud-browser use is prohibited by the owner.

The prepared executable route is to add `DO_PROVISION_TOKEN` in this repository's [Actions secrets](https://github.com/chordsnstrings/trainer_what/settings/secrets/actions), then run [Set up GymMembership](https://github.com/chordsnstrings/trainer_what/actions/workflows/gymmembership.yml) from `main`. That workflow calls the DigitalOcean API directly. It creates only the new GymMembership project, new key and new server, enforces the USD 24/month compute cap, and records returned IDs before proceeding. Existing resources remain outside write scope. Infrastructure authorization is already recorded; no new permission is required for this prepared deployment.
