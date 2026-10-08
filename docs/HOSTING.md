# Hosting requirements

## What the desktop binary contains

- Renderer, main process, protocol engines, SQLite, script worker
- Supabase **anon** key and project URL (public by design, protected by RLS)

It does **not** contain a service-role key, Apple signing credentials, or SMTP credentials.

## Supabase (required for accounts and cloud sync)

Provision a project and apply `supabase/migrations`. Configure:

- Auth: email/password, confirmations, redirect URLs
- RLS: enabled on every client-accessible table (enforced in migrations)
- Realtime: enabled for `change_log`, `collab_updates`, `presence`, `memberships`
- Storage: private buckets `attachments` and `backups` with policies in migrations
- Edge Functions: `invite-accept`, `account-delete`, `sync-push`, `sync-pull`, `secret-unwrap`, `monitor-dispatch`, `public-docs`, `share-invite`, `share-accept`, `share-manage`, `share-landing`

**Free tier limits:** projects may pause, Edge Functions have CPU/wall-clock limits, Realtime connections are capped, and outbound email uses a shared SMTP path with rate limits. This application will not pretend those services are unlimited or always on.

Cloud-shared secrets use server-side envelope encryption in Postgres (`pgp_sym_encrypt` or application-level AES-GCM with a function secret). That is **not** end-to-end encryption: project administrators with the function secret can decrypt. Describe it as “encrypted at rest with server-side keys.”

## Worker (required for true cloud monitors, hosted mocks, public webhooks)

Deploy `apps/worker` to any always-on Node host (Fly.io, Cloud Run, a VM). Set:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (never ship to clients)
- `WORKER_PUBLIC_BASE_URL`
- `MONITOR_SECRET_ENCRYPTION_KEY`
- Optional `ALLOWED_EGRESS_CIDRS` — hosted runs should not reach RFC1918 unless you deliberately allow it

Hosted runners enforce request count, timeout, and credential isolation. Desktop execution still allows localhost.

If the worker URL is unset, the UI marks cloud monitors/hosted mocks **unavailable: worker not configured**.

## Apple signing and notarization

`electron-builder` is configured for `dmg` + `zip`, `x64` + `arm64`. Signing requires:

- Developer ID Application certificate
- App-specific notarization credentials (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`)

An unsigned local build is **not** notarized. Gatekeeper will warn. Documented in `docs/DEPLOYMENT.md`.

## Email

**Auth** (sign-up verification, password reset): Supabase Auth. Configure custom SMTP under Authentication → SMTP Settings for production. The desktop app does not send these.

**Sharing invitations**: Resend, called from the `share-invite` Edge Function. Set `RESEND_API_KEY`, `INVITE_FROM_EMAIL`, and `APP_INVITE_URL` as **Edge Function secrets**. Do not expect Auth emails to deliver collection-share links. Recipients on Gmail, Outlook, and custom domains use the same HTML button; access is bound to the verified inbox that received the invite.

Never put Resend or service-role credentials in the desktop binary. See `docs/SETUP.md`.
