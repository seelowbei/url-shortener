# URL Shortener

A Bitly-style URL shortener, built as a portfolio project: short links on `go.cellow.space`, a dashboard on `console.cellow.space`, and click analytics from PostHog.

> **Status:** work in progress. The walking skeleton (build steps 1.1–1.9) runs on staging with automated deploys. Next is the production stack and release flow (step 2), then the link features. See the [build order](SPEC.md#build-order).

## Stack

- **API and redirects:** Rails 8.1 API ([`api/`](api/README.md)) on Ruby 4.0.10, with PostgreSQL 17, Solid Queue and Solid Cache
- **Frontend:** Next.js App Router ([`web/`](web/)), Tailwind v4, shadcn/ui, a typed client generated from the API's OpenAPI spec
- **Analytics:** PostHog, with server-side click capture and HogQL queries
- **Infrastructure:** AWS EC2 (`t4g`, Singapore) deployed with Kamal, Next.js on Vercel, Cloudflare DNS, all created with Pulumi ([`infra/`](infra/README.md))

Everything runs on free tiers except the domain and the AWS VMs (about $20/month, with staging stopped when not in use).

## Architecture

```text
Browser ──► Next.js on Vercel (console.cellow.space)
              │  /api/* rewritten (proxied) ──────────────┐
              ▼                                           ▼
Visitor ──► GET go.cellow.space/:code ──► kamal-proxy ──► Rails API (AWS EC2 t4g, Docker)
                                                           │   302 + enqueue ClickJob
                                         Solid Queue ──────┼──► PostHog capture
                                         Stats request ────┼──► PostHog Query API (HogQL), cached
                                         Link create ──────┼──► Google Safe Browsing
                                                           └──► Postgres 17 (Kamal accessory, same VM)
```

- Rails serves the short domain directly, so a redirect does one indexed lookup and never waits on a third party.
- The browser only talks to `console.cellow.space`. Next.js proxies `/api/*` to Rails, so the session cookie is first-party and no CORS is needed.
- No raw IP is stored or logged; visitors are identified by a daily-salted hash.

## Repository layout

```text
api/                 Rails API (+ Kamal config in config/deploy*.yml and .kamal/)
web/                 Next.js app
infra/               Pulumi TypeScript program (run from a laptop only)
docs/spec/           design docs: product, api, backend, frontend, infrastructure, delivery, config
SPEC.md              overview, architecture, build order
docker-compose.yml   dev Postgres 17 on localhost:5433
.github/workflows/   ci.yml, pipeline.yml (build + deploys), pr-title.yml
```

## Local development

Needs Docker, Ruby 4.0.10 and Node 26 with pnpm.

```bash
docker compose up -d --wait db   # Postgres on localhost:5433
```

```bash
cd api && bin/rails db:prepare && bin/rails server   # API on localhost:3000
```

```bash
cd web && pnpm install && pnpm dev   # web on localhost:3001; /api/* goes to API_ORIGIN (default localhost:3000)
```

Tests and linters for each app are listed in [`AGENTS.md`](AGENTS.md#commands) and the app READMEs.

## Delivery

- Every PR runs CI (`api`, `web` and `infra` jobs plus a Conventional Commits title check); all are required on `main`.
- A merge to `main` builds one ARM64 image and deploys it to staging (Kamal + Vercel), followed by a smoke test.
- Production deploys of that same image come from merged release-please PRs, after manual approval (build step 2).

Details: [docs/spec/delivery.md](docs/spec/delivery.md).

## Docs

| Doc | Covers |
|---|---|
| [SPEC.md](SPEC.md) | Overview, architecture, build order |
| [Product](docs/spec/product.md) | Features and acceptance criteria |
| [API and data model](docs/spec/api.md) | Tables, endpoints, error shape |
| [Backend](docs/spec/backend.md) | Rails structure, redirect path, jobs |
| [Frontend](docs/spec/frontend.md) | Next.js routes, API client, UI |
| [Infrastructure](docs/spec/infrastructure.md) | Pulumi, EC2, Kamal, Vercel, DNS |
| [Delivery](docs/spec/delivery.md) | Tests, CI, environments, releases |
| [Config](docs/spec/config.md) | Every environment variable and where it lives |
| [AGENTS.md](AGENTS.md) | Commands and conventions for coding agents |
