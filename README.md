# PostConet API Studio

A production-oriented macOS desktop API client: real HTTP from the Electron main process, SQLite local-first storage, optional Supabase sync, team roles enforced in Postgres RLS, and a CLI that reuses the same runner.

This is not a UI mock. Sending a request executes on the machine’s network stack (localhost and non-CORS APIs included). Saving writes SQLite immediately and enqueues a durable sync operation.

## Branding

Edit `brand/brand.json` (keep `packages/core/src/brand.ts` in sync). The UI, protocol scheme, user-agent, and packaging `appId` are driven from that configuration.

The product mark is fixed at `resources/icons/postconet_logo.png`. That file is the favicon, window/dock icon, packaged macOS `.icns`, and in-app logo. Do not swap it per-screen.

## Quick start

```bash
pnpm install
cp .env.example apps/desktop/.env   # optional; needed for accounts/sync
pnpm --filter @postconet/core test
pnpm --filter @postconet/persistence test
pnpm dev
```

Continue **offline** from the sign-in screen if cloud is not configured. Accounts, sync, and sharing need one developer-owned Supabase project; follow the dashboard walkthrough in `docs/SETUP.md` before applying migrations. Never put a service-role key in the desktop app.

## Layout

| Path | Role |
| --- | --- |
| `apps/desktop` | Electron main (sandboxed renderer, IPC) |
| `apps/cli` | Collection runner CLI (`json` + JUnit, CI exit codes) |
| `apps/worker` | Hosted monitors, mocks, webhook intake |
| `packages/core` | Engines: HTTP, auth, import/export, scripts, protocols |
| `packages/persistence` | SQLite schema and repositories |
| `supabase/` | Migrations, RLS, Edge Functions |
| `docs/` | Architecture, feature matrix, hosting, acceptance |
| `fixtures/` | Labeled sample collections |

## What works without extra services

- Local workspaces, collections, folders, requests
- Real HTTP/HTTPS from main (variables, auth helpers, cookies, large-body cap)
- Postman Collection v2.1 / environment / cURL / OpenAPI / HAR import with issue reports
- Export (secrets omitted by default)
- Pre-request / post-response scripts in an isolated worker+vm sandbox
- Collection runner + CLI
- GraphQL-over-HTTP, SOAP XML, SSE, WebSocket (against local fixtures in tests)
- Offline SQLite and account isolation (`accounts/<userId>/studio.db`)

## What needs deployment credentials

| Feature | Requirement | If missing |
| --- | --- | --- |
| Register / sign in | Supabase project + deployed `register` function | Sign-in shows “cloud not configured”; local mode still works |
| Sync + second computer | Same + applied migrations | Queue stays local; status is `offline`/`failed` with the error |
| Team invites / RLS | Migrations + two test users | Live RLS tests skip unless `POSTCONET_IT_*` is set |
| Cloud monitors while the Mac is closed | `apps/worker` + service role | UI/worker respond that the worker is not configured |
| Signed+notarized DMG | Apple Developer ID | `pnpm pack:mac` builds unsigned artifacts; **not** notarized |

Never put a service-role key in the desktop app.

## Tests vs claims

Automated tests that actually run: `pnpm --filter @postconet/core test` and `pnpm --filter @postconet/persistence test`. They cover HTTP against a local fixture server, Postman round-trip, scripts/runner/JUnit, auth header helpers, variable precedence, sync conflict rules, Yjs merge, SSE/WebSocket/SOAP/GraphQL, and SQLite durability.

Auth email, two-client collaboration, and packaged macOS launch require a live project and a Mac build; those are listed as **not run** until you execute them. See `docs/ACCEPTANCE.md` and `docs/FEATURE_MATRIX.md`.

## License

MIT
