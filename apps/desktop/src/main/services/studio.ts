import { closeDatabase, openDatabase, StudioRepo } from "@postconet/persistence";
import {
  createId,
  nowIso,
  emptyAuth,
  emptyScripts,
  emptyHttpDocument,
  type HttpRequestDocument,
  type Collection,
  type Folder,
  type SavedRequest,
  type Workspace,
  type Environment
} from "@postconet/core";
import { runtime } from "./state.js";
import { existsSync } from "node:fs";
import { dbPath, wipeAccountFiles } from "./session.js";

export function openAccount(userId: string) {
  closeAccount();
  runtime.accountId = userId;
  runtime.db = openDatabase(dbPath(userId));
  runtime.repo = new StudioRepo(runtime.db, userId);
  if (userId === "local") ensurePersonalWorkspace(userId);
}

export function ensureWorkspaceIfEmpty(userId: string) {
  ensurePersonalWorkspace(userId);
}

export function closeAccount() {
  if (runtime.db) closeDatabase(runtime.db);
  runtime.db = null;
  runtime.repo = null;
  runtime.accountId = "local";
}

export type LocalSnapshot = {
  collections: Collection[];
  folders: Folder[];
  requests: SavedRequest[];
  environments: Environment[];
};

export type LocalDataSummary = {
  collections: number;
  requests: number;
  environments: number;
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function snapshotFromRepo(repo: StudioRepo): LocalSnapshot {
  const collections: Collection[] = [];
  const folders: Folder[] = [];
  const requests: SavedRequest[] = [];
  const environments: Environment[] = [];
  for (const ws of repo.listWorkspaces()) {
    environments.push(...repo.listEnvironments(ws.id));
    for (const col of repo.listCollections(ws.id)) {
      collections.push(col);
      folders.push(...repo.listFolders(col.id));
      requests.push(...repo.listRequests(col.id));
    }
  }
  return {
    collections: clone(collections),
    folders: clone(folders),
    requests: clone(requests),
    environments: clone(environments)
  };
}

export function captureLocalSnapshot(): LocalSnapshot {
  if (runtime.accountId === "local" && runtime.repo) return snapshotFromRepo(runtime.repo);
  const path = dbPath("local");
  if (!existsSync(path)) return { collections: [], folders: [], requests: [], environments: [] };
  const db = openDatabase(path);
  try {
    return snapshotFromRepo(new StudioRepo(db, "local"));
  } finally {
    closeDatabase(db);
  }
}

export function summarizeLocalSnapshot(snapshot: LocalSnapshot): LocalDataSummary {
  return {
    collections: snapshot.collections.length,
    requests: snapshot.requests.length,
    environments: snapshot.environments.length
  };
}

export function localSnapshotHasData(snapshot: LocalSnapshot) {
  return snapshot.collections.length > 0 || snapshot.requests.length > 0 || snapshot.environments.length > 0;
}

function sortedFolders(folders: Folder[]) {
  const remaining = [...folders];
  const out: Folder[] = [];
  const placed = new Set<string>();
  while (remaining.length) {
    const ready = remaining.filter((folder) => !folder.parentId || placed.has(folder.parentId) || !folders.some((row) => row.id === folder.parentId));
    if (!ready.length) {
      out.push(...remaining);
      break;
    }
    for (const folder of ready) {
      placed.add(folder.id);
      out.push(folder);
    }
    remaining.splice(0, remaining.length, ...remaining.filter((folder) => !placed.has(folder.id)));
  }
  return out;
}

export function importLocalSnapshot(snapshot: LocalSnapshot) {
  const repo = mustRepo();
  const workspace = repo.listWorkspaces()[0];
  if (!workspace) return;
  const now = nowIso();
  const colMap = new Map<string, string>();
  const folderMap = new Map<string, string>();
  for (const col of snapshot.collections) {
    const id = createId("col");
    colMap.set(col.id, id);
    repo.upsertCollection({
      ...col,
      id,
      workspaceId: workspace.id,
      version: 1,
      updatedAt: now,
      deletedAt: null
    });
  }
  for (const folder of sortedFolders(snapshot.folders)) {
    const id = createId("fld");
    folderMap.set(folder.id, id);
    const collectionId = colMap.get(folder.collectionId);
    if (!collectionId) continue;
    repo.upsertFolder({
      ...folder,
      id,
      workspaceId: workspace.id,
      collectionId,
      parentId: folder.parentId ? folderMap.get(folder.parentId) ?? null : null,
      version: 1,
      updatedAt: now,
      deletedAt: null
    });
  }
  for (const req of snapshot.requests) {
    const collectionId = colMap.get(req.collectionId);
    if (!collectionId) continue;
    repo.upsertRequest({
      ...req,
      id: createId("req"),
      workspaceId: workspace.id,
      collectionId,
      folderId: req.folderId ? folderMap.get(req.folderId) ?? null : null,
      version: 1,
      updatedAt: now,
      deletedAt: null
    });
  }
  for (const env of snapshot.environments) {
    repo.upsertEnvironment({
      ...env,
      id: createId("env"),
      workspaceId: workspace.id,
      version: 1,
      updatedAt: now,
      deletedAt: null
    });
  }
}

export function wipeClosedAccount(userId: string) {
  if (!userId || userId === "local") return;
  if (runtime.accountId === userId) closeAccount();
  wipeAccountFiles(userId);
}

export function resetLocalAccountFiles() {
  if (runtime.accountId === "local") closeAccount();
  wipeAccountFiles("local");
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

function withRequestDefaults(doc: HttpRequestDocument): HttpRequestDocument {
  try {
    const raw = mustRepo().getMeta("ui_settings");
    const settings = raw ? (JSON.parse(raw) as { timeoutMs?: number; followRedirects?: boolean; tlsVerify?: boolean }) : {};
    return {
      ...doc,
      settings: {
        ...doc.settings,
        timeoutMs: settings.timeoutMs ?? doc.settings.timeoutMs,
        followRedirects: settings.followRedirects ?? doc.settings.followRedirects,
        tlsVerify: settings.tlsVerify ?? doc.settings.tlsVerify
      }
    };
  } catch {
    return doc;
  }
}

export function mustRepo(): StudioRepo {
  if (!runtime.repo) throw new Error("No account database is open");
  return runtime.repo;
}

async function assertCanEditResource(kind: "collection" | "folder" | "request", id: string, workspaceId: string) {
  if (!runtime.supabase || !runtime.user) return;
  try {
    const { data, error } = await runtime.supabase.rpc("can_edit_resource", {
      p_kind: kind,
      p_id: id,
      p_workspace: workspaceId
    });
    if (error) return;
    if (data === false) throw new Error("You need Editor access to do that.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("Editor access")) throw error;
  }
}

async function assertCanEditWorkspace(workspaceId: string) {
  if (!runtime.supabase || !runtime.user) return;
  try {
    const { data, error } = await runtime.supabase.rpc("can_edit_workspace", { ws: workspaceId });
    if (error) return;
    if (data === false) throw new Error("You cannot change this workspace.");
  } catch (error) {
    if (error instanceof Error && error.message.includes("cannot change")) throw error;
  }
}

export async function createCollection(workspaceId: string, name: string): Promise<Collection> {
  await assertCanEditWorkspace(workspaceId);
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
  runtime.onLocalMutation?.();
  return col;
}

export async function createFolder(workspaceId: string, collectionId: string, parentId: string | null, name: string): Promise<Folder> {
  await assertCanEditResource(parentId ? "folder" : "collection", parentId ?? collectionId, workspaceId);
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
  runtime.onLocalMutation?.();
  return folder;
}

export async function createRequest(opts: {
  workspaceId: string;
  collectionId: string;
  folderId: string | null;
  name: string;
}): Promise<SavedRequest> {
  await assertCanEditResource(opts.folderId ? "folder" : "collection", opts.folderId ?? opts.collectionId, opts.workspaceId);
  const req: SavedRequest = {
    id: createId("req"),
    workspaceId: opts.workspaceId,
    collectionId: opts.collectionId,
    folderId: opts.folderId,
    projectId: null,
    name: opts.name,
    protocol: "http",
    sortOrder: Date.now(),
    document: withRequestDefaults(emptyHttpDocument()),
    examples: [],
    favorite: false,
    archivedAt: null,
    deletedAt: null,
    version: 1,
    updatedAt: nowIso(),
    createdAt: nowIso()
  };
  mustRepo().upsertRequest(req);
  runtime.onLocalMutation?.();
  return req;
}

export async function createEnvironment(workspaceId: string, name: string): Promise<Environment> {
  await assertCanEditWorkspace(workspaceId);
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
  runtime.onLocalMutation?.();
  return env;
}

export async function renameEntity(type: "collection" | "folder" | "request" | "environment", id: string, name: string) {
  const repo = mustRepo();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  if (type === "collection") {
    const col = repo.getCollection(id);
    if (!col) throw new Error("Collection not found");
    await assertCanEditResource("collection", id, col.workspaceId);
    col.name = trimmed;
    col.updatedAt = nowIso();
    col.version += 1;
    repo.upsertCollection(col);
    runtime.onLocalMutation?.();
    return col;
  }
  if (type === "folder") {
    const folder = repo.getFolder(id);
    if (!folder) throw new Error("Folder not found");
    await assertCanEditResource("folder", id, folder.workspaceId);
    folder.name = trimmed;
    folder.updatedAt = nowIso();
    folder.version += 1;
    repo.upsertFolder(folder);
    runtime.onLocalMutation?.();
    return folder;
  }
  if (type === "environment") {
    const env = repo.getEnvironment(id);
    if (!env) throw new Error("Environment not found");
    await assertCanEditWorkspace(env.workspaceId);
    env.name = trimmed;
    env.updatedAt = nowIso();
    env.version += 1;
    repo.upsertEnvironment(env);
    runtime.onLocalMutation?.();
    return env;
  }
  const req = repo.getRequest(id);
  if (!req) throw new Error("Request not found");
  await assertCanEditResource("request", id, req.workspaceId);
  req.name = trimmed;
  req.updatedAt = nowIso();
  req.version += 1;
  repo.upsertRequest(req);
  runtime.onLocalMutation?.();
  return req;
}

function stampDelete<T extends { deletedAt: string | null; updatedAt: string; version: number }>(entity: T, stamp: string): T {
  entity.deletedAt = stamp;
  entity.updatedAt = stamp;
  entity.version += 1;
  return entity;
}

export async function deleteEntity(type: "collection" | "folder" | "request" | "environment", id: string) {
  const repo = mustRepo();
  const stamp = nowIso();
  if (type === "collection") {
    const col = repo.getCollection(id);
    if (!col) throw new Error("Collection not found");
    await assertCanEditResource("collection", id, col.workspaceId);
    repo.upsertCollection(stampDelete(col, stamp));
    for (const folder of repo.listFolders(id)) repo.upsertFolder(stampDelete(folder, stamp));
    for (const req of repo.listRequests(id)) repo.upsertRequest(stampDelete(req, stamp));
    runtime.onLocalMutation?.();
    return { ok: true };
  }
  if (type === "folder") {
    const folder = repo.getFolder(id);
    if (!folder) throw new Error("Folder not found");
    await assertCanEditResource("folder", id, folder.workspaceId);
    const descendantIds = repo.folderDescendants(id);
    for (const folderId of descendantIds) {
      const child = repo.getFolder(folderId);
      if (child) repo.upsertFolder(stampDelete(child, stamp));
    }
    for (const req of repo.listRequests(folder.collectionId)) {
      if (req.folderId && descendantIds.includes(req.folderId)) repo.upsertRequest(stampDelete(req, stamp));
    }
    runtime.onLocalMutation?.();
    return { ok: true };
  }
  if (type === "environment") {
    const env = repo.getEnvironment(id);
    if (!env) throw new Error("Environment not found");
    await assertCanEditWorkspace(env.workspaceId);
    repo.upsertEnvironment(stampDelete(env, stamp));
    runtime.onLocalMutation?.();
    return { ok: true };
  }
  const req = repo.getRequest(id);
  if (!req) throw new Error("Request not found");
  await assertCanEditResource("request", id, req.workspaceId);
  repo.upsertRequest(stampDelete(req, stamp));
  runtime.onLocalMutation?.();
  return { ok: true };
}

export async function moveFolder(folderId: string, collectionId: string, parentId: string | null) {
  const repo = mustRepo();
  const folder = repo.getFolder(folderId);
  if (!folder) throw new Error("Folder not found");
  await assertCanEditResource("folder", folderId, folder.workspaceId);
  await assertCanEditResource("collection", collectionId, folder.workspaceId);
  if (parentId === folderId) throw new Error("A folder cannot be moved into itself");
  const descendantIds = repo.folderDescendants(folderId);
  if (parentId && descendantIds.includes(parentId)) {
    throw new Error("A folder cannot be moved into one of its own subfolders");
  }
  if (parentId) {
    const parent = repo.getFolder(parentId);
    if (!parent || parent.deletedAt) throw new Error("Destination folder not found");
    if (parent.collectionId !== collectionId) throw new Error("Parent folder is in a different collection");
    await assertCanEditResource("folder", parentId, parent.workspaceId);
  }
  const collection = repo.getCollection(collectionId);
  if (!collection || collection.deletedAt) throw new Error("Destination collection not found");
  const oldCollectionId = folder.collectionId;
  folder.collectionId = collectionId;
  folder.parentId = parentId;
  folder.updatedAt = nowIso();
  folder.version += 1;
  repo.upsertFolder(folder);
  for (const id of descendantIds) {
    if (id === folderId) continue;
    const child = repo.getFolder(id);
    if (!child) continue;
    child.collectionId = collectionId;
    child.updatedAt = nowIso();
    child.version += 1;
    repo.upsertFolder(child);
  }
  if (oldCollectionId !== collectionId) {
    for (const req of repo.listRequests(oldCollectionId)) {
      if (req.folderId && descendantIds.includes(req.folderId)) {
        req.collectionId = collectionId;
        req.updatedAt = nowIso();
        req.version += 1;
        repo.upsertRequest(req);
      }
    }
  }
  runtime.onLocalMutation?.();
  return folder;
}

export async function moveRequest(requestId: string, collectionId: string, folderId: string | null) {
  const repo = mustRepo();
  const req = repo.getRequest(requestId);
  if (!req) throw new Error("Request not found");
  await assertCanEditResource("request", requestId, req.workspaceId);
  const collection = repo.getCollection(collectionId);
  if (!collection || collection.deletedAt) throw new Error("Destination collection not found");
  await assertCanEditResource("collection", collectionId, collection.workspaceId);
  if (folderId) {
    const folder = repo.getFolder(folderId);
    if (!folder || folder.deletedAt) throw new Error("Destination folder not found");
    if (folder.collectionId !== collectionId) throw new Error("Folder is not in that collection");
    await assertCanEditResource("folder", folderId, folder.workspaceId);
  }
  req.collectionId = collectionId;
  req.folderId = folderId;
  req.updatedAt = nowIso();
  req.version += 1;
  repo.upsertRequest(req);
  runtime.onLocalMutation?.();
  return req;
}

export type SaveRequestResult =
  | { status: "saved"; request: SavedRequest }
  | { status: "conflict"; draft: SavedRequest; latest: SavedRequest; deleted?: boolean };

export async function saveRequestDocument(
  incoming: SavedRequest,
  opts?: { overwrite?: boolean; expectedLatest?: number }
): Promise<SaveRequestResult> {
  const repo = mustRepo();
  const current = repo.getRequest(incoming.id);
  if (!current || current.deletedAt) {
    if (current?.deletedAt) {
      return { status: "conflict", draft: incoming, latest: current, deleted: true };
    }
    throw new Error("Request not found");
  }
  await assertCanEditResource("request", incoming.id, current.workspaceId);
  if (opts?.overwrite) {
    if (opts.expectedLatest != null && current.version !== opts.expectedLatest) {
      return { status: "conflict", draft: incoming, latest: current };
    }
  } else if (current.version !== incoming.version) {
    return { status: "conflict", draft: incoming, latest: current };
  }
  const next: SavedRequest = {
    ...incoming,
    collectionId: incoming.collectionId || current.collectionId,
    folderId: incoming.folderId === undefined ? current.folderId : incoming.folderId,
    workspaceId: current.workspaceId,
    version: current.version + 1,
    updatedAt: nowIso(),
    createdAt: current.createdAt,
    deletedAt: null
  };
  repo.upsertRequest(next);
  runtime.onLocalMutation?.();
  return { status: "saved", request: next };
}

export async function saveEnvironmentDocument(env: Environment): Promise<Environment> {
  const repo = mustRepo();
  const current = repo.getEnvironment(env.id);
  if (!current || current.deletedAt) throw new Error("Environment not found");
  await assertCanEditWorkspace(current.workspaceId);
  if (current.version !== env.version) {
    throw new Error("Someone updated this environment. Reload it, then save again.");
  }
  env.version = current.version + 1;
  env.updatedAt = nowIso();
  repo.upsertEnvironment(env);
  runtime.onLocalMutation?.();
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
