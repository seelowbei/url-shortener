# Infrastructure and deployment

[← Spec overview](../../SPEC.md)

## Infrastructure (Pulumi)

Three layers, each with one owner:

| Layer | Tool | Changes |
|---|---|---|
| AWS resources | **Pulumi** (TypeScript, `/infra`) | Rarely; run by hand from your laptop |
| Server setup | **cloud-init**, passed by Pulumi | Once, when a VM is created |
| App containers | **Kamal** (`/api/config/deploy.yml` + destinations) | Staging on every merge to `main` while it's running, production on release ([environments and release flow](delivery.md#environments-and-release-flow)) |

### State and auth
- **State:** Pulumi Cloud, individual free plan (confirm it's still free). **Two stacks, `staging` and `prod`**, from the same code with different config ([environments and release flow](delivery.md#environments-and-release-flow)). Infra changes go to `staging` first. Secrets in the state are encrypted by Pulumi Cloud.
- **AWS auth:** an AWS CLI profile on your laptop (IAM Identity Center/SSO recommended), named in the stack config as `aws:profile`. AWS credentials never go in the repo or the Pulumi config. Region: `ap-southeast-1` (Singapore).
- **Cloudflare auth:** an API token with only *Zone → DNS → Edit* on the `cellow.space` zone, stored as the Pulumi secret `cloudflare:apiToken`.
- **`pulumi up` runs only from your laptop.** CI never holds AWS credentials and only type-checks `/infra` (`tsc --noEmit`).
- **Cost guardrails:** the account is on the AWS Paid plan with an AWS Budgets alert at **$20/month**. The design adds nothing that bills while idle beyond the disks and the prod Elastic IP: no NAT gateway, load balancer, RDS or CloudWatch extras. T4g instances use `standard` CPU credits, so CPU bursts are never billed.

### Resources (`/infra/index.ts`)

Each stack creates its own copy. Names below carry the stack suffix (`-staging` / `-prod`), and sizes come from stack config.

| Resource | Details |
|---|---|
| VPC + internet gateway + route table | `10.0.0.0/16`, default route through the internet gateway. One VPC per stack, so the two environments are fully separate. |
| Public subnet | `10.0.1.0/24`, in the availability zone picked by `availabilityZoneIndex` (AZs sorted by name), to work around "insufficient capacity" |
| Security group | Ingress TCP **80, 443** from anywhere. **No port 22** (SSH goes over Tailscale). Egress: everything. |
| Instance role | IAM role + instance profile with `AmazonSSMManagedInstanceCore`, so SSM Session Manager works as emergency shell access without an open port. Prod adds write access to the backup bucket ([backups](#backups)). |
| Ubuntu image | `resolve:ssm:/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id`: Canonical's latest Ubuntu 24.04 arm64 image, resolved by EC2 at launch, so a newer image never replaces the VM. |
| Instance | Graviton **`t4g.small`** (2 vCPU, 2 GB) for both stacks (`instanceType`), gp3 root volume (`volumeSizeGb`, 20 GB), encrypted. IMDSv2 only, with hop limit 2 so containers can use the instance role. `user_data` is the rendered cloud-init. Changes to it are ignored, because cloud-init only runs on first boot. |
| Public IP | **prod:** an Elastic IP (`elasticIp: true`), fixed for the life of the stack. **staging:** the instance's own public IP, which changes on every start. Pulumi re-reads it after each start. |
| Start/stop (staging) | `running: false` stops the VM: only its disk is billed, and the short-host record is removed. `running: true` starts it and points the record at the new IP. Prod always runs. |
| Backup bucket | **prod only** (build step 2.1): S3 bucket `url-shortener-backups-<account-id>`, private, encrypted, with a lifecycle rule deleting objects after 14 days. The instance role may only put/list/get objects in it. Staging data is disposable seed data, so it has no backups. |
| DNS records | Cloudflare provider, in the `cellow.space` zone (`cloudflareZoneId`): an A record for `shortHost` → the public IP (TTL 60 s, since staging's changes), and a CNAME for `appHost` → the target Vercel shows for that domain (`vercelCname`). Both are DNS only (not proxied), so kamal-proxy gets its own Let's Encrypt certificate and redirects never pass through Cloudflare. |

**Stack outputs:** `publicIp`, `shortHost`, `instanceId`, `tailscaleHost` (`url-shortener-<stack>`), and in prod `bucketName`.

### cloud-init (`/infra/cloud-init.yaml`, templated)
- `unattended-upgrades` enabled, 2 GB swap file.
- Docker Engine installed from Docker's apt repository, so Kamal doesn't need to install it.
- A `deploy` user in the `docker` group with the deploy SSH public key (`sshPublicKey`). `PasswordAuthentication no`, `PermitRootLogin no`. The image's default `ubuntu` user has no SSH key.
- Tailscale: install it, then `tailscale up --authkey=<one-time key> --hostname=url-shortener-<stack>`.
  - The auth key is single-use, pre-approved, tagged `tag:server`, and expires after 1 day. It ends up in instance user data, so it must not be reusable. A stop/start keeps the node: Tailscale's state lives on the disk.

### Tailscale (private network for SSH)
- Your laptop and the VM join your tailnet. CI runners join as temporary nodes through `tailscale/github-action`, using an OAuth client and `tag:ci`.
- Access rules (Tailscale ACL): `tag:ci` and your user → `tag:server:22` only.
- Kamal destinations use the Tailscale hostnames `url-shortener-staging` and `url-shortener-prod`. Port 22 is never open to the internet.
- **Emergency access** if Tailscale breaks: SSM Session Manager (`aws ssm start-session --target <instanceId>`) or the EC2 serial console.

### Typical commands
```
cd infra && pulumi up -s staging                       # create or update infrastructure (staging first)
pulumi up -s prod                                      # then prod
pulumi config set -s staging running false && pulumi up -s staging   # stop staging (start: running true)
pulumi up -s prod --replace <instance-urn>             # rebuild the VM (restore drill)
pulumi config set -s prod availabilityZoneIndex 1 && pulumi up -s prod   # insufficient-capacity retry
```

## Deployment

### AWS EC2 VM (Rails)
Created by Pulumi ([infrastructure](#infrastructure-pulumi)). Operational notes:
- **Type:** `t4g.small` (ARM64 Graviton, 2 vCPU, 2 GB RAM), Ubuntu 24.04 arm64, in `ap-southeast-1`.
- **Cost:** about $18/month for prod (instance about $12.30, public IPv4 $3.60, 20 GB gp3 about $2). Staging costs about $2/month while stopped (disk only), plus about 2 cents per hour running. Check the figures in the AWS Pricing Calculator. The $100 of new-account credits covers roughly the first five months.
- **Ports 80/443** are opened by the security group only. Ubuntu's AWS image has no host firewall rules to change.
- **Staging is stopped when not in use** (`running: false`). Starting it takes about a minute, plus `pulumi up` to update the DNS record. The data on its disk survives a stop.
- **SSH:** only over Tailscale, key-only login, as the `deploy` user.

### Kamal
- `config/deploy.yml` holds shared settings. **Destinations:** `config/deploy.staging.yml` and `config/deploy.production.yml` set the host (Tailscale name), proxy host (`shortHost`) and env, with secrets in `.kamal/secrets.<destination>`. Deploy with `kamal deploy -d staging|production`.
- One `web` role per VM. The image is built for `arm64` (native on Apple Silicon; in CI on GitHub's free `ubuntu-24.04-arm` runner for public repos).
- Registry: GitHub Container Registry (`ghcr.io`), free.
- kamal-proxy: TLS through Let's Encrypt for `go.cellow.space` (staging: `go-staging.cellow.space`), health check on `/up`.
- Env: `SOLID_QUEUE_IN_PUMA=true`, `WEB_CONCURRENCY=1`, `RAILS_MAX_THREADS=3`, database pool 5.
- Rails trusts kamal-proxy for `X-Forwarded-For`, so the real client IP reaches `ClickJob`.

### DNS (Cloudflare)
- The `cellow.space` domain (renewed yearly) uses Cloudflare's free DNS. The registrar only points the nameservers at Cloudflare.
- Short links look like `https://go.cellow.space/abc123`.

| | Short links (Rails, A record → VM) | Web (Next.js, CNAME → Vercel) |
|---|---|---|
| staging | `go-staging.cellow.space` | `console-staging.cellow.space` |
| production | `go.cellow.space` | `console.cellow.space` |

- Each Pulumi stack owns its two records ([resources](#resources-infraindexts)). Nothing is set by hand in the Cloudflare dashboard.
- Records stay **DNS only** (grey cloud). Proxying through Cloudflare would put a third party in the redirect path and break kamal-proxy's Let's Encrypt HTTP challenge.
- The bare `cellow.space` is unused for now.

### Postgres (Kamal accessory on the same VM)
- `postgres:17` accessory in `config/deploy.yml`, data on a host volume (`/var/lib/url-shortener/postgres`) on the VM's root volume.
- **Not exposed publicly:** no published port (or bound to `127.0.0.1` only). The app reaches it by container name on the Kamal Docker network. Port 5432 stays closed in the security group.
- One database server holds the primary, Solid Queue and Solid Cache databases (Rails 8 multi-database config). Solid Cache is capped (`max_size: 256.megabytes`), and Solid Queue clears finished jobs.
- Tuning for a 2 GB VM shared with Rails: `shared_buffers=256MB`, `max_connections=30`.
- **Local access:** an SSH tunnel (`ssh -L 5433:127.0.0.1:5432 …`, with the port bound to localhost on the VM) for seeds, the click backfill and debugging from your laptop.
- Upgrades: pin the major version and change it on purpose, with dump → restore. Never `latest`.

### Backups
- A `backup` Kamal accessory (small cron container) runs `pg_dump -Fc` nightly for each database and uploads to the **S3 backup bucket**, keeping 14 days (bucket lifecycle rule). It authenticates with the instance role through IMDSv2, so there are no long-lived access keys.
- The backup is stored off the VM, so losing the VM or its disk is recoverable.
- **Restore drill**, documented in the README: `pulumi up --replace <instance-urn>` (new VM; the Elastic IP moves to it, so DNS doesn't change) → wait for cloud-init → `kamal setup` → `pg_restore` the latest dump → `kamal deploy`. Test it once before calling the deploy done.

### Vercel
- Next.js on the Hobby plan, one Vercel project from `/web`, with the custom domains `console.cellow.space` (production) and `console-staging.cellow.space` (staging alias). Custom domains are free on Hobby.
- Vercel only links a Preview domain to an existing Git branch, so `console-staging.cellow.space` is linked to a `staging` branch that **nobody pushes to**. The domain only moves when the pipeline runs `vercel alias`. Pushing to `staging` would hand the staging domain to that preview.
- **The Git integration only builds PR previews.** `vercel.json` turns off automatic deploys from `main` (`"git": {"deploymentEnabled": {"main": false}}`). Staging and production web deploys run from GitHub Actions with the Vercel CLI, so the web app and the API always ship together ([environments and release flow](delivery.md#environments-and-release-flow)).
- `API_ORIGIN` env var for the rewrites: the Vercel *Preview* environment points at the staging API, *Production* at the prod API.

### Pipeline (GitHub Actions)
- `ci.yml`: tests ([testing and CI](delivery.md#testing-and-ci)) and the Conventional Commits PR-title check on every PR, plus `tsc --noEmit` for `/infra`.
- `pipeline.yml` (push to `main`: CI → build → staging → release-please → production) and `rollback.yml`: see [environments and release flow](delivery.md#environments-and-release-flow).
- Infrastructure changes are never applied from CI; `pulumi up` runs by hand ([infrastructure](#infrastructure-pulumi)).
