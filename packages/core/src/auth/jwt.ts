import { SignJWT, importPKCS8 } from "jose";

const ALGS = ["HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "ES256", "ES384", "ES512", "PS256", "PS384", "PS512"] as const;
export type JwtAlg = (typeof ALGS)[number];

export async function signJwtBearer(opts: {
  algorithm: JwtAlg;
  secret?: string;
  secretBase64?: boolean;
  privateKeyPem?: string;
  payload: Record<string, unknown>;
  headers?: Record<string, unknown>;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now, ...opts.payload };
  const jwt = new SignJWT(payload).setProtectedHeader({ alg: opts.algorithm, typ: "JWT", ...opts.headers });
  if (opts.algorithm.startsWith("HS")) {
    if (!opts.secret) throw new Error("JWT HS* requires a secret");
    const key = opts.secretBase64 ? Buffer.from(opts.secret, "base64") : new TextEncoder().encode(opts.secret);
    return jwt.sign(key);
  }
  if (!opts.privateKeyPem) throw new Error("JWT RS/ES/PS requires a PKCS#8 private key");
  const key = await importPKCS8(opts.privateKeyPem, opts.algorithm);
  return jwt.sign(key);
}
