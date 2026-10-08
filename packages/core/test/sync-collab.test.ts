import { describe, expect, it } from "vitest";
import { applyRemoteChanges, refuseEmptyOverwrite, summarizeState } from "../src/sync/engine.js";
import { createRequestDoc, encodeState, applyUpdate, readFields, mergeStructured, setField } from "../src/collab/document.js";
import type { ChangeLogRow } from "../src/types.js";

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
