import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer, type FixtureServer } from "../src/http/fixtures-server.js";
import { executeHttp } from "../src/http/execute.js";
import { collectSse } from "../src/protocols/sse.js";
import { connectWebSocket } from "../src/protocols/websocket.js";
import { operationsFromWsdl, soapEnvelope } from "../src/soap/wsdl.js";
import { emptyHttpDocument, kv } from "../src/index.js";

let server: FixtureServer;
beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

describe("protocol fixtures", () => {
  it("GraphQL over HTTP", async () => {
    const doc = emptyHttpDocument();
    doc.protocol = "graphql";
    doc.method = "POST";
    doc.url = `${server.url}/graphql`;
    doc.body = { mode: "graphql", graphql: { query: "{ hello }" } };
    const res = await executeHttp({ document: doc, authChain: [{ type: "none", params: {} }], scopes: {} });
    expect(JSON.parse(res.bodyText).data.hello).toBe("world");
  });

  it("SOAP XML with SOAPAction", async () => {
    const { xml, headers } = soapEnvelope("<Add><a>1</a><b>2</b></Add>", "Add");
    const doc = emptyHttpDocument();
    doc.protocol = "soap";
    doc.method = "POST";
    doc.url = `${server.url}/soap`;
    doc.body = { mode: "xml", raw: xml, language: "xml" };
    doc.headers = Object.entries(headers).map(([k, v]) => kv(k, v));
    const res = await executeHttp({ document: doc, authChain: [{ type: "none", params: {} }], scopes: {} });
    expect(res.bodyText).toContain("AddResponse");
    const wsdl = `<definitions><binding><operation name="Add"><soap:operation soapAction="Add"/></operation></binding></definitions>`;
    expect(operationsFromWsdl(wsdl).some((o) => o.name === "Add")).toBe(true);
  });

  it("SSE", async () => {
    const events = await collectSse({ url: `${server.url}/sse`, maxEvents: 1 });
    expect(events[0]?.data).toContain("ok");
  });

  it("WebSocket echo", async () => {
    const url = server.url.replace("http", "ws") + "/ws";
    const got: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("ws timeout")), 4000);
      const conn = connectWebSocket({
        url,
        onOpen: () => conn.send("ping"),
        onMessage: (msg) => {
          got.push(msg.data);
          if (got.length >= 2) {
            clearTimeout(t);
            conn.close();
            resolve();
          }
        },
        onError: (e) => {
          clearTimeout(t);
          reject(e);
        }
      });
    });
    expect(got.some((m) => m.includes("welcome") || m === "ping")).toBe(true);
  });
});
