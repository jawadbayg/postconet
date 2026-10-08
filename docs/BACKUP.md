# Backups

## Local native backup

The engine in `packages/core/src/importers/backup.ts` writes a versioned `postconet-backup` blob:

- `manifest.json` with SHA-256 checksums
- `workspace.json`
- optional `attachments/` with `..` path rejection on extract
- optional AES-256-GCM passphrase wrapper (`PCNE` magic)

Default exports **exclude** local secret values. The UI must warn before `includeSecrets: true`.

## Cloud

Use your Supabase project's PITR (paid) or nightly `pg_dump` of the project database. Storage buckets `attachments` and `backups` are private.

Do not treat ordinary Postgres + Storage as end-to-end encryption. Shared secrets are encrypted at rest with server-side keys.

## Restore

1. Extract with `extractBackup`.
2. Verify checksums (throws on mismatch).
3. Preview via `detectAndImport`.
4. Commit inside a SQLite transaction (`import.commit`).
