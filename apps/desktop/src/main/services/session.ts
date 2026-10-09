import { app, safeStorage } from "electron";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Session } from "@supabase/supabase-js";

const file = () => join(app.getPath("userData"), "session.bin");

export function saveSession(session: Session) {
  const json = Buffer.from(JSON.stringify(session), "utf8");
  const payload = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json.toString("utf8")) : json;
  writeFileSync(file(), payload);
}

export function loadSession(): Session | null {
  if (!existsSync(file())) return null;
  const buf = readFileSync(file());
  try {
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
    return JSON.parse(json) as Session;
  } catch {
    return null;
  }
}

export function clearSession() {
  if (existsSync(file())) rmSync(file());
}

export function accountDir(userId: string): string {
  const dir = join(app.getPath("userData"), "accounts", userId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(userId: string): string {
  return join(accountDir(userId), "studio.db");
}

export function wipeAccountFiles(userId: string) {
  const dir = join(app.getPath("userData"), "accounts", userId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
