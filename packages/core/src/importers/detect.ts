import { detectPostmanFormat, importPostmanCollection, importPostmanEnvironment, importPostmanGlobals } from "./postman.js";
import { importCurl } from "./curl.js";
import { importOpenApi, parseSpec } from "./openapi.js";
import { importHar } from "./har.js";
import { createId, nowIso } from "../ids.js";
import { emptyAuth } from "../types.js";
import type { Collection, ImportPreview } from "../types.js";

export function detectAndImport(source: string, workspaceId: string): ImportPreview {
  const trimmed = source.trim();
  if (/^curl\s/i.test(trimmed)) {
    const collection = scratchCollection(workspaceId, "cURL import");
    const preview = importCurl(trimmed, workspaceId, collection.id);
    preview.collections = [collection];
    preview.requests = preview.requests.map((r) => ({ ...r, collectionId: collection.id }));
    return preview;
  }
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    try {
      json = parseSpec(trimmed);
    } catch {
      return {
        format: "unknown",
        title: "",
        collections: [],
        requests: [],
        folders: [],
        environments: [],
        globals: [],
        issues: [{ level: "error", path: "/", message: "Could not parse JSON, YAML, or cURL" }],
        missingFiles: [],
        unknownPreserved: false
      };
    }
  }
  const postman = detectPostmanFormat(json);
  if (postman?.startsWith("collection")) return importPostmanCollection(json, workspaceId);
  if (postman === "environment") return importPostmanEnvironment(json, workspaceId);
  if (postman === "globals") return importPostmanGlobals(json);
  if (postman === "dump") {
    const dump = json as { collections?: unknown[]; environments?: unknown[] };
    const merged: ImportPreview = {
      format: "dump",
      title: "Bulk export",
      collections: [],
      requests: [],
      folders: [],
      environments: [],
      globals: [],
      issues: [],
      missingFiles: [],
      unknownPreserved: true
    };
    for (const col of dump.collections ?? []) {
      const part = importPostmanCollection(col, workspaceId);
      merged.collections.push(...part.collections);
      merged.requests.push(...part.requests);
      merged.folders.push(...part.folders);
      merged.issues.push(...part.issues);
      merged.missingFiles.push(...part.missingFiles);
    }
    for (const env of dump.environments ?? []) {
      const part = importPostmanEnvironment(env, workspaceId);
      merged.environments.push(...part.environments);
    }
    return merged;
  }
  const obj = json as { openapi?: string; swagger?: string; log?: unknown; paths?: unknown };
  if (obj.openapi || obj.swagger || obj.paths) return importOpenApi(json, workspaceId);
  if (obj.log) {
    const collection = scratchCollection(workspaceId, "HAR import");
    const preview = importHar(json, workspaceId, collection.id);
    preview.collections = [collection];
    return preview;
  }
  return {
    format: "unknown",
    title: "",
    collections: [],
    requests: [],
    folders: [],
    environments: [],
    globals: [],
    issues: [{ level: "error", path: "/", message: "Unrecognized import format" }],
    missingFiles: [],
    unknownPreserved: false
  };
}

function scratchCollection(workspaceId: string, name: string): Collection {
  return {
    id: createId("col"),
    workspaceId,
    projectId: null,
    name,
    auth: emptyAuth("none"),
    variables: [],
    scripts: { prerequest: "", test: "" },
    favorite: false,
    archivedAt: null,
    deletedAt: null,
    version: 1,
    updatedAt: nowIso(),
    createdAt: nowIso()
  };
}
