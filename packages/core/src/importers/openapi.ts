import { parse as parseYaml } from "yaml";
import type { Collection, HttpRequestDocument, ImportIssue, ImportPreview, SavedRequest } from "../types.js";
import { createId, nowIso } from "../ids.js";
import { kv } from "../kv.js";
import { emptyAuth, emptyHttpDocument } from "../types.js";

export function parseSpec(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  return parseYaml(trimmed);
}

export function importOpenApi(spec: unknown, workspaceId: string): ImportPreview {
  const issues: ImportIssue[] = [];
  const doc = spec as {
    openapi?: string;
    swagger?: string;
    info?: { title?: string; description?: string };
    servers?: Array<{ url?: string }>;
    paths?: Record<string, Record<string, unknown>>;
    components?: { securitySchemes?: Record<string, unknown> };
  };
  if (!doc.openapi && !doc.swagger) {
    issues.push({ level: "error", path: "/", message: "Not an OpenAPI or Swagger document" });
    return {
      format: "openapi",
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
  const collection: Collection = {
    id: createId("col"),
    workspaceId,
    projectId: null,
    name: doc.info?.title ?? "OpenAPI import",
    description: doc.info?.description,
    auth: emptyAuth("none"),
    variables: [
      {
        id: createId("var"),
        key: "baseUrl",
        value: doc.servers?.[0]?.url ?? "http://localhost",
        sharedValue: doc.servers?.[0]?.url ?? "http://localhost",
        enabled: true,
        secret: false
      }
    ],
    scripts: { prerequest: "", test: "" },
    favorite: false,
    archivedAt: null,
    deletedAt: null,
    version: 1,
    updatedAt: nowIso(),
    createdAt: nowIso()
  };
  const requests: SavedRequest[] = [];
  let order = 0;
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods ?? {})) {
      if (!["get", "post", "put", "patch", "delete", "head", "options", "trace"].includes(method)) continue;
      const operation = op as {
        operationId?: string;
        summary?: string;
        parameters?: Array<{ name: string; in: string; example?: unknown; schema?: { default?: unknown } }>;
        requestBody?: { content?: Record<string, { example?: unknown; schema?: unknown }> };
      };
      const http: HttpRequestDocument = {
        ...emptyHttpDocument(),
        method: method.toUpperCase(),
        url: `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, ":$1")}`,
        auth: emptyAuth("inherit")
      };
      for (const p of operation.parameters ?? []) {
        const value = String(p.example ?? p.schema?.default ?? "");
        if (p.in === "query") http.query.push(kv(p.name, value));
        else if (p.in === "header") http.headers.push(kv(p.name, value));
        else if (p.in === "path") http.pathVariables.push(kv(p.name, value));
      }
      const jsonContent = operation.requestBody?.content?.["application/json"];
      if (jsonContent) {
        http.body = {
          mode: "json",
          language: "json",
          raw: JSON.stringify(jsonContent.example ?? sampleFromSchema(jsonContent.schema), null, 2)
        };
        http.headers.push(kv("Content-Type", "application/json"));
      }
      requests.push({
        id: createId("req"),
        workspaceId,
        collectionId: collection.id,
        folderId: null,
        projectId: null,
        name: operation.summary ?? operation.operationId ?? `${method.toUpperCase()} ${path}`,
        protocol: "http",
        sortOrder: order++,
        document: http,
        examples: [],
        favorite: false,
        archivedAt: null,
        deletedAt: null,
        version: 1,
        updatedAt: nowIso(),
        createdAt: nowIso()
      });
    }
  }
  if (doc.swagger === "2.0") issues.push({ level: "info", path: "/", message: "Imported Swagger 2.0 as HTTP requests" });
  return {
    format: doc.openapi ? "openapi" : "swagger",
    title: collection.name,
    collections: [collection],
    requests,
    folders: [],
    environments: [],
    globals: [],
    issues,
    missingFiles: [],
    unknownPreserved: false
  };
}

function sampleFromSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return {};
  const s = schema as { type?: string; properties?: Record<string, unknown>; example?: unknown; items?: unknown };
  if (s.example !== undefined) return s.example;
  if (s.type === "array") return [sampleFromSchema(s.items)];
  if (s.type === "string") return "";
  if (s.type === "number" || s.type === "integer") return 0;
  if (s.type === "boolean") return false;
  if (s.properties) {
    return Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, sampleFromSchema(v)]));
  }
  return {};
}
