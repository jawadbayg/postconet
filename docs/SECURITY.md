# Security

- Renderer: `sandbox`, `contextIsolation`, `nodeIntegration: false`, no remote module
- Preload exposes `invoke` / `on` only
- IPC payloads validated with Zod in the main process
- Session tokens: Electron `safeStorage` (macOS Keychain when available)
- Per-account SQLite directories
- TLS verification default on
- OAuth: system browser + loopback callback; validate `state`; PKCE for auth code
- Scripts: dedicated limits, no `fs`/`child_process`/`eval`
- Hosted worker: deny localhost and RFC1918 unless allow-listed
- Service role key: Edge Functions and worker only
- Default exports redact secrets
- Cloud shared secrets: server-side encryption at rest, not E2E

Report issues privately to the address in `brand/brand.json`.
