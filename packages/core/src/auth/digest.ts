import { createHash, randomBytes } from "node:crypto";

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
  stale?: string;
}

export function parseDigestChallenge(header: string): DigestChallenge | null {
  const trimmed = header.replace(/^Digest\s+/i, "");
  const out: Record<string, string> = {};
  const re = /(\w+)=(?:"([^"]+)"|([^,\s]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed))) {
    out[m[1]!] = m[2] ?? m[3] ?? "";
  }
  if (!out.realm || !out.nonce) return null;
  return {
    realm: out.realm,
    nonce: out.nonce,
    qop: out.qop,
    opaque: out.opaque,
    algorithm: out.algorithm,
    stale: out.stale
  };
}

function hash(alg: string, data: string): string {
  const name = alg.toUpperCase().includes("SHA-256") ? "sha256" : "md5";
  return createHash(name).update(data).digest("hex");
}

export function buildDigestHeader(opts: {
  challenge: DigestChallenge;
  username: string;
  password: string;
  method: string;
  uri: string;
  nc?: string;
  cnonce?: string;
  body?: string;
}): string {
  const algorithm = opts.challenge.algorithm ?? "MD5";
  const cnonce = opts.cnonce ?? randomBytes(8).toString("hex");
  const nc = opts.nc ?? "00000001";
  const ha1 = hash(algorithm, `${opts.username}:${opts.challenge.realm}:${opts.password}`);
  const qop = opts.challenge.qop?.split(",")[0]?.trim();
  const ha2 = qop === "auth-int"
    ? hash(algorithm, `${opts.method}:${opts.uri}:${hash(algorithm, opts.body ?? "")}`)
    : hash(algorithm, `${opts.method}:${opts.uri}`);
  const response = qop
    ? hash(algorithm, `${ha1}:${opts.challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(algorithm, `${ha1}:${opts.challenge.nonce}:${ha2}`);
  const parts = [
    `username="${opts.username}"`,
    `realm="${opts.challenge.realm}"`,
    `nonce="${opts.challenge.nonce}"`,
    `uri="${opts.uri}"`,
    `response="${response}"`,
    `algorithm=${algorithm}`
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (opts.challenge.opaque) parts.push(`opaque="${opts.challenge.opaque}"`);
  return `Digest ${parts.join(", ")}`;
}
