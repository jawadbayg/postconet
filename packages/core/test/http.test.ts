import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeHttp } from "../src/http/execute.js";
import { startFixtureServer, type FixtureServer } from "../src/http/fixtures-server.js";
import { emptyHttpDocument, kv } from "../src/index.js";

let server: FixtureServer;

beforeAll(async () => {
  server = await startFixtureServer();
});

afterAll(async () => {
  await server.close();
});

describe("HTTP engine", () => {
  it("sends GET with repeated query keys", async () => {
    const doc = emptyHttpDocument();
    doc.url = `${server.url}/get`;
    doc.query = [kv("id", "1"), kv("id", "2")];
    const res = await executeHttp({ document: doc, authChain: [doc.auth], scopes: {} });
    expect(res.status).toBe(200);
    const body = JSON.parse(res.bodyText) as { args: Record<string, unknown> };
    expect(JSON.stringify(body.args.id)).toContain("1");
    expect(JSON.stringify(body.args.id)).toContain("2");
    expect(res.elapsedMs).toBeGreaterThan(0);
    expect(res.measuredTimings.some((t) => t.name === "total")).toBe(true);
  });

  it("posts JSON and inspects response", async () => {
    const doc = emptyHttpDocument();
    doc.method = "POST";
    doc.url = `${server.url}/post`;
    doc.body = { mode: "json", raw: "{\"hello\":\"world\"}", language: "json" };
    const res = await executeHttp({ document: doc, authChain: [{ type: "none", params: {} }], scopes: {} });
    expect(res.ok).toBe(true);
    expect(res.bodyText).toContain("hello");
  });

  it("posts over HTTP/1.1 when HTTP/2 is off", async () => {
    const doc = emptyHttpDocument();
    doc.method = "POST";
    doc.url = `${server.url}/post`;
    doc.settings.http2 = "off";
    doc.body = { mode: "json", raw: "{\"hello\":\"h1\"}", language: "json" };
    const res = await executeHttp({ document: doc, authChain: [{ type: "none", params: {} }], scopes: {} });
    expect(res.ok).toBe(true);
    expect(res.bodyText).toContain("h1");
  });

  it("applies bearer auth", async () => {
    const doc = emptyHttpDocument();
    doc.url = `${server.url}/echo-auth`;
    doc.auth = { type: "bearer", params: { token: "secret-token" } };
    const res = await executeHttp({ document: doc, authChain: [doc.auth], scopes: {} });
    expect(JSON.parse(res.bodyText).authorization).toBe("Bearer secret-token");
  });

  it("substitutes environment variables", async () => {
    const doc = emptyHttpDocument();
    doc.url = "{{base}}/get";
    const res = await executeHttp({
      document: doc,
      authChain: [{ type: "none", params: {} }],
      scopes: { environment: [{ id: "1", key: "base", value: server.url, enabled: true, secret: false }] }
    });
    expect(res.status).toBe(200);
  });

  it("flags truncation", async () => {
    const doc = emptyHttpDocument();
    doc.url = `${server.url}/large`;
    doc.settings.maxResponseBytes = 10;
    const res = await executeHttp({ document: doc, authChain: [{ type: "none", params: {} }], scopes: {} });
    expect(res.truncated).toBe(true);
    expect(res.sizeBytes).toBe(10);
  });
});
