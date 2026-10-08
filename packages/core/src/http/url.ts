import type { KeyValue } from "../types.js";
import { activePairs } from "../kv.js";

export function applyPathVariables(url: string, pathVariables: KeyValue[]): string {
  let out = url;
  for (const { key, value } of activePairs(pathVariables)) {
    out = out.replaceAll(`:${key}`, encodeURIComponent(value));
    out = out.replaceAll(`{${key}}`, encodeURIComponent(value));
  }
  return out;
}

export function mergeQuery(url: string, query: KeyValue[], encode = true): string {
  const pairs = activePairs(query);
  if (pairs.length === 0) return url;
  const u = new URL(url, "http://local.invalid");
  const isRelative = !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
  for (const { key, value } of pairs) {
    u.searchParams.append(key, value);
  }
  if (!encode) {
    const raw = pairs.map(({ key, value }) => `${key}=${value}`).join("&");
    const base = url.split("?")[0] ?? url;
    const hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
    const existing = url.includes("?") && !url.endsWith("?") ? "" : "";
    void existing;
    return `${base}?${raw}${hash}`;
  }
  if (isRelative && url.startsWith("/")) {
    return `${u.pathname}${u.search}${u.hash}`;
  }
  if (isRelative) {
    const q = u.search;
    const hashIdx = url.indexOf("#");
    const withoutHash = hashIdx === -1 ? url : url.slice(0, hashIdx);
    const base = withoutHash.split("?")[0] ?? withoutHash;
    const hash = hashIdx === -1 ? "" : url.slice(hashIdx);
    return `${base}${q}${hash}`;
  }
  return u.toString();
}

export function splitUrlQuery(url: string): { url: string; query: Array<{ key: string; value: string }> } {
  try {
    const u = new URL(url);
    const query: Array<{ key: string; value: string }> = [];
    u.searchParams.forEach((value, key) => query.push({ key, value }));
    u.search = "";
    return { url: u.toString(), query };
  } catch {
    const idx = url.indexOf("?");
    if (idx === -1) return { url, query: [] };
    const query = url
      .slice(idx + 1)
      .split("&")
      .filter(Boolean)
      .map((part) => {
        const eq = part.indexOf("=");
        if (eq === -1) return { key: decodeURIComponent(part), value: "" };
        return {
          key: decodeURIComponent(part.slice(0, eq)),
          value: decodeURIComponent(part.slice(eq + 1))
        };
      });
    return { url: url.slice(0, idx), query };
  }
}
