type MenuTarget = { kind: "collection" | "folder" | "request"; id: string; name: string; collectionId?: string };
type RequestRecord = { id: string; name: string; folderId: string | null; deletedAt?: string | null; document: Record<string, unknown> };
type Tree = {
  collections: Array<{
    id: string;
    name: string;
    auth: Auth;
    scripts: Scripts;
    variables?: unknown[];
    folders: Array<{ id: string; name: string; parentId: string | null; auth: Auth; scripts: Scripts }>;
    requests: RequestRecord[];
  }>;
};

type Auth = { type: string; params: Record<string, string> };
type Scripts = { prerequest?: string; test?: string };
type Kv = { key?: string; value?: string; enabled?: boolean; type?: string; filePath?: string };
type Body = {
  mode?: string;
  raw?: string;
  language?: string;
  urlencoded?: Kv[];
  formdata?: Kv[];
  graphql?: unknown;
  filePath?: string;
};
type Doc = {
  method?: string;
  url?: string;
  headers?: Kv[];
  query?: Kv[];
  pathVariables?: Kv[];
  body?: Body;
  auth?: Auth;
  scripts?: Scripts;
  description?: string;
};

const SCHEMA = "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

export async function downloadPostmanJson(tree: Tree, target: MenuTarget) {
  const { title, json } = buildPostmanFromTree(tree, target);
  await saveJsonFile(`${safeFileName(title)}.postman_collection.json`, json);
}

export function buildPostmanFromTree(tree: Tree, target: MenuTarget): { title: string; json: Record<string, unknown> } {
  if (target.kind === "collection") {
    const collection = tree.collections.find((c) => c.id === target.id);
    if (!collection) throw new Error("Collection not found");
    return { title: collection.name, json: toPostman(collection) };
  }
  if (target.kind === "folder") {
    const collection = tree.collections.find(
      (c) => c.id === target.collectionId || c.folders.some((f) => f.id === target.id)
    );
    const folder = collection?.folders.find((f) => f.id === target.id);
    if (!collection || !folder) throw new Error("Folder not found");
    return { title: folder.name, json: toPostman(collection, { rootFolderId: folder.id }) };
  }
  const collection = tree.collections.find(
    (c) => c.id === target.collectionId || c.requests.some((r) => r.id === target.id)
  );
  const request = collection?.requests.find((r) => r.id === target.id);
  if (!collection || !request) throw new Error("Request not found");
  return { title: request.name, json: toPostman(collection, { onlyRequestId: request.id }) };
}

function toPostman(
  collection: Tree["collections"][number],
  opts: { rootFolderId?: string; onlyRequestId?: string } = {}
): Record<string, unknown> {
  const foldersByParent = new Map<string | null, Tree["collections"][number]["folders"]>();
  for (const folder of collection.folders) {
    const parent = "parentId" in folder ? folder.parentId : null;
    const list = foldersByParent.get(parent) ?? [];
    list.push(folder);
    foldersByParent.set(parent, list);
  }
  const requestsByFolder = new Map<string | null, RequestRecord[]>();
  for (const req of collection.requests.filter((r) => !r.deletedAt)) {
    const list = requestsByFolder.get(req.folderId) ?? [];
    list.push(req);
    requestsByFolder.set(req.folderId, list);
  }

  const mapRequest = (req: RequestRecord) => {
    const doc = (req.document ?? {}) as Doc;
    const headers = Array.isArray(doc.headers) ? doc.headers : [];
    const query = Array.isArray(doc.query) ? doc.query : [];
    const pathVars = Array.isArray(doc.pathVariables) ? doc.pathVariables : [];
    return {
      name: req.name,
      request: {
        method: String(doc.method ?? "GET"),
        header: headers.filter((h) => h.key).map((h) => ({ key: h.key, value: h.value ?? "", disabled: h.enabled === false })),
        url: mapUrl(
          String(doc.url ?? ""),
          query.map((q) => ({ key: q.key ?? "", value: q.value ?? "", disabled: q.enabled === false })),
          pathVars.map((p) => ({ key: p.key ?? "", value: p.value ?? "" }))
        ),
        body: mapBody(doc.body),
        auth: mapAuth(doc.auth),
        description: doc.description
      },
      event: mapEvents(doc.scripts),
      response: [] as unknown[]
    };
  };

  const buildItems = (parent: string | null): unknown[] => {
    const folders = foldersByParent.get(parent) ?? [];
    const reqs = requestsByFolder.get(parent) ?? [];
    return [
      ...folders.map((folder) => ({
        name: folder.name,
        auth: mapAuth(folder.auth),
        event: mapEvents(folder.scripts),
        item: buildItems(folder.id)
      })),
      ...reqs.map(mapRequest)
    ];
  };

  if (opts.onlyRequestId) {
    const req = collection.requests.find((r) => r.id === opts.onlyRequestId && !r.deletedAt);
    if (!req) throw new Error("Request not found");
    return { info: { name: req.name, schema: SCHEMA }, item: [mapRequest(req)] };
  }

  const root = opts.rootFolderId ?? null;
  const title = root ? (collection.folders.find((f) => f.id === root)?.name ?? collection.name) : collection.name;
  const folder = root ? collection.folders.find((f) => f.id === root) : undefined;
  return {
    info: { name: title, schema: SCHEMA },
    item: buildItems(root),
    variable: root ? undefined : mapVars(collection.variables),
    auth: mapAuth(root ? folder?.auth : collection.auth),
    event: mapEvents(root ? folder?.scripts : collection.scripts)
  };
}

function mapVars(vars: unknown) {
  if (!Array.isArray(vars)) return undefined;
  const mapped = vars
    .map((v) => {
      const row = v as { key?: string; value?: string; secret?: boolean; enabled?: boolean };
      return {
        key: row.key ?? "",
        value: row.secret ? "" : (row.value ?? ""),
        type: row.secret ? "secret" : "default",
        disabled: row.enabled === false
      };
    })
    .filter((v) => v.key);
  return mapped.length ? mapped : undefined;
}

function mapUrl(raw: string, query: Array<{ key: string; value: string; disabled: boolean }>, pathVars: Array<{ key: string; value: string }>) {
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

function mapAuth(auth?: Auth) {
  if (!auth || auth.type === "inherit") return undefined;
  if (auth.type === "none") return { type: "noauth" };
  const type = auth.type === "none" ? "noauth" : auth.type;
  const params = Object.entries(auth.params ?? {}).map(([key, value]) => ({ key, value, type: "string" }));
  return { type, [type]: params };
}

function mapEvents(scripts?: Scripts) {
  const events: unknown[] = [];
  if (scripts?.prerequest) events.push({ listen: "prerequest", script: { type: "text/javascript", exec: scripts.prerequest.split("\n") } });
  if (scripts?.test) events.push({ listen: "test", script: { type: "text/javascript", exec: scripts.test.split("\n") } });
  return events.length ? events : undefined;
}

function mapBody(body?: Body) {
  if (!body || body.mode === "none") return undefined;
  if (body.mode === "urlencoded") {
    return { mode: "urlencoded", urlencoded: body.urlencoded?.map((i) => ({ key: i.key, value: i.value, disabled: i.enabled === false })) };
  }
  if (body.mode === "formdata") {
    return {
      mode: "formdata",
      formdata: body.formdata?.map((i) => ({
        key: i.key,
        value: i.type === "file" ? undefined : i.value,
        src: i.filePath,
        type: i.type === "file" ? "file" : "text",
        disabled: i.enabled === false
      }))
    };
  }
  if (body.mode === "graphql") return { mode: "graphql", graphql: body.graphql };
  if (body.mode === "file") return { mode: "file", file: { src: body.filePath } };
  return {
    mode: "raw",
    raw: body.raw ?? "",
    options: { raw: { language: body.language ?? (body.mode === "json" ? "json" : "text") } }
  };
}

function safeFileName(name: string) {
  const cleaned = name.replace(/[<>:"/\\|?*]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "collection";
}

async function saveJsonFile(filename: string, data: unknown) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  const picker = (window as Window & { showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<{ createWritable: () => Promise<{ write: (d: string) => Promise<void>; close: () => Promise<void> }> }> }).showSaveFilePicker;
  if (picker) {
    try {
      const file = await picker({
        suggestedName: filename,
        types: [{ description: "Postman Collection", accept: { "application/json": [".json"] } }]
      });
      const writable = await file.createWritable();
      await writable.write(text);
      await writable.close();
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
