import { describe, expect, it } from "vitest";
import {
  applyRemoteChanges,
  cloudSortOrder,
  evaluatePush,
  mergeQueue,
  refuseEmptyOverwrite,
  sameEntityContent,
  summarizeState,
  syncStatusLabel,
  tabOnRemoteUpdate
} from "../src/sync/engine.js";
import { createRequestDoc, encodeState, applyUpdate, readFields, mergeStructured, setField } from "../src/collab/document.js";
import type { ChangeLogRow, SyncOp } from "../src/types.js";

describe("sync", () => {
  it("never treats empty local as a wipe of populated cloud", () => {
    expect(refuseEmptyOverwrite(0, 10)).toBe(true);
    expect(refuseEmptyOverwrite(3, 10)).toBe(false);
  });

  it("applies change log in seq order and skips duplicate idempotency keys", () => {
    const rows: ChangeLogRow[] = [
      { seq: 2, workspaceId: "w", entityType: "request", entityId: "r1", op: "upsert", version: 2, payload: {}, actorId: "u", idempotencyKey: "a", createdAt: "" },
      { seq: 1, workspaceId: "w", entityType: "request", entityId: "r1", op: "upsert", version: 1, payload: {}, actorId: "u", idempotencyKey: "b", createdAt: "" },
      { seq: 3, workspaceId: "w", entityType: "request", entityId: "r1", op: "upsert", version: 3, payload: {}, actorId: "u", idempotencyKey: "b", createdAt: "" }
    ];
    const { apply, skip } = applyRemoteChanges(new Map(), rows, new Set());
    expect(apply.map((r) => r.seq)).toEqual([1, 2]);
    expect(skip.some((r) => r.seq === 3)).toBe(true);
    expect(summarizeState({ online: true, pending: 0, conflicts: 0, lastError: null })).toBe("synchronized");
  });

  it("skips equal or older remote versions so echoes do not loop", () => {
    const { apply, skip } = applyRemoteChanges(new Map([["r1", 4]]), [
      { seq: 9, workspaceId: "w", entityType: "request", entityId: "r1", op: "upsert", version: 4, payload: {}, actorId: "u", idempotencyKey: "echo", createdAt: "" }
    ], new Set());
    expect(apply).toHaveLength(0);
    expect(skip).toHaveLength(1);
  });
});

describe("concurrent save versions", () => {
  it("lets the first save of a base version apply and rejects the second", () => {
    const current = { version: 1, deletedAt: null };
    expect(evaluatePush(current, { op: "upsert", version: 2, baseVersion: 1 })).toBe("apply");
    expect(evaluatePush({ version: 2, deletedAt: null }, { op: "upsert", version: 2, baseVersion: 1 })).toBe("conflict");
  });

  it("does not recreate a deleted item from a stale upsert", () => {
    expect(evaluatePush({ version: 3, deletedAt: "2026-01-01" }, { op: "upsert", version: 3, baseVersion: 2 })).toBe("deleted");
  });

  it("does not let a stale delete undo a newer move", () => {
    expect(evaluatePush({ version: 5, deletedAt: null }, { op: "delete", version: 4, baseVersion: 3 })).toBe("conflict");
  });

  it("treats a second delete of an already-deleted row as applied", () => {
    expect(evaluatePush({ version: 4, deletedAt: "x" }, { op: "delete", version: 4, baseVersion: 3 })).toBe("already_deleted");
  });

  it("creates a missing row even when local version already advanced", () => {
    expect(evaluatePush(null, { op: "upsert", version: 1, baseVersion: 0 })).toBe("apply");
    expect(evaluatePush(null, { op: "upsert", version: 4, baseVersion: 3 })).toBe("apply");
  });

  it("fits Date.now() folder/request sort keys into a Postgres integer", () => {
    expect(cloudSortOrder(Date.now())).toBeLessThanOrEqual(2_147_483_647);
    expect(cloudSortOrder(1_760_000_000_000)).toBe(1_760_000_000);
    expect(cloudSortOrder(12)).toBe(12);
  });

  it("treats version-only drift as the same content", () => {
    const a = { id: "r", name: "login", version: 7, updatedAt: "a", document: { method: "POST", url: "/x", body: { raw: "{}" } } };
    const b = { ...a, version: 8, updatedAt: "b" };
    expect(sameEntityContent(a, b)).toBe(true);
    expect(sameEntityContent(a, { ...b, document: { ...a.document, method: "GET" } })).toBe(false);
    expect(sameEntityContent(a, null)).toBe(false);
  });

  it("keeps a dirty tab draft and replaces a clean tab", () => {
    expect(tabOnRemoteUpdate({ dirty: false })).toBe("replace");
    expect(tabOnRemoteUpdate({ dirty: true })).toBe("keep_draft");
  });

  it("maps sync state to the four status labels", () => {
    expect(syncStatusLabel("offline", true)).toBe("Offline");
    expect(syncStatusLabel("syncing", true)).toBe("Syncing");
    expect(syncStatusLabel("synchronized", true)).toBe("Synced");
    expect(syncStatusLabel("failed", true)).toBe("Sync failed");
    expect(syncStatusLabel("conflicted", true)).toBe("Sync failed");
    expect(syncStatusLabel("synchronized", false)).toBe("Offline");
  });

  it("coalesces queued edits for the same entity without duplicating keys", () => {
    const first = {
      id: "1",
      idempotencyKey: "k1",
      entityType: "request",
      entityId: "r1",
      workspaceId: "w",
      op: "upsert",
      payload: { name: "A" },
      version: 2,
      baseVersion: 1,
      createdAt: "1",
      attempts: 0,
      lastError: null,
      status: "pending"
    } as SyncOp;
    const second = { ...first, id: "2", idempotencyKey: "k2", payload: { name: "B" }, version: 3, createdAt: "2" };
    const merged = mergeQueue([first], second);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.payload).toEqual({ name: "B" });
    expect(merged[0]?.baseVersion).toBe(1);
    expect(merged[0]?.idempotencyKey).toBe("k1");
  });
});

describe("collaboration", () => {
  it("merges concurrent text edits without silent drop", () => {
    const doc = createRequestDoc({ url: "https://a.test" });
    const replica = createRequestDoc();
    applyUpdate(replica, encodeState(doc));
    const a = createRequestDoc();
    applyUpdate(a, encodeState(doc));
    setField(doc, "url", "https://a.test/one");
    setField(replica, "url", "https://a.test/two");
    applyUpdate(doc, encodeState(replica));
    applyUpdate(replica, encodeState(doc));
    const text = readFields(doc).url ?? "";
    expect(text.includes("https://a.test")).toBe(true);
    const structured = mergeStructured(
      { version: 4, method: "GET", parent: "x" },
      { version: 4, method: "POST", parent: "y" },
      ["method", "parent"]
    );
    expect(structured.conflicts.length).toBeGreaterThan(0);
  });
});
