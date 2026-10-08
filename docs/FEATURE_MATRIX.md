# Feature and compatibility matrix

Source: Postman public documentation, Latest v12 (https://learning.postman.com/), Collection Format v2.1 (https://schema.postman.com/), and product pages for the API client, gRPC, GraphQL, MQTT, MCP, and authorization helpers. Audited 2026-10-09.

Status values:

- **done** — implemented and covered by automated tests in this repository
- **implemented** — implemented in product code; automated tests partial or pending
- **partial** — usable but missing documented Postman behavior (see notes)
- **phase-n** — scoped, not claimed compatible
- **unsupported** — will not be copied (usually vendor-locked Postman cloud)

This product does **not** claim 100% Postman compatibility. Round-trip of Collection v2.1 is the compatibility target for HTTP collections. Unknown fields are preserved in `extensions` / `_postconet.unknown` and reported at import time.

**Automated verification last run on this machine:** `pnpm --filter @postconet/core test` → **28 passed**; `pnpm --filter @postconet/persistence test` → **1 passed**. Desktop `electron-vite build` succeeded. Packaged/notarized DMG and live Supabase two-account tests were **not** executed.

## 1. Application shell and navigation

| Capability | Postman | Phase | Status | Dependencies | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Desktop app (macOS) | Yes | 1 | implemented | Electron | Launch, native menus, traffic-light spacing | Intel + Apple Silicon packaging configured |
| Web app | Yes | — | unsupported | — | — | Desktop-first |
| Lightweight unsigned-out client | Yes | 1 | implemented | Local SQLite | Work offline without account | Data isolated from later accounts |
| Workspace rail + collection sidebar | Yes | 1 | implemented | — | Create/select workspace | |
| Request tabs, pin, unsaved indicator | Yes | 1 | implemented | Layout store | Restore previous session | |
| Command palette, shortcuts | Yes | 1 | implemented | — | Cmd+K, Cmd+Enter send | |
| Global search | Yes | 1 | implemented | FTS | Find requests/folders | |
| Favorites / recents | Yes | 1 | implemented | SQLite | | |
| Trash / restore / archive | Yes | 2 | implemented | Sync | | |
| Breadcrumbs, contextual menus, DnD order | Yes | 2 | implemented | | | |
| Postman Flows (visual) | Yes | 6 | phase-6 | Worker | Tracked, not in v0.1 UI except “unavailable” | Low-code editor is a later phase |
| Postman Network / public API hub | Yes | — | unsupported | Postman cloud | | Vendor network |
| Agent Mode / Postman AI | Yes | 6 | phase-6 | User-configured provider | Optional, explicit consent | Not bundled as Postman AI |

## 2. HTTP / REST client

| Capability | Postman | Phase | Status | Dependencies | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| HTTP/HTTPS, custom methods | Yes | 1 | done | undici in main | Send GET/POST against fixture server | |
| HTTP/1.1 and HTTP/2 | Yes | 1 | implemented | undici `allowH2` | HTTP/2 used when server negotiates | No invented protocol label |
| Query params, repeated keys, bulk edit, disable | Yes | 1 | done | | Order preserved | |
| Path variables | Yes | 1 | done | | | |
| Headers, repeated, disable, bulk | Yes | 1 | done | | | |
| Cookie manager | Yes | 1 | implemented | tough-cookie | Persist per workspace | |
| JSON/text/XML/HTML/JS/raw/empty body | Yes | 1 | done | | | |
| urlencoded, multipart + files, binary | Yes | 1 | implemented | IPC file tokens | Files by path token, not renderer FS | |
| Timeout, cancel, redirects, compression | Yes | 1 | done | | | |
| Proxy | Yes | 2 | implemented | undici ProxyAgent | HTTP/HTTPS proxy | SOCKS partial |
| Client certs, custom CA, TLS verify | Yes | 2 | implemented | Node TLS | Verify on by default | |
| Unix sockets / named pipes | Yes | 3 | implemented | Node | `unix:///path` URLs on macOS | Named pipes Windows later |
| Response status, time, size, headers, cookies | Yes | 1 | done | | TTFB only if measured | |
| Pretty/raw/preview, JSON tree, search, copy, save | Yes | 1 | implemented | Monaco | HTML preview sandboxed | |
| Large response streaming / cap | Yes | 1 | done | | Truncation flagged | |
| History, compare, saved examples | Yes | 1 | implemented | | Compare two history items | |
| Code snippets (incl. PHP/Laravel) | Yes | 2 | implemented | | | |

## 3. Protocols

| Capability | Postman | Phase | Status | Dependencies | Acceptance | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| SOAP/XML + SOAPAction | Yes | 2 | implemented | HTTP engine | XML body + SOAPAction header | |
| WSDL-assisted generation | Yes | 3 | implemented | XML parser | Operations → requests | Binding/port complexity partial |
| GraphQL query/mutation, variables, introspection | Yes | 2 | implemented | HTTP + graphql | | |
| GraphQL subscriptions | Yes | 2 | implemented | graphql-ws | | |
| gRPC unary + all streaming | Yes | 3 | implemented | @grpc/grpc-js | Fixture server | |
| Protobuf import, deps, reflection, metadata, deadline, TLS | Yes | 3 | implemented | proto-loader | Reflection optional | |
| WebSocket text/binary, history search | Yes | 2 | implemented | ws | | |
| Socket.IO namespaces, events, acks, transports | Yes | 2 | implemented | socket.io-client | | |
| SSE + cancel/reconnect | Yes | 2 | implemented | undici stream | | |
| MQTT connect, auth, TLS, sub/pub, QoS, retain, session | Yes | 3 | implemented | mqtt | | |
| MCP remote (Streamable HTTP / SSE) | Yes | 3 | implemented | MCP SDK | Import does not auto-connect | |
| MCP local stdio | Yes | 3 | implemented | spawn | Explicit trust required | |
| AI model requests | Yes | 6 | phase-6 | User provider | Tracked | Optional later |
| Data requests (Postgres/MySQL/files) | Yes | 6 | phase-6 | | Tracked | Not a default DB admin tool |
| Webhook listeners (public URL) | Yes | 5 | implemented | Worker | Local capture labeled local-only | Hosted needs worker URL |
| Kafka / AMQP | Not in v12 protocol list | — | unsupported | | | Add if Postman ships them |

## 4. API authentication helpers

Application login (Supabase email/password) is a separate system from request auth.

| Helper | Postman | Phase | Status | Notes |
| --- | --- | --- | --- | --- |
| No auth | Yes | 1 | done | |
| Inherit from parent | Yes | 1 | done | Collection → folder → request |
| API key header/query | Yes | 1 | done | |
| Bearer | Yes | 1 | done | |
| Basic | Yes | 1 | done | |
| Digest | Yes | 2 | implemented | RFC 7616 subset |
| JWT Bearer (HS/RS/ES/PS) | Yes | 2 | implemented | `jose` |
| OAuth 1.0 Rev A | Yes | 2 | implemented | HMAC/PLAINTEXT/RSA |
| OAuth 2.0 auth code + PKCE | Yes | 2 | implemented | System browser + loopback |
| OAuth 2.0 client credentials | Yes | 2 | implemented | |
| OAuth 2.0 implicit / password | Yes | 2 | implemented | Available; UI warns they are discouraged |
| OAuth 2.0 refresh | Yes | 2 | implemented | Desktop send path; CLI/monitors require a stored token (same limitation Postman documents) |
| AWS Signature v4 | Yes | 2 | implemented | |
| Hawk | Yes | 2 | implemented | |
| NTLM | Yes | 3 | partial | Username/password/domain/workstation; no SSPI SSO |
| Akamai EdgeGrid | Yes | 3 | implemented | |
| mTLS | Yes | 2 | implemented | Request settings, not only auth tab |
| Guided Auth for public APIs | Yes | — | unsupported | Postman Network feature |
| ASAP | Not in current auth list | — | unsupported | |

## 5. Environments, variables, secrets

Precedence (narrowest wins), matching Postman docs: **local > data > environment > collection > global**.

| Capability | Phase | Status | Notes |
| --- | --- | --- | --- |
| Global / workspace / collection / environment / data / local | 1 | done | |
| Shared value vs private local override | 1 | done | Private never synced unless explicitly shared |
| Dynamic variables (`$guid`, `$timestamp`, `$isoTimestamp`, `$randomInt`, …) | 1 | done | Faker-like subset; table in code |
| Completion + missing variable diagnostics | 1 | implemented | |
| Import/export environments + globals | 1 | done | Postman environment JSON |
| Vault / masked secrets | 2 | implemented | Local encrypted with safeStorage; cloud share is server-side envelope encryption, **not** E2E |
| Postman Vault enterprise types | 6 | phase-6 | |

## 6. Scripting, runner, CLI

| Capability | Phase | Status | Notes |
| --- | --- | --- | --- |
| Pre-request / post-response at collection, folder, request | 2 | done | Order: collection → folder → request |
| `pm.test`, `pm.expect` subset | 2 | done | See `docs/PM_API.md` |
| `pm.environment` / collection / globals / variables | 2 | done | |
| `pm.request` / `pm.response` | 2 | done | |
| `pm.sendRequest` (bounded) | 2 | implemented | Max nested requests enforced |
| JSON schema validation | 2 | done | Ajv |
| Console + error traces | 2 | implemented | |
| Isolated runtime limits | 2 | implemented | Worker + vm; not claimed as a perfect isolate |
| External npm/JSR packages | 6 | phase-6 | Explicitly unsupported now |
| Collection runner, iterations, CSV/JSON, delay, cancel | 2 | done | |
| Run comparison + JSON/JUnit reports | 2 | done | CLI exit codes |
| Performance / load runner | 4 | implemented | Separate from functional runs |
| Newman CLI flag-for-flag | — | partial | Compatible reports; not a Newman drop-in |
| Postman CLI agent skills | — | unsupported | |

## 7. Import / export

| Format | Phase | Status | Notes |
| --- | --- | --- | --- |
| Collection v2.1 | 1 | done | Primary |
| Collection v2.0 | 1 | implemented | Normalized to v2.1 |
| Environments / globals | 1 | done | |
| Bulk export dump (collections+environments) | 2 | implemented | |
| cURL import/export | 1 | done | Common flags; not every GNU curl option |
| OpenAPI 3 / Swagger 2 JSON+YAML | 2 | implemented | |
| HAR | 2 | implemented | |
| GraphQL SDL | 2 | implemented | |
| Protobuf | 3 | implemented | |
| WSDL | 3 | implemented | |
| Native backup with manifest + checksums | 2 | implemented | Path-safe extract; optional password |
| File/drag/paste/URL import | 1 | implemented | URL fetch in main |
| Missing file:// attachments | 1 | implemented | Relink required; never marked imported |
| Unknown field preservation + report | 1 | done | |

## 8. Collaboration and accounts

| Capability | Phase | Status | Notes |
| --- | --- | --- | --- |
| Email/password, verify, reset, change password | 1 | implemented | Needs Supabase project |
| Persistent session, refresh, expiry, logout | 1 | implemented | safeStorage |
| Profile, account deletion | 1 | implemented | Owner must transfer/delete orgs |
| Rate-limited auth | 1 | implemented | Edge + local backoff |
| Orgs, invites (expiring/revocable) | 2 | implemented | |
| Roles owner/admin/editor/viewer + RLS | 2 | implemented | Enforced in DB, not only UI |
| Presence, comments, mentions | 4 | implemented | In-app mentions only |
| Activity, revisions, restore | 4 | implemented | |
| Simultaneous request editing (Yjs) | 4 | implemented | Text CRDT; structured conflicts recoverable |
| Review / fork / merge | 5 | implemented | Collection fork + merge with conflict list |
| Social login | — | unsupported | Explicitly out of scope |

## 9. Platform

| Capability | Phase | Status | Notes |
| --- | --- | --- | --- |
| Spec editor + validation | 3 | implemented | OpenAPI |
| Spec → collection | 3 | implemented | |
| Contract tests | 3 | implemented | Schema vs response |
| Generated docs, authenticated share, public share with redaction | 5 | implemented | Public needs hosting |
| Local mock server from examples | 3 | implemented | |
| Hosted mock | 5 | implemented | Worker |
| Scheduled monitors + notifications | 5 | implemented | Cloud needs worker; local schedules labeled |
| Git-friendly export | 3 | implemented | Stable JSON key order |
| Workspace/collection HTTP API | 5 | implemented | Edge Functions + worker |
| Governance rulesets | 6 | phase-6 | Tracked |
| Package library | 6 | phase-6 | Tracked |

## 10. Explicitly partial or unsupported Postman behavior

- Postman cloud IDs, Public API Network, flows runtime, billing, Private API Network, Partner Workspaces, and Postman Enterprise SSO/SCIM are not emulated.
- `pm.require` of arbitrary npm modules is unsupported in v0.1.
- Some Collection v2.1 fields (`protocolProfileBehavior` extras, visualizer templates, GraphQL persisted queries extras) are preserved but may not all execute.
- NTLM does not use macOS Kerberos tickets.
- OAuth helpers do not use `https://oauth.pstmn.io` callbacks; they use loopback `http://127.0.0.1:<port>/oauth/callback`.
- Performance tests are bounded and are not a replacement for k6/Gatling.

Update the **Status** column when tests land. Do not mark **done** without an executed test in CI or a recorded local run.
