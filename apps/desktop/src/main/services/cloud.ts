import { createClient, type Session, type User } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl, isCloudConfigured } from "../config.js";
import { runtime } from "./state.js";
import { saveSession, clearSession, loadSession } from "./session.js";
import {
  closeAccount,
  openAccount,
  mustRepo,
  ensureWorkspaceIfEmpty,
  captureLocalSnapshot,
  summarizeLocalSnapshot,
  localSnapshotHasData,
  importLocalSnapshot,
  wipeClosedAccount,
  resetLocalAccountFiles,
  type LocalSnapshot,
  type LocalDataSummary
} from "./studio.js";
import { sameEntityContent, summarizeState, type ChangeLogRow } from "@postconet/core";
import { app, BrowserWindow, net, powerMonitor } from "electron";

const SESSION_EXPIRED = "Your session expired. Sign out, then sign in again to resume sync.";

export function createAuthedClient() {
  if (!isCloudConfigured()) return null;
  const client = createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false }
  });
  // Supabase rotates the refresh token on every renewal. Persist each rotation, or the next
  // app start presents an already-used refresh token and every cloud call becomes "unauthorized".
  client.auth.onAuthStateChange((event, session) => {
    if (session?.refresh_token) {
      saveSession(session);
      if (runtime.syncError === SESSION_EXPIRED) {
        runtime.syncError = null;
        refreshStatus();
      }
      return;
    }
    if (event === "SIGNED_OUT" && runtime.user && !signingOut) markSessionExpired();
  });
  return client;
}

let signingOut = false;

async function adoptSession(client: NonNullable<typeof runtime.supabase>, session: Session): Promise<boolean> {
  const { data, error } = await client.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
  if (error || !data.session) return false;
  saveSession(data.session);
  return true;
}

function markSessionExpired() {
  runtime.sync = "failed";
  runtime.syncError = SESSION_EXPIRED;
  emit("sync.status", statusPayload());
}

/** Returns a live access token, refreshing if needed; null (and a visible status) when the session is gone. */
export async function ensureSession(): Promise<string | null> {
  if (!runtime.supabase || !runtime.user) return null;
  const { data, error } = await runtime.supabase.auth.getSession();
  const token = data.session?.access_token ?? null;
  if (error || !token) {
    markSessionExpired();
    return null;
  }
  return token;
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
    lastError: runtime.syncError ?? runtime.repo?.firstFailedError() ?? null
  });
  emit("sync.status", statusPayload());
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let flushAgain = false;
let lastReconcile = 0;
let queueReconciled = false;

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
    if (!(await ensureSession())) return;
    await reconcileUnsyncedOnce();
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
  runtime.supabase = createAuthedClient();
  if (!session || !runtime.supabase) return { user: null, cloudConfigured: true };
  const adopted = await adoptSession(runtime.supabase, session);
  if (!adopted) {
    clearSession();
    return { user: null, cloudConfigured: true };
  }
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
  if (!isCloudConfigured()) {
    throw new Error("Cloud is not configured for this build. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }
  if (!runtime.supabase) runtime.supabase = createAuthedClient();
  const res = await fetch(`${supabaseUrl().replace(/\/$/, "")}/functions/v1/register`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey(),
      Authorization: `Bearer ${supabaseAnonKey()}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password, displayName })
  });
  type RegisterPayload = { error?: string; message?: string; user?: { id: string; email?: string } };
  let payload: RegisterPayload | null = null;
  const raw = await res.text();
  try {
    payload = raw ? (JSON.parse(raw) as RegisterPayload) : null;
  } catch {
    throw new Error(raw.slice(0, 180) || `Could not create the account (${res.status}).`);
  }
  const code = payload?.error || payload?.message || "";
  if (code === "email_taken" || res.status === 409) {
    throw new Error("That email already has an account. Sign in instead.");
  }
  if (code === "password_invalid" || code === "password_too_short") {
    throw new Error("Could not create the account. Use at least 6 characters, with a letter and a number.");
  }
  if (!res.ok || !payload?.user) {
    throw new Error(code || `Could not create the account (${res.status}). Deploy the register function with Verify JWT off.`);
  }
  return { needsVerification: false, user: payload.user };
}

async function functionInvokeDetail(error: unknown): Promise<string> {
  const err = error as { message?: string; context?: Response } | null;
  const fallback = err?.message || "Sync request failed";
  try {
    const res = err?.context;
    if (!res) return fallback;
    const body = await res.clone().text();
    if (!body) return `${fallback} (${res.status})`;
    try {
      const parsed = JSON.parse(body) as { error?: string; message?: string };
      const reason = parsed.error || parsed.message;
      if (reason) return reason;
    } catch {
      return body.slice(0, 180);
    }
    return `${fallback} (${res.status})`;
  } catch {
    return fallback;
  }
}

let pendingLocalSnapshot: LocalSnapshot | null = null;
let pendingUser: User | null = null;

export async function signIn(email: string, password: string) {
  if (!runtime.supabase && isCloudConfigured()) runtime.supabase = createAuthedClient();
  if (!runtime.supabase) throw new Error("Cloud is not configured for this build.");
  const { data, error } = await runtime.supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  if (!data.session || !data.user) throw new Error("Sign-in did not return a session");
  saveSession(data.session);
  pendingUser = data.user;
  const snapshot = captureLocalSnapshot();
  pendingLocalSnapshot = snapshot;
  const localData = summarizeLocalSnapshot(snapshot);
  if (localSnapshotHasData(snapshot)) {
    return {
      user: { id: data.user.id, email: data.user.email ?? "", displayName: (data.user.user_metadata?.display_name as string) ?? "" },
      pending: true,
      localData
    };
  }
  await completeSignIn(false);
  return { user: publicUser(), pending: false, localData: null as LocalDataSummary | null };
}

export async function completeSignIn(mergeLocal: boolean) {
  const user = pendingUser ?? runtime.user;
  if (!user) throw new Error("Sign in first.");
  const snapshot = pendingLocalSnapshot;
  pendingLocalSnapshot = null;
  pendingUser = null;
  runtime.user = user;
  closeAccount();
  openAccount(user.id);
  await hydrateFromCloud();
  ensureWorkspaceIfEmpty(user.id);
  if (mergeLocal && snapshot && localSnapshotHasData(snapshot)) {
    importLocalSnapshot(snapshot);
    await flushSync();
    resetLocalAccountFiles();
    if (!runtime.repo) openAccount(user.id);
  }
  await acceptPendingInvites();
  subscribeRealtime();
  emit("sync.status", statusPayload());
  return publicUser();
}

export async function signOut() {
  const accountId = runtime.user?.id;
  if (realtimeChannel && runtime.supabase) {
    await runtime.supabase.removeChannel(realtimeChannel);
  }
  realtimeChannel = null;
  subscribed = false;
  pendingLocalSnapshot = null;
  pendingUser = null;
  queueReconciled = false;
  signingOut = true;
  try {
    await runtime.supabase?.auth.signOut();
  } catch {
    /* already signed out server-side; local cleanup still runs */
  }
  signingOut = false;
  clearSession();
  runtime.user = null;
  runtime.sync = "offline";
  runtime.syncError = null;
  runtime.lastHydration = null;
  closeAccount();
  if (accountId) wipeClosedAccount(accountId);
  openAccount("local");
  ensureWorkspaceIfEmpty("local");
  const payload = statusPayload();
  emit("sync.status", payload);
  return payload;
}

export async function resetPassword(_email: string) {
  throw new Error("Email password reset is disabled in this version. Ask an admin to create a new in-app account, or sign in with the existing password.");
}

export async function updatePassword(password: string) {
  if (!runtime.supabase) throw new Error("Not signed in");
  const { error } = await runtime.supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function hydrateFromCloud() {
  if (!runtime.supabase || !runtime.user) return;
  if (!(await ensureSession())) return;
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
  repo.recoverSendingOps();
  repo.requeueRetryableOps();
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
    const cloudCollections = await pullEntity("collections", ws.id, (row) => {
      const incoming = cloudRowToEntity(row);
      if (!incoming || repo.hasPendingEntity(incoming.id)) return;
      const local = repo.getCollection(incoming.id);
      if (!local || incoming.version > local.version || (incoming.deletedAt && !local.deletedAt)) repo.upsertCollection(incoming as never, false);
    });
    const cloudFolders = await pullEntity("folders", ws.id, (row) => {
      const incoming = cloudRowToEntity(row);
      if (!incoming || repo.hasPendingEntity(incoming.id)) return;
      const local = repo.getFolder(incoming.id);
      if (!local || incoming.version > local.version || (incoming.deletedAt && !local.deletedAt)) repo.upsertFolder(incoming as never, false);
    });
    const cloudRequests = await pullEntity("requests", ws.id, (row) => {
      const incoming = cloudRowToEntity(row);
      if (!incoming || repo.hasPendingEntity(incoming.id)) return;
      const local = repo.getRequest(incoming.id);
      if (!local || incoming.version > local.version || (incoming.deletedAt && !local.deletedAt)) repo.upsertRequest(incoming as never, false);
    });
    const cloudEnvs = await pullEntity("environments", ws.id, (row) => {
      const incoming = cloudRowToEntity(row);
      if (!incoming || repo.hasPendingEntity(incoming.id)) return;
      const local = repo.getEnvironment(incoming.id);
      if (!local || incoming.version > local.version || (incoming.deletedAt && !local.deletedAt)) repo.upsertEnvironment(incoming as never, false);
    });
    enqueueMissingCloudEntities(ws.id, cloudCollections, cloudFolders, cloudRequests, cloudEnvs);
    const cursor = await runtime.supabase.from("change_log").select("seq").eq("workspace_id", ws.id).order("seq", { ascending: false }).limit(1);
    repo.setCursor(ws.id, cursor.data?.[0]?.seq ?? 0);
  }
  await reconcileUnsyncedOnce();
  await pushQueue();
  runtime.sync = summarizeState({
    online: true,
    pending: repo.pendingOps().length,
    conflicts: 0,
    lastError: repo.firstFailedError()
  });
  runtime.lastHydration = { phase: "Ready" };
  emit("sync.progress", runtime.lastHydration);
  emit("sync.status", statusPayload());
}

type CloudRow = { id?: string; version?: number | string; deleted_at?: string | null; updated_at?: string; payload: unknown };

/**
 * Deletes and version bumps live in the row columns, not inside the JSON payload
 * (a delete never rewrites the payload). Merge them so a deleted item is not revived locally.
 */
function cloudRowToEntity(row: CloudRow): { id: string; version: number; deletedAt: string | null } & Record<string, unknown> | null {
  const payload = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>;
  const id = String(row.id ?? payload.id ?? "");
  if (!id) return null;
  const payloadVersion = Number(payload.version ?? 0);
  const rowVersion = Number(row.version ?? payloadVersion);
  const deletedAt = (row.deleted_at as string | null | undefined) ?? (payload.deletedAt as string | null | undefined) ?? null;
  return {
    ...payload,
    id,
    version: Math.max(rowVersion, payloadVersion),
    deletedAt,
    updatedAt: (deletedAt && row.updated_at) || (payload.updatedAt as string | undefined) || row.updated_at || new Date().toISOString()
  };
}

async function pullEntity(table: string, workspaceId: string, apply: (row: CloudRow) => void): Promise<Set<string>> {
  const { data } = await runtime.supabase!.from(table).select("id, version, deleted_at, updated_at, payload").eq("workspace_id", workspaceId);
  const ids = new Set<string>();
  for (const row of data ?? []) {
    const record = row as CloudRow;
    if (record.id) ids.add(record.id);
    const payload = record.payload as { id?: string } | null;
    if (payload?.id) ids.add(payload.id);
    apply(record);
  }
  return ids;
}

function parentFirstFolders<T extends { id: string; parentId: string | null }>(folders: T[]): T[] {
  const remaining = [...folders];
  const out: T[] = [];
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

async function versionsInCloud(table: string, workspaceId: string): Promise<Map<string, number>> {
  if (!runtime.supabase) return new Map();
  const { data } = await runtime.supabase.from(table).select("id, version").eq("workspace_id", workspaceId);
  const out = new Map<string, number>();
  for (const row of data ?? []) {
    const r = row as { id: string; version: number | string };
    out.set(String(r.id), Number(r.version));
  }
  return out;
}

async function reconcileUnsyncedOnce() {
  if (queueReconciled || !runtime.supabase || !runtime.repo || !runtime.user) return;
  const repo = runtime.repo;
  repo.recoverSendingOps();
  repo.requeueRetryableOps();
  for (const ws of repo.listWorkspaces()) {
    const [cloudCollections, cloudFolders, cloudRequests, cloudEnvs] = await Promise.all([
      versionsInCloud("collections", ws.id),
      versionsInCloud("folders", ws.id),
      versionsInCloud("requests", ws.id),
      versionsInCloud("environments", ws.id)
    ]);
    enqueueMissingCloudEntities(
      ws.id,
      new Set(cloudCollections.keys()),
      new Set(cloudFolders.keys()),
      new Set(cloudRequests.keys()),
      new Set(cloudEnvs.keys())
    );
    // Old conflict notices are stale once the local copy matches the server copy.
    for (const conflict of repo.unresolvedConflictEntities()) {
      if (conflict.workspaceId !== ws.id || repo.hasPendingEntity(conflict.entityId)) continue;
      const localVersion =
        repo.getRequest(conflict.entityId)?.version ??
        repo.getFolder(conflict.entityId)?.version ??
        repo.getCollection(conflict.entityId)?.version ??
        repo.getEnvironment(conflict.entityId)?.version;
      const cloudVersion =
        cloudRequests.get(conflict.entityId) ??
        cloudFolders.get(conflict.entityId) ??
        cloudCollections.get(conflict.entityId) ??
        cloudEnvs.get(conflict.entityId);
      if (localVersion == null || cloudVersion == null || localVersion === cloudVersion) {
        repo.resolveConflictsForEntity(ws.id, conflict.entityId);
      }
    }
  }
  queueReconciled = true;
}

function enqueueMissingCloudEntities(
  workspaceId: string,
  cloudCollections: Set<string>,
  cloudFolders: Set<string>,
  cloudRequests: Set<string>,
  cloudEnvs: Set<string>
) {
  const repo = mustRepo();
  for (const col of repo.listCollections(workspaceId)) {
    if (!col.deletedAt && !cloudCollections.has(col.id)) repo.upsertCollection(col, true);
    for (const folder of parentFirstFolders(repo.listFolders(col.id))) {
      if (!folder.deletedAt && !cloudFolders.has(folder.id)) repo.upsertFolder(folder, true);
    }
    for (const req of repo.listRequests(col.id)) {
      if (!req.deletedAt && !cloudRequests.has(req.id)) repo.upsertRequest(req, true);
    }
  }
  for (const env of repo.listEnvironments(workspaceId)) {
    if (!env.deletedAt && !cloudEnvs.has(env.id)) repo.upsertEnvironment(env, true);
  }
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
  repo.recoverSendingOps();
  const ops = repo.pendingOps();
  if (ops.length === 0) return { rejected: [] };
  if (!(await ensureSession())) return { rejected: [] };
  for (const op of ops) repo.markSending(op.id);
  const { data, error } = await runtime.supabase.functions.invoke("sync-push", { body: { ops } });
  if (error) {
    const detail = await functionInvokeDetail(error);
    const expired = /unauthorized|invalid jwt|jwt expired/i.test(detail);
    runtime.sync = "failed";
    runtime.syncError = expired ? SESSION_EXPIRED : detail;
    // Leave the ops retryable; a transport/auth failure is not a verdict on the data.
    for (const op of ops) repo.markOp(op.id, "pending", expired ? SESSION_EXPIRED : detail);
    emit("sync.status", statusPayload());
    return { rejected: [] };
  }
  const applied = new Set((data?.applied ?? []).map((a: { idempotencyKey: string }) => a.idempotencyKey));
  const rejected = (data?.rejected ?? []) as PushReject[];
  for (const op of ops) {
    if (applied.has(op.idempotencyKey)) {
      repo.ackOp(op.id);
      repo.rememberIdempotency(op.idempotencyKey);
      if (op.workspaceId) repo.resolveConflictsForEntity(op.workspaceId, op.entityId);
      continue;
    }
    const hit = rejected.find((r) => r.idempotencyKey === op.idempotencyKey);
    const reason = hit?.reason ?? "rejected";
    if (reason.startsWith("write_failed")) {
      repo.markOp(op.id, "failed", reason.replace(/^write_failed:/, "") || reason);
    } else if ((reason === "conflict" || reason === "deleted") && op.workspaceId) {
      revertStaleOp(op, hit);
      const silent = reason === "conflict" && sameEntityContent(op.payload, hit?.current);
      if (!silent) repo.addConflict(op.workspaceId, op.entityId, { op, reason, latest: hit?.current });
      repo.rejectOp(op.id, reason === "deleted" ? "Remote item was deleted." : silent ? "Already on server." : "Remote version is newer.");
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
  const changes = (data?.changes ?? []) as Record<string, unknown>[];
  for (const raw of changes) {
    const row = normalizeChangeLogRow(raw);
    if (!row) continue;
    applyChange(row);
    repo.setCursor(workspaceId, row.seq);
  }
}

function normalizeChangeLogRow(raw: Record<string, unknown>): ChangeLogRow | null {
  const entityId = String(raw.entityId ?? raw.entity_id ?? "");
  const workspaceId = String(raw.workspaceId ?? raw.workspace_id ?? "");
  const entityType = (raw.entityType ?? raw.entity_type) as ChangeLogRow["entityType"] | undefined;
  const op = raw.op as ChangeLogRow["op"] | undefined;
  if (!entityId || !workspaceId || !entityType || (op !== "upsert" && op !== "delete")) return null;
  return {
    seq: Number(raw.seq ?? 0),
    workspaceId,
    entityType,
    entityId,
    op,
    version: Number(raw.version ?? 0),
    payload: raw.payload,
    actorId: String(raw.actorId ?? raw.actor_id ?? ""),
    idempotencyKey: String(raw.idempotencyKey ?? raw.idempotency_key ?? ""),
    createdAt: String(raw.createdAt ?? raw.created_at ?? "")
  };
}

function applyChange(row: ChangeLogRow) {
  const repo = mustRepo();
  if (!row.entityId) return;
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
      const row = normalizeChangeLogRow(payload.new as Record<string, unknown>);
      if (row) applyChange(row);
      emit("sync.live", payload.new);
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "memberships" }, () => {
      void hydrateFromCloud();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "workspace_members" }, () => {
      void hydrateFromCloud();
    })
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${runtime.user.id}` },
      (payload) => {
        emit("notify", payload.new);
        void hydrateFromCloud();
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
