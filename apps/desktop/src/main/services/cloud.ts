import { createClient, type Session } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl, isCloudConfigured } from "../config.js";
import { runtime } from "./state.js";
import { saveSession, clearSession, loadSession } from "./session.js";
import { closeAccount, openAccount, mustRepo, ensureWorkspaceIfEmpty } from "./studio.js";
import { summarizeState, type ChangeLogRow } from "@postconet/core";
import { app, BrowserWindow, net, powerMonitor } from "electron";

export function createAuthedClient(session?: Session) {
  if (!isCloudConfigured()) return null;
  const client = createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
  });
  if (session) void client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  return client;
}

function emit(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

function isOnline() {
  try {
    return net.isOnline();
  } catch {
    return true;
  }
}

function refreshStatus() {
  if (!runtime.user || !isCloudConfigured()) {
    runtime.sync = "offline";
    emit("sync.status", statusPayload());
    return;
  }
  if (!isOnline()) {
    runtime.sync = "offline";
    runtime.syncError = null;
    emit("sync.status", statusPayload());
    return;
  }
  const pending = runtime.repo?.pendingOps().length ?? 0;
  runtime.sync = summarizeState({
    online: true,
    pending,
    conflicts: 0,
    lastError: runtime.syncError
  });
  emit("sync.status", statusPayload());
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let flushAgain = false;
let lastReconcile = 0;

export function schedulePush() {
  refreshStatus();
  if (!runtime.user || !isCloudConfigured()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void flushSync(), 280);
}

export async function flushSync() {
  if (!runtime.user || !runtime.supabase || !isCloudConfigured()) {
    refreshStatus();
    return;
  }
  if (flushing) {
    flushAgain = true;
    return;
  }
  flushing = true;
  try {
    if (!isOnline()) {
      runtime.sync = "offline";
      emit("sync.status", statusPayload());
      return;
    }
    runtime.sync = "syncing";
    runtime.syncError = null;
    emit("sync.status", statusPayload());
    await pullAllWorkspaces();
    await pushQueue();
    refreshStatus();
  } catch (error) {
    runtime.sync = "failed";
    runtime.syncError = error instanceof Error ? error.message : String(error);
    emit("sync.status", statusPayload());
  } finally {
    flushing = false;
    if (flushAgain) {
      flushAgain = false;
      schedulePush();
    }
  }
}

export function startSyncRuntime() {
  runtime.onLocalMutation = () => schedulePush();
  const tick = () => {
    if (!runtime.user || !isCloudConfigured()) return;
    if (!isOnline()) {
      if (runtime.sync !== "offline") refreshStatus();
      return;
    }
    if (runtime.sync === "offline") void flushSync();
  };
  setInterval(tick, 4000);
  powerMonitor.on("resume", () => {
    lastReconcile = Date.now();
    void flushSync();
  });
  app.on("browser-window-focus", () => {
    if (Date.now() - lastReconcile < 2000) return;
    lastReconcile = Date.now();
    void flushSync();
  });
}

async function pullAllWorkspaces() {
  if (!runtime.repo) return;
  for (const ws of runtime.repo.listWorkspaces()) {
    try {
      await pullWorkspace(ws.id);
    } catch (error) {
      console.error("Pull failed", ws.id, error);
    }
  }
}

export async function restoreSession() {
  openAccount("local");
  if (!isCloudConfigured()) {
    runtime.sync = "offline";
    return { user: null, cloudConfigured: false };
  }
  const session = loadSession();
  runtime.supabase = createAuthedClient(session ?? undefined);
  if (!session || !runtime.supabase) return { user: null, cloudConfigured: true };
  const { data, error } = await runtime.supabase.auth.getUser();
  if (error || !data.user) {
    clearSession();
    return { user: null, cloudConfigured: true };
  }
  runtime.user = data.user;
  openAccount(data.user.id);
  await hydrateFromCloud();
  ensureWorkspaceIfEmpty(data.user.id);
  await acceptPendingInvites();
  subscribeRealtime();
  return { user: publicUser(), cloudConfigured: true };
}

export function publicUser() {
  const u = runtime.user;
  if (!u) return null;
  return { id: u.id, email: u.email ?? "", displayName: (u.user_metadata?.display_name as string) ?? "" };
}

export async function signUp(email: string, password: string, displayName: string) {
  if (!runtime.supabase && isCloudConfigured()) runtime.supabase = createAuthedClient();
  if (!runtime.supabase) throw new Error("Cloud is not configured for this build. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  const { data, error } = await runtime.supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName }, emailRedirectTo: "postconet://auth/callback" }
  });
  if (error) throw error;
  return { needsVerification: !data.session, user: data.user ? { id: data.user.id, email: data.user.email } : null };
}

export async function signIn(email: string, password: string) {
  if (!runtime.supabase && isCloudConfigured()) runtime.supabase = createAuthedClient();
  if (!runtime.supabase) throw new Error("Cloud is not configured for this build.");
  const { data, error } = await runtime.supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session || !data.user) throw new Error("Sign-in did not return a session");
  saveSession(data.session);
  runtime.user = data.user;
  closeAccount();
  openAccount(data.user.id);
  await hydrateFromCloud();
  ensureWorkspaceIfEmpty(data.user.id);
  await acceptPendingInvites();
  subscribeRealtime();
  return publicUser();
}

export async function signOut() {
  if (realtimeChannel && runtime.supabase) {
    await runtime.supabase.removeChannel(realtimeChannel);
  }
  realtimeChannel = null;
  subscribed = false;
  await runtime.supabase?.auth.signOut();
  clearSession();
  runtime.user = null;
  closeAccount();
  openAccount("local");
}

export async function resetPassword(email: string) {
  if (!runtime.supabase) runtime.supabase = createAuthedClient();
  if (!runtime.supabase) throw new Error("Cloud is not configured");
  const { error } = await runtime.supabase.auth.resetPasswordForEmail(email, { redirectTo: "postconet://auth/callback" });
  if (error) throw error;
}

export async function updatePassword(password: string) {
  if (!runtime.supabase) throw new Error("Not signed in");
  const { error } = await runtime.supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function hydrateFromCloud() {
  if (!runtime.supabase || !runtime.user) return;
  runtime.sync = "syncing";
  runtime.lastHydration = { phase: "Downloading workspaces" };
  emit("sync.progress", runtime.lastHydration);
  const { data: workspaces, error } = await runtime.supabase.from("workspaces").select("*");
  if (error) {
    runtime.sync = "failed";
    runtime.syncError = error.message;
    emit("sync.status", statusPayload());
    return;
  }
  const repo = mustRepo();
  for (const ws of workspaces ?? []) {
    runtime.lastHydration = { phase: "Downloading collections", detail: ws.name };
    emit("sync.progress", runtime.lastHydration);
    const payload = (ws.payload as object) ?? {};
    const incomingWs = {
      id: ws.id,
      name: ws.name,
      kind: ws.kind,
      organizationId: ws.organization_id,
      ownerUserId: ws.owner_user_id,
      description: ws.description,
      archivedAt: ws.archived_at,
      deletedAt: ws.deleted_at,
      version: Number(ws.version),
      updatedAt: ws.updated_at,
      createdAt: ws.created_at,
      ...payload
    };
    const localWs = repo.getWorkspace(ws.id);
    if (!localWs || Number(ws.version) > localWs.version) {
      repo.upsertWorkspace(incomingWs as never, false);
    }
    await pullEntity("collections", ws.id, (row) => {
      const incoming = row.payload as { id: string; version: number };
      if (repo.hasPendingEntity(incoming.id)) return;
      const local = repo.getCollection(incoming.id);
      if (!local || incoming.version > local.version) repo.upsertCollection(row.payload as never, false);
    });
    await pullEntity("folders", ws.id, (row) => {
      const incoming = row.payload as { id: string; version: number };
      if (repo.hasPendingEntity(incoming.id)) return;
      const local = repo.getFolder(incoming.id);
      if (!local || incoming.version > local.version) repo.upsertFolder(row.payload as never, false);
    });
    await pullEntity("requests", ws.id, (row) => {
      const incoming = row.payload as { id: string; version: number };
      if (repo.hasPendingEntity(incoming.id)) return;
      const local = repo.getRequest(incoming.id);
      if (!local || incoming.version > local.version) repo.upsertRequest(row.payload as never, false);
    });
    await pullEntity("environments", ws.id, (row) => {
      const incoming = row.payload as { id: string; version: number };
      if (repo.hasPendingEntity(incoming.id)) return;
      const local = repo.getEnvironment(incoming.id);
      if (!local || incoming.version > local.version) repo.upsertEnvironment(row.payload as never, false);
    });
    const cursor = await runtime.supabase.from("change_log").select("seq").eq("workspace_id", ws.id).order("seq", { ascending: false }).limit(1);
    repo.setCursor(ws.id, cursor.data?.[0]?.seq ?? 0);
  }
  await pushQueue();
  runtime.sync = summarizeState({
    online: true,
    pending: repo.pendingOps().length,
    conflicts: 0,
    lastError: null
  });
  runtime.lastHydration = { phase: "Ready" };
  emit("sync.progress", runtime.lastHydration);
  emit("sync.status", statusPayload());
}

async function pullEntity(table: string, workspaceId: string, apply: (row: { payload: unknown }) => void) {
  const { data } = await runtime.supabase!.from(table).select("payload").eq("workspace_id", workspaceId);
  for (const row of data ?? []) apply(row as { payload: unknown });
}

export type PushReject = {
  idempotencyKey: string;
  reason: string;
  currentVersion?: number;
  current?: unknown;
  deleted?: boolean;
};

export async function pushQueue(): Promise<{ rejected: PushReject[] }> {
  if (!runtime.supabase || !runtime.user) return { rejected: [] };
  const repo = mustRepo();
  const ops = repo.pendingOps();
  if (ops.length === 0) return { rejected: [] };
  for (const op of ops) repo.markSending(op.id);
  const { data, error } = await runtime.supabase.functions.invoke("sync-push", { body: { ops } });
  if (error) {
    runtime.sync = "failed";
    runtime.syncError = error.message;
    for (const op of ops) repo.markOp(op.id, "failed", error.message);
    emit("sync.status", statusPayload());
    return { rejected: [] };
  }
  const applied = new Set((data?.applied ?? []).map((a: { idempotencyKey: string }) => a.idempotencyKey));
  const rejected = (data?.rejected ?? []) as PushReject[];
  for (const op of ops) {
    if (applied.has(op.idempotencyKey)) {
      repo.ackOp(op.id);
      repo.rememberIdempotency(op.idempotencyKey);
      continue;
    }
    const hit = rejected.find((r) => r.idempotencyKey === op.idempotencyKey);
    const reason = hit?.reason ?? "rejected";
    if ((reason === "conflict" || reason === "deleted") && op.workspaceId) {
      revertStaleOp(op, hit);
      repo.addConflict(op.workspaceId, op.entityId, { op, reason, latest: hit?.current });
      repo.markOp(op.id, "conflict", reason === "deleted" ? "Remote item was deleted." : "Remote version is newer.");
    } else if (reason === "already_deleted") {
      repo.ackOp(op.id);
    } else {
      repo.markOp(op.id, "failed", reason);
    }
  }
  return { rejected };
}

function revertStaleOp(op: { entityType: string; entityId: string; payload: unknown }, hit?: PushReject) {
  const repo = mustRepo();
  const latest = hit?.current;
  if (hit?.deleted || hit?.reason === "deleted") {
    const stamp = new Date().toISOString();
    if (op.entityType === "request") {
      const local = repo.getRequest(op.entityId);
      if (local) repo.upsertRequest({ ...local, deletedAt: stamp, version: hit.currentVersion ?? local.version } as never, false);
    }
    if (op.entityType === "folder") {
      const local = repo.getFolder(op.entityId);
      if (local) repo.upsertFolder({ ...local, deletedAt: stamp, version: hit.currentVersion ?? local.version } as never, false);
    }
    if (op.entityType === "collection") {
      const local = repo.getCollection(op.entityId);
      if (local) repo.upsertCollection({ ...local, deletedAt: stamp, version: hit.currentVersion ?? local.version } as never, false);
    }
    if (op.entityType === "environment") {
      const local = repo.getEnvironment(op.entityId);
      if (local) repo.upsertEnvironment({ ...local, deletedAt: stamp, version: hit.currentVersion ?? local.version } as never, false);
    }
    emit("sync.changed", { entityType: op.entityType, entityId: op.entityId, op: "delete", payload: latest ?? null });
    return;
  }
  if (!latest || typeof latest !== "object") return;
  if (op.entityType === "request") repo.upsertRequest(latest as never, false);
  if (op.entityType === "collection") repo.upsertCollection(latest as never, false);
  if (op.entityType === "folder") repo.upsertFolder(latest as never, false);
  if (op.entityType === "environment") repo.upsertEnvironment(latest as never, false);
  emit("sync.changed", { entityType: op.entityType, entityId: op.entityId, op: "upsert", payload: latest });
}

export async function acceptPendingInvites(token?: string) {
  if (!runtime.supabase || !runtime.user) return { accepted: 0 };
  const { data, error } = await runtime.supabase.functions.invoke("share-accept", { body: token ? { token } : {} });
  if (error) throw error;
  await hydrateFromCloud();
  return { accepted: Number(data?.accepted ?? 0) };
}

export async function listNotifications() {
  if (!runtime.supabase || !runtime.user) return [];
  const { data, error } = await runtime.supabase
    .from("notifications")
    .select("id, kind, title, body, payload, read_at, created_at")
    .eq("user_id", runtime.user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data ?? [];
}

export async function markNotificationRead(id: string) {
  if (!runtime.supabase) return;
  await runtime.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
}

export async function pullWorkspace(workspaceId: string) {
  if (!runtime.supabase) return;
  const repo = mustRepo();
  const after = repo.getCursor(workspaceId);
  const { data, error } = await runtime.supabase.functions.invoke("sync-pull", { body: { workspaceId, afterSeq: after } });
  if (error) throw error;
  const changes = (data?.changes ?? []) as ChangeLogRow[];
  for (const row of changes) {
    applyChange(row);
    repo.setCursor(workspaceId, row.seq);
  }
}

function applyChange(row: ChangeLogRow) {
  const repo = mustRepo();
  if (row.idempotencyKey && repo.hasIdempotency(row.idempotencyKey)) {
    if (row.workspaceId && row.seq) repo.setCursor(row.workspaceId, row.seq);
    return;
  }
  if (row.idempotencyKey) repo.rememberIdempotency(row.idempotencyKey);
  if (repo.hasPendingEntity(row.entityId)) {
    if (row.workspaceId && row.seq) repo.setCursor(row.workspaceId, row.seq);
    return;
  }
  if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload) || !("id" in row.payload)) return;
  const incoming = row.payload as { id: string; version?: number };
  const incomingVersion = Number(incoming.version ?? 0);
  const keepLocal = (localVersion: number | undefined) => localVersion != null && localVersion >= incomingVersion;
  if (row.op === "delete") {
    const stamp = new Date().toISOString();
    if (row.entityType === "request") {
      const local = repo.getRequest(incoming.id);
      if (keepLocal(local?.version)) return;
      repo.upsertRequest({ ...(incoming as object), deletedAt: stamp } as never, false);
    }
    if (row.entityType === "folder") {
      const local = repo.getFolder(incoming.id);
      if (keepLocal(local?.version)) return;
      repo.upsertFolder({ ...(incoming as object), deletedAt: stamp } as never, false);
    }
    if (row.entityType === "collection") {
      const local = repo.getCollection(incoming.id);
      if (keepLocal(local?.version)) return;
      repo.upsertCollection({ ...(incoming as object), deletedAt: stamp } as never, false);
    }
    if (row.entityType === "environment") {
      const local = repo.getEnvironment(incoming.id);
      if (keepLocal(local?.version)) return;
      repo.upsertEnvironment({ ...(incoming as object), deletedAt: stamp } as never, false);
    }
    emit("sync.changed", { entityType: row.entityType, entityId: row.entityId, op: "delete", version: incomingVersion, workspaceId: row.workspaceId, payload: incoming });
    return;
  }
  if (row.entityType === "request") {
    const local = repo.getRequest(incoming.id);
    if (keepLocal(local?.version)) {
      if (local && incomingVersion < local.version && row.workspaceId) repo.addConflict(row.workspaceId, incoming.id, { row, reason: "local_newer" });
      return;
    }
    repo.upsertRequest(incoming as never, false);
  }
  if (row.entityType === "collection") {
    const local = repo.getCollection(incoming.id);
    if (keepLocal(local?.version)) return;
    repo.upsertCollection(incoming as never, false);
  }
  if (row.entityType === "folder") {
    const local = repo.getFolder(incoming.id);
    if (keepLocal(local?.version)) return;
    repo.upsertFolder(incoming as never, false);
  }
  if (row.entityType === "environment") {
    const local = repo.getEnvironment(incoming.id);
    if (keepLocal(local?.version)) return;
    repo.upsertEnvironment(incoming as never, false);
  }
  if (row.entityType === "workspace") {
    const local = repo.getWorkspace(incoming.id);
    if (keepLocal(local?.version)) return;
    repo.upsertWorkspace(incoming as never, false);
  }
  emit("sync.changed", {
    entityType: row.entityType,
    entityId: row.entityId,
    op: row.op,
    version: incomingVersion,
    workspaceId: row.workspaceId,
    payload: incoming
  });
}

let subscribed = false;
let realtimeChannel: ReturnType<NonNullable<typeof runtime.supabase>["channel"]> | null = null;
function subscribeRealtime() {
  if (!runtime.supabase || !runtime.user || subscribed) return;
  subscribed = true;
  realtimeChannel = runtime.supabase
    .channel("changes")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "change_log" }, (payload) => {
      const raw = payload.new as Record<string, unknown>;
      applyChange({
        seq: Number(raw.seq),
        workspaceId: String(raw.workspaceId ?? raw.workspace_id ?? ""),
        entityType: (raw.entityType ?? raw.entity_type) as ChangeLogRow["entityType"],
        entityId: String(raw.entityId ?? raw.entity_id ?? ""),
        op: raw.op as ChangeLogRow["op"],
        version: Number(raw.version),
        payload: raw.payload,
        actorId: String(raw.actorId ?? raw.actor_id ?? ""),
        idempotencyKey: String(raw.idempotencyKey ?? raw.idempotency_key ?? ""),
        createdAt: String(raw.createdAt ?? raw.created_at ?? "")
      });
      emit("sync.live", payload.new);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "memberships" }, () => {
      void hydrateFromCloud();
    })
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${runtime.user.id}` },
      (payload) => {
        emit("notify", payload.new);
      }
    )
    .on("postgres_changes", { event: "*", schema: "public", table: "resource_shares" }, () => {
      void hydrateFromCloud();
    })
    .subscribe();
}

export function statusPayload() {
  const pending = runtime.repo?.pendingOps().length ?? 0;
  return {
    state: runtime.sync,
    error: runtime.syncError,
    pending,
    user: publicUser(),
    cloudConfigured: isCloudConfigured(),
    hydration: runtime.lastHydration
  };
}
