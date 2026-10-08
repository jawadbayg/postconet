import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { closeDatabase, openDatabase, StudioRepo } from "../src/index.js";
import { createId, nowIso, emptyAuth, emptyScripts, type Workspace } from "@postconet/core";

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
});
