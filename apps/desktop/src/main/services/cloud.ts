import { createClient, type Session } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl, isCloudConfigured } from "../config.js";
import { runtime } from "./state.js";
import { saveSession, clearSession, loadSession } from "./session.js";
import { closeAccount, openAccount, mustRepo, ensureWorkspaceIfEmpty } from "./studio.js";
import { summarizeState, type ChangeLogRow } from "@postconet/core";
import { BrowserWindow } from "electron";

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
      const local = repo.getCollection(incoming.id);
      if (!local || incoming.version > local.version) repo.upsertCollection(row.payload as never, false);
    });
    await pullEntity("folders", ws.id, (row) => {
      const incoming = row.payload as { id: string; version: number };
      const local = repo.getFolder(incoming.id);
      if (!local || incoming.version > local.version) repo.upsertFolder(row.payload as never, false);
    });
    await pullEntity("requests", ws.id, (row) => {
      const incoming = row.payload as { id: string; version: number };
      const local = repo.getRequest(incoming.id);
      if (!local || incoming.version > local.version) repo.upsertRequest(row.payload as never, false);
    });
    await pullEntity("environments", ws.id, (row) => {
      const incoming = row.payload as { id: string; version: number };
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

export async function pushQueue() {
  if (!runtime.supabase || !runtime.user) return;
  const repo = mustRepo();
  const ops = repo.pendingOps();
  if (ops.length === 0) return;
  const { data, error } = await runtime.supabase.functions.invoke("sync-push", { body: { ops } });
  if (error) {
    runtime.sync = "failed";
    runtime.syncError = error.message;
    for (const op of ops) repo.markOp(op.id, "failed", error.message);
    emit("sync.status", statusPayload());
    return;
  }
  const applied = new Set((data?.applied ?? []).map((a: { idempotencyKey: string }) => a.idempotencyKey));
  const rejected = (data?.rejected ?? []) as Array<{ idempotencyKey: string; reason: string }>;
  for (const op of ops) {
    if (applied.has(op.idempotencyKey)) {
      repo.ackOp(op.id);
      continue;
    }
    const reason = rejected.find((r) => r.idempotencyKey === op.idempotencyKey)?.reason ?? "rejected";
    if (reason === "conflict" && op.workspaceId) {
      repo.addConflict(op.workspaceId, op.entityId, { op, reason });
      repo.markOp(op.id, "conflict", "Remote version is newer. Your local edit was kept and flagged.");
    } else {
      repo.markOp(op.id, "failed", reason);
    }
  }
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
  if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload) || !("id" in row.payload)) return;
  const incoming = row.payload as { id: string; version?: number };
  const incomingVersion = Number(incoming.version ?? 0);
  const keepLocal = (localVersion: number | undefined) => localVersion != null && localVersion >= incomingVersion;
  if (row.op === "delete") {
    if (row.entityType === "request") {
      const local = repo.getRequest(incoming.id);
      if (keepLocal(local?.version)) {
        if (row.workspaceId) repo.addConflict(row.workspaceId, incoming.id, { row, reason: "local_newer" });
        return;
      }
      repo.upsertRequest({ ...(incoming as object), deletedAt: new Date().toISOString() } as never, false);
    }
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
