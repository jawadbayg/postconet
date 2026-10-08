import { nanoid } from "nanoid";

const CLOUD_ENTITY_PREFIXES = new Set(["ws", "col", "fld", "req", "env", "project"]);

export function createId(prefix?: string): string {
  if (prefix && CLOUD_ENTITY_PREFIXES.has(prefix)) {
    return globalThis.crypto.randomUUID();
  }
  const id = nanoid(21);
  return prefix ? `${prefix}_${id}` : id;
}

export function createIdempotencyKey(): string {
  return `idem_${nanoid(24)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
