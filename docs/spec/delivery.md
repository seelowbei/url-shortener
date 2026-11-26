# Testing, environments and release flow

[← Spec overview](../../SPEC.md)

## Testing and CI

**API (`/api`):** RSpec, FactoryBot, WebMock, shoulda-matchers, rswag (OpenAPI generated from request specs).
- Model specs: code generation, collision retry, alias rules, URL validation.
- Request specs: every endpoint in [API](api.md#api-endpoints), including auth, ownership (404), rate limit (429) and the Safe Browsing cases.
- Job specs: `ClickJob` payload, `ScanLinkJob` / `RescanLinksJob`.
- Adapter spec: HogQL query building and response mapping for PostHog (stubbed HTTP).

**Web (`/web`):** ESLint, `tsc --noEmit`, Vitest + React Testing Library + MSW (mock handlers typed from the OpenAPI types) for components and hooks, and one Playwright happy path: shorten → sign up → dashboard → link stats.

**GitHub Actions** (`ci.yml`), on every PR, and on `main` as the first job of `pipeline.yml` (`workflow_call`, so a push isn't tested twice):
- `api`: Postgres service → `rubocop`, `brakeman`, `bundle-audit`, `rspec`, then `rswag:specs:swaggerize` and fail if `openapi.yaml` differs from the committed file
- `web`: `lint`, regenerate the API types and fail if they differ from the committed file, `typecheck`, `vitest`, `build`
- `e2e`: Docker Compose (Rails + Postgres, `ANALYTICS_ADAPTER=fake`) + `next start` → Playwright
- The pipeline's staging smoke test ([environments and release flow](#environments-and-release-flow)) also runs the Playwright happy path against staging, sending the Vercel protection bypass header ([Vercel](infrastructure.md#vercel)).

## Environments and release flow

### Environments

| | **dev** | **staging** | **production** |
|---|---|---|---|
| Where | Your laptop | EC2 `url-shortener-staging` (t4g.micro, stopped when not in use) | EC2 `url-shortener-prod` (t4g.small) |
| API | `bin/dev` on `localhost:3000` | `https://go-staging.cellow.space` | `https://go.cellow.space` |
| Web | `next dev` on `localhost:3001` | `https://console-staging.cellow.space` (Vercel alias on a preview deploy) | `https://console.cellow.space` |
| Postgres | `docker compose up db` (`postgres:17`) | Kamal accessory | Kamal accessory |
| `RAILS_ENV` | `development` | `production` | `production` |
| Analytics | `ANALYTICS_ADAPTER=fake` (PostHog optional) | PostHog, staging project | PostHog, prod project |
| Data | Seeds | Seeds + backfill, reset any time | Seeds + backfill (demo account), never reset |
| Backups | – | – | Nightly to S3 |
| Deployed by | – | Every merge to `main` while it's running, or a manual pipeline run | A published GitHub Release |

- **Staging runs `RAILS_ENV=production`**, so it tests exactly the prod configuration. Only env vars differ. An `APP_ENV=staging|production` variable is used for labels (a "STAGING" banner in the UI) and as the PostHog `environment` property.
- **PostHog:** one project per environment if your plan allows it. Otherwise one project, with every event carrying an `environment` property and every HogQL query filtering on it.
- **Safe Browsing:** one API key for both.
- **Staging is for your own testing and is stopped when not in use** (`running: false` in its stack, [deployment](infrastructure.md#aws-ec2-vm-rails)). A cold start of about a minute is fine. UptimeRobot only monitors production.

### Branching and commits
- Trunk-based: short-lived feature branches → PR → **squash-merge** to `main`.
- **Conventional Commits:** the PR title becomes the squash commit message, so CI checks PR titles (`amannn/action-semantic-pull-request`): `feat:`, `fix:`, `perf:`, `refactor:`, `docs:`, `test:`, `ci:`, `chore:`, with optional scope (`feat(api):`, `fix(web):`). `!` or a `BREAKING CHANGE:` footer marks a major bump.
- `main` is protected: CI and the PR-title check must pass, squash only, no direct pushes.
- PRs get a Vercel preview whose API is staging (fine for UI review; the preview has its own domain, so its login cookie is separate). Previews sit behind Vercel Authentication, so only signed-in team members can open them.

### Versioning (release-please)
- **One version for the whole product** (API + web ship together). Root-level release-please config:
  - `release-please-config.json`: one package at `.`, `release-type: simple`, `bump-minor-pre-major: true` (while on 0.x, `feat` bumps minor and breaking changes bump minor), changelog sections for Features / Bug Fixes / Performance.
  - `.release-please-manifest.json`: `{ ".": "0.0.0" }`, so the first `feat:` commit gives a release PR for `0.1.0`.
  - `version.txt` (bumped by release-please) and `CHANGELOG.md` (generated).
- The version is passed into the image as a build arg (`APP_VERSION`, along with `GIT_SHA`). `GET /up` returns `{version, sha}`, and the web footer shows the version, so you can always tell what's running where.
- **release-please needs a GitHub App token:** a GitHub App created for the repo (`actions/create-github-app-token`), not `GITHUB_TOKEN`. PRs created with `GITHUB_TOKEN` don't trigger workflows, so CI wouldn't run on the release PR and branch protection would block merging it.

### Pipeline (`pipeline.yml`, on push to `main`)

One workflow chains every step, so production only gets a commit that already passed staging. Separate workflows wouldn't work: a release created by the workflow's own token doesn't trigger other workflows, and the staging deploy of that same commit could still be running.

```
push to main
  └─ ci            tests and lint (calls ci.yml)
      └─ build     arm64 image, tagged <sha>, pushed to GHCR (once)
          └─ staging      kamal deploy -d staging --skip-push --version=<sha>
                          vercel deploy (preview env) → alias console-staging.cellow.space
                          smoke test
              └─ release-please   opens/updates the release PR, or — when this push
                                  *is* the merged release PR — tags vX.Y.Z + GitHub Release
                  └─ production   only if release_created == true
                                  environment: production (required reviewer: you)
                                  retag <sha> → vX.Y.Z in GHCR
                                  kamal deploy -d production --skip-push --version=<sha>
                                  vercel deploy --prebuilt --prod (same commit)
                                  smoke test
```

**Day to day:**
1. Merge feature PRs to `main`. Each one deploys to staging automatically while staging is running, and release-please keeps a single open PR, `chore(main): release X.Y.Z`, with the next version and changelog.
2. When you want to test, start staging (`running: true` + `pulumi up`) and run the pipeline manually (`workflow_dispatch`) to deploy the latest `main` to it.
3. When staging looks good, **merge the release PR** while staging is still running. That push goes through CI → build → staging (the release commit only changes `version.txt` and `CHANGELOG.md`), then release-please creates tag `vX.Y.Z` and the GitHub Release, then the production job waits for your approval and deploys the exact image staging just ran.

**Details:**
- **Staging stopped:** the staging job first checks whether `url-shortener-staging` is online in the tailnet. If it isn't, it skips the deploy and smoke test with a notice, and the run still passes. The production job only runs if the staging job actually deployed and smoke-tested that commit, so a release can't skip staging.
- **Concurrency:** group `staging` queues runs instead of cancelling one mid-deploy (that would leave the Kamal deploy lock held). GitHub keeps only the newest pending run, so in-between commits are skipped. Group `production` is never cancelled mid-run.
- **Smoke test:** `GET /up` = 200 with the expected `version`/`sha`, the same through the web app's rewrite (`/api/health` on the web host, with the Vercel protection bypass header in staging), then `POST /api/links` → `GET /:code` = 302 to the right destination. In production the throwaway link is deleted afterwards. Until the links endpoints exist, it checks only `/up` and `/api/health`.
- **Approval:** the required reviewer on the `production` environment is free for public repos. On a private repo, merging the release PR is the gate.

### Rollback
- **Fast:** `rollback.yml` (`workflow_dispatch`, input: a previous tag such as `v1.3.0`) deploys that tag's image, which is already in GHCR, to production with `kamal deploy -d production --skip-push --version=<tag's sha>`, and rolls the web back to the matching Vercel deployment. No rebuild.
- **Manual:** `kamal rollback <sha> -d production` / `vercel rollback`.
- A rollback doesn't change versions. The fix goes out as the next release.
- **Database migrations must be backward compatible** (expand → deploy → contract across two releases). Kamal starts the new container while the old one still serves traffic, and a rollback runs old code against the new schema.

### Hotfix
Same path: `fix: …` PR → merge → staging → the release PR now proposes a patch bump → merge it → approve production. Trunk-based with fast deploys keeps this to minutes. There's no long-lived release branch.
