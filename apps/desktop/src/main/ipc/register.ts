import { BrowserWindow, ipcMain, shell, dialog } from "electron";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  executeHttp,
  detectAndImport,
  exportPostmanCollection,
  exportPostmanEnvironment,
  exportCurl,
  generateSnippets,
  cookieHeaderFor,
  storeSetCookies,
  listCookies,
  type AuthConfig,
  type HttpRequestDocument,
  type SavedRequest,
  type Environment,
  mcpInitializeHttp,
  mcpStartStdio
} from "@postconet/core";
import { runtime } from "../services/state.js";
import {
  mustRepo,
  tree,
  createCollection,
  createFolder,
  createRequest,
  createEnvironment,
  renameEntity,
  renameWorkspace,
  listWorkspacesForUi,
  deleteEntity,
  moveFolder,
  moveRequest,
  saveRequestDocument,
  saveEnvironmentDocument
} from "../services/studio.js";
import {
  signIn,
  completeSignIn,
  signUp,
  signOut,
  resetPassword,
  updatePassword,
  publicUser,
  statusPayload,
  pushQueue,
  flushSync,
  hydrateFromCloud,
  acceptPendingInvites,
  listNotifications,
  markNotificationRead
} from "../services/cloud.js";
import { inviteShare, listShares, manageShare } from "../services/share.js";
import { isCloudConfigured } from "../config.js";
import { closeConnection, openConnection, sendConnection } from "../services/connections.js";
import { authorizeInSystemBrowser } from "../services/oauth-loopback.js";
import { signInSchema, signUpSchema } from "@postconet/core";

function ok<T>(data: T) {
  return { ok: true as const, data };
}
function fail(message: string) {
  return { ok: false as const, error: message };
}

async function handle<T>(fn: () => Promise<T> | T) {
  try {
    return ok(await fn());
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : error && typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string"
          ? (error as { message: string }).message
          : String(error ?? "Unknown error");
    return fail(message);
  }
}

function bindIpc(channel: string, listener: Parameters<typeof ipcMain.handle>[1]) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, listener);
}

export function registerIpc() {
  bindIpc("app.brand", () => handle(async () => (await import("@postconet/core")).brand));
  bindIpc("app.cloudConfigured", () => ok(isCloudConfigured()));

  bindIpc("auth.session", () => ok(statusPayload()));
  bindIpc("auth.signUp", (_e, raw) =>
    handle(async () => {
      const input = signUpSchema.parse(raw);
      return signUp(input.email, input.password, input.displayName);
    })
  );
  bindIpc("auth.signIn", (_e, raw) =>
    handle(async () => {
      const input = signInSchema.parse(raw);
      return signIn(input.email, input.password);
    })
  );
  bindIpc("auth.completeSignIn", (_e, raw) =>
    handle(async () => {
      const { mergeLocal } = z.object({ mergeLocal: z.boolean() }).parse(raw);
      return completeSignIn(mergeLocal);
    })
  );
  bindIpc("auth.signOut", () => handle(() => signOut()));
  bindIpc("auth.resetPassword", (_e, raw) =>
    handle(async () => {
      const { email } = z.object({ email: z.string().email() }).parse(raw);
      await resetPassword(email);
      return { sent: true };
    })
  );
  bindIpc("auth.updatePassword", (_e, raw) =>
    handle(async () => {
      const { password } = z.object({ password: z.string().min(8) }).parse(raw);
      await updatePassword(password);
      return { updated: true };
    })
  );

  bindIpc("workspace.list", () => handle(() => listWorkspacesForUi()));
  bindIpc("workspace.renameWorkspace", (_e, raw) =>
    handle(() => {
      const p = z.object({ id: z.string(), name: z.string().min(1) }).parse(raw);
      return renameWorkspace(p.id, p.name);
    })
  );
  bindIpc("workspace.tree", (_e, raw) =>
    handle(() => {
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(raw);
      return tree(workspaceId);
    })
  );
  bindIpc("workspace.createCollection", (_e, raw) =>
    handle(() => {
      const { workspaceId, name } = z.object({ workspaceId: z.string(), name: z.string().min(1) }).parse(raw);
      return createCollection(workspaceId, name);
    })
  );
  bindIpc("workspace.createFolder", (_e, raw) =>
    handle(() => {
      const p = z.object({ workspaceId: z.string(), collectionId: z.string(), parentId: z.string().nullable(), name: z.string() }).parse(raw);
      return createFolder(p.workspaceId, p.collectionId, p.parentId, p.name);
    })
  );
  bindIpc("workspace.createRequest", (_e, raw) =>
    handle(() => {
      const p = z.object({ workspaceId: z.string(), collectionId: z.string(), folderId: z.string().nullable(), name: z.string() }).parse(raw);
      return createRequest(p);
    })
  );
  bindIpc("workspace.createEnvironment", (_e, raw) =>
    handle(() => {
      const p = z.object({ workspaceId: z.string(), name: z.string() }).parse(raw);
      return createEnvironment(p.workspaceId, p.name);
    })
  );
  bindIpc("workspace.saveRequest", (_e, raw) =>
    handle(async () => {
      const body = (raw ?? {}) as SavedRequest & {
        request?: SavedRequest;
        overwrite?: boolean;
        expectedLatest?: number;
      };
      const incoming = (body.request ?? body) as SavedRequest;
      const result = await saveRequestDocument(incoming, {
        overwrite: body.overwrite,
        expectedLatest: body.expectedLatest
      });
      if (result.status === "conflict") return result;
      if (runtime.user && runtime.supabase) {
        await pushQueue();
        const latest = mustRepo().getRequest(incoming.id);
        if (!latest || latest.deletedAt) {
          return { status: "conflict" as const, draft: incoming, latest: latest ?? result.request, deleted: true };
        }
        if (latest.version !== result.request.version) {
          return { status: "conflict" as const, draft: incoming, latest };
        }
      }
      return result;
    })
  );
  bindIpc("workspace.saveEnvironment", (_e, raw) =>
    handle(async () => {
      const env = raw as Environment;
      const saved = await saveEnvironmentDocument(env);
      if (runtime.user && runtime.supabase) await pushQueue();
      return saved;
    })
  );
  bindIpc("workspace.rename", (_e, raw) =>
    handle(() => {
      const p = z.object({ type: z.enum(["collection", "folder", "request", "environment"]), id: z.string(), name: z.string() }).parse(raw);
      return renameEntity(p.type, p.id, p.name);
    })
  );
  bindIpc("workspace.delete", (_e, raw) =>
    handle(() => {
      const p = z.object({ type: z.enum(["collection", "folder", "request", "environment"]), id: z.string() }).parse(raw);
      return deleteEntity(p.type, p.id);
    })
  );
  bindIpc("workspace.moveFolder", (_e, raw) =>
    handle(() => {
      const p = z.object({ folderId: z.string(), collectionId: z.string(), parentId: z.string().nullable() }).parse(raw);
      return moveFolder(p.folderId, p.collectionId, p.parentId);
    })
  );
  bindIpc("workspace.moveRequest", (_e, raw) =>
    handle(() => {
      const p = z.object({ requestId: z.string(), collectionId: z.string(), folderId: z.string().nullable() }).parse(raw);
      return moveRequest(p.requestId, p.collectionId, p.folderId);
    })
  );

  bindIpc("share.invite", (_e, raw) =>
    handle(() =>
      inviteShare(
        z
          .object({
            workspaceId: z.string(),
            resourceKind: z.enum(["workspace", "collection", "folder", "request"]),
            resourceId: z.string().optional(),
            email: z.string().email(),
            role: z.enum(["viewer", "editor"])
          })
          .parse(raw)
      )
    )
  );
  bindIpc("share.list", (_e, raw) =>
    handle(() =>
      listShares(
        z
          .object({
            workspaceId: z.string(),
            resourceKind: z.enum(["workspace", "collection", "folder", "request"]),
            resourceId: z.string().optional()
          })
          .parse(raw)
      )
    )
  );
  bindIpc("share.manage", (_e, raw) => handle(() => manageShare(z.record(z.unknown()).parse(raw))));
  bindIpc("share.acceptPending", (_e, raw) =>
    handle(() => acceptPendingInvites(z.object({ token: z.string().optional() }).parse(raw ?? {}).token))
  );
  bindIpc("notifications.list", () => handle(() => listNotifications()));
  bindIpc("notifications.read", (_e, raw) =>
    handle(async () => {
      const { id } = z.object({ id: z.string() }).parse(raw);
      await markNotificationRead(id);
      return true;
    })
  );

  bindIpc("settings.get", () =>
    handle(() => {
      const raw = mustRepo().getMeta("ui_settings");
      return { ...defaultSettings(), ...(raw ? JSON.parse(raw) : {}) };
    })
  );
  bindIpc("settings.set", (_e, raw) =>
    handle(() => {
      const prev = mustRepo().getMeta("ui_settings");
      const next = { ...defaultSettings(), ...(prev ? JSON.parse(prev) : {}), ...(raw as object) };
      mustRepo().setMeta("ui_settings", JSON.stringify(next));
      return next;
    })
  );
  bindIpc("history.clear", (_e, raw) =>
    handle(() => {
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(raw);
      mustRepo().clearHistory(workspaceId);
      return true;
    })
  );
  bindIpc("sync.conflicts", (_e, raw) =>
    handle(() => {
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(raw);
      return mustRepo().listConflicts(workspaceId);
    })
  );

  bindIpc("request.send", (_e, raw) =>
    handle(async () => {
      const p = z
        .object({
          executionId: z.string(),
          workspaceId: z.string(),
          requestId: z.string().optional(),
          document: z.custom<HttpRequestDocument>(),
          authChain: z.custom<AuthConfig[]>(),
          environmentId: z.string().nullable().optional()
        })
        .parse(raw);
      const repo = mustRepo();
      const env = p.environmentId ? repo.listEnvironments(p.workspaceId).find((e) => e.id === p.environmentId) : undefined;
      const globals = repo.getGlobals(p.workspaceId);
      const collectionId = p.requestId ? repo.getRequest(p.requestId)?.collectionId : undefined;
      const collection = collectionId ? repo.listCollections(p.workspaceId).find((c) => c.id === collectionId) : undefined;
      const controller = new AbortController();
      runtime.abort.set(p.executionId, controller);
      const jar = repo.getCookieJar(p.workspaceId);
      const urlForCookies = (p.document as HttpRequestDocument).url;
      const cookies = await cookieHeaderFor(jar, interpolatePreview(urlForCookies, env?.values ?? []));
      const result = await executeHttp({
        document: p.document,
        authChain: p.authChain,
        scopes: { environment: env?.values, collection: collection?.variables, global: globals },
        cookies,
        signal: controller.signal
      });
      runtime.abort.delete(p.executionId);
      if (result.cookies.length) {
        const next = await storeSetCookies(jar, result.url, result.cookies.map((c) => c.value));
        repo.setCookieJar(p.workspaceId, next);
      }
      const ui = JSON.parse(repo.getMeta("ui_settings") || "{}") as { historyEnabled?: boolean };
      if (ui.historyEnabled !== false) repo.addHistory(p.workspaceId, p.requestId, {
        status: result.status,
        url: result.url,
        method: p.document.method,
        elapsedMs: result.elapsedMs,
        truncated: result.truncated,
        bodyPreview: result.bodyText.slice(0, 2000),
        document: p.document,
        name: p.requestId ? repo.getRequest(p.requestId)?.name : undefined,
        requestId: p.requestId
      });
      return {
        ...result,
        body: undefined,
        bodyBase64: result.body.toString("base64")
      };
    })
  );
  bindIpc("request.cancel", (_e, raw) =>
    handle(() => {
      const { executionId } = z.object({ executionId: z.string() }).parse(raw);
      runtime.abort.get(executionId)?.abort();
      return { cancelled: true };
    })
  );

  bindIpc("history.list", (_e, raw) =>
    handle(() => {
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(raw);
      return mustRepo().listHistory(workspaceId);
    })
  );
  bindIpc("cookies.list", (_e, raw) =>
    handle(async () => {
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(raw);
      return listCookies(mustRepo().getCookieJar(workspaceId));
    })
  );
  bindIpc("search.query", (_e, raw) =>
    handle(() => {
      const { q } = z.object({ q: z.string() }).parse(raw);
      return mustRepo().search(q);
    })
  );
  bindIpc("layout.save", (_e, raw) =>
    handle(() => {
      mustRepo().saveTabs(raw);
      return true;
    })
  );
  bindIpc("layout.load", () => handle(() => mustRepo().loadTabs()));

  bindIpc("import.preview", (_e, raw) =>
    handle(() => {
      const { text, workspaceId } = z.object({ text: z.string(), workspaceId: z.string() }).parse(raw);
      return detectAndImport(text, workspaceId);
    })
  );
  bindIpc("import.commit", (_e, raw) =>
    handle(() => {
      const preview = raw as ReturnType<typeof detectAndImport>;
      const repo = mustRepo();
      repo.transaction(() => {
        for (const c of preview.collections) repo.upsertCollection(c);
        for (const f of preview.folders) repo.upsertFolder(f);
        for (const r of preview.requests) repo.upsertRequest(r);
        for (const e of preview.environments) repo.upsertEnvironment(e);
        if (preview.globals.length && preview.collections[0]) {
          repo.setGlobals(preview.collections[0].workspaceId, preview.globals);
        }
      });
      runtime.onLocalMutation?.();
      return { imported: true, issues: preview.issues, missingFiles: preview.missingFiles };
    })
  );
  bindIpc("export.collection", (_e, raw) =>
    handle(() => {
      const { collectionId, includeSecrets } = z.object({ collectionId: z.string(), includeSecrets: z.boolean().optional() }).parse(raw);
      return buildPostmanExport("collection", collectionId, includeSecrets ?? false).json;
    })
  );
  bindIpc("export.download", (_e, raw) =>
    handle(async () => {
      const { kind, id } = z
        .object({ kind: z.enum(["collection", "folder", "request"]), id: z.string() })
        .parse(raw);
      const { title, json } = buildPostmanExport(kind, id);
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      const options = {
        title: "Export Postman Collection",
        defaultPath: `${sanitizeExportName(title)}.postman_collection.json`,
        filters: [{ name: "Postman Collection", extensions: ["json"] }]
      };
      const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return { saved: false as const };
      await writeFile(result.filePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
      return { saved: true as const, path: result.filePath };
    })
  );
  bindIpc("export.curl", (_e, raw) => handle(() => exportCurl(raw as HttpRequestDocument)));
  bindIpc("export.snippets", (_e, raw) => handle(() => generateSnippets(raw as HttpRequestDocument)));
  bindIpc("export.environment", (_e, raw) =>
    handle(() => {
      const env = raw as { id: string };
      const found = mustRepo().listWorkspaces().flatMap((w) => mustRepo().listEnvironments(w.id)).find((e) => e.id === env.id);
      if (!found) throw new Error("Environment not found");
      return exportPostmanEnvironment(found, false);
    })
  );

  bindIpc("conn.open", (_e, raw) => handle(() => openConnection(raw)));
  bindIpc("conn.send", (_e, raw) =>
    handle(() => {
      const p = z.object({ id: z.string(), data: z.string(), topic: z.string().optional(), event: z.string().optional() }).parse(raw);
      return sendConnection(p.id, p.data, { topic: p.topic, event: p.event });
    })
  );
  bindIpc("conn.close", (_e, raw) =>
    handle(() => {
      const { id } = z.object({ id: z.string() }).parse(raw);
      return closeConnection(id);
    })
  );

  bindIpc("oauth.authorize", (_e, raw) => handle(() => authorizeInSystemBrowser(raw)));

  bindIpc("mcp.http", (_e, raw) =>
    handle(async () => {
      const { url } = z.object({ url: z.string().url() }).parse(raw);
      return mcpInitializeHttp(url);
    })
  );
  bindIpc("mcp.stdio", (_e, raw) =>
    handle(() => {
      const p = z.object({ command: z.string(), args: z.array(z.string()), trusted: z.literal(true) }).parse(raw);
      const child = mcpStartStdio(p);
      child.once("exit", () => undefined);
      return { pid: child.pid, note: "Spawned only because trusted=true. Import paths never pass that flag." };
    })
  );

  bindIpc("sync.status", () => ok(statusPayload()));
  bindIpc("sync.now", () =>
    handle(async () => {
      await flushSync();
      return statusPayload();
    })
  );

  bindIpc("dialog.openFile", async () => {
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win!, { properties: ["openFile"] });
    if (res.canceled || !res.filePaths[0]) return ok(null);
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(res.filePaths[0]);
    return ok({ path: res.filePaths[0], text: buf.toString("utf8") });
  });
  bindIpc("shell.openExternal", (_e, raw) =>
    handle(async () => {
      const { url } = z.object({ url: z.string().url() }).parse(raw);
      if (!/^https?:/.test(url)) throw new Error("Blocked URL");
      await shell.openExternal(url);
      return true;
    })
  );
}

function sanitizeExportName(name: string) {
  const cleaned = name
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "collection";
}

function buildPostmanExport(kind: "collection" | "folder" | "request", id: string, includeSecrets = false) {
  const repo = mustRepo();
  if (kind === "collection") {
    const collection = repo.getCollection(id);
    if (!collection || collection.deletedAt) throw new Error("Collection not found");
    return {
      title: collection.name,
      json: exportPostmanCollection({
        collection,
        folders: repo.listFolders(collection.id),
        requests: repo.listRequests(collection.id),
        includeSecrets
      })
    };
  }
  if (kind === "folder") {
    const folder = repo.getFolder(id);
    if (!folder || folder.deletedAt) throw new Error("Folder not found");
    const collection = repo.getCollection(folder.collectionId);
    if (!collection || collection.deletedAt) throw new Error("Collection not found");
    return {
      title: folder.name,
      json: exportPostmanCollection({
        collection,
        folders: repo.listFolders(collection.id),
        requests: repo.listRequests(collection.id),
        includeSecrets,
        rootFolderId: folder.id
      })
    };
  }
  const request = repo.getRequest(id);
  if (!request || request.deletedAt) throw new Error("Request not found");
  const collection = repo.getCollection(request.collectionId);
  if (!collection || collection.deletedAt) throw new Error("Collection not found");
  return {
    title: request.name,
    json: exportPostmanCollection({
      collection,
      folders: repo.listFolders(collection.id),
      requests: repo.listRequests(collection.id),
      includeSecrets,
      onlyRequestId: request.id
    })
  };
}

function defaultSettings() {
  return {
    timeoutMs: 30_000,
    followRedirects: true,
    tlsVerify: true,
    historyEnabled: true,
    theme: "light" as "light" | "dark"
  };
}

function interpolatePreview(url: string, vars: Array<{ key: string; value: string; enabled: boolean }>) {
  let out = url;
  for (const v of vars.filter((x) => x.enabled)) out = out.replaceAll(`{{${v.key}}}`, v.value);
  return out.startsWith("http") ? out : "http://localhost";
}

