import type { ChangeLogRow, SyncOp, SyncState } from "../types.js";

export interface SyncCursor {
  workspaceId: string;
  lastSeq: number;
}

export function nextBackoffMs(attempts: number): number {
  const base = Math.min(60_000, 500 * 2 ** Math.min(8, attempts));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

export function applyRemoteChanges(
  localVersions: Map<string, number>,
  rows: ChangeLogRow[],
  seenIdempotency: Set<string>
): { apply: ChangeLogRow[]; skip: ChangeLogRow[]; conflicts: ChangeLogRow[] } {
  const apply: ChangeLogRow[] = [];
  const skip: ChangeLogRow[] = [];
  const conflicts: ChangeLogRow[] = [];
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  for (const row of ordered) {
    if (seenIdempotency.has(row.idempotencyKey)) {
      skip.push(row);
      continue;
    }
    seenIdempotency.add(row.idempotencyKey);
    const current = localVersions.get(row.entityId) ?? 0;
    if (row.version < current) {
      skip.push(row);
      continue;
    }
    if (row.version === current && current !== 0) {
      conflicts.push(row);
      continue;
    }
    apply.push(row);
    localVersions.set(row.entityId, row.version);
  }
  return { apply, skip, conflicts };
}

export function shouldHydrateFromCloud(localEntityCount: number, cloudEntityCount: number): boolean {
  if (localEntityCount === 0 && cloudEntityCount > 0) return true;
  return false;
}

export function refuseEmptyOverwrite(localEntityCount: number, cloudEntityCount: number): boolean {
  return localEntityCount === 0 && cloudEntityCount > 0;
}

export function summarizeState(opts: { online: boolean; pending: number; conflicts: number; lastError: string | null }): SyncState {
  if (!opts.online) return "offline";
  if (opts.conflicts > 0) return "conflicted";
  if (opts.lastError) return "failed";
  if (opts.pending > 0) return "syncing";
  return "synchronized";
}

export function mergeQueue(existing: SyncOp[], incoming: SyncOp): SyncOp[] {
  const idx = existing.findIndex((op) => op.idempotencyKey === incoming.idempotencyKey);
  if (idx >= 0) return existing;
  return [...existing, incoming];
}
