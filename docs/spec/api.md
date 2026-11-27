# API and data model

[← Spec overview](../../SPEC.md)

## Data model

```
users
  id, email_address (unique, citext), password_digest, timestamps

sessions                      # Rails 8 auth generator
  id, user_id, ip_address, user_agent, timestamps

links
  id               bigint pk
  user_id          fk, nullable          # null = anonymous
  code             citext, unique index
  destination_url  text, not null
  custom_alias     boolean, default false
  clicks_count     integer, default 0
  stats_public     boolean, default true
  disabled_at      datetime
  deleted_at       datetime              # soft delete; code stays reserved
  scan_status      enum: pending|clean|flagged
  flagged_at       datetime
  flag_reason      string
  last_scanned_at  datetime
  timestamps
  index (user_id, created_at desc)
```

## API endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/registrations` | – | Sign up |
| POST | `/api/session` | – | Log in |
| DELETE | `/api/session` | user | Log out |
| GET | `/api/me` | user | Current user |
| POST | `/api/links` | optional | Shorten |
| GET | `/api/links` | user | List own links |
| GET | `/api/links/:code` | owner | Link detail |
| PATCH | `/api/links/:code` | owner | Edit destination / disable / stats_public |
| DELETE | `/api/links/:code` | owner | Soft delete |
| GET | `/api/links/:code/stats` | owner | Analytics |
| GET | `/api/links/:code/qr.svg` | owner | QR code |
| GET | `/api/public/links/:code/stats` | – | Public analytics |
| GET | `/:code` | – | Redirect |
| GET | `/:code+` | – | Redirect to public stats page |
| GET | `/up` | – | Health check |

Errors use the shape `{ "error": { "code": "validation_failed", "message": "...", "fields": { "url": ["..."] } } }`.

**OpenAPI contract:** the `/api/*` endpoints are described in **rswag** request specs, which generate `api/swagger/v1/openapi.yaml` (committed). The web client's types are generated from that file ([frontend](frontend.md)). Docs are served at `/api/docs` in dev and staging only.

**CSRF:** besides `SameSite=Lax` cookies, Rails rejects state-changing `/api/*` requests (POST/PATCH/DELETE) whose `Origin` header isn't in `ALLOWED_ORIGINS`: the web app's origin (the same value as `APP_ORIGIN`), plus the Vercel preview-domain pattern for this project in staging. Rejected requests get 403.
