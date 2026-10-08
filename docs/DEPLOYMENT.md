# Deployment and macOS packaging

## Desktop

```bash
pnpm --filter @postconet/desktop build
pnpm pack:mac
```

Outputs unsigned `dmg` and `zip` for `x64` and `arm64` under `apps/desktop/release/`.

### Signing and notarization

Set:

```
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
CSC_LINK          # .p12
CSC_KEY_PASSWORD
```

Then set `mac.notarize: true` in `apps/desktop/electron-builder.yml` (or pass `--config.mac.notarize=true`). An unsigned build is **not** notarized; Gatekeeper will warn. Do not advertise it as a notarized app.

Auto-update uses `electron-updater` with `publish.url` in the builder config. Host `latest-mac.yml` and the artifacts on HTTPS. There is no update feed until you publish one.

## Supabase

```bash
npx supabase db push
npx supabase functions deploy sync-push
npx supabase functions deploy sync-pull
npx supabase functions deploy invite-accept
npx supabase functions deploy account-delete
npx supabase functions deploy secret-unwrap
npx supabase functions deploy monitor-dispatch
npx supabase functions deploy public-docs
```

Set function secrets: `SUPABASE_SERVICE_ROLE_KEY` (account-delete, public-docs), `WORKER_PUBLIC_BASE_URL`.

Enable Realtime on `change_log`, `collab_updates`, `presence`, `memberships`, `workspace_members`.

## Worker

Deploy `apps/worker` as a long-running Node service. See `docs/HOSTING.md`.

## Backups

See `docs/BACKUP.md`.
