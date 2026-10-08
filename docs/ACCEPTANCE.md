# Acceptance scenarios

Do not mark a row **passed** unless that check actually ran. Distinguish:

- **Automated** — executed by `pnpm --filter @postconet/core test` or persistence tests
- **Blocked** — implementation exists; external credential or second machine required
- **Manual** — must be run on macOS by a person

| # | Scenario | Status in this repo | How to run |
| --- | --- | --- | --- |
| 1 | Register, verify email, sign in, reset password | Blocked on Supabase Auth | Configure project (`docs/SETUP.md`), use Inbucket locally |
| 2 | Create workspace, environment, collection, folder, request | Automated (SQLite repo) + UI path implemented | Persistence test; `pnpm dev` for UI |
| 3 | Send real requests and inspect responses | Automated against local fixture HTTP server | `packages/core/test/http.test.ts` |
| 4 | Import and execute a representative Postman collection | Automated import; execute via runner | `import-export.test.ts`, `scripting.test.ts` |
| 5 | Export and re-import | Automated | `import-export.test.ts` |
| 6 | Edit offline, restart, reconnect, sync | SQLite restart automated; cloud reconnect blocked | Persistence test; needs live project for sync |
| 7 | Sign in on a second computer and retrieve cloud data | Implemented (`hydrateFromCloud` after login); not executed here | Two machines + same account |
| 8 | Invite another user; editor/viewer permissions | RLS + invite function implemented; live test skipped without tokens | `tests/integration/rls.test.ts` when `POSTCONET_IT_*` set |
| 9 | Concurrent request edit without silent loss | Automated Yjs + structured conflict records | `sync-collab.test.ts` |
| 10 | Revoke membership; reject further access | RLS + queue drop implemented; live test skipped | Same as 8 |
| 11 | Scripts and datasets, pass/fail reports | Automated | `scripting.test.ts` |
| 12 | Protocols against fixtures | HTTP, GraphQL, SOAP, SSE, WebSocket automated. MQTT/gRPC/MCP/Socket.IO implemented in engines; need broker/server to execute | `protocols.test.ts` |
| 13 | Private secrets absent from default export | Automated | `secrets-export.test.ts` |
| 14 | Failed uploads, missed events, interrupted sync | Queue retry + change-log seq + idempotency keys automated; live reconnect blocked | `sync-collab.test.ts` |
| 15 | Packaged macOS app | `electron-builder` configured; **not built or notarized in this session** | `pnpm pack:mac` on a Mac with Xcode CLT |

## Last automated run

Executed on 2026-10-09 in this workspace:

```
pnpm --filter @postconet/core test          # 28 passed
pnpm --filter @postconet/persistence test   # 1 passed
pnpm --filter @postconet/desktop build      # succeeded (electron-vite)
pnpm --filter @postconet/cli exec tsx src/index.ts --help
```

Not executed: live Supabase email/auth, two-client sync, packaged notarized DMG, MQTT broker, gRPC reflection server.
