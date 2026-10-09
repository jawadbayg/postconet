import type {
  AuthConfig,
  AuthType,
  Collection,
  Environment,
  Folder,
  HttpRequestDocument,
  ImportIssue,
  ImportPreview,
  KeyValue,
  ProtocolKind,
  RequestBody,
  SavedRequest,
  ScriptBag,
  Variable
} from "../types.js";
import { createId, nowIso } from "../ids.js";
import { kv } from "../kv.js";
import { defaultRequestSettings, emptyAuth, emptyHttpDocument, emptyScripts } from "../types.js";

const AUTH_MAP: Record<string, AuthType> = {
  noauth: "none",
  apikey: "apikey",
  bearer: "bearer",
  basic: "basic",
  digest: "digest",
  oauth1: "oauth1",
  oauth2: "oauth2",
  hawka: "hawk",
  hawk: "hawk",
  ntlm: "ntlm",
  awsv4: "awsv4",
  jwt: "jwt",
  edgegrid: "edgegrid"
};

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function kvFromPostman(list: unknown): KeyValue[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const row = item as { key?: string; value?: unknown; disabled?: boolean; description?: string; type?: string; src?: string };
    return {
      ...kv(row.key ?? "", String(row.value ?? ""), row.disabled ? false : true),
      description: typeof row.description === "string" ? row.description : undefined,
      type: row.type === "file" ? "file" : "text",
      filePath: typeof row.src === "string" ? row.src : Array.isArray(row.src) ? row.src[0] : undefined
    };
  });
}

function varsFromPostman(list: unknown): Variable[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const row = item as { key?: string; value?: unknown; disabled?: boolean; description?: string; type?: string };
    return {
      id: createId("var"),
      key: row.key ?? "",
      value: String(row.value ?? ""),
      sharedValue: String(row.value ?? ""),
      enabled: !row.disabled,
      secret: row.type === "secret",
      description: typeof row.description === "string" ? row.description : undefined
    };
  });
}

function scriptsFromEvents(events: unknown): ScriptBag {
  const bag = emptyScripts();
  if (!Array.isArray(events)) return bag;
  for (const event of events) {
    const e = event as { listen?: string; script?: { exec?: string | string[] } };
    const exec = e.script?.exec;
    const code = Array.isArray(exec) ? exec.join("\n") : String(exec ?? "");
    if (e.listen === "prerequest") bag.prerequest = code;
    if (e.listen === "test") bag.test = code;
  }
  return bag;
}

function authFromPostman(raw: unknown): AuthConfig {
  if (!raw || typeof raw !== "object") return emptyAuth("inherit");
  const a = raw as { type?: string; [k: string]: unknown };
  const type = AUTH_MAP[a.type ?? ""] ?? (a.type === "inherit" ? "inherit" : a.type ? "none" : "inherit");
  if (!a.type || a.type === "noauth") return emptyAuth("none");
  const block = a[a.type ?? ""];
  const params: Record<string, string> = {};
  if (Array.isArray(block)) {
    for (const row of block as Array<{ key?: string; value?: unknown; type?: string }>) {
      if (row.key) params[row.key] = String(row.value ?? "");
    }
  } else if (block && typeof block === "object") {
    for (const [k, v] of Object.entries(block as Record<string, unknown>)) {
      params[k] = String(v ?? "");
    }
  }
  return { type: type as AuthType, params };
}

function urlFromPostman(raw: unknown): { url: string; query: KeyValue[]; pathVariables: KeyValue[] } {
  if (typeof raw === "string") return { url: raw, query: [], pathVariables: [] };
  if (!raw || typeof raw !== "object") return { url: "", query: [], pathVariables: [] };
  const u = raw as {
    raw?: string;
    query?: unknown;
    variable?: unknown;
    protocol?: string;
    host?: string[];
    path?: string[];
    port?: string;
  };
  return {
    url: u.raw ?? [u.protocol ? `${u.protocol}://` : "", asArray(u.host).join("."), u.port ? `:${u.port}` : "", "/", asArray(u.path).join("/")].join(""),
    query: kvFromPostman(u.query),
    pathVariables: kvFromPostman(u.variable)
  };
}

function bodyFromPostman(raw: unknown, issues: ImportIssue[], path: string): RequestBody {
  if (!raw || typeof raw !== "object") return { mode: "none" };
  const b = raw as {
    mode?: string;
    raw?: string;
    options?: { raw?: { language?: string } };
    urlencoded?: unknown;
    formdata?: unknown;
    file?: { src?: string };
    graphql?: { query?: string; variables?: string };
    disabled?: boolean;
  };
  if (b.disabled) return { mode: "none" };
  switch (b.mode) {
    case "raw": {
      const language = b.options?.raw?.language ?? guessLang(b.raw ?? "");
      return { mode: language === "json" ? "json" : (language as RequestBody["mode"]) ?? "raw", raw: b.raw ?? "", language: language as RequestBody["language"] };
    }
    case "urlencoded":
      return { mode: "urlencoded", urlencoded: kvFromPostman(b.urlencoded) };
    case "formdata":
      return { mode: "formdata", formdata: kvFromPostman(b.formdata) };
    case "file":
      if (b.file?.src && !b.file.src) issues.push({ level: "warning", path, message: "Binary body referenced a missing file" });
      return { mode: "file", filePath: b.file?.src };
    case "graphql":
      return {
        mode: "graphql",
        graphql: {
          query: b.graphql?.query ?? "",
          variables: typeof b.graphql?.variables === "string" ? b.graphql.variables : JSON.stringify(b.graphql?.variables ?? {})
        }
      };
    default:
      if (b.mode && b.mode !== "none") {
        issues.push({ level: "warning", path, message: `Unsupported body mode '${b.mode}' preserved as raw`, unsupported: true });
        return { mode: "raw", raw: b.raw ?? JSON.stringify(b) };
      }
      return { mode: "none" };
  }
}

function guessLang(raw: string): "json" | "xml" | "html" | "javascript" | "text" {
  const t = raw.trim();
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (t.startsWith("<")) return t.toLowerCase().includes("<html") ? "html" : "xml";
  return "text";
}

function detectProtocol(item: Record<string, unknown>): ProtocolKind {
  if (item.protocolProfileBehavior && typeof item.protocolProfileBehavior === "object") {
    /* keep http */
  }
  const req = item.request as { url?: unknown; body?: { mode?: string } } | undefined;
  if (req?.body?.mode === "graphql") return "graphql";
  return "http";
}

interface WalkCtx {
  workspaceId: string;
  collectionId: string;
  folders: Folder[];
  requests: SavedRequest[];
  issues: ImportIssue[];
  missingFiles: string[];
  unknown: unknown[];
}

function walkItems(items: unknown[], parentFolderId: string | null, ctx: WalkCtx, path: string, sortBase = 0) {
  items.forEach((raw, index) => {
    const item = raw as Record<string, unknown>;
    const name = String(item.name ?? `Item ${index + 1}`);
    const itemPath = `${path}/${name}`;
    if (Array.isArray(item.item)) {
      const folder: Folder = {
        id: createId("fld"),
        workspaceId: ctx.workspaceId,
        collectionId: ctx.collectionId,
        parentId: parentFolderId,
        name,
        auth: authFromPostman(item.auth),
        scripts: scriptsFromEvents(item.event),
        sortOrder: sortBase + index,
        archivedAt: null,
        deletedAt: null,
        version: 1,
        updatedAt: nowIso(),
        createdAt: nowIso()
      };
      ctx.folders.push(folder);
      walkItems(item.item as unknown[], folder.id, ctx, itemPath);
      return;
    }
    if (!item.request) {
      ctx.issues.push({ level: "warning", path: itemPath, message: "Skipped item without request or folder children" });
      return;
    }
    const request = item.request as Record<string, unknown>;
    const url = urlFromPostman(request.url);
    const body = bodyFromPostman(request.body, ctx.issues, itemPath);
    if (body.mode === "file" && body.filePath) ctx.missingFiles.push(body.filePath);
    if (body.mode === "formdata") {
      for (const f of body.formdata ?? []) {
        if (f.type === "file" && f.filePath) ctx.missingFiles.push(f.filePath);
      }
    }
    const document: HttpRequestDocument = {
      ...emptyHttpDocument(),
      method: String(request.method ?? "GET").toUpperCase(),
      url: url.url,
      query: url.query,
      pathVariables: url.pathVariables,
      headers: kvFromPostman(request.header),
      body,
      auth: request.auth ? authFromPostman(request.auth) : emptyAuth("inherit"),
      scripts: scriptsFromEvents(item.event),
      description: typeof request.description === "string" ? request.description : undefined,
      settings: defaultRequestSettings()
    };
    const protocol = detectProtocol(item);
    if (protocol === "graphql") document.protocol = "graphql";
    const unknownKeys = Object.keys(item).filter(
      (k) => !["name", "id", "request", "response", "event", "protocolProfileBehavior", "auth", "item", "description"].includes(k)
    );
    ctx.requests.push({
      id: createId("req"),
      workspaceId: ctx.workspaceId,
      collectionId: ctx.collectionId,
      folderId: parentFolderId,
      projectId: null,
      name,
      protocol,
      sortOrder: sortBase + index,
      document,
      examples: asArray(item.response).map((resp, i) => {
        const r = resp as { name?: string; code?: number; header?: unknown; body?: string; _postman_previewlanguage?: string };
        return {
          id: createId("ex"),
          name: r.name ?? `Example ${i + 1}`,
          status: r.code ?? 200,
          headers: kvFromPostman(r.header),
          body: typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? ""),
          contentType: r._postman_previewlanguage
        };
      }),
      favorite: false,
      archivedAt: null,
      deletedAt: null,
      version: 1,
      updatedAt: nowIso(),
      createdAt: nowIso(),
      unknown: unknownKeys.length ? Object.fromEntries(unknownKeys.map((k) => [k, item[k]])) : undefined
    });
    if (unknownKeys.length) {
      ctx.issues.push({
        level: "info",
        path: itemPath,
        message: `Preserved unknown fields: ${unknownKeys.join(", ")}`
      });
    }
  });
}

export function detectPostmanFormat(json: unknown): "collection-v2.1" | "collection-v2.0" | "environment" | "globals" | "dump" | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as Record<string, unknown>;
  const schema = String((obj.info as { schema?: string } | undefined)?.schema ?? obj.info ?? "");
  if (schema.includes("collection/v2.1") || schema.includes("v2.1.0")) return "collection-v2.1";
  if (schema.includes("collection/v2.0") || schema.includes("v2.0.0")) return "collection-v2.0";
  if (obj.values && (obj.name || obj._postman_variable_scope === "environment")) return "environment";
  if (obj.values && obj._postman_variable_scope === "globals") return "globals";
  if (obj.collections || obj.environments) return "dump";
  if (obj.item && obj.info) return "collection-v2.1";
  return null;
}

export function importPostmanCollection(json: unknown, workspaceId: string): ImportPreview {
  const issues: ImportIssue[] = [];
  const format = detectPostmanFormat(json);
  if (!format?.startsWith("collection")) {
    issues.push({ level: "error", path: "/", message: "Not a Postman collection" });
    return emptyPreview("unknown", issues);
  }
  const root = json as { info?: { name?: string; description?: string; schema?: string }; item?: unknown[]; variable?: unknown; auth?: unknown; event?: unknown };
  const collectionId = createId("col");
  const collection: Collection = {
    id: collectionId,
    workspaceId,
    projectId: null,
    name: root.info?.name ?? "Imported collection",
    description: typeof root.info?.description === "string" ? root.info.description : undefined,
    auth: authFromPostman(root.auth),
    variables: varsFromPostman(root.variable),
    scripts: scriptsFromEvents(root.event),
    favorite: false,
    archivedAt: null,
    deletedAt: null,
    version: 1,
    updatedAt: nowIso(),
    createdAt: nowIso(),
    unknown: root.info?.schema ? { schema: root.info.schema } : undefined
  };
  const ctx: WalkCtx = {
    workspaceId,
    collectionId,
    folders: [],
    requests: [],
    issues,
    missingFiles: [],
    unknown: []
  };
  walkItems(root.item ?? [], null, ctx, collection.name);
  if (format === "collection-v2.0") {
    issues.push({ level: "info", path: "/", message: "Normalized Collection v2.0 to the internal v2.1-compatible model" });
  }
  for (const file of ctx.missingFiles) {
    issues.push({
      level: "warning",
      path: file,
      message: `Referenced file is not embedded. Relink before sending. Contents were not imported from ${file}`
    });
  }
  return {
    format,
    title: collection.name,
    collections: [collection],
    requests: ctx.requests,
    folders: ctx.folders,
    environments: [],
    globals: [],
    issues,
    missingFiles: ctx.missingFiles,
    unknownPreserved: true
  };
}

export function importPostmanEnvironment(json: unknown, workspaceId: string): ImportPreview {
  const obj = json as { name?: string; values?: unknown };
  const env: Environment = {
    id: createId("env"),
    workspaceId,
    name: obj.name ?? "Imported environment",
    values: varsFromPostman(obj.values),
    archivedAt: null,
    deletedAt: null,
    version: 1,
    updatedAt: nowIso(),
    createdAt: nowIso()
  };
  return {
    format: "environment",
    title: env.name,
    collections: [],
    requests: [],
    folders: [],
    environments: [env],
    globals: [],
    issues: [],
    missingFiles: [],
    unknownPreserved: true
  };
}

export function importPostmanGlobals(json: unknown): ImportPreview {
  const obj = json as { values?: unknown };
  return {
    format: "globals",
    title: "Globals",
    collections: [],
    requests: [],
    folders: [],
    environments: [],
    globals: varsFromPostman(obj.values),
    issues: [],
    missingFiles: [],
    unknownPreserved: true
  };
}

function mapPostmanUrl(raw: string, query: Array<{ key: string; value: string; disabled: boolean }>, pathVars: Array<{ key: string; value: string }>) {
  const url: Record<string, unknown> = {
    raw,
    query: query.length ? query : undefined,
    variable: pathVars.length ? pathVars : undefined
  };
  if (/\{\{|\}\}/.test(raw)) return url;
  try {
    const parsed = new URL(raw);
    url.protocol = parsed.protocol.replace(":", "");
    url.host = parsed.hostname.split(".");
    if (parsed.port) url.port = parsed.port;
    url.path = parsed.pathname.split("/").filter(Boolean);
  } catch {
    /* keep raw */
  }
  return url;
}

export function exportPostmanCollection(opts: {
  collection: Collection;
  folders: Folder[];
  requests: SavedRequest[];
  includeSecrets?: boolean;
  rootFolderId?: string | null;
  onlyRequestId?: string;
}): Record<string, unknown> {
  const foldersByParent = new Map<string | null, Folder[]>();
  for (const folder of opts.folders.filter((f) => f.collectionId === opts.collection.id && !f.deletedAt)) {
    const list = foldersByParent.get(folder.parentId) ?? [];
    list.push(folder);
    foldersByParent.set(folder.parentId, list);
  }
  const requestsByFolder = new Map<string | null, SavedRequest[]>();
  for (const req of opts.requests.filter((r) => r.collectionId === opts.collection.id && !r.deletedAt)) {
    const list = requestsByFolder.get(req.folderId) ?? [];
    list.push(req);
    requestsByFolder.set(req.folderId, list);
  }

  const mapVars = (vars: Variable[]) =>
    vars.map((v) => ({
      key: v.key,
      value: !opts.includeSecrets && v.secret ? "" : v.value,
      type: v.secret ? "secret" : "default",
      disabled: !v.enabled
    }));

  const mapAuth = (auth: AuthConfig) => {
    if (auth.type === "inherit") return undefined;
    if (auth.type === "none") return { type: "noauth" };
    const type =
      Object.entries(AUTH_MAP).find(([, v]) => v === auth.type)?.[0] ?? auth.type;
    const params = Object.entries(auth.params)
      .filter(([k, v]) => opts.includeSecrets || !/secret|password|token|key/i.test(k) || v === "")
      .map(([key, value]) => ({ key, value, type: "string" }));
    return { type, [type]: params };
  };

  const mapEvents = (scripts: ScriptBag) => {
    const events: unknown[] = [];
    if (scripts.prerequest) events.push({ listen: "prerequest", script: { type: "text/javascript", exec: scripts.prerequest.split("\n") } });
    if (scripts.test) events.push({ listen: "test", script: { type: "text/javascript", exec: scripts.test.split("\n") } });
    return events.length ? events : undefined;
  };

  const mapBody = (body: RequestBody) => {
    switch (body.mode) {
      case "none":
        return undefined;
      case "urlencoded":
        return { mode: "urlencoded", urlencoded: body.urlencoded?.map((i) => ({ key: i.key, value: i.value, disabled: !i.enabled })) };
      case "formdata":
        return {
          mode: "formdata",
          formdata: body.formdata?.map((i) => ({
            key: i.key,
            value: i.type === "file" ? undefined : i.value,
            src: i.filePath,
            type: i.type === "file" ? "file" : "text",
            disabled: !i.enabled
          }))
        };
      case "graphql":
        return { mode: "graphql", graphql: body.graphql };
      case "file":
        return { mode: "file", file: { src: body.filePath } };
      default:
        return {
          mode: "raw",
          raw: body.raw ?? "",
          options: { raw: { language: body.language ?? (body.mode === "json" ? "json" : "text") } }
        };
    }
  };

  const mapRequest = (req: SavedRequest) => {
    const doc = req.document as HttpRequestDocument;
    return {
      name: req.name,
      request: {
        method: doc.method,
        header: doc.headers.filter((h) => h.key).map((h) => ({ key: h.key, value: h.value, disabled: !h.enabled })),
        url: mapPostmanUrl(
          doc.url,
          doc.query.map((q) => ({ key: q.key, value: q.value, disabled: !q.enabled })),
          doc.pathVariables.map((p) => ({ key: p.key, value: p.value }))
        ),
        body: mapBody(doc.body),
        auth: mapAuth(doc.auth),
        description: doc.description
      },
      event: mapEvents(doc.scripts),
      response: req.examples.map((ex) => ({
        name: ex.name,
        originalRequest: { method: doc.method, url: doc.url },
        status: "OK",
        code: ex.status,
        header: ex.headers.map((h) => ({ key: h.key, value: h.value })),
        body: ex.body
      })),
      ...(req.unknown && typeof req.unknown === "object" ? (req.unknown as object) : {})
    };
  };

  const buildItems = (parent: string | null): unknown[] => {
    const folders = (foldersByParent.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
    const reqs = (requestsByFolder.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
    const items: unknown[] = [];
    const folderItems = folders.map((folder) => ({
      name: folder.name,
      auth: mapAuth(folder.auth),
      event: mapEvents(folder.scripts),
      item: buildItems(folder.id)
    }));
    items.push(...folderItems, ...reqs.map(mapRequest));
    return items;
  };

  if (opts.onlyRequestId) {
    const req = opts.requests.find((r) => r.id === opts.onlyRequestId && !r.deletedAt);
    if (!req) throw new Error("Request not found");
    return {
      info: {
        name: req.name,
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
      },
      item: [mapRequest(req)]
    };
  }

  const rootFolderId = opts.rootFolderId ?? null;
  const title = rootFolderId
    ? (opts.folders.find((f) => f.id === rootFolderId)?.name ?? opts.collection.name)
    : opts.collection.name;

  return {
    info: {
      name: title,
      description: rootFolderId ? undefined : opts.collection.description,
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
    },
    item: buildItems(rootFolderId),
    variable: rootFolderId ? undefined : mapVars(opts.collection.variables),
    auth: rootFolderId ? mapAuth(opts.folders.find((f) => f.id === rootFolderId)?.auth ?? emptyAuth()) : mapAuth(opts.collection.auth),
    event: rootFolderId
      ? mapEvents(opts.folders.find((f) => f.id === rootFolderId)?.scripts ?? emptyScripts())
      : mapEvents(opts.collection.scripts)
  };
}

export function exportPostmanEnvironment(env: Environment, includeSecrets = false) {
  return {
    id: env.id,
    name: env.name,
    values: env.values.map((v) => ({
      key: v.key,
      value: !includeSecrets && v.secret ? "" : v.value,
      enabled: v.enabled,
      type: v.secret ? "secret" : "default"
    })),
    _postman_variable_scope: "environment"
  };
}

function emptyPreview(format: string, issues: ImportIssue[]): ImportPreview {
  return {
    format,
    title: "",
    collections: [],
    requests: [],
    folders: [],
    environments: [],
    globals: [],
    issues,
    missingFiles: [],
    unknownPreserved: false
  };
}
