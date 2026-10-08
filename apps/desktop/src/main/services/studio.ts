import { closeDatabase, openDatabase, StudioRepo } from "@postconet/persistence";
import {
  createId,
  nowIso,
  emptyAuth,
  emptyScripts,
  emptyHttpDocument,
  type Collection,
  type Folder,
  type SavedRequest,
  type Workspace,
  type Environment
} from "@postconet/core";
import { runtime } from "./state.js";
import { dbPath } from "./session.js";

export function openAccount(userId: string) {
  closeAccount();
  runtime.accountId = userId;
  runtime.db = openDatabase(dbPath(userId));
  runtime.repo = new StudioRepo(runtime.db, userId);
  ensurePersonalWorkspace(userId);
}

export function closeAccount() {
  if (runtime.db) closeDatabase(runtime.db);
  runtime.db = null;
  runtime.repo = null;
  runtime.accountId = "local";
}

function ensurePersonalWorkspace(userId: string) {
  const repo = mustRepo();
  if (repo.listWorkspaces().length > 0) return;
  const ws: Workspace = {
    id: createId("ws"),
    name: "Personal",
    kind: "personal",
    organizationId: null,
    ownerUserId: userId === "local" ? null : userId,
    archivedAt: null,
    deletedAt: null,
    version: 1,
    updatedAt: nowIso(),
    createdAt: nowIso()
  };
  repo.upsertWorkspace(ws);
}

export function mustRepo(): StudioRepo {
  if (!runtime.repo) throw new Error("No account database is open");
  return runtime.repo;
}

export function createCollection(workspaceId: string, name: string): Collection {
  const col: Collection = {
    id: createId("col"),
    workspaceId,
    projectId: null,
    name,
    auth: emptyAuth("none"),
    variables: [],
    scripts: emptyScripts(),
    favorite: false,
    archivedAt: null,
    deletedAt: null,
    version: 1,
    updatedAt: nowIso(),
    createdAt: nowIso()
  };
  mustRepo().upsertCollection(col);
  return col;
}

export function createFolder(workspaceId: string, collectionId: string, parentId: string | null, name: string): Folder {
  const folder: Folder = {
    id: createId("fld"),
    workspaceId,
    collectionId,
    parentId,
    name,
    auth: emptyAuth("inherit"),
    scripts: emptyScripts(),
    sortOrder: Date.now(),
    archivedAt: null,
    deletedAt: null,
    version: 1,
    updatedAt: nowIso(),
    createdAt: nowIso()
  };
  mustRepo().upsertFolder(folder);
  return folder;
}

export function createRequest(opts: {
  workspaceId: string;
  collectionId: string;
  folderId: string | null;
  name: string;
}): SavedRequest {
  const req: SavedRequest = {
    id: createId("req"),
    workspaceId: opts.workspaceId,
    collectionId: opts.collectionId,
    folderId: opts.folderId,
    projectId: null,
    name: opts.name,
    protocol: "http",
    sortOrder: Date.now(),
    document: emptyHttpDocument(),
    examples: [],
    favorite: false,
    archivedAt: null,
    deletedAt: null,
    version: 1,
    updatedAt: nowIso(),
    createdAt: nowIso()
  };
  mustRepo().upsertRequest(req);
  return req;
}

export function createEnvironment(workspaceId: string, name: string): Environment {
  const env: Environment = {
    id: createId("env"),
    workspaceId,
    name,
    values: [],
    archivedAt: null,
    deletedAt: null,
    version: 1,
    updatedAt: nowIso(),
    createdAt: nowIso()
  };
  mustRepo().upsertEnvironment(env);
  return env;
}

export function tree(workspaceId: string) {
  const repo = mustRepo();
  const collections = repo.listCollections(workspaceId);
  return {
    workspace: repo.getWorkspace(workspaceId),
    collections: collections.map((c) => ({
      ...c,
      folders: repo.listFolders(c.id),
      requests: repo.listRequests(c.id)
    })),
    environments: repo.listEnvironments(workspaceId),
    globals: repo.getGlobals(workspaceId)
  };
}
