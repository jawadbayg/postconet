import type { HttpRequestDocument, ImportPreview, SavedRequest } from "../types.js";
import { createId, nowIso } from "../ids.js";
import { kv } from "../kv.js";
import { emptyAuth, emptyHttpDocument, emptyScripts } from "../types.js";
import { splitUrlQuery } from "../http/url.js";

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let escape = false;
  const src = input.replace(/\\\n/g, " ").trim();
  for (const ch of src) {
    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escape = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) tokens.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

export function parseCurl(command: string): HttpRequestDocument {
  const tokens = tokenize(command.replace(/^\s*curl\s+/i, "curl "));
  const doc = emptyHttpDocument();
  let i = 0;
  if (tokens[0] === "curl") i = 1;
  while (i < tokens.length) {
    const t = tokens[i]!;
    const next = () => tokens[++i] ?? "";
    if (t === "-X" || t === "--request") doc.method = next().toUpperCase();
    else if (t === "-H" || t === "--header") {
      const h = next();
      const idx = h.indexOf(":");
      if (idx !== -1) doc.headers.push(kv(h.slice(0, idx).trim(), h.slice(idx + 1).trim()));
    } else if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary" || t === "--data-ascii") {
      doc.body = { mode: "raw", raw: next(), language: "text" };
      if (doc.method === "GET") doc.method = "POST";
    } else if (t === "--data-urlencode") {
      const v = next();
      const eq = v.indexOf("=");
      doc.body.mode = "urlencoded";
      doc.body.urlencoded = doc.body.urlencoded ?? [];
      doc.body.urlencoded.push(eq === -1 ? kv(v, "") : kv(v.slice(0, eq), v.slice(eq + 1)));
      if (doc.method === "GET") doc.method = "POST";
    } else if (t === "-F" || t === "--form") {
      const v = next();
      const eq = v.indexOf("=");
      doc.body.mode = "formdata";
      doc.body.formdata = doc.body.formdata ?? [];
      const key = eq === -1 ? v : v.slice(0, eq);
      const val = eq === -1 ? "" : v.slice(eq + 1);
      if (val.startsWith("@")) {
        doc.body.formdata.push({ ...kv(key, ""), type: "file", filePath: val.slice(1) });
      } else doc.body.formdata.push(kv(key, val));
      if (doc.method === "GET") doc.method = "POST";
    } else if (t === "-u" || t === "--user") {
      const [username, password] = next().split(":");
      doc.auth = { type: "basic", params: { username: username ?? "", password: password ?? "" } };
    } else if (t === "-A" || t === "--user-agent") doc.headers.push(kv("User-Agent", next()));
    else if (t === "-b" || t === "--cookie") doc.headers.push(kv("Cookie", next()));
    else if (t === "-e" || t === "--referer") doc.headers.push(kv("Referer", next()));
    else if (t === "--compressed") {
      /* accepted */
    } else if (t === "-k" || t === "--insecure") doc.settings.tlsVerify = false;
    else if (t === "-L" || t === "--location") doc.settings.followRedirects = true;
    else if (t === "--max-time") doc.settings.timeoutMs = Number(next()) * 1000;
    else if (t === "-G" || t === "--get") doc.method = "GET";
    else if (t === "--url") doc.url = next();
    else if (t.startsWith("-") && t !== "-") {
      if (t.startsWith("--") && t.includes("=")) {
        /* ignored long opt with = */
      }
    } else if (!t.startsWith("-")) {
      doc.url = t;
    }
    i++;
  }
  if (doc.body.raw && looksJson(doc.body.raw)) {
    doc.body.mode = "json";
    doc.body.language = "json";
  }
  const split = splitUrlQuery(doc.url);
  if (split.query.length && doc.query.length === 0) {
    doc.url = split.url;
    doc.query = split.query.map((q) => kv(q.key, q.value));
  }
  if (doc.auth.type === "inherit") doc.auth = emptyAuth("none");
  return doc;
}

function looksJson(s: string) {
  const t = s.trim();
  return t.startsWith("{") || t.startsWith("[");
}

export function exportCurl(doc: HttpRequestDocument, name?: string): string {
  const parts = ["curl", "-X", doc.method];
  for (const h of doc.headers.filter((x) => x.enabled && x.key)) {
    parts.push("-H", shell(h.key + ": " + h.value));
  }
  let url = doc.url;
  if (doc.query.some((q) => q.enabled)) {
    const q = doc.query.filter((x) => x.enabled && x.key).map((x) => `${encodeURIComponent(x.key)}=${encodeURIComponent(x.value)}`).join("&");
    url += (url.includes("?") ? "&" : "?") + q;
  }
  if (doc.body.mode === "json" || doc.body.mode === "raw" || doc.body.mode === "xml" || doc.body.mode === "text") {
    if (doc.body.raw) parts.push("--data-raw", shell(doc.body.raw));
  }
  if (doc.body.mode === "urlencoded") {
    for (const f of doc.body.urlencoded ?? []) {
      if (f.enabled) parts.push("--data-urlencode", shell(`${f.key}=${f.value}`));
    }
  }
  if (doc.body.mode === "formdata") {
    for (const f of doc.body.formdata ?? []) {
      if (!f.enabled) continue;
      parts.push("-F", shell(f.type === "file" && f.filePath ? `${f.key}=@${f.filePath}` : `${f.key}=${f.value}`));
    }
  }
  if (doc.auth.type === "basic") parts.push("-u", shell(`${doc.auth.params.username}:${doc.auth.params.password}`));
  if (doc.auth.type === "bearer") parts.push("-H", shell(`Authorization: Bearer ${doc.auth.params.token}`));
  if (!doc.settings.tlsVerify) parts.push("-k");
  parts.push(shell(url));
  void name;
  return parts.join(" ");
}

function shell(value: string): string {
  if (!/[^\w.:=/+@-]/g.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function importCurl(command: string, workspaceId: string, collectionId: string): ImportPreview {
  const document = parseCurl(command);
  const request: SavedRequest = {
    id: createId("req"),
    workspaceId,
    collectionId,
    folderId: null,
    projectId: null,
    name: document.method + " " + (document.url || "cURL"),
    protocol: "http",
    sortOrder: 0,
    document,
    examples: [],
    favorite: false,
    archivedAt: null,
    deletedAt: null,
    version: 1,
    updatedAt: nowIso(),
    createdAt: nowIso()
  };
  return {
    format: "curl",
    title: request.name,
    collections: [],
    requests: [request],
    folders: [],
    environments: [],
    globals: [],
    issues: document.scripts === emptyScripts() ? [] : [],
    missingFiles: (document.body.formdata ?? []).filter((f) => f.type === "file" && f.filePath).map((f) => f.filePath!),
    unknownPreserved: false
  };
}
