# Config and secrets

[← Spec overview](../../SPEC.md)

Values differ per environment ([environments and release flow](delivery.md#environments-and-release-flow)). The API gets them from Kamal destination secrets (`.kamal/secrets.staging`, `.kamal/secrets.production`) that read from GitHub Environment secrets. The web app gets them from Vercel environment variables. The same Docker image runs in staging and production, so nothing environment-specific is baked into the image.

| Var | Where |
|---|---|
| `DATABASE_URL` (`postgres://…@url-shortener-db:5432/…`, Docker network only) | api |
| `POSTGRES_PASSWORD` | api (Kamal secret, shared by the accessory and the app) |
| `OCI_BUCKET`, OCI S3-compatible access keys | backup container |
| `SHORT_HOST` (`go.cellow.space`; staging `go-staging.cellow.space`), `APP_ORIGIN` (`https://console.cellow.space`; staging `https://console-staging.cellow.space`) | api |
| `RAILS_MASTER_KEY`, `KAMAL_REGISTRY_PASSWORD` | api (Kamal secrets / GitHub Actions secrets) |
| `INTERNAL_TOKEN` | api + GitHub Actions (for scheduled maintenance calls) |
| `POSTHOG_PROJECT_API_KEY`, `POSTHOG_HOST` | api (capture) |
| `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID` | api (query, never sent to the browser) |
| `SAFE_BROWSING_API_KEY` | api |
| `ANALYTICS_ADAPTER` (`posthog`/`fake`) | api |
| `SENTRY_DSN` | api (Rails) |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (source map upload at build time) | web |
| `MISSION_CONTROL_USER`, `MISSION_CONTROL_PASSWORD` | api (HTTP basic auth for `/jobs`) |
| `ALLOWED_ORIGINS` (comma-separated; staging adds the Vercel preview pattern) | api (Origin check, [API](api.md#api-endpoints)) |
| `API_ORIGIN` (server-side only, used by rewrites and server-side fetches) | web |
| `NEXT_PUBLIC_APP_ENV` (`development`/`staging`/`production`), `NEXT_PUBLIC_APP_VERSION` | web |
| `NEXT_PUBLIC_SHORT_HOST` (display only, e.g. the domain hint in the alias input) | web |
| `aws:profile` (your local AWS CLI profile; the credentials stay in `~/.aws`, never in config) | infra (Pulumi config, local only, not in CI) |
| `tailscaleAuthKey`, `cloudflare:apiToken` | infra (Pulumi config secrets) |
| `aws:region`, `cloudflareZoneId`, `shortHost`, `appHost`, `vercelCname`, `instanceType`, `volumeSizeGb`, `availabilityZoneIndex`, `elasticIp`, `running` | infra (Pulumi config, committed in `Pulumi.<stack>.yaml`) |
| `sshPublicKey` (deploy key) | infra (Pulumi config) |
| `TS_OAUTH_CLIENT_ID`, `TS_OAUTH_SECRET` | GitHub Actions (Tailscale for deploys) |
| `KAMAL_SSH_PRIVATE_KEY` | GitHub Actions (deploy user's key) |
| `RELEASE_APP_ID`, `RELEASE_APP_PRIVATE_KEY` | GitHub Actions (GitHub App used by release-please) |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | GitHub Actions (Vercel CLI deploys) |
| `APP_VERSION`, `GIT_SHA` | api + web (build args, from `version.txt` and the commit) |
