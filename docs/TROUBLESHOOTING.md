# Troubleshooting

## App will not start

- Node 20.19+ required
- `pnpm install`. Local SQLite uses Node's built-in `node:sqlite` (Node 22.12+ / Electron 35+). No native `better-sqlite3` rebuild is required.

## Cannot sign in

- Desktop only uses the build-time anon key. Users should never paste a project URL into the login form.
- Confirm Auth email provider, redirect URLs, and that the mailbox (Inbucket locally) received the message.
- Rate limiting: wait for the Auth throttle window.

## Requests fail to localhost

Requests run in the **main** process. If it still fails, check the URL after variable substitution, TLS verify, and proxy settings. CORS is not involved.

## Sync stuck

Status bar shows `offline`, `syncing`, `synchronized`, `failed`, or `conflicted`. Failed ops remain in `ops_queue`. Use Sync to retry. Expired sessions clear Keychain-backed `session.bin` and return to sign-in.

Empty local databases never wipe a populated cloud workspace. After login the app **downloads** first.

## Membership revoked

Queued cloud ops for that workspace are marked `rejected`. Further `sync-push` calls fail RLS (`forbidden`).

## HTML preview

Untrusted HTML renders in a sandboxed iframe without `allow-same-origin`. It cannot read the app.

## MCP

Importing a collection never starts a process. Local stdio requires an explicit trust flag (`trusted: true`).
