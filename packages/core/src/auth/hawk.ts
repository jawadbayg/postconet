import { createHmac, createHash, randomBytes } from "node:crypto";

export function hawkHeader(opts: {
  id: string;
  key: string;
  algorithm: "sha1" | "sha256";
  method: string;
  url: string;
  payload?: string;
  contentType?: string;
  includePayloadHash?: boolean;
  ext?: string;
  timestamp?: number;
  nonce?: string;
}): string {
  const u = new URL(opts.url);
  const ts = String(opts.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = opts.nonce ?? randomBytes(5).toString("hex");
  const host = u.hostname;
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  const resource = `${u.pathname}${u.search}`;
  let hash = "";
  if (opts.includePayloadHash && opts.payload !== undefined) {
    const payloadHash = createHash(opts.algorithm)
      .update(`hawk.1.payload\n${opts.contentType ?? ""}\n${opts.payload}\n`)
      .digest("base64");
    hash = payloadHash;
  }
  const normalized = [
    "hawk.1.header",
    ts,
    nonce,
    opts.method.toUpperCase(),
    resource,
    host,
    port,
    hash,
    opts.ext ?? "",
    ""
  ].join("\n");
  const mac = createHmac(opts.algorithm, opts.key).update(normalized).digest("base64");
  const parts = [`id="${opts.id}"`, `ts="${ts}"`, `nonce="${nonce}"`, `mac="${mac}"`];
  if (hash) parts.push(`hash="${hash}"`);
  if (opts.ext) parts.push(`ext="${opts.ext}"`);
  return `Hawk ${parts.join(", ")}`;
}
