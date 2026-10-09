import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportPostmanCollection, importPostmanCollection } from "../src/importers/postman.js";
import { parseCurl, exportCurl } from "../src/importers/curl.js";
import { detectAndImport } from "../src/importers/detect.js";
import { buildBackup, extractBackup } from "../src/importers/backup.js";

const fixture = JSON.parse(
  readFileSync(new URL("../../../fixtures/postman/echo.collection.json", import.meta.url), "utf8")
);

describe("Postman collection round trip", () => {
  it("imports v2.1, preserves folders/scripts/auth, and re-exports", () => {
    const preview = importPostmanCollection(fixture, "ws1");
    expect(preview.issues.filter((i) => i.level === "error")).toHaveLength(0);
    expect(preview.collections[0]?.name).toBe("PostConet Echo Sample");
    expect(preview.folders.some((f) => f.name === "Users")).toBe(true);
    expect(preview.requests.length).toBeGreaterThanOrEqual(2);
    const get = preview.requests.find((r) => r.name === "List users");
    expect(get).toBeTruthy();
    const exported = exportPostmanCollection({
      collection: preview.collections[0]!,
      folders: preview.folders,
      requests: preview.requests
    });
    const again = importPostmanCollection(exported, "ws1");
    expect(again.requests.map((r) => r.name).sort()).toEqual(preview.requests.map((r) => r.name).sort());
    const scriptsSurvive = again.requests.find((r) => r.name === "List users")?.document;
    expect((scriptsSurvive as { scripts: { test: string } }).scripts.test).toContain("pm.test");
  });

  it("exports a folder or a single request as its own Postman collection", () => {
    const preview = importPostmanCollection(fixture, "ws1");
    const users = preview.folders.find((f) => f.name === "Users");
    expect(users).toBeTruthy();
    const folderJson = exportPostmanCollection({
      collection: preview.collections[0]!,
      folders: preview.folders,
      requests: preview.requests,
      rootFolderId: users!.id
    }) as { info: { name: string; schema: string }; item: Array<{ name: string }> };
    expect(folderJson.info.schema).toContain("v2.1.0");
    expect(folderJson.info.name).toBe("Users");
    expect(folderJson.item.map((i) => i.name).sort()).toEqual(["Create user", "List users"]);

    const req = preview.requests.find((r) => r.name === "Create user");
    expect(req).toBeTruthy();
    const reqJson = exportPostmanCollection({
      collection: preview.collections[0]!,
      folders: preview.folders,
      requests: preview.requests,
      onlyRequestId: req!.id
    }) as { info: { name: string }; item: Array<{ name: string; request: { method: string; body?: { raw: string } } }> };
    expect(reqJson.info.name).toBe("Create user");
    expect(reqJson.item).toHaveLength(1);
    expect(reqJson.item[0]?.request.method).toBe("POST");
    expect(reqJson.item[0]?.request.body?.raw).toContain("Ada");
  });

  it("splits concrete URLs into host, port, and path like Postman", () => {
    const src = {
      info: { name: "bot", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      item: [
        {
          name: "First Job - run",
          request: {
            method: "POST",
            header: [{ key: "Content-Type", value: "application/json" }],
            body: {
              mode: "raw",
              raw: '{"categories":["Pet Supplies"]}',
              options: { raw: { language: "json" } }
            },
            url: "http://127.0.0.1:5000/api/bot/run"
          }
        }
      ]
    };
    const preview = importPostmanCollection(src, "ws1");
    const exported = exportPostmanCollection({
      collection: preview.collections[0]!,
      folders: preview.folders,
      requests: preview.requests
    }) as {
      item: Array<{
        request: {
          method: string;
          url: { raw: string; protocol: string; host: string[]; port: string; path: string[] };
          body: { raw: string };
        };
      }>;
    };
    const url = exported.item[0]?.request.url;
    expect(exported.item[0]?.request.method).toBe("POST");
    expect(url?.protocol).toBe("http");
    expect(url?.host).toEqual(["127", "0", "0", "1"]);
    expect(url?.port).toBe("5000");
    expect(url?.path).toEqual(["api", "bot", "run"]);
    expect(exported.item[0]?.request.body.raw).toContain("Pet Supplies");
  });

  it("does not treat missing file bodies as imported content", () => {
    const src = {
      info: { name: "files", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
      item: [{ name: "upload", request: { method: "POST", body: { mode: "file", file: { src: "/tmp/missing.bin" } }, url: "https://x.test" } }]
    };
    const preview = importPostmanCollection(src, "ws1");
    expect(preview.missingFiles).toContain("/tmp/missing.bin");
    expect(preview.issues.some((i) => i.message.includes("not imported"))).toBe(true);
  });
});

describe("cURL", () => {
  it("parses common flags and exports a runnable command", () => {
    const doc = parseCurl(`curl -X POST 'https://api.example.test/v1/items?x=1' -H 'Content-Type: application/json' --data-raw '{"a":1}' -u user:pass`);
    expect(doc.method).toBe("POST");
    expect(doc.auth.type).toBe("basic");
    expect(doc.body.raw).toContain("a");
    const out = exportCurl(doc);
    expect(out).toContain("POST");
    expect(out).toContain("api.example.test");
  });
});

describe("detect", () => {
  it("detects OpenAPI yaml", () => {
    const preview = detectAndImport(
      "openapi: 3.0.0\ninfo:\n  title: Demo\npaths:\n  /ping:\n    get:\n      summary: Ping\n",
      "ws1"
    );
    expect(preview.format).toBe("openapi");
    expect(preview.requests[0]?.name).toContain("Ping");
  });
});

describe("native backup", () => {
  it("round-trips with checksums and rejects path traversal", () => {
    const { blob } = buildBackup({
      workspaceJson: { hello: "world" },
      attachments: { "note.txt": Buffer.from("hi") },
      includeSecrets: false,
      productName: "PostConet API Studio"
    });
    const extracted = extractBackup(blob);
    expect(extracted.manifest.format).toBe("postconet-backup");
    expect(extracted.files["workspace.json"]?.toString()).toContain("hello");
  });
});
