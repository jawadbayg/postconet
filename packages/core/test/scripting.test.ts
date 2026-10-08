import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runScript } from "../src/scripting/sandbox.js";
import { runCollection, toJUnit } from "../src/scripting/runner.js";
import { startFixtureServer, type FixtureServer } from "../src/http/fixtures-server.js";
import { emptyHttpDocument, type Collection, type SavedRequest } from "../src/index.js";
import { createId, nowIso } from "../src/ids.js";

let server: FixtureServer;
beforeAll(async () => {
  server = await startFixtureServer();
});
afterAll(async () => {
  await server.close();
});

describe("script sandbox", () => {
  it("records pm.test pass/fail and forbids eval", async () => {
    const doc = emptyHttpDocument();
    const result = await runScript({
      code: `pm.test('ok', () => pm.expect(1).to.eql(1)); pm.test('bad', () => pm.expect(1).to.eql(2));`,
      eventName: "test",
      request: doc,
      response: {
        ok: true,
        status: 200,
        statusText: "OK",
        httpVersion: "1.1",
        headers: [],
        cookies: [],
        body: Buffer.from("{}"),
        bodyText: "{}",
        truncated: false,
        sizeBytes: 2,
        elapsedMs: 1,
        measuredTimings: [],
        url: "http://x",
        redirected: false
      },
      scopes: {},
      iteration: 0,
      iterationCount: 1,
      requestName: "t"
    });
    expect(result.tests[0]?.passed).toBe(true);
    expect(result.tests[1]?.passed).toBe(false);
    const evaled = await runScript({
      code: `eval('1+1')`,
      eventName: "prerequest",
      request: doc,
      scopes: {},
      iteration: 0,
      iterationCount: 1,
      requestName: "t"
    });
    expect(evaled.error).toBeTruthy();
  });
});

describe("collection runner", () => {
  it("runs scripts and datasets with pass/fail reports", async () => {
    const collection: Collection = {
      id: "col1",
      workspaceId: "ws",
      projectId: null,
      name: "run",
      auth: { type: "none", params: {} },
      variables: [],
      scripts: { prerequest: "", test: "" },
      favorite: false,
      archivedAt: null,
      deletedAt: null,
      version: 1,
      updatedAt: nowIso(),
      createdAt: nowIso()
    };
    const req: SavedRequest = {
      id: createId("req"),
      workspaceId: "ws",
      collectionId: "col1",
      folderId: null,
      projectId: null,
      name: "echo",
      protocol: "http",
      sortOrder: 0,
      document: {
        ...emptyHttpDocument(),
        url: `${server.url}/get`,
        scripts: {
          prerequest: "",
          test: `pm.test('status', () => pm.response.to.have.status(200));`
        }
      },
      examples: [],
      favorite: false,
      archivedAt: null,
      deletedAt: null,
      version: 1,
      updatedAt: nowIso(),
      createdAt: nowIso()
    };
    const run = await runCollection({
      collection,
      folders: [],
      requests: [req],
      csvText: "n\n1\n2\n",
      iterations: 2
    });
    expect(run.results).toHaveLength(2);
    expect(run.failed).toBe(0);
    expect(run.assertionsPassed).toBeGreaterThan(0);
    const xml = toJUnit(run);
    expect(xml).toContain("testsuite");
    expect(xml).toContain("failures=\"0\"");
  });
});
