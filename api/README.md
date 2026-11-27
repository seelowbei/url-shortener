# api

Rails 8.1 API for the URL shortener: the JSON API, auth and short-link redirects. Ruby 4.0.10, PostgreSQL 17, Solid Queue (runs inside Puma) and Solid Cache. Design: [docs/spec/backend.md](../docs/spec/backend.md) and [docs/spec/api.md](../docs/spec/api.md).

## Local development

Postgres runs in Docker on `localhost:5433` (from the repo root: `docker compose up -d --wait db`).

```bash
bin/rails db:prepare              # create and migrate dev + test databases
bin/rails server                  # localhost:3000; GET /up and /api/health answer 200
bin/rspec                         # tests (request specs, WebMock for external HTTP)
bin/rubocop                       # lint (rubocop-rails-omakase); -a to autocorrect
bin/brakeman -q --no-pager        # security scan
bin/bundler-audit check --update  # gem vulnerabilities
docker build --platform linux/arm64 -t url-shortener-api:local .   # production image (the VMs are ARM64)
```

Environment variables are listed in [docs/spec/config.md](../docs/spec/config.md).

## Deployment

Kamal 2 deploys the image to the AWS EC2 VM, with Postgres as a Kamal accessory on the same host. Config is in `config/deploy.yml` (shared) and `config/deploy.<destination>.yml`. Secrets resolve from `.kamal/secrets.<destination>`, which only references environment variables set from GitHub Environment secrets.

Deploys run only in CI (`.github/workflows/pipeline.yml`): a merge to `main` deploys to staging, a merged release PR deploys to production. See [docs/spec/delivery.md](../docs/spec/delivery.md).
