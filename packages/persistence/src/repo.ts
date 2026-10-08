import type { Database } from "./db.js";
import {
  createId,
  createIdempotencyKey,
  nowIso,
  type Collection,
  type EntityType,
  type Environment,
  type Folder,
  type SavedRequest,
  type SyncOp,
  type Variable,
  type Workspace
} from "@postconet/core";

export class StudioRepo {
  constructor(
    private readonly db: Database,
    private readonly accountId: string
  ) {}

  private enqueue(entityType: EntityType, entityId: string, workspaceId: string | null, op: "upsert" | "delete", payload: unknown, version: number) {
    this.db
      .prepare(
        `INSERT INTO ops_queue (id, idempotency_key, entity_type, entity_id, workspace_id, op, payload, version, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      )
      .run(
        createId("op"),
        createIdempotencyKey(),
        entityType,
        entityId,
        workspaceId,
        op,
        JSON.stringify(payload),
        version,
        nowIso()
      );
  }

  private reindex(entityId: string, entityType: string, title: string, body: string) {
    this.db.prepare("DELETE FROM search_idx WHERE entity_id = ?").run(entityId);
    this.db.prepare("INSERT INTO search_idx (entity_id, entity_type, title, body) VALUES (?, ?, ?, ?)").run(entityId, entityType, title, body);
  }

  listWorkspaces(): Workspace[] {
    return this.db
      .prepare("SELECT payload FROM workspaces WHERE deleted_at IS NULL ORDER BY name")
      .all()
      .map((row) => JSON.parse(String((row as { payload: string }).payload)) as Workspace);
  }

  getWorkspace(id: string): Workspace | undefined {
    const row = this.db.prepare("SELECT payload FROM workspaces WHERE id = ?").get(id) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as Workspace) : undefined;
  }

  upsertWorkspace(ws: Workspace, enqueue = true) {
    this.db
      .prepare(
        `INSERT INTO workspaces (id, name, kind, organization_id, owner_user_id, description, archived_at, deleted_at, version, updated_at, created_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, kind=excluded.kind, description=excluded.description, archived_at=excluded.archived_at,
           deleted_at=excluded.deleted_at, version=excluded.version, updated_at=excluded.updated_at, payload=excluded.payload`
      )
      .run(
        ws.id,
        ws.name,
        ws.kind,
        ws.organizationId,
        ws.ownerUserId,
        ws.description ?? null,
        ws.archivedAt,
        ws.deletedAt,
        ws.version,
        ws.updatedAt,
        ws.createdAt,
        JSON.stringify(ws)
      );
    this.reindex(ws.id, "workspace", ws.name, ws.description ?? "");
    if (enqueue) this.enqueue("workspace", ws.id, ws.id, ws.deletedAt ? "delete" : "upsert", ws, ws.version);
  }

  upsertCollection(col: Collection, enqueue = true) {
    this.db
      .prepare(
        `INSERT INTO collections (id, workspace_id, project_id, name, archived_at, deleted_at, version, updated_at, created_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, payload=excluded.payload, version=excluded.version, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, archived_at=excluded.archived_at`
      )
      .run(
        col.id,
        col.workspaceId,
        col.projectId,
        col.name,
        col.archivedAt,
        col.deletedAt,
        col.version,
        col.updatedAt,
        col.createdAt,
        JSON.stringify(col)
      );
    this.reindex(col.id, "collection", col.name, col.description ?? "");
    if (enqueue) this.enqueue("collection", col.id, col.workspaceId, col.deletedAt ? "delete" : "upsert", col, col.version);
  }

  upsertFolder(folder: Folder, enqueue = true) {
    this.db
      .prepare(
        `INSERT INTO folders (id, workspace_id, collection_id, parent_id, name, sort_order, archived_at, deleted_at, version, updated_at, created_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, parent_id=excluded.parent_id, sort_order=excluded.sort_order, payload=excluded.payload, version=excluded.version, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`
      )
      .run(
        folder.id,
        folder.workspaceId,
        folder.collectionId,
        folder.parentId,
        folder.name,
        folder.sortOrder,
        folder.archivedAt,
        folder.deletedAt,
        folder.version,
        folder.updatedAt,
        folder.createdAt,
        JSON.stringify(folder)
      );
    this.reindex(folder.id, "folder", folder.name, "");
    if (enqueue) this.enqueue("folder", folder.id, folder.workspaceId, folder.deletedAt ? "delete" : "upsert", folder, folder.version);
  }

  upsertRequest(req: SavedRequest, enqueue = true) {
    this.db
      .prepare(
        `INSERT INTO requests (id, workspace_id, collection_id, folder_id, project_id, name, protocol, sort_order, favorite, archived_at, deleted_at, version, updated_at, created_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, folder_id=excluded.folder_id, sort_order=excluded.sort_order, favorite=excluded.favorite, payload=excluded.payload, version=excluded.version, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, protocol=excluded.protocol`
      )
      .run(
        req.id,
        req.workspaceId,
        req.collectionId,
        req.folderId,
        req.projectId,
        req.name,
        req.protocol,
        req.sortOrder,
        req.favorite ? 1 : 0,
        req.archivedAt,
        req.deletedAt,
        req.version,
        req.updatedAt,
        req.createdAt,
        JSON.stringify(req)
      );
    const doc = req.document as { url?: string; method?: string };
    this.reindex(req.id, "request", req.name, `${doc.method ?? ""} ${doc.url ?? ""}`);
    if (enqueue) this.enqueue("request", req.id, req.workspaceId, req.deletedAt ? "delete" : "upsert", req, req.version);
  }

  upsertEnvironment(env: Environment, enqueue = true) {
    this.db
      .prepare(
        `INSERT INTO environments (id, workspace_id, name, archived_at, deleted_at, version, updated_at, created_at, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, payload=excluded.payload, version=excluded.version, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`
      )
      .run(
        env.id,
        env.workspaceId,
        env.name,
        env.archivedAt,
        env.deletedAt,
        env.version,
        env.updatedAt,
        env.createdAt,
        JSON.stringify(env)
      );
    if (enqueue) this.enqueue("environment", env.id, env.workspaceId, env.deletedAt ? "delete" : "upsert", env, env.version);
  }

  getGlobals(workspaceId: string): Variable[] {
    const row = this.db.prepare("SELECT payload FROM globals WHERE workspace_id = ?").get(workspaceId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as Variable[]) : [];
  }

  setGlobals(workspaceId: string, vars: Variable[], enqueue = true) {
    this.db
      .prepare(
        `INSERT INTO globals (workspace_id, payload, version, updated_at) VALUES (?, ?, 1, ?)
         ON CONFLICT(workspace_id) DO UPDATE SET payload=excluded.payload, version=globals.version+1, updated_at=excluded.updated_at`
      )
      .run(workspaceId, JSON.stringify(vars), nowIso());
    if (enqueue) this.enqueue("globals", workspaceId, workspaceId, "upsert", vars, 1);
  }

  listCollections(workspaceId: string): Collection[] {
    return this.db
      .prepare("SELECT payload FROM collections WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY name")
      .all(workspaceId)
      .map((row) => JSON.parse(String((row as { payload: string }).payload)) as Collection);
  }

  listFolders(collectionId: string): Folder[] {
    return this.db
      .prepare("SELECT payload FROM folders WHERE collection_id = ? AND deleted_at IS NULL ORDER BY sort_order")
      .all(collectionId)
      .map((row) => JSON.parse(String((row as { payload: string }).payload)) as Folder);
  }

  listRequests(collectionId: string): SavedRequest[] {
    return this.db
      .prepare("SELECT payload FROM requests WHERE collection_id = ? AND deleted_at IS NULL ORDER BY sort_order")
      .all(collectionId)
      .map((row) => JSON.parse(String((row as { payload: string }).payload)) as SavedRequest);
  }

  getRequest(id: string): SavedRequest | undefined {
    const row = this.db.prepare("SELECT payload FROM requests WHERE id = ?").get(id) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as SavedRequest) : undefined;
  }

  listEnvironments(workspaceId: string): Environment[] {
    return this.db
      .prepare("SELECT payload FROM environments WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY name")
      .all(workspaceId)
      .map((row) => JSON.parse(String((row as { payload: string }).payload)) as Environment);
  }

  search(query: string): Array<{ entityId: string; entityType: string; title: string }> {
    return this.db
      .prepare("SELECT entity_id as entityId, entity_type as entityType, title FROM search_idx WHERE title LIKE ? OR body LIKE ? LIMIT 50")
      .all(`%${query}%`, `%${query}%`)
      .map((row) => row as { entityId: string; entityType: string; title: string });
  }

  addHistory(workspaceId: string, requestId: string | undefined, payload: unknown) {
    this.db
      .prepare("INSERT INTO history (id, workspace_id, request_id, created_at, payload) VALUES (?, ?, ?, ?, ?)")
      .run(createId("hist"), workspaceId, requestId ?? null, nowIso(), JSON.stringify(payload));
  }

  listHistory(workspaceId: string, limit = 50) {
    return this.db
      .prepare("SELECT id, created_at as createdAt, payload FROM history WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?")
      .all(workspaceId, limit)
      .map((row) => {
        const r = row as { id: string; createdAt: string; payload: string };
        return { id: r.id, createdAt: r.createdAt, ...(JSON.parse(r.payload) as object) };
      });
  }

  getCookieJar(workspaceId: string): string | null {
    const row = this.db.prepare("SELECT jar_json FROM cookies WHERE workspace_id = ?").get(workspaceId) as { jar_json: string } | undefined;
    return row?.jar_json ?? null;
  }

  setCookieJar(workspaceId: string, jarJson: string) {
    this.db
      .prepare("INSERT INTO cookies (workspace_id, jar_json) VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET jar_json=excluded.jar_json")
      .run(workspaceId, jarJson);
  }

  pendingOps(limit = 100): SyncOp[] {
    return this.db
      .prepare("SELECT * FROM ops_queue WHERE status IN ('pending','failed') ORDER BY created_at LIMIT ?")
      .all(limit)
      .map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: String(r.id),
          idempotencyKey: String(r.idempotency_key),
          entityType: r.entity_type as EntityType,
          entityId: String(r.entity_id),
          workspaceId: (r.workspace_id as string) ?? null,
          op: r.op as "upsert" | "delete",
          payload: JSON.parse(String(r.payload)),
          version: (r.version as number) ?? null,
          createdAt: String(r.created_at),
          attempts: Number(r.attempts),
          lastError: (r.last_error as string) ?? null,
          status: r.status as SyncOp["status"]
        };
      });
  }

  markOp(id: string, status: SyncOp["status"], error?: string) {
    this.db.prepare("UPDATE ops_queue SET status = ?, last_error = ?, attempts = attempts + 1 WHERE id = ?").run(status, error ?? null, id);
  }

  ackOp(id: string) {
    this.db.prepare("UPDATE ops_queue SET status = 'acked' WHERE id = ?").run(id);
  }

  getCursor(workspaceId: string): number {
    const row = this.db.prepare("SELECT last_seq FROM sync_cursors WHERE workspace_id = ?").get(workspaceId) as { last_seq: number } | undefined;
    return row?.last_seq ?? 0;
  }

  setCursor(workspaceId: string, seq: number) {
    this.db
      .prepare(
        "INSERT INTO sync_cursors (workspace_id, last_seq) VALUES (?, ?) ON CONFLICT(workspace_id) DO UPDATE SET last_seq=excluded.last_seq"
      )
      .run(workspaceId, seq);
  }

  saveTabs(payload: unknown) {
    this.db
      .prepare("INSERT INTO tabs_state (account_id, payload) VALUES (?, ?) ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload")
      .run(this.accountId, JSON.stringify(payload));
  }

  loadTabs(): unknown {
    const row = this.db.prepare("SELECT payload FROM tabs_state WHERE account_id = ?").get(this.accountId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : null;
  }

  addConflict(workspaceId: string, entityId: string, payload: unknown) {
    this.db
      .prepare("INSERT INTO conflicts (id, workspace_id, entity_id, payload, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(createId("cfl"), workspaceId, entityId, JSON.stringify(payload), nowIso());
  }

  listConflicts(workspaceId: string) {
    return this.db
      .prepare("SELECT id, entity_id as entityId, payload, created_at as createdAt FROM conflicts WHERE workspace_id = ? AND resolved_at IS NULL")
      .all(workspaceId);
  }

  countEntities(): number {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM requests").get() as { c: number };
    return Number(row.c);
  }

  dropPendingForWorkspace(workspaceId: string) {
    this.db
      .prepare("UPDATE ops_queue SET status = 'rejected', last_error = 'membership revoked' WHERE workspace_id = ? AND status IN ('pending','failed','sending')")
      .run(workspaceId);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
