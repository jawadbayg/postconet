import type { HttpRequestDocument, ImportPreview, SavedRequest } from "../types.js";
import { createId, nowIso } from "../ids.js";
import { kv } from "../kv.js";
import { emptyAuth, emptyHttpDocument } from "../types.js";
import { splitUrlQuery } from "../http/url.js";

export function importHar(json: unknown, workspaceId: string, collectionId: string): ImportPreview {
  const har = json as { log?: { entries?: Array<{ request?: Record<string, unknown>; response?: Record<string, unknown> }> } };
  const entries = har.log?.entries ?? [];
  const requests: SavedRequest[] = entries.map((entry, i) => {
    const req = entry.request ?? {};
    const url = String(req.url ?? "");
    const split = splitUrlQuery(url);
    const headers = Array.isArray(req.headers)
      ? (req.headers as Array<{ name: string; value: string }>).map((h) => kv(h.name, h.value))
      : [];
    const post = req.postData as { mimeType?: string; text?: string; params?: Array<{ name: string; value?: string }> } | undefined;
    const document: HttpRequestDocument = {
      ...emptyHttpDocument(),
      method: String(req.method ?? "GET"),
      url: split.url,
      query: split.query.map((q) => kv(q.key, q.value)),
      headers,
      auth: emptyAuth("none"),
      body: post?.params
        ? { mode: "urlencoded", urlencoded: post.params.map((p) => kv(p.name, p.value ?? "")) }
        : post?.text
          ? { mode: post.mimeType?.includes("json") ? "json" : "raw", raw: post.text, language: post.mimeType?.includes("json") ? "json" : "text" }
          : { mode: "none" }
    };
    const res = entry.response as { status?: number; content?: { text?: string; mimeType?: string } } | undefined;
    return {
      id: createId("req"),
      workspaceId,
      collectionId,
      folderId: null,
      projectId: null,
      name: `${document.method} ${new URL(url, "http://local.invalid").pathname}`,
      protocol: "http" as const,
      sortOrder: i,
      document,
      examples: res
        ? [
            {
              id: createId("ex"),
              name: "HAR response",
              status: res.status ?? 0,
              headers: [],
              body: res.content?.text ?? "",
              contentType: res.content?.mimeType
            }
          ]
        : [],
      favorite: false,
      archivedAt: null,
      deletedAt: null,
      version: 1,
      updatedAt: nowIso(),
      createdAt: nowIso()
    };
  });
  return {
    format: "har",
    title: "HAR import",
    collections: [],
    requests,
    folders: [],
    environments: [],
    globals: [],
    issues: [],
    missingFiles: [],
    unknownPreserved: false
  };
}
