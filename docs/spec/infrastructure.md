# Infrastructure and deployment

[← Spec overview](../../SPEC.md)

## Infrastructure (Pulumi)

Three layers, each with one owner:

| Layer | Tool | Changes |
|---|---|---|
| Oracle Cloud resources | **Pulumi** (TypeScript, `/infra`) | Rarely; run by hand from your laptop |
| Server setup | **cloud-init**, passed by Pulumi | Once, when a VM is created |
| App containers | **Kamal** (`/api/config/deploy.yml` + destinations) | Staging on every merge to `main`, production on release ([environments and release flow](delivery.md#environments-and-release-flow)) |

### State and auth
- **State:** Pulumi Cloud, individual free plan (confirm it's still free). **Two stacks, `staging` and `prod`**, from the same code with different config ([environments and release flow](delivery.md#environments-and-release-flow)). Infra changes go to `staging` first. Secrets in the state are encrypted by Pulumi Cloud.
- **Oracle auth:** an API signing key for your Oracle user, kept in the stack config, with the private key stored as a Pulumi secret.
- **Cloudflare auth:** an API token with only *Zone → DNS → Edit* on the `cellow.space` zone, stored as the Pulumi secret `cloudflare:apiToken`.
- **`pulumi up` runs only from your laptop.** CI never holds Oracle credentials and only type-checks `/infra` (`tsc --noEmit`).
- **No surprise charges:** the account is limited to Always Free resources, so Pulumi can't create anything paid.

### Resources (`/infra/index.ts`)

Each stack creates its own copy. Names below carry the stack suffix (`-staging` / `-prod`), and sizes come from stack config.

| Resource | Details |
|---|---|
| Compartment | `url-shortener-<stack>`, under the tenancy root; everything below lives in it, so the two environments are fully separate |
| VCN + internet gateway + route table | `10.0.0.0/16`, default route through the internet gateway. One VCN per stack: check the Always Free VCN limit (if it's too low, move the network into a shared `network` stack). |
| Public subnet | `10.0.1.0/24` |
| Security list | Ingress TCP **80, 443** from anywhere, plus ICMP 3/4 (needed so large packets get through). **No port 22** (SSH goes over Tailscale). An optional config value, `sshAllowCidr`, can open 22 to a single IP for emergencies. Egress: everything. |
| Ubuntu image | Looked up with `getImages`: Canonical Ubuntu 24.04 aarch64, latest. The instance ignores later changes to it (`ignoreChanges: ["sourceDetails"]`), so a newer image doesn't replace the VM. |
| Instance | `VM.Standard.A1.Flex`, 50 GB boot volume. Size from config: **prod 1 OCPU / 6 GB, staging 1 OCPU / 4 GB** (2 OCPU / 10 GB / 100 GB in total, within the free 4 OCPU / 24 GB / 200 GB). The availability domain comes from config (`availabilityDomainIndex`), to work around "out of capacity". Metadata: your SSH public key + cloud-init `user_data`. |
| Public IP | The VM's temporary public IP (it changes only when the VM is replaced). Optional `reservedIp` config flag; check it's covered by Always Free before turning it on. |
| Backup bucket | **prod only** (`backupsEnabled` config): `url-shortener-backups`, private, lifecycle rule deleting objects after 14 days. Staging data is disposable seed data, so it has no backups. |
| IAM policy for lifecycle rules | `Allow service objectstorage-<region> to manage object-family in compartment url-shortener`. Without it, the lifecycle rule fails silently. |
| Backup user | IAM user `backup-bot` + group + policy that only allows managing objects in the backup bucket. A **Customer Secret Key** gives S3-compatible credentials for the backup container. |
| DNS records | Cloudflare provider, in the `cellow.space` zone (`cloudflareZoneId`): an A record for `shortHost` → the instance's public IP (updated whenever the IP changes), and a CNAME for `appHost` → the target Vercel shows for that domain (`vercelCname`). Both are DNS only (not proxied), so kamal-proxy gets its own Let's Encrypt certificate and redirects never pass through Cloudflare. |

**Stack outputs:** `publicIp`, `shortHost`, `tailscaleHost` (`url-shortener-<stack>`), `bucketName`, `s3Endpoint` (`https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`), `backupAccessKeyId`, `backupSecretKey` (secret). Copy the outputs into Kamal secrets with `pulumi stack output --show-secrets`.

### cloud-init (`/infra/cloud-init.yaml`, templated)
- `unattended-upgrades` enabled, 2 GB swap file.
- `iptables`: allow 80/443 before Oracle's default REJECT rule, then `netfilter-persistent save`.
- Docker Engine installed from Docker's apt repository, so Kamal doesn't need to install it.
- A `deploy` user in the `docker` group with your SSH public key. `PasswordAuthentication no`, `PermitRootLogin no`.
- Tailscale: install it, then `tailscale up --authkey=<one-time key> --hostname=url-shortener-<stack>`.
  - The auth key is single-use, pre-approved, tagged `tag:server`, and expires after 1 day. It ends up in instance metadata, so it must not be reusable.

### Tailscale (private network for SSH)
- Your laptop and the VM join your tailnet. CI runners join as temporary nodes through `tailscale/github-action`, using an OAuth client and `tag:ci`.
- Access rules (Tailscale ACL): `tag:ci` and your user → `tag:server:22` only.
- Kamal destinations use the Tailscale hostnames `url-shortener-staging` and `url-shortener-prod`. Port 22 is never open to the internet.
- **Emergency access** if Tailscale breaks: Oracle Cloud Shell, the serial console, or temporarily setting `sshAllowCidr` to your IP and running `pulumi up`.

### Typical commands
```
cd infra && pulumi up -s staging                       # create or update infrastructure (staging first)
pulumi up -s prod                                      # then prod
pulumi up -s prod --replace <instance-urn>             # rebuild the VM (restore drill)
pulumi config set -s prod availabilityDomainIndex 1 && pulumi up -s prod   # out-of-capacity retry
```

## Deployment

### Oracle Cloud VM (Rails)
Created by Pulumi ([infrastructure](#infrastructure-pulumi)). Operational notes:
- **Shape:** `VM.Standard.A1.Flex` (ARM64), 1 OCPU / 6 GB RAM, Ubuntu 24.04 aarch64. The free allowance is 4 OCPU / 24 GB in total, so the rest stays available.
- **"Out of capacity" errors:** change `availabilityDomainIndex` or keep retrying. A1 capacity is limited for Always-Free-only accounts.
- **Ports 80/443 must be open in two places:** the security list (Pulumi) *and* the instance's `iptables` rules (cloud-init).
- **Idle reclamation:** Oracle may stop Always Free instances that sit idle for 7 days (low CPU, network *and*, for A1, memory). Check the current thresholds in Oracle's docs. Keep memory use above the threshold, e.g. by sizing the VM to 6 GB rather than 24 GB, and monitor with UptimeRobot so a stopped instance gets noticed.
- **SSH:** only over Tailscale, key-only login, as the `deploy` user.

### Kamal
- `config/deploy.yml` holds shared settings. **Destinations:** `config/deploy.staging.yml` and `config/deploy.production.yml` set the host (Tailscale name), proxy host (`shortHost`) and env, with secrets in `.kamal/secrets.<destination>`. Deploy with `kamal deploy -d staging|production`.
- One `web` role per VM. The image is built for `arm64` (native on Apple Silicon; in CI on GitHub's free `ubuntu-24.04-arm` runner for public repos).
- Registry: GitHub Container Registry (`ghcr.io`), free.
- kamal-proxy: TLS through Let's Encrypt for `go.cellow.space` (staging: `go-staging.cellow.space`), health check on `/up`.
- Env: `SOLID_QUEUE_IN_PUMA=true`, `WEB_CONCURRENCY=1`, `RAILS_MAX_THREADS=3`, database pool 5.
- Rails trusts kamal-proxy for `X-Forwarded-For`, so the real client IP reaches `ClickJob`.

### DNS (Cloudflare)
- The `cellow.space` domain (the project's one paid item, renewed yearly) uses Cloudflare's free DNS. The registrar only points the nameservers at Cloudflare.
- Short links look like `https://go.cellow.space/abc123`.

| | Short links (Rails, A record → VM) | Web (Next.js, CNAME → Vercel) |
|---|---|---|
| staging | `go-staging.cellow.space` | `console-staging.cellow.space` |
| production | `go.cellow.space` | `console.cellow.space` |

- Each Pulumi stack owns its two records ([resources](#resources-infraindexts)). Nothing is set by hand in the Cloudflare dashboard.
- Records stay **DNS only** (grey cloud). Proxying through Cloudflare would put a third party in the redirect path and break kamal-proxy's Let's Encrypt HTTP challenge.
- The bare `cellow.space` is unused for now.

### Postgres (Kamal accessory on the same VM)
- `postgres:17` accessory in `config/deploy.yml`, data on a host volume (`/var/lib/url-shortener/postgres`) on the VM's boot volume (Always Free block storage is 200 GB in total).
- **Not exposed publicly:** no published port (or bound to `127.0.0.1` only). The app reaches it by container name on the Kamal Docker network. Ports 5432 stay closed in the VCN security list.
- One database server holds the primary, Solid Queue and Solid Cache databases (Rails 8 multi-database config). Solid Cache is capped (`max_size: 256.megabytes`), and Solid Queue clears finished jobs.
- Tuning for a 6 GB VM shared with Rails: `shared_buffers=512MB`, `max_connections=30`.
- **Local access:** an SSH tunnel (`ssh -L 5433:127.0.0.1:5432 …`, with the port bound to localhost on the VM) for seeds, the click backfill and debugging from your laptop.
- Upgrades: pin the major version and change it on purpose, with dump → restore. Never `latest`.

### Backups
- A `backup` Kamal accessory (small cron container) runs `pg_dump -Fc` nightly for each database and uploads to **Oracle Object Storage** (Always Free 20 GB, S3-compatible API), keeping 14 days (bucket lifecycle rule).
- The backup is stored off the VM, so losing the VM or its disk is recoverable.
- **Restore drill**, documented in the README: `pulumi up --replace <instance-urn>` (new VM, DNS record updated automatically) → wait for cloud-init → `kamal setup` → `pg_restore` the latest dump → `kamal deploy`. Test it once before calling the deploy done.

### Vercel
- Next.js on the Hobby plan, one Vercel project from `/web`, with the custom domains `console.cellow.space` (production) and `console-staging.cellow.space` (staging alias). Custom domains are free on Hobby.
- Vercel only links a Preview domain to an existing Git branch, so `console-staging.cellow.space` is linked to a `staging` branch that **nobody pushes to**. The domain only moves when the pipeline runs `vercel alias`. Pushing to `staging` would hand the staging domain to that preview.
- **The Git integration only builds PR previews.** `vercel.json` turns off automatic deploys from `main` (`"git": {"deploymentEnabled": {"main": false}}`). Staging and production web deploys run from GitHub Actions with the Vercel CLI, so the web app and the API always ship together ([environments and release flow](delivery.md#environments-and-release-flow)).
- `API_ORIGIN` env var for the rewrites: the Vercel *Preview* environment points at the staging API, *Production* at the prod API.

### Pipeline (GitHub Actions)
- `ci.yml`: tests ([testing and CI](delivery.md#testing-and-ci)) and the Conventional Commits PR-title check on every PR, plus `tsc --noEmit` for `/infra`.
- `pipeline.yml` (push to `main`: CI → build → staging → release-please → production) and `rollback.yml`: see [environments and release flow](delivery.md#environments-and-release-flow).
- Infrastructure changes are never applied from CI; `pulumi up` runs by hand ([infrastructure](#infrastructure-pulumi)).
