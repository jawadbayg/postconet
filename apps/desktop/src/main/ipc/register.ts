import { BrowserWindow, ipcMain, shell, dialog } from "electron";
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
  deleteEntity,
  moveFolder,
  moveRequest,
  saveRequestDocument,
  saveEnvironmentDocument
} from "../services/studio.js";
import {
  signIn,
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
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export function registerIpc() {
  ipcMain.handle("app.brand", () => handle(async () => (await import("@postconet/core")).brand));
  ipcMain.handle("app.cloudConfigured", () => ok(isCloudConfigured()));

  ipcMain.handle("auth.session", () => ok(statusPayload()));
  ipcMain.handle("auth.signUp", (_e, raw) =>
    handle(async () => {
      const input = signUpSchema.parse(raw);
      return signUp(input.email, input.password, input.displayName);
    })
  );
  ipcMain.handle("auth.signIn", (_e, raw) =>
    handle(async () => {
      const input = signInSchema.parse(raw);
      return signIn(input.email, input.password);
    })
  );
  ipcMain.handle("auth.signOut", () => handle(() => signOut()));
  ipcMain.handle("auth.resetPassword", (_e, raw) =>
    handle(async () => {
      const { email } = z.object({ email: z.string().email() }).parse(raw);
      await resetPassword(email);
      return { sent: true };
    })
  );
  ipcMain.handle("auth.updatePassword", (_e, raw) =>
    handle(async () => {
      const { password } = z.object({ password: z.string().min(8) }).parse(raw);
      await updatePassword(password);
      return { updated: true };
    })
  );

  ipcMain.handle("workspace.list", () => handle(() => mustRepo().listWorkspaces()));
  ipcMain.handle("workspace.tree", (_e, raw) =>
    handle(() => {
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(raw);
      return tree(workspaceId);
    })
  );
  ipcMain.handle("workspace.createCollection", (_e, raw) =>
    handle(() => {
      const { workspaceId, name } = z.object({ workspaceId: z.string(), name: z.string().min(1) }).parse(raw);
      return createCollection(workspaceId, name);
    })
  );
  ipcMain.handle("workspace.createFolder", (_e, raw) =>
    handle(() => {
      const p = z.object({ workspaceId: z.string(), collectionId: z.string(), parentId: z.string().nullable(), name: z.string() }).parse(raw);
      return createFolder(p.workspaceId, p.collectionId, p.parentId, p.name);
    })
  );
  ipcMain.handle("workspace.createRequest", (_e, raw) =>
    handle(() => {
      const p = z.object({ workspaceId: z.string(), collectionId: z.string(), folderId: z.string().nullable(), name: z.string() }).parse(raw);
      return createRequest(p);
    })
  );
  ipcMain.handle("workspace.createEnvironment", (_e, raw) =>
    handle(() => {
      const p = z.object({ workspaceId: z.string(), name: z.string() }).parse(raw);
      return createEnvironment(p.workspaceId, p.name);
    })
  );
  ipcMain.handle("workspace.saveRequest", (_e, raw) =>
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
  ipcMain.handle("workspace.saveEnvironment", (_e, raw) =>
    handle(async () => {
      const env = raw as Environment;
      const saved = await saveEnvironmentDocument(env);
      if (runtime.user && runtime.supabase) await pushQueue();
      return saved;
    })
  );
  ipcMain.handle("workspace.rename", (_e, raw) =>
    handle(() => {
      const p = z.object({ type: z.enum(["collection", "folder", "request", "environment"]), id: z.string(), name: z.string() }).parse(raw);
      return renameEntity(p.type, p.id, p.name);
    })
  );
  ipcMain.handle("workspace.delete", (_e, raw) =>
    handle(() => {
      const p = z.object({ type: z.enum(["collection", "folder", "request", "environment"]), id: z.string() }).parse(raw);
      return deleteEntity(p.type, p.id);
    })
  );
  ipcMain.handle("workspace.moveFolder", (_e, raw) =>
    handle(() => {
      const p = z.object({ folderId: z.string(), collectionId: z.string(), parentId: z.string().nullable() }).parse(raw);
      return moveFolder(p.folderId, p.collectionId, p.parentId);
    })
  );
  ipcMain.handle("workspace.moveRequest", (_e, raw) =>
    handle(() => {
      const p = z.object({ requestId: z.string(), collectionId: z.string(), folderId: z.string().nullable() }).parse(raw);
      return moveRequest(p.requestId, p.collectionId, p.folderId);
    })
  );

  ipcMain.handle("share.invite", (_e, raw) =>
    handle(() =>
      inviteShare(
        z
          .object({
            workspaceId: z.string(),
            resourceKind: z.enum(["collection", "folder", "request"]),
            resourceId: z.string(),
            email: z.string().email(),
            role: z.enum(["viewer", "editor"])
          })
          .parse(raw)
      )
    )
  );
  ipcMain.handle("share.list", (_e, raw) =>
    handle(() =>
      listShares(
        z
          .object({
            workspaceId: z.string(),
            resourceKind: z.enum(["collection", "folder", "request"]),
            resourceId: z.string()
          })
          .parse(raw)
      )
    )
  );
  ipcMain.handle("share.manage", (_e, raw) => handle(() => manageShare(z.record(z.unknown()).parse(raw))));
  ipcMain.handle("share.acceptPending", (_e, raw) =>
    handle(() => acceptPendingInvites(z.object({ token: z.string().optional() }).parse(raw ?? {}).token))
  );
  ipcMain.handle("notifications.list", () => handle(() => listNotifications()));
  ipcMain.handle("notifications.read", (_e, raw) =>
    handle(async () => {
      const { id } = z.object({ id: z.string() }).parse(raw);
      await markNotificationRead(id);
      return true;
    })
  );

  ipcMain.handle("settings.get", () =>
    handle(() => {
      const raw = mustRepo().getMeta("ui_settings");
      return { ...defaultSettings(), ...(raw ? JSON.parse(raw) : {}) };
    })
  );
  ipcMain.handle("settings.set", (_e, raw) =>
    handle(() => {
      const prev = mustRepo().getMeta("ui_settings");
      const next = { ...defaultSettings(), ...(prev ? JSON.parse(prev) : {}), ...(raw as object) };
      mustRepo().setMeta("ui_settings", JSON.stringify(next));
      return next;
    })
  );
  ipcMain.handle("history.clear", (_e, raw) =>
    handle(() => {
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(raw);
      mustRepo().clearHistory(workspaceId);
      return true;
    })
  );
  ipcMain.handle("sync.conflicts", (_e, raw) =>
    handle(() => {
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(raw);
      return mustRepo().listConflicts(workspaceId);
    })
  );

  ipcMain.handle("request.send", (_e, raw) =>
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
  ipcMain.handle("request.cancel", (_e, raw) =>
    handle(() => {
      const { executionId } = z.object({ executionId: z.string() }).parse(raw);
      runtime.abort.get(executionId)?.abort();
      return { cancelled: true };
    })
  );

  ipcMain.handle("history.list", (_e, raw) =>
    handle(() => {
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(raw);
      return mustRepo().listHistory(workspaceId);
    })
  );
  ipcMain.handle("cookies.list", (_e, raw) =>
    handle(async () => {
      const { workspaceId } = z.object({ workspaceId: z.string() }).parse(raw);
      return listCookies(mustRepo().getCookieJar(workspaceId));
    })
  );
  ipcMain.handle("search.query", (_e, raw) =>
    handle(() => {
      const { q } = z.object({ q: z.string() }).parse(raw);
      return mustRepo().search(q);
    })
  );
  ipcMain.handle("layout.save", (_e, raw) =>
    handle(() => {
      mustRepo().saveTabs(raw);
      return true;
    })
  );
  ipcMain.handle("layout.load", () => handle(() => mustRepo().loadTabs()));

  ipcMain.handle("import.preview", (_e, raw) =>
    handle(() => {
      const { text, workspaceId } = z.object({ text: z.string(), workspaceId: z.string() }).parse(raw);
      return detectAndImport(text, workspaceId);
    })
  );
  ipcMain.handle("import.commit", (_e, raw) =>
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
  ipcMain.handle("export.collection", (_e, raw) =>
    handle(() => {
      const { collectionId, includeSecrets } = z.object({ collectionId: z.string(), includeSecrets: z.boolean().optional() }).parse(raw);
      const repo = mustRepo();
      const collections = repo.listWorkspaces().flatMap((w) => repo.listCollections(w.id));
      const collection = collections.find((c) => c.id === collectionId);
      if (!collection) throw new Error("Collection not found");
      return exportPostmanCollection({
        collection,
        folders: repo.listFolders(collection.id),
        requests: repo.listRequests(collection.id),
        includeSecrets: includeSecrets ?? false
      });
    })
  );
  ipcMain.handle("export.curl", (_e, raw) => handle(() => exportCurl(raw as HttpRequestDocument)));
  ipcMain.handle("export.snippets", (_e, raw) => handle(() => generateSnippets(raw as HttpRequestDocument)));
  ipcMain.handle("export.environment", (_e, raw) =>
    handle(() => {
      const env = raw as { id: string };
      const found = mustRepo().listWorkspaces().flatMap((w) => mustRepo().listEnvironments(w.id)).find((e) => e.id === env.id);
      if (!found) throw new Error("Environment not found");
      return exportPostmanEnvironment(found, false);
    })
  );

  ipcMain.handle("conn.open", (_e, raw) => handle(() => openConnection(raw)));
  ipcMain.handle("conn.send", (_e, raw) =>
    handle(() => {
      const p = z.object({ id: z.string(), data: z.string(), topic: z.string().optional(), event: z.string().optional() }).parse(raw);
      return sendConnection(p.id, p.data, { topic: p.topic, event: p.event });
    })
  );
  ipcMain.handle("conn.close", (_e, raw) =>
    handle(() => {
      const { id } = z.object({ id: z.string() }).parse(raw);
      return closeConnection(id);
    })
  );

  ipcMain.handle("oauth.authorize", (_e, raw) => handle(() => authorizeInSystemBrowser(raw)));

  ipcMain.handle("mcp.http", (_e, raw) =>
    handle(async () => {
      const { url } = z.object({ url: z.string().url() }).parse(raw);
      return mcpInitializeHttp(url);
    })
  );
  ipcMain.handle("mcp.stdio", (_e, raw) =>
    handle(() => {
      const p = z.object({ command: z.string(), args: z.array(z.string()), trusted: z.literal(true) }).parse(raw);
      const child = mcpStartStdio(p);
      child.once("exit", () => undefined);
      return { pid: child.pid, note: "Spawned only because trusted=true. Import paths never pass that flag." };
    })
  );

  ipcMain.handle("sync.status", () => ok(statusPayload()));
  ipcMain.handle("sync.now", () =>
    handle(async () => {
      await flushSync();
      return statusPayload();
    })
  );

  ipcMain.handle("dialog.openFile", async () => {
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win!, { properties: ["openFile"] });
    if (res.canceled || !res.filePaths[0]) return ok(null);
    const { readFile } = await import("node:fs/promises");
    const buf = await readFile(res.filePaths[0]);
    return ok({ path: res.filePaths[0], text: buf.toString("utf8") });
  });
  ipcMain.handle("shell.openExternal", (_e, raw) =>
    handle(async () => {
      const { url } = z.object({ url: z.string().url() }).parse(raw);
      if (!/^https?:/.test(url)) throw new Error("Blocked URL");
      await shell.openExternal(url);
      return true;
    })
  );
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

