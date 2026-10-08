import { createId } from "./ids.js";
import type { KeyValue } from "./types.js";

export function kv(key = "", value = "", enabled = true): KeyValue {
  return { id: createId("kv"), key, value, enabled };
}

export function activePairs(list: KeyValue[]): Array<{ key: string; value: string }> {
  return list.filter((item) => item.enabled && item.key.length > 0).map((item) => ({
    key: item.key,
    value: item.value
  }));
}

export function toHeaderObject(list: KeyValue[]): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const { key, value } of activePairs(list)) {
    const existing = out[key];
    if (existing === undefined) {
      out[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      out[key] = [existing, value];
    }
  }
  return out;
}

export function flattenHeaders(input: Record<string, string | string[] | undefined>): KeyValue[] {
  const list: KeyValue[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) list.push(kv(key, item));
    } else {
      list.push(kv(key, value));
    }
  }
  return list;
}

export function parseBulk(text: string): KeyValue[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return kv(line, "");
      return kv(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
    });
}

export function serializeBulk(list: KeyValue[]): string {
  return list.map((item) => `${item.enabled ? "" : "// "}${item.key}: ${item.value}`).join("\n");
}
