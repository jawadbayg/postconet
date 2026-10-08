import { createHmac, createSign, randomBytes } from "node:crypto";

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function oauth1Header(opts: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  signatureMethod: "HMAC-SHA1" | "HMAC-SHA256" | "PLAINTEXT" | "RSA-SHA1";
  privateKey?: string;
  nonce?: string;
  timestamp?: string;
  callback?: string;
  verifier?: string;
  realm?: string;
  extra?: Record<string, string>;
}): string {
  const nonce = opts.nonce ?? randomBytes(8).toString("hex");
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const params: Record<string, string> = {
    oauth_consumer_key: opts.consumerKey,
    oauth_nonce: nonce,
    oauth_timestamp: timestamp,
    oauth_signature_method: opts.signatureMethod,
    oauth_version: "1.0",
    ...opts.extra
  };
  if (opts.token) params.oauth_token = opts.token;
  if (opts.callback) params.oauth_callback = opts.callback;
  if (opts.verifier) params.oauth_verifier = opts.verifier;

  const u = new URL(opts.url);
  u.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  const baseParams = Object.keys(params)
    .sort()
    .map((k) => `${encode(k)}=${encode(params[k]!)}`)
    .join("&");
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  const baseString = [opts.method.toUpperCase(), encode(baseUrl), encode(baseParams)].join("&");

  let signature: string;
  if (opts.signatureMethod === "PLAINTEXT") {
    signature = `${encode(opts.consumerSecret)}&${encode(opts.tokenSecret ?? "")}`;
  } else if (opts.signatureMethod === "RSA-SHA1") {
    if (!opts.privateKey) throw new Error("OAuth 1.0 RSA-SHA1 requires a private key");
    signature = createSign("RSA-SHA1").update(baseString).sign(opts.privateKey, "base64");
  } else {
    const alg = opts.signatureMethod === "HMAC-SHA256" ? "sha256" : "sha1";
    const key = `${encode(opts.consumerSecret)}&${encode(opts.tokenSecret ?? "")}`;
    signature = createHmac(alg, key).update(baseString).digest("base64");
  }
  params.oauth_signature = signature;
  const headerParams = Object.keys(params)
    .filter((k) => k.startsWith("oauth_"))
    .sort()
    .map((k) => `${encode(k)}="${encode(params[k]!)}"`)
    .join(", ");
  const realm = opts.realm ? `realm="${opts.realm}", ` : "";
  return `OAuth ${realm}${headerParams}`;
}
