# Frontend architecture

[← Spec overview](../../SPEC.md)

## Principles
- **Rails owns all business logic and auth.** Next.js is the UI. It has no database access and no auth library of its own.
- **Rendering is chosen per page:** public pages are rendered on the server for speed, SEO and link previews. The signed-in app fetches data in the browser through the `/api` rewrite.
- **Types come from the API contract,** never written by hand.
- **Server data lives in TanStack Query, UI state lives in the URL.** No global store.

## Routes (`/web/src/app`)
```
(marketing)/page.tsx          Landing + shorten form (anonymous OK)
(auth)/login/page.tsx         Login + "Try the demo"
(auth)/signup/page.tsx        Sign up
(app)/layout.tsx              Signed-in shell: nav, user menu, staging banner
(app)/dashboard/page.tsx      Links table (paginated)
(app)/links/[code]/page.tsx   Link detail: analytics, QR, edit / disable / delete / public toggle
stats/[code]/page.tsx         Public stats
stats/[code]/opengraph-image.tsx   Open Graph image for the public stats page
not-found.tsx, error.tsx, loading.tsx (+ per-route loading.tsx skeletons)
middleware.ts
```
Short codes (`/:code`, `/:code+`) never reach Next.js. They go to Rails on `SHORT_HOST`.

## Rendering and data fetching

| Page | Rendering | Data |
|---|---|---|
| Landing | Static shell + client-side form | `POST /api/links` via a TanStack mutation |
| Login / signup | Client | `POST /api/session` / `/api/registrations`. On success, invalidate `me` and go to `?next=` or `/dashboard` |
| Dashboard | Client | `GET /api/links?page=`, with `keepPreviousData` for smooth paging |
| Link detail | Client | `GET /api/links/:code`, `GET /api/links/:code/stats?range=`, QR `<img src="/api/links/:code/qr.svg">` |
| Public stats | **Server Component**, `revalidate: 60` | Fetched server-side from `${API_ORIGIN}/api/public/links/:code/stats`, no cookie. A 404 from Rails shows `notFound()`. |

**Public stats extras:**
- `generateMetadata` sets the page title and description (short URL, destination domain, total clicks).
- `opengraph-image.tsx` (`next/og`, 1200×630) renders the short URL, total clicks and a sparkline, so a pasted link shows a preview card. Cached like the page.

**Rewrites** (`next.config.ts`): `/api/:path*` → `${API_ORIGIN}/api/:path*`. The browser only ever calls same-origin `/api/*`, so the session cookie is first-party and no CORS setup is needed.

## API client
- `pnpm gen:api` runs `openapi-typescript ../api/swagger/v1/openapi.yaml -o src/lib/api/schema.d.ts`. The output is committed, and CI checks it's up to date ([testing and CI](delivery.md#testing-and-ci)).
- `src/lib/api/client.ts`: an `openapi-fetch` client with base URL `/api` in the browser and `${API_ORIGIN}/api` on the server, `credentials: "include"`, and response errors normalized into an `ApiError` (`status`, `code`, `message`, `fields`).
- `src/lib/api/hooks.ts`: TanStack Query hooks: `useMe`, `useLinks(page)`, `useLink(code)`, `useLinkStats(code, range)`, `useCreateLink`, `useUpdateLink`, `useDeleteLink`, `useLogin`, `useLogout`, `useSignup`.
  - Query keys: `["me"]`, `["links", page]`, `["link", code]`, `["stats", code, range]`.
  - Mutations invalidate the affected keys. Disabling a link and toggling public stats update the UI immediately, before the server responds.
  - Stats queries use `staleTime: 60s`, matching the Rails cache.
- **Global handling of 401:** a QueryClient `onError` clears the `me` query and sends the user to `/login?next=<current path>`.

## Auth in the frontend
- `middleware.ts` matches only the `(app)` routes. If the session cookie is missing, it redirects to `/login?next=…`. This check is just for speed: Rails is the authority, and the 401 handling above catches expired sessions.
- `(app)/layout.tsx` loads `useMe` and shows a skeleton until it has loaded.
- "Try the demo" calls `POST /api/session` with the demo credentials ([demo seed](product.md#demo-seed)).
- `?next=` only accepts same-origin relative paths, to prevent open redirects.

## UI
- **Tailwind v4 + shadcn/ui** (Button, Input, Form, Table, Dialog, DropdownMenu, Tabs, Badge, Skeleton, Card, Chart), plus **lucide-react** icons, **sonner** toasts and **next-themes** for system, light and dark mode.
- **Forms:** react-hook-form + zod.
  - The zod schemas mirror the server's basic rules (URL format, alias pattern). The server stays the source of truth.
  - An `ApiError.fields` from Rails is mapped onto the form with `setError`, so server validation messages appear next to the right input.
- **Charts** (shadcn chart on Recharts):
  - clicks over time: area chart
  - referrers and countries: horizontal bar lists
  - devices and browsers: donut charts
  - Each chart has an empty state ("No clicks yet") and a skeleton while loading.
- **URL state:** `range` (`7d|30d|90d`) and `page` live in search params, via `nuqs`. Views can be shared and survive a refresh, and the back button behaves.
- **Copy to clipboard** with toast feedback. QR download as SVG/PNG.
- **Staging banner** when `NEXT_PUBLIC_APP_ENV=staging`. The footer shows `NEXT_PUBLIC_APP_VERSION`.
- **Accessibility:**
  - Every input has a label, focus is visible, and dialogs trap focus (Radix behavior).
  - Charts get a visually hidden data table or `aria-label` summary.
  - `@axe-core/playwright` runs in the e2e test.
- **Responsive:** the dashboard table turns into cards below `md`, and charts stack vertically.

## Errors, loading and empty states
- Route-level `loading.tsx` skeletons. `error.tsx` boundaries with a "Try again" button that calls `reset()` and refetches.
- `ApiError` → a user-facing message: 422 → field errors, 429 → "Slow down — try again in a minute", 503 on stats → "Analytics temporarily unavailable" with retry.
- Dashboard empty state: "Create your first link" with the shorten form inline.

## Directory layout (`/web/src`)
```
app/                 routes (above)
components/ui/       shadcn components (generated, lightly customized)
components/          app components: ShortenForm, LinksTable, LinkCard, StatsCharts, RangePicker, QrCode, CopyButton, StagingBanner
lib/api/             schema.d.ts (generated), client.ts, hooks.ts, errors.ts
lib/validation.ts    zod schemas
lib/utils.ts         cn(), formatters
test/                MSW handlers, test utils
e2e/                 Playwright specs
```

## Tooling
- pnpm, TypeScript `strict`, ESLint (`next/core-web-vitals`) + Prettier.
- Node version pinned in `.nvmrc` and in Vercel's settings.
