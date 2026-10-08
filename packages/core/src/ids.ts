import { nanoid } from "nanoid";

export function createId(prefix?: string): string {
  const id = nanoid(21);
  return prefix ? `${prefix}_${id}` : id;
}

export function createIdempotencyKey(): string {
  return `idem_${nanoid(24)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
