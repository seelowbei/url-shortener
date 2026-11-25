# Backend architecture

[← Spec overview](../../SPEC.md)

## Principles
- **Domain rules live in models** (validations, scopes, normalization). **POROs in `app/services`** only coordinate multi-step operations or wrap external services. No dry-rb, interactor or similar gems.
- **The request path never waits on a third party** except the Safe Browsing check when a link is created or edited (2 s timeout, fails open).
- **Thin controllers:** authenticate → call a model or service → serialize, with errors handled centrally.

## App setup
- `rails new api --api --database=postgresql`, plus:
  - **Cookie middleware** (`ActionDispatch::Cookies`) and `ActionController::Cookies` in `Api::BaseController`, needed by the Rails 8 auth generator's signed `session_id` cookie.
  - **One HTML controller**, `PagesController < ActionController::Base`, for the branded 404 and the unsafe-link warning page (ERB + a small inline stylesheet).
- Auth generator output kept: `User`, `Session`, `Current`, the `Authentication` concern (adapted to return 401 JSON instead of redirecting). Password reset is removed.

## Directory layout (`/api/app`)
```
controllers/
  api/base_controller.rb          Authentication, Origin check, rescue_from → error shape, pagy
  api/links_controller.rb         index, show, create, update, destroy, qr
  api/stats_controller.rb         GET /api/links/:code/stats
  api/public_stats_controller.rb  GET /api/public/links/:code/stats
  api/sessions_controller.rb, api/registrations_controller.rb, api/me_controller.rb
  redirects_controller.rb         GET /:code, GET /:code+   (no session, no auth)
  pages_controller.rb             HTML 404 + interstitial
models/
  link.rb                         validations, scopes (live, flagged, needs_rescan), code normalization
  user.rb, session.rb, current.rb
services/
  result.rb                       Result = Data.define(:value, :error) { success? }
  links/create.rb                 normalize URL → validate → safety check → ShortCode → save
  links/update_destination.rb     validate → safety check → save
  short_code.rb                   7-char base62 (SecureRandom), insert with retry on unique violation (max 5)
  url_safety/safe_browsing_client.rb   Faraday, threatMatches:find, batch up to 500 URLs
  analytics/adapter.rb            interface: capture(event), link_stats(link, range)
  analytics/posthog_adapter.rb    posthog-ruby for capture, Faraday for the Query API
  analytics/fake_adapter.rb       deterministic stats generated from a seed (link id)
  analytics/stats_query.rb        HogQL builder + response mapper
  visitor.rb                      client IP, daily-salted visitor hash, bot detection, UA parsing (browser gem)
serializers/                      Alba: LinkResource, StatsResource, UserResource, ErrorResource
jobs/
  click_job.rb, scan_link_job.rb, rescan_links_job.rb
views/pages/                      not_found.html.erb, interstitial.html.erb
```
`config/initializers/app_config.rb` defines `AppConfig`, which reads every env var with `ENV.fetch` at boot. A missing secret fails the boot, so Kamal's health check stops the deploy.

## Services and Result
```ruby
result = Links::Create.call(url:, alias:, user: Current.user)
if result.success?
  render json: LinkResource.new(result.value).serialize, status: :created
else
  render_error(result.error)   # :invalid (with fields) | :unsafe_url | :alias_taken
end
```
- Services are classes with a single `.call` method returning a `Result`. Unexpected failures (bugs, the database being down) still raise, and `rescue_from` handles them.
- No service for simple reads or toggles. `Current.user.links.live.find_by!(code:)` and `link.update!(disabled_at: …)` stay in the controller.

## Request handling

| Concern | Implementation |
|---|---|
| **Authorization** | Owner scoping only: `Current.user.links.live.find_by!(code:)`. A miss → `RecordNotFound` → 404 (other users' links stay hidden). No Pundit. |
| **Serialization** | Alba resources, kept in line with the rswag schemas. Request specs validate responses against the schema. |
| **Pagination** | pagy (25/page) → `{ data: [...], meta: { page, pages, count } }` |
| **Errors** | `rescue_from` in `Api::BaseController`: `RecordNotFound` → 404, `RecordInvalid` / `Result` `:invalid` → 422 with `fields`, `ActionController::ParameterMissing` → 400, rate limit → 429, `Analytics::Unavailable` → 503, `StandardError` → 500 (generic message, reported to Sentry). |
| **Rate limiting** | Rails 8 `rate_limit` on `links#create`, `sessions#create` and `registrations#create`, stored in Solid Cache (shared across processes) |
| **CSRF** | A `before_action` in `Api::BaseController` checks `Origin` against `ALLOWED_ORIGINS` for POST/PATCH/DELETE → 403 |
| **Params** | `params.expect(link: [:url, :alias])` (Rails 8) |
| **External HTTP** | Faraday with explicit timeouts: Safe Browsing open 1 s / read 2 s, PostHog query open 2 s / read 5 s. No retries during a request; retries happen only in jobs. |

## Routes
```ruby
namespace :api do
  resource  :session, only: %i[create destroy]
  resource  :registration, only: :create
  get "me", to: "me#show"
  resources :links, param: :code, only: %i[index show create update destroy] do
    get :stats, on: :member, to: "stats#show"
    get :qr,    on: :member, defaults: { format: :svg }
  end
  get "public/links/:code/stats", to: "public_stats#show"
end
get "up", to: "rails/health#show"
mount MissionControl::Jobs::Engine, at: "/jobs"
mount Rswag::Ui::Engine, at: "/api/docs" if AppConfig.api_docs_enabled  # dev + staging

# Last: short codes
constraints(code: /[A-Za-z0-9_-]{3,30}/) do
  get "/:code+", to: "redirects#stats", format: false
  get "/:code",  to: "redirects#show",  format: false
end
```
The reserved-words list ([reserved words](product.md#shorten-a-url)) includes every top-level path above (`api`, `up`, `jobs`, …) so an alias can never shadow a route.

## Redirect hot path (`RedirectsController#show`)
1. `Link.live.select(:id, :code, :destination_url, :disabled_at, :flagged_at).find_by(code:)`: one indexed lookup, under 1 ms on the same machine.
2. Missing or disabled → render `pages/not_found` (404). Flagged → render `pages/interstitial` (200).
3. `Visitor.from(request)`: bot check. Bots are redirected without being counted.
4. `ClickJob.perform_later(link_id:, occurred_at: Time.current, ip:, user_agent:, referrer:)`: one `INSERT` into Solid Queue.
5. `redirect_to destination_url, status: :found, allow_other_host: true` + `Cache-Control: private, max-age=0`.

No session lookup, no cookies, no cache in front of the lookup (Solid Cache is also Postgres, so it would only add a query). The controller inherits from `ActionController::API` and skips the `Authentication` concern.

## Jobs (Solid Queue, inside Puma)

| Job | Queue | Behavior |
|---|---|---|
| `ClickJob` | `analytics` | `Link.update_counters(link_id, clicks_count: 1)`, then `Analytics.adapter.capture(...)` with `timestamp: occurred_at`. `retry_on` network errors ×5 with growing delays, then discarded (a lost analytics event is acceptable; the counter is already incremented). |
| `ScanLinkJob` | `default` | Rescans a `pending` link. `retry_on` Safe Browsing errors with growing delays. A match → `flagged`. |
| `RescanLinksJob` | `default` | Nightly (`config/recurring.yml`). `Link.needs_rescan` (not scanned in 7 days) in batches of 500 → one Safe Browsing call per batch. |

- Finished jobs are cleared by Solid Queue's recurring cleanup task (keeps 1 day).
- **Mission Control – Jobs** at `/jobs`, behind HTTP basic auth (`MISSION_CONTROL_USER` / `_PASSWORD`), for inspecting queues, failed jobs and retries.

## Analytics stats query
- `Analytics::StatsQuery` runs **5 HogQL queries in parallel** (threads, each with its own Faraday connection) against `POST /api/projects/:id/query`:
  1. totals + unique visitors (`count()`, `count(DISTINCT distinct_id)`)
  2. daily timeseries (`toStartOfDay(timestamp)`)
  3. top 10 referring domains
  4. top 10 countries (`properties.$geoip_country_code`)
  5. devices and browsers (`$device_type`, `$browser`)
- Filters: `event = 'link_clicked' AND properties.link_id = {link_id} AND properties.environment = {env} AND timestamp >= now() - INTERVAL {days} DAY`. Values go in as **HogQL `values` parameters**, never pasted into the query string.
- The response is mapped to the [analytics](product.md#analytics) shape and cached for 60 s with `Rails.cache.fetch(["stats", link.id, range], expires_in: 60.seconds)`.
- Any failure or timeout raises `Analytics::Unavailable` → 503.
- The public stats endpoint reuses the query and drops referrer paths (domains only).

## Visitor (client identity, no raw IP stored)
- IP: `request.remote_ip`, with kamal-proxy configured as a trusted proxy so `X-Forwarded-For` is honored.
- `visitor_id = SHA256(ip + user_agent + daily_salt)`. The daily salt is derived from `secret_key_base` + the date, so the same visitor can't be linked across days.
- Bot detection: the `browser` gem's `bot?` plus a small extra list (Slackbot, Twitterbot, facebookexternalhit, Discordbot, LinkedInBot, WhatsApp, curl and wget in production).
- UA parsing (`browser` gem) → `$browser`, `$os`, `$device_type` sent as PostHog properties.

## Observability
- **Logs:** JSON to stdout, one line per request (`request_id`, method, path, status, duration_ms, `link_code` when present, `user_id` when signed in). IPs aren't logged. Read them with `kamal app logs -d production`.
- **Sentry** (`sentry-ruby` + `sentry-rails`):
  - `release: APP_VERSION`, `environment: APP_ENV`, `send_default_pii: false`.
  - Errors are captured from requests and jobs. Performance tracing is off at first (it uses up free-plan quota).
  - The Next.js side uses `@sentry/nextjs` with the same release name, so errors from both sides match up with release-please versions.
- **Uptime:** UptimeRobot on `/up` for staging and production ([deployment](infrastructure.md#deployment)).

## Gems
`rails ~> 8.x`, `pg`, `puma`, `solid_queue`, `solid_cache`, `mission_control-jobs`, `bcrypt`, `alba`, `pagy`, `faraday`, `posthog-ruby`, `browser`, `rqrcode`, `sentry-ruby`, `sentry-rails`, `bootsnap`, `kamal`, `thruster` (optional; kamal-proxy already terminates TLS).
Dev/test: `rspec-rails`, `rswag`, `factory_bot_rails`, `shoulda-matchers`, `webmock`, `rubocop-rails-omakase`, `brakeman`, `bundler-audit`.
