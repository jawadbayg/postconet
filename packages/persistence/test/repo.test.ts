import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase, StudioRepo } from "../src/index.js";
import { createId, nowIso, emptyAuth, emptyScripts, emptyHttpDocument, type Workspace, type Folder } from "@postconet/core";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.length = 0;
});

describe("sqlite repo", () => {
  it("persists workspace/collection/request and queues sync ops", () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-"));
    dirs.push(dir);
    const db = openDatabase(join(dir, "studio.db"));
    const repo = new StudioRepo(db, "acct");
    const ws: Workspace = {
      id: createId("ws"),
      name: "Personal",
      kind: "personal",
      organizationId: null,
      ownerUserId: "acct",
      archivedAt: null,
      deletedAt: null,
      version: 1,
      updatedAt: nowIso(),
      createdAt: nowIso()
    };
    repo.transaction(() => {
      repo.upsertWorkspace(ws);
      repo.upsertCollection({
        id: "col1",
        workspaceId: ws.id,
        projectId: null,
        name: "API",
        auth: emptyAuth("none"),
        variables: [],
        scripts: emptyScripts(),
        favorite: false,
        archivedAt: null,
        deletedAt: null,
        version: 1,
        updatedAt: nowIso(),
        createdAt: nowIso()
      });
    });
    expect(repo.listWorkspaces()).toHaveLength(1);
    expect(repo.listCollections(ws.id)[0]?.name).toBe("API");
    expect(repo.pendingOps().length).toBeGreaterThan(0);
    closeDatabase(db);
    const db2 = openDatabase(join(dir, "studio.db"));
    const repo2 = new StudioRepo(db2, "acct");
    expect(repo2.listCollections(ws.id)[0]?.name).toBe("API");
    closeDatabase(db2);
  });

  it("coalesces pending sync ops for the same request and keeps the original base version", () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-"));
    dirs.push(dir);
    const db = openDatabase(join(dir, "studio.db"));
    const repo = new StudioRepo(db, "acct");
    const req = {
      id: createId("req"),
      workspaceId: createId("ws"),
      collectionId: createId("col"),
      folderId: null,
      projectId: null,
      name: "One",
      protocol: "http" as const,
      sortOrder: 1,
      document: emptyHttpDocument(),
      examples: [],
      favorite: false,
      archivedAt: null,
      deletedAt: null,
      version: 2,
      updatedAt: nowIso(),
      createdAt: nowIso()
    };
    repo.upsertRequest(req);
    req.name = "Two";
    req.version = 3;
    repo.upsertRequest(req);
    const ops = repo.pendingOps();
    expect(ops).toHaveLength(1);
    expect(ops[0]?.version).toBe(3);
    expect(ops[0]?.baseVersion).toBe(1);
    expect((ops[0]?.payload as { name: string }).name).toBe("Two");
    closeDatabase(db);
  });

  it("tracks folder descendants and persists collection moves", () => {
    const dir = mkdtempSync(join(tmpdir(), "pc-"));
    dirs.push(dir);
    const db = openDatabase(join(dir, "studio.db"));
    const repo = new StudioRepo(db, "acct");
    const wsId = createId("ws");
    const colA = createId("col");
    const colB = createId("col");
    const parent = createId("fld");
    const child = createId("fld");
    const reqId = createId("req");
    const folder = (id: string, collectionId: string, parentId: string | null, name: string): Folder => ({
      id,
      workspaceId: wsId,
      collectionId,
      parentId,
      name,
      auth: emptyAuth("inherit"),
      scripts: emptyScripts(),
      sortOrder: 1,
      archivedAt: null,
      deletedAt: null,
      version: 1,
      updatedAt: nowIso(),
      createdAt: nowIso()
    });
    repo.upsertFolder(folder(parent, colA, null, "Parent"));
    repo.upsertFolder(folder(child, colA, parent, "Child"));
    repo.upsertRequest({
      id: reqId,
      workspaceId: wsId,
      collectionId: colA,
      folderId: child,
      projectId: null,
      name: "Echo",
      protocol: "http",
      sortOrder: 1,
      document: emptyHttpDocument(),
      examples: [],
      favorite: false,
      archivedAt: null,
      deletedAt: null,
      version: 1,
      updatedAt: nowIso(),
      createdAt: nowIso()
    });
    expect(repo.folderDescendants(parent).sort()).toEqual([parent, child].sort());
    const moved = repo.getFolder(parent)!;
    moved.collectionId = colB;
    repo.upsertFolder(moved);
    expect(repo.getFolder(parent)?.collectionId).toBe(colB);
    const movedReq = repo.getRequest(reqId)!;
    movedReq.collectionId = colB;
    repo.upsertRequest(movedReq);
    expect(repo.getRequest(reqId)?.collectionId).toBe(colB);
    repo.setMeta("ui_settings", JSON.stringify({ historyEnabled: false }));
    expect(JSON.parse(repo.getMeta("ui_settings")!).historyEnabled).toBe(false);
    repo.addHistory(wsId, reqId, { method: "GET" });
    expect(repo.listHistory(wsId)).toHaveLength(1);
    repo.clearHistory(wsId);
    expect(repo.listHistory(wsId)).toHaveLength(0);
    closeDatabase(db);
  });
});
