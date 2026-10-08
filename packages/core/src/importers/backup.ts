import { createHash, createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { detectAndImport } from "./detect.js";
import type { ImportPreview } from "../types.js";

export const BACKUP_VERSION = 1;

export interface BackupManifest {
  format: "postconet-backup";
  version: number;
  createdAt: string;
  product: string;
  checksums: Record<string, string>;
  encrypted: boolean;
  includesSecrets: boolean;
  files: string[];
}

export function buildBackup(opts: {
  workspaceJson: unknown;
  attachments?: Record<string, Buffer>;
  includeSecrets: boolean;
  passphrase?: string;
  productName: string;
}): { manifest: BackupManifest; blob: Buffer } {
  const files: Record<string, Buffer> = {
    "workspace.json": Buffer.from(JSON.stringify(opts.workspaceJson, null, 2), "utf8")
  };
  for (const [name, buf] of Object.entries(opts.attachments ?? {})) {
    const safe = name.replace(/\\/g, "/").split("/").filter((p) => p !== ".." && p !== "").join("/");
    files[`attachments/${safe}`] = buf;
  }
  const checksums: Record<string, string> = {};
  for (const [name, buf] of Object.entries(files)) checksums[name] = createHash("sha256").update(buf).digest("hex");
  const manifest: BackupManifest = {
    format: "postconet-backup",
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    product: opts.productName,
    checksums,
    encrypted: Boolean(opts.passphrase),
    includesSecrets: opts.includeSecrets,
    files: Object.keys(files)
  };
  files["manifest.json"] = Buffer.from(JSON.stringify(manifest, null, 2));
  let packed = pack(files);
  if (opts.passphrase) packed = encrypt(packed, opts.passphrase);
  return { manifest, blob: packed };
}

export function extractBackup(blob: Buffer, passphrase?: string): { manifest: BackupManifest; files: Record<string, Buffer> } {
  let packed = blob;
  if (blob.subarray(0, 4).toString() === "PCNE") packed = decrypt(blob, passphrase ?? "");
  const files = unpack(packed);
  if (files["manifest.json"] == null) throw new Error("Backup missing manifest.json");
  const manifest = JSON.parse(files["manifest.json"].toString("utf8")) as BackupManifest;
  for (const [name, sum] of Object.entries(manifest.checksums)) {
    const file = files[name];
    if (!file) throw new Error(`Missing backup file ${name}`);
    const actual = createHash("sha256").update(file).digest("hex");
    if (actual !== sum) throw new Error(`Checksum mismatch for ${name}`);
  }
  return { manifest, files };
}

function pack(files: Record<string, Buffer>): Buffer {
  const parts: Buffer[] = [];
  const names = Object.keys(files);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(names.length);
  parts.push(Buffer.from("PCN0"), header);
  for (const name of names) {
    const n = Buffer.from(name, "utf8");
    const nh = Buffer.alloc(4);
    nh.writeUInt32BE(n.length);
    const fh = Buffer.alloc(4);
    const data = files[name]!;
    fh.writeUInt32BE(data.length);
    parts.push(nh, n, fh, data);
  }
  return Buffer.concat(parts);
}

function unpack(buf: Buffer): Record<string, Buffer> {
  if (buf.subarray(0, 4).toString() !== "PCN0") throw new Error("Not a PostConet backup");
  let offset = 4;
  const count = buf.readUInt32BE(offset);
  offset += 4;
  const files: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    const nlen = buf.readUInt32BE(offset);
    offset += 4;
    const name = buf.subarray(offset, offset + nlen).toString("utf8");
    offset += nlen;
    if (name.includes("..") || name.startsWith("/")) throw new Error("Unsafe backup path");
    const flen = buf.readUInt32BE(offset);
    offset += 4;
    files[name] = buf.subarray(offset, offset + flen);
    offset += flen;
  }
  return files;
}

function encrypt(data: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const key = scryptSync(passphrase, salt, 32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("PCNE"), salt, iv, tag, enc]);
}

function decrypt(data: Buffer, passphrase: string): Buffer {
  const salt = data.subarray(4, 20);
  const iv = data.subarray(20, 32);
  const tag = data.subarray(32, 48);
  const enc = data.subarray(48);
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

export function previewWorkspaceJson(json: unknown, workspaceId: string): ImportPreview {
  if (typeof json === "string") return detectAndImport(json, workspaceId);
  return detectAndImport(JSON.stringify(json), workspaceId);
}
