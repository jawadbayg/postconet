# Architecture

PostConet API Studio is a local-first macOS desktop API client with optional cloud synchronization, team collaboration, and a separately deployable worker for workloads that cannot run in the desktop process.

Branding is loaded from `brand/brand.json`. Product name, protocol scheme, accent color, and user-agent are not hardcoded in UI copy except as defaults.

## Process boundaries

```
┌──────────────────────────────────────────────────────────────┐
│ Renderer (React, sandboxed, contextIsolation)                │
│  - UI, editors, layout persistence                           │
│  - Talks only through a validated preload IPC bridge         │
│  - No Node, filesystem, shell, or SQLite access              │
└──────────────────────────▲───────────────────────────────────┘
                           │ contextBridge + Zod IPC
┌──────────────────────────┴───────────────────────────────────┐
│ Preload                                                      │
│  - Exposes a small typed API                                 │
│  - Does not leak ipcRenderer or Node                         │
└──────────────────────────▲───────────────────────────────────┘
                           │ ipcMain.handle
┌──────────────────────────┴───────────────────────────────────┐
│ Main (Electron, Node)                                        │
│  - SQLite, Keychain/safeStorage, protocol engines            │
│  - Native HTTP (no CORS), cookies, certificates, proxies     │
│  - Sync, collaboration transport, OAuth loopback server      │
│  - Script workers, MCP process spawn (explicit trust only)   │
└─────────────┬──────────────────────────┬─────────────────────┘
              │ HTTPS (anon key)         │ HTTPS (service role)
              ▼                          ▼
     Supabase (Auth, Postgres,    Worker service
     Storage, Realtime, Edge      (monitors, hosted mocks,
     Functions)                   inbound webhooks)
```

The renderer never receives a Supabase service-role key. The desktop uses the project URL and anon key compiled in at build time. Privileged operations run in Edge Functions or the worker.

## Packages

| Package | Responsibility |
| --- | --- |
| `@postconet/core` | Shared types, Zod schemas, variable resolution, HTTP and protocol engines, auth helpers, importers/exporters, scripting sandbox API, runner, snippets, collaboration document helpers |
| `@postconet/persistence` | SQLite via Node `node:sqlite` (`DatabaseSync`), repositories, operation queue, history, cookies, secrets vault |
| `@postconet/desktop` | Electron main, preload, React renderer, macOS menus, packaging |
| `@postconet/cli` | Collection runner CLI sharing `@postconet/core` |
| `@postconet/worker` | Scheduled monitors, hosted mocks, webhook listeners |

## Data ownership

| Entity | Owner | Notes |
| --- | --- | --- |
| Profile | User | Auth user 1:1 |
| Organization | Owner membership | Teams, billing boundary |
| Membership / invitation | Organization | Roles: owner, administrator, editor, viewer |
| Personal workspace | User | Cannot be shared; survives org leave |
| Shared / private workspace | Organization | Membership + workspace ACLs |
| Project | Workspace | Optional grouping inside a workspace |
| Collection, folder, request, example, spec | Workspace (via project) | Syncable documents |
| Environment | Workspace | Shared values vs private local overrides |
| Cookie jar, tabs, layout, selected environment | User + machine | Personal execution state; not synced by default |
| Request history | User + machine | Local by default; cloud retention is opt-in |
| Secrets | User (local vault) or org (explicit share) | Default exports redact secrets |
| Comments, revisions, activity | Workspace | Syncable |
| Collaboration document | Workspace + entity | Yjs state persisted server-side |
| Monitor / hosted mock | Workspace | Executed by worker, not the desktop |

Moving an entity into another workspace is rejected unless the actor can edit both containers.

## Local persistence

Each signed-in account gets an isolated SQLite file:

```
~/Library/Application Support/<appId>/accounts/<userId>/studio.db
```

Logging out closes the database handle, wipes decrypted secrets from memory, and does not load another account’s file. Guest/offline-without-account data lives in `accounts/local/` and is never merged into a cloud account unless the user confirms an import.

Session tokens are encrypted with Electron `safeStorage` (macOS Keychain-backed) and stored beside the account directory. They are not written to SQLite in plaintext.

## Synchronization

Local writes are committed in a SQLite transaction and appended to a durable `ops_queue` with an idempotency key. When online:

1. Authenticate and refresh if needed.
2. Push queued operations through `sync-push` (server assigns monotonic `seq` / `version`).
3. Pull `change_log` rows after the last acknowledged cursor.
4. Subscribe to Realtime for live `change_log` and membership events.
5. Reconcile on reconnect, app resume, and a slow periodic fallback.

Conflict rules:

- Text fields in a request (URL, body, scripts, descriptions) use Yjs CRDTs when a collaboration session is active.
- Structured fields (method, folder parent, enabled flags, order) use server version checks. Concurrent incompatible updates create a recoverable conflict record instead of last-write-wins on client timestamps.
- Client clocks are never used to decide winners.
- An empty local database never deletes cloud data. Pull is the source of hydration after login.

Membership revocation is enforced by RLS, Edge Functions, Realtime membership events, and a local “cloud access revoked” path that drops the queue for that workspace and refuses further pushes.

## Networking

HTTP(S), HTTP/2, proxies, client certificates, custom CAs, cookies, and redirects execute in the main process using Node/undici so localhost and non-CORS APIs work. GraphQL queries/mutations reuse the HTTP engine; subscriptions use `graphql-ws`. Other protocols have dedicated clients in main.

Transport timings reported in the UI are only values the engine measured (total elapsed, time-to-first-byte when observed). DNS/TCP/TLS breakdowns are omitted unless the runtime actually exposes them.

## Scripting

Pre-request and post-response scripts run in a dedicated worker thread with:

- no `fs`, `child_process`, `net`, Electron, or SQLite bindings
- `vm` context with `codeGeneration.strings = false`
- wall-clock timeout, output cap, and worker memory limit
- an explicit `pm.*` surface documented in the compatibility matrix

Import and preview never execute scripts. Collection import stores script text only.

## Security defaults

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- Restrictive CSP; HTML response preview in a sandboxed iframe (`allow-scripts` without `allow-same-origin`)
- TLS verification on by default
- MCP stdio servers require an explicit trust prompt; collection import never spawns processes
- OAuth uses the system browser and a loopback callback with state + PKCE validation
- Hosted worker egress is restricted; desktop testing is unrestricted to the user’s own network

## Hosting honesty

Supabase Auth, Postgres, Storage, and Realtime cover account and document sync. They do not provide:

- always-on collection monitors while the Mac is closed (needs the worker)
- a public webhook intake URL (needs the worker)
- hosted mock hostnames (needs the worker or an Edge Function plus a public host)
- Apple notarization (needs an Apple Developer account)

The free Supabase tier is not a complete hosted platform and is subject to project pausing, connection limits, and function timeouts. See `docs/HOSTING.md`.
