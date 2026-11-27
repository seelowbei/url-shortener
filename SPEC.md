# URL Shortener — Spec

Portfolio project: a Bitly-style URL shortener.

- **API + redirects:** Rails 8.1 (API mode), Postgres, Solid Queue, Solid Cache, Alba, pagy, Faraday
- **Error tracking:** Sentry (free plan), for both Rails and Next.js
- **Frontend:** Next.js (App Router), TanStack Query, Tailwind v4, shadcn/ui (charts on Recharts), typed client generated from the API's OpenAPI spec
- **Analytics:** PostHog (server-side event capture + HogQL Query API)

## Spec documents

| Doc | Covers |
|---|---|
| [Product](docs/spec/product.md) | Features, acceptance criteria, demo seed |
| [API and data model](docs/spec/api.md) | Tables, endpoints, error shape, OpenAPI, CSRF |
| [Backend](docs/spec/backend.md) | Rails structure, services, routes, redirect path, jobs, analytics query |
| [Frontend](docs/spec/frontend.md) | Next.js routes, rendering, API client, UI, auth |
| [Infrastructure and deployment](docs/spec/infrastructure.md) | Pulumi, AWS EC2 VM, Kamal, Postgres, backups, Vercel |
| [Testing, environments and release](docs/spec/delivery.md) | Tests, CI, dev/staging/prod, release-please pipeline, rollback |
| [Config and secrets](docs/spec/config.md) | Every env var and where it lives |

## Goals

- Show a clean, well-tested full-stack app that a reviewer can explore in under 2 minutes.
- Keep the redirect path fast: it never waits on a third-party call.
- Out of scope: teams, custom domains, billing, bulk import, link-in-bio, geo/device targeting.

## Architecture

```
Browser ──► Next.js on Vercel (console.cellow.space)
              │  /api/* rewritten (proxied) ──────────────┐
              ▼                                           ▼
Visitor ──► GET go.cellow.space/:code ──► kamal-proxy ──► Rails 8.1 API (AWS EC2 t4g, Docker)
                                                           │   302 + enqueue ClickJob
                                         Solid Queue ──────┼──► PostHog capture (link_clicked)
                                         Stats request ────┼──► PostHog Query API (HogQL), cached 60s
                                         Link create ──────┼──► Google Safe Browsing v4
                                                           └──► Postgres 17 (Kamal accessory, same VM)
```

Everything except the VMs runs on free tiers: Vercel Hobby, PostHog Free, Sentry Developer, UptimeRobot Free, Cloudflare DNS Free, Pulumi Cloud, Tailscale and GitHub Actions. The paid items are the `cellow.space` domain (yearly renewal) and AWS (two EC2 VMs in Singapore plus an S3 backup bucket). AWS is budgeted at about $20/month, with staging stopped when not in use.

Repo layout (monorepo):

```
/api     Rails 8.1 app (+ Kamal config)
/web     Next.js app
/infra   Pulumi (TypeScript) — AWS infrastructure and Cloudflare DNS
/.github/workflows/{ci,pr-title,pipeline,rollback}.yml
release-please-config.json, .release-please-manifest.json, version.txt, CHANGELOG.md
```

Rails serves the short domain directly, so redirects never go through Next.js. The frontend reaches Rails only through Next.js rewrites (`/api/:path*` → `https://go.cellow.space/api/:path*`). That means the browser only ever talks to `console.cellow.space`. The Rails session cookie is first-party there (`SameSite=Lax`, `Secure`, no `Domain` attribute, so it's host-only and never sent to `go.cellow.space` directly), and no CORS setup is needed.

## Build order

1. **Walking skeleton on staging.** Each sub-step ends in something you can check:
   1. **Repo:** `git init`, the monorepo layout, `.gitignore`, README stub, push to GitHub. Protect `main` (squash only, no direct pushes).
      Done when: the repo is on GitHub and a direct push to `main` is rejected.
   2. **Rails skeleton:** `rails new api --api --database=postgresql`, RSpec, RuboCop, `docker compose up db` for dev, `GET /up`, and `GET /api/health` returning `{version, sha}`.
      Done when: `bin/rspec` passes locally, and `docker build --platform linux/arm64` succeeds.
   3. **Next.js skeleton:** `create-next-app` (TypeScript, App Router, pnpm), Tailwind v4, shadcn init, ESLint + Prettier, Vitest. A hello page calls `/api/health` through the rewrite.
      Done when: the page shows the API version with both apps running locally.
   4. **CI:** `ci.yml` with `api` (rubocop, rspec) and `web` (lint, typecheck, vitest, build) jobs, plus the Conventional Commits PR-title check, all required on `main`.
      Done when: a test PR shows all checks green and can only be merged once they pass.
   5. **Accounts and prerequisites** (manual, one-time):
      - an AWS account on the Paid plan with an AWS Budgets alert at $20/month, and an AWS CLI profile for Pulumi (replaced the Oracle account, which could never get an A1 VM)
      - a Pulumi Cloud account
      - a Tailscale tailnet with `tag:server` / `tag:ci` ACLs and an OAuth client
      - the `cellow.space` domain on Cloudflare DNS (nameservers pointed at Cloudflare), plus a Cloudflare API token that can only edit that zone's DNS
      - a Vercel project linked to `/web`, with `console.cellow.space` and `console-staging.cellow.space` added as domains (`console-staging` is a Preview domain on the `staging` branch; see [Vercel](docs/spec/infrastructure.md#vercel))
      - the release-please GitHub App, its ID and private key stored as repo secrets
      Done when: every account above exists and its values have a home: GitHub `staging` environment or repo secrets, or saved for the Pulumi config in step 6. Generated deploy secrets come in steps 6 and 7. Keys for later features (PostHog, Safe Browsing, Sentry, Mission Control) come in the build steps that use them.
   6. **Pulumi `staging` stack:** VPC, security group (80/443 only), instance role, `t4g.micro` VM with cloud-init, Cloudflare DNS records, and the `running` flag that stops and starts it. A new deploy SSH key pair: the public key goes in the stack config, the private key in the GitHub `staging` secret `KAMAL_SSH_PRIVATE_KEY`.
      Done when: `ssh deploy@url-shortener-staging` works over Tailscale, `docker ps` runs, and `go-staging.cellow.space` resolves to the VM.
   7. **First Kamal deploy from your laptop:** `deploy.yml` + the `staging` destination, Postgres accessory, Let's Encrypt TLS. `POSTGRES_PASSWORD`, `SECRET_KEY_BASE` (a different value per environment; there's no Rails master key) and a GHCR token (`KAMAL_REGISTRY_PASSWORD`) are generated here, referenced from `.kamal/secrets.staging`, and stored in the GitHub `staging` environment.
      Done when: `https://go-staging.cellow.space/up` returns 200 with a valid certificate.
   8. **Vercel staging:** `vercel.json` (automatic deploys from `main` off), `API_ORIGIN` for the Preview environment, then a manual `vercel deploy` + `vercel alias` to `console-staging.cellow.space`.
      Done when: the staging page shows the version coming from the staging API through the rewrite.
   9. **Automate it:** in `pipeline.yml`, the build (arm64 runner → GHCR, tagged with the commit hash), staging deploy (Tailscale → `kamal deploy -d staging`, Vercel CLI deploy + alias) and smoke test jobs.
      Done when: merging a PR to `main` updates a running staging on its own, `/up` reports the new commit hash, and the staging job skips cleanly while staging is stopped.
2. **Production and the release flow.** The hello-world build goes all the way to production, so the whole pipeline is proven before any features exist:
   1. **Pulumi `prod` stack:** `t4g.small` VM with an Elastic IP, the S3 backup bucket with the 14-day lifecycle rule, write access to it for the instance role, and the prod DNS records.
      Done when: `ssh deploy@url-shortener-prod` works over Tailscale, `go.cellow.space` resolves, and the bucket shows the lifecycle rule.
   2. **Production secrets:**
      - a GitHub `production` environment with you as required reviewer, deploys allowed only from `main`, and its secrets
      - Vercel Production env vars (`API_ORIGIN` pointing at the prod API)
      Done when: every value in [config](docs/spec/config.md) for production has a home.
   3. **First Kamal deploy to production, from your laptop:** `kamal setup -d production`.
      Done when: `https://go.cellow.space/up` returns 200 with a valid certificate.
   4. **Backups:** the `backup` accessory (nightly `pg_dump` → S3, using the instance role).
      Done when: a manual run puts a dump in the bucket, and `pg_restore` of that dump into a local database succeeds.
   5. **release-please:** config files, the manifest at `0.0.0`, `version.txt`, and the release-please job in `pipeline.yml`, using the GitHub App token.
      Done when: after a `feat:` merge, a `chore(main): release 0.1.0` PR appears with a CHANGELOG, and CI runs on it.
   6. **Production job:** runs only when a release is created, waits in the `production` environment for approval, then retags the image, runs `kamal deploy -d production`, `vercel deploy --prod` and the smoke test.
      Done when: the job is in `pipeline.yml` and skipped on normal merges. Its first real run happens in the next step.
   7. **First release:** merge the release PR → approve the production deploy.
      Done when: tag `v0.1.0` and its GitHub Release exist, `go.cellow.space/up` reports `0.1.0`, and `console.cellow.space` shows `v0.1.0` in the footer.
   8. **Rollback workflow:** `rollback.yml` (manual run with a tag as input).
      Done when: running it with `v0.1.0` redeploys that image to production and `/up` reports the same commit hash.
   9. **Monitoring:** UptimeRobot on production `/up` (staging is stopped most of the time, so it isn't monitored), and Sentry projects for Rails and Next.js, tagged with release, environment and commit, without personal data.
      Done when: after the next release, a test exception from each app shows up in Sentry tagged with that version / `production`, and a temporary UptimeRobot monitor on staging's `/up` alerts when staging's Rails container is stopped (then the monitor is deleted).
3. Links model, code generation, `POST /api/links`, redirect
4. Auth (generator + first-party cookie through the Next.js `/api` rewrite)
5. Dashboard: list / edit / disable / delete / QR
6. Analytics adapter, `ClickJob`, PostHog capture
7. Stats endpoint (HogQL + cache) and per-link analytics UI
8. Safe Browsing check, rescan job, interstitial
9. Public stats page (`/:code+`)
10. Demo seed + backfill, "Try the demo" button
11. Polish: 404/interstitial pages, README with screenshots and architecture, then a commit with a `Release-As: 1.0.0` footer so release-please proposes `v1.0.0` (with `bump-minor-pre-major`, a `feat!:` alone would only bump the minor version)
