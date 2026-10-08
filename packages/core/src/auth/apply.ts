import type { AuthConfig, KeyValue } from "../types.js";
import { kv } from "../kv.js";
import { hawkHeader } from "./hawk.js";
import { signAwsV4 } from "./aws.js";
import { edgegridHeader } from "./edgegrid.js";
import { oauth1Header } from "./oauth1.js";
import { signJwtBearer, type JwtAlg } from "./jwt.js";
import { parseDigestChallenge, buildDigestHeader } from "./digest.js";

export interface AppliedAuth {
  headers: KeyValue[];
  query: KeyValue[];
  digestRetry?: boolean;
}

export function inheritAuth(chain: AuthConfig[]): AuthConfig {
  for (let i = chain.length - 1; i >= 0; i--) {
    const item = chain[i];
    if (item && item.type !== "inherit") return item;
  }
  return { type: "none", params: {} };
}

export async function applyAuth(opts: {
  auth: AuthConfig;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}): Promise<AppliedAuth> {
  const { auth } = opts;
  const p = auth.params;
  switch (auth.type) {
    case "none":
    case "inherit":
    case "mtls":
      return { headers: [], query: [] };
    case "apikey": {
      const key = p.key ?? "X-Api-Key";
      const value = p.value ?? "";
      if ((p.in ?? "header") === "query") return { headers: [], query: [kv(key, value)] };
      return { headers: [kv(key, value)], query: [] };
    }
    case "bearer":
      return { headers: [kv("Authorization", `Bearer ${p.token ?? ""}`)], query: [] };
    case "basic": {
      const token = Buffer.from(`${p.username ?? ""}:${p.password ?? ""}`).toString("base64");
      return { headers: [kv("Authorization", `Basic ${token}`)], query: [] };
    }
    case "jwt": {
      const token = await signJwtBearer({
        algorithm: (p.algorithm as JwtAlg) || "HS256",
        secret: p.secret,
        secretBase64: p.secretBase64 === "true",
        privateKeyPem: p.privateKey,
        payload: p.payload ? JSON.parse(p.payload) : {},
        headers: p.jwtHeaders ? JSON.parse(p.jwtHeaders) : undefined
      });
      const prefix = p.headerPrefix ?? "Bearer";
      if ((p.addTo ?? "header") === "query") return { headers: [], query: [kv(p.queryKey ?? "token", token)] };
      return { headers: [kv("Authorization", `${prefix} ${token}`.trim())], query: [] };
    }
    case "oauth2": {
      const token = auth.oauth2Token?.accessToken ?? p.accessToken ?? "";
      const prefix = p.headerPrefix ?? "Bearer";
      if ((p.addTo ?? "header") === "query") return { headers: [], query: [kv("access_token", token)] };
      return { headers: [kv("Authorization", `${prefix} ${token}`.trim())], query: [] };
    }
    case "oauth1":
      return {
        headers: [
          kv(
            "Authorization",
            oauth1Header({
              method: opts.method,
              url: opts.url,
              consumerKey: p.consumerKey ?? "",
              consumerSecret: p.consumerSecret ?? "",
              token: p.token,
              tokenSecret: p.tokenSecret,
              signatureMethod: (p.signatureMethod as "HMAC-SHA1") || "HMAC-SHA1",
              privateKey: p.privateKey,
              callback: p.callback,
              verifier: p.verifier,
              realm: p.realm
            })
          )
        ],
        query: []
      };
    case "awsv4": {
      const signed = signAwsV4({
        method: opts.method,
        url: opts.url,
        headers: { ...opts.headers },
        body: opts.body,
        accessKey: p.accessKey ?? "",
        secretKey: p.secretKey ?? "",
        region: p.region ?? "us-east-1",
        service: p.service ?? "execute-api",
        sessionToken: p.sessionToken
      });
      return {
        headers: Object.entries(signed)
          .filter(([k]) => k.toLowerCase() !== "host")
          .map(([k, v]) => kv(k, v)),
        query: []
      };
    }
    case "hawk":
      return {
        headers: [
          kv(
            "Authorization",
            hawkHeader({
              id: p.authId ?? "",
              key: p.authKey ?? "",
              algorithm: (p.algorithm as "sha256") || "sha256",
              method: opts.method,
              url: opts.url,
              payload: opts.body.toString("utf8"),
              includePayloadHash: p.includePayloadHash === "true"
            })
          )
        ],
        query: []
      };
    case "edgegrid":
      return {
        headers: [
          kv(
            "Authorization",
            edgegridHeader({
              method: opts.method,
              url: opts.url,
              clientToken: p.clientToken ?? "",
              clientSecret: p.clientSecret ?? "",
              accessToken: p.accessToken ?? "",
              body: opts.body.toString("utf8")
            })
          )
        ],
        query: []
      };
    case "digest":
      return { headers: [], query: [], digestRetry: true };
    case "ntlm":
      return { headers: [], query: [] };
    default:
      return { headers: [], query: [] };
  }
}

export function applyDigestFromChallenge(
  wwwAuthenticate: string,
  username: string,
  password: string,
  method: string,
  url: string
): KeyValue | null {
  const challenge = parseDigestChallenge(wwwAuthenticate);
  if (!challenge) return null;
  const u = new URL(url);
  const header = buildDigestHeader({
    challenge,
    username,
    password,
    method,
    uri: `${u.pathname}${u.search}`
  });
  return kv("Authorization", header);
}
