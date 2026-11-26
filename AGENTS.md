# AGENTS.md

Instructions for coding agents (Codex, Claude Code, others). This file is the source of truth; `CLAUDE.md` imports it.

## Project

A Bitly-style URL shortener, built as a portfolio project. Everything runs on **free tiers except the AWS VMs**, which are budgeted at about $20/month.

- **API and redirects:** Rails 8.1 API (`api/`) on Ruby 4.0.10, with PostgreSQL 17, Solid Queue and Solid Cache.
- **Frontend:** Next.js App Router (`web/`).
- **Analytics:** PostHog. Click events are captured server-side, and stats come from HogQL queries.
- **Hosting:**
  - Rails runs on AWS EC2 in Singapore (prod `t4g.small`, staging `t4g.micro`), deployed with Kamal. Staging is stopped when not in use.
  - Next.js runs on Vercel Hobby.
  - DNS for `cellow.space` is on Cloudflare (free), managed by Pulumi: short links on `go.cellow.space`, the web app on `console.cellow.space`, with `-staging` variants.
  - The infrastructure is created with Pulumi (`infra/`).

The design lives in `SPEC.md` (overview and build order) and `docs/spec/*.md` (details). Read the relevant doc before implementing anything. If the code and the spec disagree, stop and ask rather than silently picking one. When the user changes a decision, update the spec in the same PR.

**Status:** build steps 1.1 (repo and branch protection), 1.2 (Rails skeleton), 1.3 (Next.js skeleton), 1.4 (CI), 1.5 (accounts and prerequisites), 1.6 (Pulumi `staging` stack on AWS) and 1.7 (first Kamal deploy to staging from the laptop) are done. Next is step 1.8 (Vercel staging). Do not start later build steps unless asked.

## Layout

```text
SPEC.md              overview, architecture, build order
docs/spec/           product, api, backend, frontend, infrastructure, delivery, config
api/                 Rails 8.1 API (+ Kamal config in api/config/deploy*.yml, api/.kamal/)
web/                 Next.js app (pnpm, Node 26; has its own AGENTS.md for Next.js docs)
infra/               Pulumi TypeScript program (pnpm, Node 26); run from your laptop only
docker-compose.yml   dev Postgres 17 on localhost:5433
.github/workflows/   CI: ci.yml (api, web, infra jobs) and pr-title.yml; all are required checks on main
.claude/hooks/       agent safety hooks, shared by Claude Code and Codex
```

## Commands

```bash
docker compose up -d --wait db          # dev/test Postgres on localhost:5433
docker compose down                     # stop it (data kept in the db-data volume)

cd api
bin/rails db:prepare                    # create and migrate dev + test databases
bin/rspec                               # tests
bin/rubocop                             # lint (rubocop-rails-omakase); -a to autocorrect
bin/brakeman -q --no-pager              # security scan
bin/bundler-audit check --update        # gem vulnerabilities
bin/rails server                        # API on localhost:3000
docker build --platform linux/arm64 -t url-shortener-api:local .   # production image (the VM is ARM64)

cd web
pnpm install
pnpm dev                                # Next.js on localhost:3001; /api/* is rewritten to API_ORIGIN (default localhost:3000)
pnpm lint                               # ESLint
pnpm typecheck                          # route types + tsc --noEmit
pnpm test                               # Vitest
pnpm format:check                       # Prettier; `pnpm format` to fix
pnpm build                              # production build

cd infra
pnpm install
pnpm typecheck                          # tsc --noEmit (the only check CI runs, with format:check)
pnpm format:check                       # Prettier
pulumi preview -s staging               # needs the user's local OCI config; applying is the user's job

node --test ".claude/hooks/*.test.mjs"  # hook tests (from the repo root)
```

Before calling an API change done, run `bin/rspec`, `bin/rubocop` and `bin/brakeman`. Before calling a web change done, run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm format:check`.

## Hard constraints (from the spec; do not violate)

- **Low cost.** The only paid items are the `cellow.space` domain and AWS, which stays within about $20/month: a prod `t4g.small` and a staging `t4g.micro` (stopped when not in use), their disks, the prod Elastic IP and the S3 backup bucket. Don't add another paid service or plan, or an AWS resource that bills while idle (NAT gateway, load balancer, RDS, and so on), without asking.
- **The redirect path (`GET /:code`) never waits on a third party.** It does one indexed lookup and enqueues `ClickJob`. No PostHog or Safe Browsing call, no session, no write to the `links` row.
- **No raw IP is stored or logged.** Visitors are identified by `SHA256(ip + user_agent + daily_salt)`.
- **Rails owns all business logic and auth.** Next.js is the UI: no database access, no auth library.
- **The same Docker image runs in staging and production.** Nothing environment-specific is baked into the image; config comes from environment variables.
- **Database migrations must be backward compatible** (expand → deploy → contract), because Kamal runs old and new containers side by side and a rollback runs old code against the new schema.
- **Secrets never live in the repo.** Kamal reads them from `.kamal/secrets.<destination>` references, and those resolve from GitHub Environment secrets. The one exception is Pulumi config secrets: they're committed in `infra/Pulumi.<stack>.yaml` only as `secure:` ciphertext, encrypted by Pulumi Cloud. Never commit them in plain text, and never run `pulumi config --show-secrets`.

## Conventions

- **Branches and PRs:** branch off `main`, open a PR, squash-merge.
- **Atomic commits:** never put all of a branch's changes in one big commit. Each commit is one logical change (a dependency, a config change, a feature plus its tests, a doc update), builds and passes tests on its own, and has a Conventional Commits message. Stage by file or hunk (`git add <paths>`, `git add -p`), never `git add -A` / `git commit -a` across unrelated changes. Squash-merge still collapses them on `main`; the atomic history is for review and bisecting within the PR.
- **PR titles follow Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`, `refactor:`, `perf:`, optional scope such as `feat(api):`). The squash commit uses the PR title, and release-please builds versions and the changelog from it.
- **Backend** (details in `docs/spec/backend.md`):
  - Domain rules live in models.
  - Multi-step operations and external services go in POROs under `app/services`, each with a single `.call` that returns a `Result`.
  - Thin controllers, Alba serializers, pagy pagination.
  - Authorization is owner scoping, so a miss is a 404.
- **Errors:** every API error uses the shape `{ "error": { "code", "message", "fields" } }`, with stable machine-readable codes.
- **Tests:** request specs for every endpoint. External HTTP is always stubbed (WebMock), and tests never call PostHog or Safe Browsing.
- **Frontend** (details in `docs/spec/frontend.md`): TypeScript strict. The API types are generated from the rswag OpenAPI file, never written by hand.

## Do not

- **Push to `main` or merge into it.** `main` is protected on GitHub, and `.claude/hooks/protect-main.mjs` also blocks the attempt. Push a feature branch and open a PR. Check `git status -sb` before committing, since the user may have merged and switched branches between turns.
- **Deploy or change servers:** no `kamal setup`, `deploy`, `redeploy`, `rollback`, `app`, `accessory`, `proxy`, `remove`, `prune`, `server` or `lock` commands. Deploys are CI-only: merge to `main` → staging, merged release PR → production.
- **Change infrastructure:** no `pulumi up`, `destroy`, `refresh`, `import`, `cancel`, `state`, `stack init/rm` or `config set/rm`. `pulumi preview` is fine. Ask the user to apply.
- **Touch secrets:** never read, print or commit `config/master.key`, `config/credentials/*.key`, `.env` files, `*.pem` keys or decrypted credentials (`rails credentials:show`, `kamal secrets print`, `--show-secrets`). `.claude/hooks/protect-secrets.mjs` blocks these for both agents.
  When adding a variable, update `docs/spec/config.md` and the committed `*.sample` / `.kamal/secrets*` references instead.
- **Send real user data** (URLs, IPs, emails) to any service other than PostHog and Google Safe Browsing, and only as the spec describes.
