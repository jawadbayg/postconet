# Setup

## Prerequisites

- macOS 13+
- Node.js 20.19+ or 22.12+
- pnpm 9.15+
- Xcode Command Line Tools (native module rebuild)
- Optional: Docker, for local Supabase (`npx supabase start`)
- Optional: Apple Developer ID, for signed/notarized builds

## Install

```bash
pnpm install
cp .env.example apps/desktop/.env
```

Edit `apps/desktop/.env` with **your** Supabase project URL and anon key. Users of a packaged build never see these fields; they are build-time configuration.

```bash
pnpm --filter @postconet/core test
pnpm --filter @postconet/persistence test
pnpm dev
```

`pnpm dev` launches Electron with a sandboxed renderer. The first window is sign-in or local workspace.

## Local Supabase

```bash
npx supabase start
npx supabase db reset
```

Copy `API URL` and `anon key` from `npx supabase status` into `apps/desktop/.env`. Never copy the `service_role` key into the desktop app. Put it only in `apps/worker/.env` and Edge Function secrets.

Configure Auth:

- Enable Email provider
- Confirm email (use Inbucket from `supabase start`, or disable confirmation only on a local project)
- Set Site URL to `postconet://auth/callback` and redirect URLs to that plus `http://127.0.0.1:*`

## CLI

```bash
pnpm --filter @postconet/cli build
node apps/cli/dist/index.js run fixtures/postman/echo.collection.json --env fixtures/postman/echo.environment.json --reporters json,junit --out tmp/report
```

## Worker (optional)

```bash
cp .env.example apps/worker/.env
# fill SUPABASE_SERVICE_ROLE_KEY and WORKER_PUBLIC_BASE_URL
pnpm --filter @postconet/worker start
```

Without a worker, monitors and hosted mocks remain local-only and are labeled as such in the UI.

## Tests

```bash
pnpm test
```

Auth, multi-client sync, and collaboration tests that need a live Supabase project are skipped unless `POSTCONET_IT_SUPABASE_URL` and two test users are set. See `docs/ACCEPTANCE.md`.
