import { resolveDynamic } from "./dynamic.js";
import type { Variable } from "../types.js";

export type VariableScopeName = "local" | "data" | "environment" | "collection" | "global";

export interface VariableScopes {
  local?: Record<string, string>;
  data?: Record<string, string>;
  environment?: Variable[];
  collection?: Variable[];
  global?: Variable[];
}

const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;

function valueOf(list: Variable[] | undefined, key: string): string | undefined {
  const found = list?.find((item) => item.enabled && item.key === key);
  if (!found) return undefined;
  if (found.secret && found.value === "") return found.sharedValue;
  return found.value !== "" ? found.value : found.sharedValue;
}

/**
 * Narrowest scope wins: local > data > environment > collection > global.
 * Matches Postman documented precedence.
 */
export function lookupVariable(key: string, scopes: VariableScopes): { value: string; scope: VariableScopeName } | undefined {
  if (scopes.local && Object.prototype.hasOwnProperty.call(scopes.local, key)) {
    return { value: scopes.local[key] ?? "", scope: "local" };
  }
  if (scopes.data && Object.prototype.hasOwnProperty.call(scopes.data, key)) {
    return { value: scopes.data[key] ?? "", scope: "data" };
  }
  const env = valueOf(scopes.environment, key);
  if (env !== undefined) return { value: env, scope: "environment" };
  const col = valueOf(scopes.collection, key);
  if (col !== undefined) return { value: col, scope: "collection" };
  const glob = valueOf(scopes.global, key);
  if (glob !== undefined) return { value: glob, scope: "global" };
  const dyn = resolveDynamic(key);
  if (dyn !== undefined) return { value: dyn, scope: "local" };
  return undefined;
}

export interface ResolveDiagnostics {
  missing: string[];
  used: Array<{ key: string; scope: VariableScopeName }>;
}

export function interpolate(input: string, scopes: VariableScopes, diagnostics?: ResolveDiagnostics, depth = 0): string {
  if (depth > 8) return input;
  return input.replace(TOKEN, (_, raw: string) => {
    const key = String(raw).trim();
    const found = lookupVariable(key, scopes);
    if (!found) {
      diagnostics?.missing.push(key);
      return `{{${key}}}`;
    }
    diagnostics?.used.push({ key, scope: found.scope });
    return interpolate(found.value, scopes, diagnostics, depth + 1);
  });
}

export function interpolateObject<T>(value: T, scopes: VariableScopes, diagnostics?: ResolveDiagnostics): T {
  if (typeof value === "string") return interpolate(value, scopes, diagnostics) as T;
  if (Array.isArray(value)) return value.map((item) => interpolateObject(item, scopes, diagnostics)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolateObject(v, scopes, diagnostics);
    }
    return out as T;
  }
  return value;
}

export function collectPlaceholders(input: string): string[] {
  const keys: string[] = [];
  for (const match of input.matchAll(TOKEN)) {
    const key = match[1]?.trim();
    if (key) keys.push(key);
  }
  return keys;
}

export function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("••••••••");
  }
  return out;
}

export function secretValues(scopes: VariableScopes): string[] {
  const lists = [scopes.environment, scopes.collection, scopes.global];
  const values: string[] = [];
  for (const list of lists) {
    for (const item of list ?? []) {
      if (item.secret && item.value) values.push(item.value);
    }
  }
  return values;
}
