import { createHmac, randomBytes } from "node:crypto";

export function edgegridHeader(opts: {
  method: string;
  url: string;
  clientToken: string;
  clientSecret: string;
  accessToken: string;
  body?: string;
  timestamp?: string;
  nonce?: string;
}): string {
  const u = new URL(opts.url);
  const timestamp =
    opts.timestamp ??
    new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "+0000");
  const nonce = opts.nonce ?? randomBytes(8).toString("hex");
  const authHeader =
    `EG1-HMAC-SHA256 client_token=${opts.clientToken};access_token=${opts.accessToken};timestamp=${timestamp};nonce=${nonce};`;
  const bodyHash = opts.method.toUpperCase() === "POST"
    ? createHmac("sha256", opts.clientSecret).update(opts.body ?? "").digest("base64")
    : "";
  const dataToSign = [
    opts.method.toUpperCase(),
    u.protocol.replace(":", ""),
    u.host,
    u.pathname + u.search,
    "",
    bodyHash,
    authHeader
  ].join("\t");
  const signingKey = createHmac("sha256", opts.clientSecret).update(timestamp).digest("base64");
  const signature = createHmac("sha256", signingKey).update(dataToSign).digest("base64");
  return `${authHeader}signature=${signature}`;
}
