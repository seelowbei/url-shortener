# Product: features and demo

[← Spec overview](../../SPEC.md)

What the app does and how each feature is accepted.

## Shorten a URL
- `POST /api/links` with `url` and an optional `alias`.
- Anonymous users can create links. Logged-in users' links belong to their account.
- URL rules: `http`/`https` only, max 2048 chars, has a host, does not point to the short domain itself (blocks redirect loops).
- Generated code: 7 random base62 chars. On a unique-index collision, retry up to 5 times.
- Alias: `[A-Za-z0-9_-]{3,30}`, case-insensitive unique, not in the reserved list (`api`, `admin`, `login`, `signup`, `dashboard`, `stats`, `health`, `up`, …).
- Rate limit: 10 creates/min per IP for anonymous users, 60/min for logged-in users (Rails `rate_limit`). Over the limit → 429.
- Every new URL goes through the Safe Browsing check ([Safe Browsing](#malicious-url-check-google-safe-browsing-v4)) before it is saved.

**Accept:** a valid URL returns 201 with `{code, short_url, destination_url}`. An invalid URL returns 422 with field errors. An alias that is taken or reserved returns 422.

## Redirect
- `GET /:code` → `302 Found` to the destination with `Cache-Control: private, max-age=0`.
- Unknown, disabled or deleted code → branded 404 page.
- Flagged link ([Safe Browsing](#malicious-url-check-google-safe-browsing-v4)) → a warning interstitial instead of the redirect, with a "continue anyway" link.
- On a successful redirect, `ClickJob` is enqueued with the request metadata. The redirect itself never writes to the `links` row and never calls PostHog. `ClickJob` increments `clicks_count` atomically, so the counter lags by under a second.
- Bot user agents (crawlers, link unfurlers) are redirected but not counted.

**Accept:** the redirect responds in under 20 ms p50 locally, and the job is enqueued with the correct payload (request spec).

## Auth
- Rails 8 authentication generator: email + password, plus a sign-up endpoint. Password reset is removed from the generated code; it's out of scope because it needs a mailer.
- `POST /api/registrations`, `POST /api/session`, `DELETE /api/session`, `GET /api/me`.
- The login page has a "Try the demo" button that logs in as the seeded demo user.

## Link management (owner only)
- Dashboard: paginated list (25/page) with short URL, destination, total clicks, created date, status, and a copy button.
- Edit the destination URL (Safe Browsing check runs again), disable/enable, toggle public stats, soft delete.
- QR code: `GET /api/links/:code/qr.svg`, generated with `rqrcode` and shown in the UI with a download option.
- Anonymous links cannot be edited.

**Accept:** a user who is not the owner gets 404 on every owner endpoint, so other users' codes are not revealed.

## Analytics
**Capture:** `ClickJob` sends one PostHog event:

| Field | Value |
|---|---|
| event | `link_clicked` |
| distinct_id | `sha256(ip + user_agent + daily_salt)`, which gives approximate unique visitors and no raw IP stored |
| timestamp | time of the click (not time of job run) |
| properties | `link_id`, `link_code`, `environment` (`APP_ENV`), `$referrer`, `$referring_domain`, `$browser`, `$os`, `$device_type` (parsed in Rails with the `browser` gem), `$ip` (for GeoIP only) |

PostHog project settings: enable GeoIP and "discard client IP data". Check that GeoIP country is still populated when the IP is discarded.

**Query:** `GET /api/links/:code/stats?range=7d|30d|90d` → Rails runs HogQL against the PostHog Query API (personal API key, server-side only). The result is cached in Solid Cache for 60 s per `(link, range)`.

```json
{
  "range": "30d",
  "total_clicks": 1234,
  "unique_visitors": 980,
  "timeseries": [{"date": "2026-11-01", "clicks": 40}],
  "referrers": [{"domain": "twitter.com", "clicks": 300}],
  "countries": [{"code": "US", "clicks": 500}],
  "devices": [{"type": "Mobile", "clicks": 700}],
  "browsers": [{"name": "Chrome", "clicks": 600}]
}
```

- The total in the dashboard list comes from `clicks_count`, not PostHog, because it updates almost instantly (via `ClickJob`) and needs no API call.
- If PostHog is unavailable, the stats endpoint returns 503 and the UI shows a retry state. Redirects are unaffected.
- `Analytics` adapter interface (`capture`, `link_stats`) with `PosthogAdapter` and `FakeAdapter`, so tests and offline dev don't need PostHog.

**UI:** a per-link page with a range picker, a clicks-over-time line chart, top referrers, countries, devices and browsers.

## Malicious-URL check (Google Safe Browsing v4)
- On create and on destination edit: `threatMatches:find` for `MALWARE`, `SOCIAL_ENGINEERING`, `UNWANTED_SOFTWARE`, `POTENTIALLY_HARMFUL_APPLICATION`.
- Match → 422 `"This URL is flagged as unsafe"`.
- API error or timeout (2 s) → **fail open**: the link is saved with `scan_status = pending`, and `ScanLinkJob` retries with backoff.
- `RescanLinksJob` runs nightly (Solid Queue `config/recurring.yml`) on links not scanned in the last 7 days. A match sets `flagged_at`, and the redirect then shows the interstitial ([redirect](#redirect)).

**Accept:** request specs cover clean, flagged and API-timeout cases using WebMock stubs (no real API calls in tests).

## Public stats page
- `GET /:code+` (Rails) → 302 to `${APP_ORIGIN}/stats/:code`.
- The Next.js page `/stats/:code` calls `GET /api/public/links/:code/stats`, which returns the same shape as [analytics](#analytics) but without referrer paths (domains only).
- Visible only when `stats_public = true` (default true; the owner can turn it off). Otherwise → 404.
- Shows the short URL, the destination domain, the created date and the charts.

## Demo seed

- `bin/rails db:seed` creates the demo user (credentials in `db/seeds.rb`, demo use only) with about 15 links of varied age and popularity, including one custom alias and one disabled link.
- `bin/rails demo:backfill_clicks` sends about 5,000 backdated `link_clicked` events over 90 days to PostHog (posthog-ruby supports a `timestamp`), with realistic referrer, country and device distributions, and sets `clicks_count` to match. It runs once against the demo PostHog project.
- With `ANALYTICS_ADAPTER=fake`, `FakeAdapter` returns deterministic generated stats, so the dashboard looks populated without PostHog.
