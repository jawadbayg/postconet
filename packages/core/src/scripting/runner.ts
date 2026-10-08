import { parse } from "csv-parse/sync";
import type { AuthConfig, Collection, Folder, HttpRequestDocument, SavedRequest, Variable } from "../types.js";
import { executeHttp } from "../http/execute.js";
import { runScript, type ScriptRunResult, type TestResult } from "./sandbox.js";
import type { VariableScopes } from "../variables/resolve.js";

export interface RunItemResult {
  requestId: string;
  name: string;
  iteration: number;
  skipped: boolean;
  responseStatus: number;
  elapsedMs: number;
  tests: TestResult[];
  failed: boolean;
  error?: string;
  logs: ScriptRunResult["logs"];
}

export interface CollectionRunResult {
  startedAt: string;
  finishedAt: string;
  iterations: number;
  results: RunItemResult[];
  passed: number;
  failed: number;
  assertionsPassed: number;
  assertionsFailed: number;
}

export interface RunnerOptions {
  collection: Collection;
  folders: Folder[];
  requests: SavedRequest[];
  selectedFolderIds?: string[];
  environment?: Variable[];
  globals?: Variable[];
  iterations?: number;
  delayMs?: number;
  dataset?: Array<Record<string, string>>;
  csvText?: string;
  jsonText?: string;
  signal?: AbortSignal;
  onProgress?: (item: RunItemResult, index: number, total: number) => void;
}

function loadDataset(opts: RunnerOptions): Array<Record<string, string>> {
  if (opts.dataset) return opts.dataset;
  if (opts.csvText) {
    return parse(opts.csvText, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>;
  }
  if (opts.jsonText) {
    const parsed = JSON.parse(opts.jsonText);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return [{}];
}

function folderChain(folders: Folder[], folderId: string | null): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: Folder[] = [];
  let cur = folderId ? byId.get(folderId) : undefined;
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}

function allowedRequest(req: SavedRequest, folders: Folder[], selected?: string[]): boolean {
  if (!selected || selected.length === 0) return true;
  if (selected.includes(req.id)) return true;
  const chain = folderChain(folders, req.folderId);
  return chain.some((f) => selected.includes(f.id));
}

export async function runCollection(opts: RunnerOptions): Promise<CollectionRunResult> {
  const startedAt = new Date().toISOString();
  const dataRows = loadDataset(opts);
  const iterations = Math.max(1, opts.iterations ?? dataRows.length);
  const requests = opts.requests
    .filter((r) => r.collectionId === opts.collection.id && !r.deletedAt && !r.archivedAt)
    .filter((r) => allowedRequest(r, opts.folders, opts.selectedFolderIds))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  let environment = (opts.environment ?? []).map((v) => ({ ...v }));
  let collectionVars = opts.collection.variables.map((v) => ({ ...v }));
  let globals = (opts.globals ?? []).map((v) => ({ ...v }));
  const results: RunItemResult[] = [];
  let assertionsPassed = 0;
  let assertionsFailed = 0;

  const total = iterations * requests.length;
  let index = 0;

  for (let i = 0; i < iterations; i++) {
    const data = dataRows[Math.min(i, dataRows.length - 1)] ?? {};
    for (const req of requests) {
      if (opts.signal?.aborted) throw new Error("Run cancelled");
      const folders = folderChain(opts.folders, req.folderId);
      const document = req.document as HttpRequestDocument;
      const authChain: AuthConfig[] = [opts.collection.auth, ...folders.map((f) => f.auth), document.auth];
      const local: Record<string, string> = {};
      const scopes: VariableScopes = {
        local,
        data,
        environment,
        collection: collectionVars,
        global: globals
      };

      const preCodes = [opts.collection.scripts.prerequest, ...folders.map((f) => f.scripts.prerequest), document.scripts.prerequest];
      let skipped = false;
      const logs: ScriptRunResult["logs"] = [];
      const tests: TestResult[] = [];
      for (const code of preCodes) {
        if (!code) continue;
        const pre = await runScript({
          code,
          eventName: "prerequest",
          request: document,
          scopes,
          iteration: i,
          iterationCount: iterations,
          requestName: req.name
        });
        environment = pre.mutated.environment;
        collectionVars = pre.mutated.collection;
        globals = pre.mutated.global;
        Object.assign(local, pre.mutated.local);
        skipped = skipped || pre.skipped;
        logs.push(...pre.logs);
        tests.push(...pre.tests);
      }

      let status = 0;
      let elapsed = 0;
      let error: string | undefined;
      if (!skipped) {
        const response = await executeHttp({ document, authChain, scopes, signal: opts.signal });
        status = response.status;
        elapsed = response.elapsedMs;
        error = response.error;
        const postCodes = [opts.collection.scripts.test, ...folders.map((f) => f.scripts.test), document.scripts.test];
        for (const code of postCodes) {
          if (!code) continue;
          const post = await runScript({
            code,
            eventName: "test",
            request: document,
            response,
            scopes: { local, data, environment, collection: collectionVars, global: globals },
            iteration: i,
            iterationCount: iterations,
            requestName: req.name
          });
          environment = post.mutated.environment;
          collectionVars = post.mutated.collection;
          globals = post.mutated.global;
          logs.push(...post.logs);
          tests.push(...post.tests);
        }
      }

      for (const t of tests) {
        if (t.passed) assertionsPassed += 1;
        else assertionsFailed += 1;
      }
      const item: RunItemResult = {
        requestId: req.id,
        name: req.name,
        iteration: i,
        skipped,
        responseStatus: status,
        elapsedMs: elapsed,
        tests,
        failed: Boolean(error) || tests.some((t) => !t.passed),
        error,
        logs
      };
      results.push(item);
      index += 1;
      opts.onProgress?.(item, index, total);
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    }
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    iterations,
    results,
    passed: results.filter((r) => !r.failed).length,
    failed: results.filter((r) => r.failed).length,
    assertionsPassed,
    assertionsFailed
  };
}

export function toJUnit(run: CollectionRunResult, suiteName = "PostConet"): string {
  const cases = run.results
    .map((r) => {
      const name = `${r.name} [iter ${r.iteration}]`;
      if (r.failed) {
        const msg = r.error ?? r.tests.filter((t) => !t.passed).map((t) => t.error).join("; ");
        return `<testcase name="${esc(name)}" time="${(r.elapsedMs / 1000).toFixed(3)}"><failure message="${esc(msg ?? "failed")}"/></testcase>`;
      }
      return `<testcase name="${esc(name)}" time="${(r.elapsedMs / 1000).toFixed(3)}"/>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?><testsuite name="${esc(suiteName)}" tests="${run.results.length}" failures="${run.failed}">${cases}</testsuite>`;
}

export function toJsonReport(run: CollectionRunResult) {
  return {
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    iterations: run.iterations,
    passed: run.passed,
    failed: run.failed,
    assertionsPassed: run.assertionsPassed,
    assertionsFailed: run.assertionsFailed,
    results: run.results.map((r) => ({
      name: r.name,
      iteration: r.iteration,
      status: r.responseStatus,
      elapsedMs: r.elapsedMs,
      failed: r.failed,
      skipped: r.skipped,
      tests: r.tests,
      error: r.error
    }))
  };
}

function esc(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}

export async function runLoad(opts: RunnerOptions & { concurrency: number; durationMs?: number; ratePerSec?: number }) {
  const start = Date.now();
  const latencies: number[] = [];
  let ok = 0;
  let err = 0;
  let inFlight = 0;
  const stopAt = opts.durationMs ? start + opts.durationMs : start + 10_000;
  const workers = Array.from({ length: Math.max(1, opts.concurrency) }, async () => {
    while (Date.now() < stopAt) {
      if (opts.signal?.aborted) break;
      inFlight++;
      const one = await runCollection({ ...opts, iterations: 1, dataset: [{}], delayMs: 0 });
      inFlight--;
      for (const r of one.results) {
        latencies.push(r.elapsedMs);
        if (r.failed) err++;
        else ok++;
      }
      if (opts.ratePerSec) await new Promise((r) => setTimeout(r, Math.floor(1000 / opts.ratePerSec!)));
    }
  });
  await Promise.all(workers);
  latencies.sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))] ?? 0;
  return {
    ok,
    err,
    count: latencies.length,
    p50: pct(50),
    p90: pct(90),
    p95: pct(95),
    p99: pct(99),
    durationMs: Date.now() - start,
    kind: "load" as const
  };
}
