# Config and secrets

[← Spec overview](../../SPEC.md)

Values differ per environment ([environments and release flow](delivery.md#environments-and-release-flow)). The API gets them from Kamal destination secrets (`.kamal/secrets.staging`, `.kamal/secrets.production`) that read from GitHub Environment secrets. The web app gets them from Vercel environment variables. The same Docker image runs in staging and production, so nothing environment-specific is baked into the image.

**Every API secret is a per-environment env var.** The app has no Rails encrypted credentials file and no `RAILS_MASTER_KEY`. Both staging and prod run `RAILS_ENV=production`, so a shared credentials file couldn't give them different secrets. To add a secret: set it in each GitHub environment, reference it in `.kamal/secrets.<destination>`, and list it under `env.secret` in `config/deploy.yml`. Staging and production never share a secret value.

**GitHub environments.** The deploy jobs read every secret from their environment, not from repo secrets (only the release-please App lives at repo level):

| Secret | `staging` | `production` |
|---|---|---|
| `SECRET_KEY_BASE`, `POSTGRES_PASSWORD`, `KAMAL_SSH_PRIVATE_KEY` | its own value | its own value |
| `KAMAL_REGISTRY_PASSWORD` | its own GHCR token | its own GHCR token |
| `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | same value in both (CI credentials, not app secrets) | same value in both |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | yes | – (`console.cellow.space` is public) |

`production` has you as required reviewer and only allows deployments from `main`. `staging` has no protection rules. Keys for later features (PostHog, Safe Browsing, Sentry, Mission Control, `INTERNAL_TOKEN`) are added to both in the build steps that use them.

| Var | Where |
|---|---|
| `DATABASE_URL` (`postgres://…@url-shortener-db:5432/…`, Docker network only) | api |
| `POSTGRES_PASSWORD` | api (Kamal secret, shared by the accessory and the app) |
| `BACKUP_BUCKET` (the prod stack's `bucketName` output, `url-shortener-backups-<account-id>`; no access keys, the instance role signs requests) | backup container (prod only) |
| `SHORT_HOST` (`go.cellow.space`; staging `go-staging.cellow.space`), `APP_ORIGIN` (`https://console.cellow.space`; staging `https://console-staging.cellow.space`) | api |
| `SECRET_KEY_BASE` (different per environment, from `bin/rails secret`; signs cookies and seeds the visitor-hash salt) | api (Kamal secret, GitHub environment secret) |
| `KAMAL_REGISTRY_PASSWORD` (GHCR token, `write:packages`, one per environment) | api (Kamal secret, GitHub environment secret) |
| `INTERNAL_TOKEN` | api + GitHub Actions (for scheduled maintenance calls) |
| `POSTHOG_PROJECT_API_KEY`, `POSTHOG_HOST` | api (capture) |
| `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` | api (query, never sent to the browser) |
| `SAFE_BROWSING_API_KEY` | api |
| `ANALYTICS_ADAPTER` (`posthog`/`fake`) | api |
| `SENTRY_DSN` | api (Rails) |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (source map upload at build time) | web |
| `MISSION_CONTROL_USER`, `MISSION_CONTROL_PASSWORD` | api (HTTP basic auth for `/jobs`) |
| `ALLOWED_ORIGINS` (comma-separated; staging adds the Vercel preview pattern) | api (Origin check, [API](api.md#api-endpoints)) |
| `API_ORIGIN` (server-side only, used by rewrites and server-side fetches; Vercel Preview `https://go-staging.cellow.space`, Production `https://go.cellow.space`) | web |
| `NEXT_PUBLIC_APP_ENV` (`development`/`staging`/`production`), `NEXT_PUBLIC_APP_VERSION` | web |
| `NEXT_PUBLIC_SHORT_HOST` (display only, e.g. the domain hint in the alias input) | web |
| `aws:profile` (your local AWS CLI profile; the credentials stay in `~/.aws`, never in config) | infra (Pulumi config, local only, not in CI) |
| `tailscaleAuthKey`, `cloudflare:apiToken` | infra (Pulumi config secrets, committed in `Pulumi.<stack>.yaml` as `secure:` ciphertext that only Pulumi Cloud can decrypt) |
| `aws:region`, `aws:allowedAccountIds` (the workload account, so Pulumi can't touch any other), `cloudflareZoneId`, `shortHost`, `appHost`, `vercelCname`, `instanceType`, `volumeSizeGb`, `availabilityZoneIndex`, `elasticIp`, `running` | infra (Pulumi config, committed in `Pulumi.<stack>.yaml`) |
| `sshPublicKey` (deploy key, a separate pair per environment) | infra (Pulumi config) |
| `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` | GitHub Actions environment secrets, `staging` and `production` (Tailscale for deploys) |
| `KAMAL_SSH_PRIVATE_KEY` | GitHub Actions environment secret (that environment's deploy key) |
| `RELEASE_APP_ID`, `RELEASE_APP_PRIVATE_KEY` | GitHub Actions (GitHub App used by release-please) |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | GitHub Actions environment secrets, `staging` and `production` (Vercel CLI deploys) |
| `VERCEL_AUTOMATION_BYPASS_SECRET` (Vercel's Protection Bypass for Automation, sent as the `x-vercel-protection-bypass` header) | GitHub Actions `staging` environment (Playwright against `console-staging`, [Vercel](infrastructure.md#vercel)) |
| `APP_VERSION`, `GIT_SHA` | api + web (build args, from `version.txt` and the commit) |
