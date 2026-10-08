import { Script, createContext } from "node:vm";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { expect, AssertionError } from "./expect.js";
import type { HttpExchangeResult, HttpRequestDocument, Variable } from "../types.js";
import type { VariableScopes } from "../variables/resolve.js";
import { lookupVariable } from "../variables/resolve.js";

export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

export interface ScriptLog {
  level: "log" | "warn" | "error" | "info";
  args: unknown[];
}

export interface ScriptRunResult {
  tests: TestResult[];
  logs: ScriptLog[];
  skipped: boolean;
  error?: string;
  mutated: {
    environment: Variable[];
    collection: Variable[];
    global: Variable[];
    local: Record<string, string>;
  };
  nestedRequests: Array<{ url: string; method: string }>;
  warnings: string[];
}

export interface ScriptContextInput {
  code: string;
  eventName: "prerequest" | "test";
  request: HttpRequestDocument;
  response?: HttpExchangeResult | null;
  scopes: VariableScopes;
  iteration: number;
  iterationCount: number;
  requestName: string;
  timeoutMs?: number;
  sendRequest?: (spec: { url: string; method?: string; header?: Record<string, string> }) => Promise<{ code: number; json: unknown; text: string }>;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

function cloneVars(list: Variable[] | undefined): Variable[] {
  return (list ?? []).map((v) => ({ ...v }));
}

function mutate(list: Variable[], key: string, value: string | undefined, unset = false) {
  const idx = list.findIndex((v) => v.key === key);
  if (unset) {
    if (idx >= 0) list.splice(idx, 1);
    return;
  }
  if (idx >= 0) list[idx]!.value = value ?? "";
  else list.push({ id: `var_${key}`, key, value: value ?? "", enabled: true, secret: false });
}

export async function runScript(input: ScriptContextInput): Promise<ScriptRunResult> {
  const tests: TestResult[] = [];
  const logs: ScriptLog[] = [];
  const warnings: string[] = [];
  const nested: Array<{ url: string; method: string }> = [];
  let skipped = false;
  const environment = cloneVars(input.scopes.environment);
  const collection = cloneVars(input.scopes.collection);
  const global = cloneVars(input.scopes.global);
  const local: Record<string, string> = { ...(input.scopes.local ?? {}) };
  const data = { ...(input.scopes.data ?? {}) };
  let nestedCount = 0;

  const varApi = (list: Variable[]) => ({
    get: (key: string) => list.find((v) => v.key === key && v.enabled)?.value,
    set: (key: string, value: unknown) => mutate(list, key, String(value ?? "")),
    unset: (key: string) => mutate(list, key, undefined, true),
    has: (key: string) => list.some((v) => v.key === key),
    toObject: () => Object.fromEntries(list.map((v) => [v.key, v.value]))
  });

  const responseJson = () => {
    if (!input.response) throw new Error("No response");
    return JSON.parse(input.response.bodyText || "null");
  };

  const pm = {
    info: {
      eventName: input.eventName,
      iteration: input.iteration,
      iterationCount: input.iterationCount,
      requestName: input.requestName
    },
    environment: varApi(environment),
    collectionVariables: varApi(collection),
    globals: varApi(global),
    iterationData: {
      get: (key: string) => data[key]
    },
    variables: {
      get: (key: string) =>
        lookupVariable(key, { local, data, environment, collection, global })?.value
    },
    request: {
      url: input.request.url,
      method: input.request.method,
      headers: Object.fromEntries(input.request.headers.filter((h) => h.enabled).map((h) => [h.key, h.value]))
    },
    response: input.response
      ? {
          code: input.response.status,
          status: input.response.statusText,
          responseTime: input.response.elapsedMs,
          headers: Object.fromEntries(input.response.headers.map((h) => [h.key, h.value])),
          text: () => input.response!.bodyText,
          json: responseJson,
          to: {
            have: {
              status: (code: number) => expect({ code: input.response!.status }).status(code),
              jsonSchema: (schema: object) => {
                const validate = ajv.compile(schema);
                const dataJson = responseJson();
                if (!validate(dataJson)) {
                  throw new AssertionError(ajv.errorsText(validate.errors));
                }
              }
            }
          }
        }
      : undefined,
    test: (name: string, fn: () => void) => {
      try {
        fn();
        tests.push({ name, passed: true });
      } catch (error) {
        tests.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
    expect,
    sendRequest: (spec: string | { url: string; method?: string; header?: Record<string, string> }, cb?: (err: unknown, res: unknown) => void) => {
      nestedCount += 1;
      if (nestedCount > 3) {
        warnings.push("pm.sendRequest skipped: nested request limit (3)");
        cb?.(new Error("nested request limit"), undefined);
        return;
      }
      const req = typeof spec === "string" ? { url: spec, method: "GET" } : spec;
      nested.push({ url: req.url, method: req.method ?? "GET" });
      const promise = input.sendRequest
        ? input.sendRequest(req)
        : Promise.resolve({ code: 0, json: {}, text: "" });
      promise.then((res) => cb?.(null, res)).catch((err) => cb?.(err, undefined));
    },
    execution: {
      skipRequest: () => {
        skipped = true;
      },
      setNextRequest: (name: string | null) => {
        warnings.push(`pm.execution.setNextRequest(${String(name)}) is not executed in v0.1`);
      }
    }
  };

  const consoleApi = {
    log: (...args: unknown[]) => logs.push({ level: "log", args }),
    warn: (...args: unknown[]) => logs.push({ level: "warn", args }),
    error: (...args: unknown[]) => logs.push({ level: "error", args }),
    info: (...args: unknown[]) => logs.push({ level: "info", args })
  };

  const sandbox = {
    pm,
    console: consoleApi,
    expect,
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    Map,
    Set,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout
  };

  const code = String(input.code ?? "").trim();
  if (!code) {
    return { tests, logs, skipped, mutated: { environment, collection, global, local }, nestedRequests: nested, warnings };
  }

  try {
    const context = createContext(sandbox, {
      name: "postconet-script",
      codeGeneration: { strings: false, wasm: false }
    });
    const script = new Script(`"use strict";\n${code}`, { filename: "script.js" });
    const result = script.runInContext(context, { timeout: input.timeoutMs ?? 5000, breakOnSigint: true });
    if (result && typeof (result as Promise<unknown>).then === "function") {
      await Promise.race([
        result as Promise<unknown>,
        new Promise((_, reject) => setTimeout(() => reject(new Error("script timeout")), input.timeoutMs ?? 5000))
      ]);
    }
    return { tests, logs, skipped, mutated: { environment, collection, global, local }, nestedRequests: nested, warnings };
  } catch (error) {
    return {
      tests,
      logs,
      skipped,
      error: error instanceof Error ? error.message : String(error),
      mutated: { environment, collection, global, local },
      nestedRequests: nested,
      warnings
    };
  }
}
