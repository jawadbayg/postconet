import { createClient, type Session } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl, isCloudConfigured } from "../config.js";
import { runtime } from "./state.js";
import { saveSession, clearSession, loadSession } from "./session.js";
import { closeAccount, openAccount, mustRepo } from "./studio.js";
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
    options: { data: { display_name: displayName } }
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
  subscribeRealtime();
  return publicUser();
}

export async function signOut() {
  await runtime.supabase?.auth.signOut();
  clearSession();
  runtime.user = null;
  closeAccount();
  openAccount("local");
}

export async function resetPassword(email: string) {
  if (!runtime.supabase) runtime.supabase = createAuthedClient();
  if (!runtime.supabase) throw new Error("Cloud is not configured");
  const { error } = await runtime.supabase.auth.resetPasswordForEmail(email);
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
    repo.upsertWorkspace(
      {
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
      } as never,
      false
    );
    await pullEntity("collections", ws.id, (row) => repo.upsertCollection(row.payload as never, false));
    await pullEntity("folders", ws.id, (row) => repo.upsertFolder(row.payload as never, false));
    await pullEntity("requests", ws.id, (row) => repo.upsertRequest(row.payload as never, false));
    await pullEntity("environments", ws.id, (row) => repo.upsertEnvironment(row.payload as never, false));
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
  for (const op of ops) {
    if (applied.has(op.idempotencyKey)) repo.ackOp(op.id);
    else repo.markOp(op.id, "failed", "rejected");
  }
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
  const payload = row.payload;
  if (row.op === "delete") {
    if (row.entityType === "request" && payload && typeof payload === "object") {
      repo.upsertRequest({ ...(payload as never), deletedAt: new Date().toISOString() }, false);
    }
    return;
  }
  if (row.entityType === "request") repo.upsertRequest(payload as never, false);
  if (row.entityType === "collection") repo.upsertCollection(payload as never, false);
  if (row.entityType === "folder") repo.upsertFolder(payload as never, false);
  if (row.entityType === "environment") repo.upsertEnvironment(payload as never, false);
  if (row.entityType === "workspace") repo.upsertWorkspace(payload as never, false);
}

let subscribed = false;
function subscribeRealtime() {
  if (!runtime.supabase || subscribed) return;
  subscribed = true;
  runtime.supabase
    .channel("changes")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "change_log" }, (payload) => {
      applyChange(payload.new as ChangeLogRow);
      emit("sync.live", payload.new);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "memberships" }, () => {
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
