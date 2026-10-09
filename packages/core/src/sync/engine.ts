import type { ChangeLogRow, SyncOp, SyncState } from "../types.js";

export interface SyncCursor {
  workspaceId: string;
  lastSeq: number;
}

export type PushDecision = "apply" | "conflict" | "deleted" | "already_deleted";
export type TabRemoteDecision = "replace" | "keep_draft";
export type SyncStatusLabel = "Syncing" | "Synced" | "Offline" | "Sync failed";

export function nextBackoffMs(attempts: number): number {
  const base = Math.min(60_000, 500 * 2 ** Math.min(8, attempts));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

export function expectedBaseVersion(newVersion: number): number {
  return Math.max(0, newVersion - 1);
}

/** Server-side decision: never last-write-wins, never undelete from a stale upsert. */
export function evaluatePush(
  current: { version: number; deletedAt?: string | null } | null,
  op: { op: "upsert" | "delete"; version: number; baseVersion?: number | null }
): PushDecision {
  const base = op.baseVersion ?? expectedBaseVersion(op.version);
  if (!current) {
    if (op.op === "delete") return "already_deleted";
    return "apply";
  }
  if (current.deletedAt) {
    if (op.op === "delete") return "already_deleted";
    return "deleted";
  }
  if (Number(current.version) !== Number(base)) return "conflict";
  return "apply";
}

const PG_INT_MAX = 2_147_483_647;

/** Folders/requests use Date.now() locally; Postgres integer cannot store millisecond timestamps. */
export function cloudSortOrder(value: unknown): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n <= PG_INT_MAX) return n;
  return Math.min(PG_INT_MAX, Math.trunc(n / 1000));
}

const VOLATILE_ENTITY_KEYS = new Set(["version", "updatedAt", "createdAt", "updated_at", "created_at", "sortOrder", "sort_order"]);

function stableJson(value: unknown, top: boolean): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v, false)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => v !== undefined && !(top && VOLATILE_ENTITY_KEYS.has(k)))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v, false)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** True when two copies of an entity differ only in version / timestamps / sort position. */
export function sameEntityContent(a: unknown, b: unknown): boolean {
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  return stableJson(a, true) === stableJson(b, true);
}

export function tabOnRemoteUpdate(tab: { dirty: boolean }): TabRemoteDecision {
  return tab.dirty ? "keep_draft" : "replace";
}

export function syncStatusLabel(state: SyncState | string | undefined, cloudConfigured: boolean): SyncStatusLabel {
  if (!cloudConfigured) return "Offline";
  if (state === "offline") return "Offline";
  if (state === "failed" || state === "conflicted") return "Sync failed";
  if (state === "syncing") return "Syncing";
  return "Synced";
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
    if (row.version <= current) {
      skip.push(row);
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
  if (opts.lastError) return "failed";
  if (opts.pending > 0) return "syncing";
  if (opts.conflicts > 0) return "conflicted";
  return "synchronized";
}

export function mergeQueue(existing: SyncOp[], incoming: SyncOp): SyncOp[] {
  const idx = existing.findIndex((op) => op.idempotencyKey === incoming.idempotencyKey);
  if (idx >= 0) return existing;
  const sameEntity = existing.findIndex(
    (op) => op.entityId === incoming.entityId && (op.status === "pending" || op.status === "failed")
  );
  if (sameEntity >= 0) {
    const prev = existing[sameEntity]!;
    const next = [...existing];
    next[sameEntity] = {
      ...prev,
      payload: incoming.payload,
      version: incoming.version,
      op: incoming.op,
      createdAt: incoming.createdAt
    };
    return next;
  }
  return [...existing, incoming];
}
