import { createHmac, createHash } from "node:crypto";

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function hashHex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function signAwsV4(opts: {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Buffer | string;
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  sessionToken?: string;
  datetime?: Date;
}): Record<string, string> {
  const u = new URL(opts.url);
  const now = opts.datetime ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const body = typeof opts.body === "string" ? Buffer.from(opts.body) : opts.body;
  const payloadHash = hashHex(body);
  const headers: Record<string, string> = { ...opts.headers };
  headers.host = u.host;
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = payloadHash;
  if (opts.sessionToken) headers["x-amz-security-token"] = opts.sessionToken;

  const signedHeaderKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderKeys.map((k) => {
    const raw = headers[Object.keys(headers).find((x) => x.toLowerCase() === k)!] ?? "";
    return `${k}:${raw.trim().replace(/\s+/g, " ")}\n`;
  }).join("");
  const signedHeaders = signedHeaderKeys.join(";");
  const canonicalQuery = [...u.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join("&");
  const canonical = [
    opts.method.toUpperCase(),
    u.pathname || "/",
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/${opts.region}/${opts.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, hashHex(canonical)].join("\n");
  const kDate = hmac(`AWS4${opts.secretKey}`, dateStamp);
  const kRegion = hmac(kDate, opts.region);
  const kService = hmac(kRegion, opts.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${opts.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}
