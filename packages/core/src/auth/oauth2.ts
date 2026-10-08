import { createHash, randomBytes } from "node:crypto";
import { request } from "undici";

export type OAuth2Grant =
  | "authorization_code"
  | "authorization_code_pkce"
  | "implicit"
  | "password"
  | "client_credentials";

export interface OAuth2Config {
  grantType: OAuth2Grant;
  authUrl: string;
  accessTokenUrl: string;
  refreshTokenUrl?: string;
  clientId: string;
  clientSecret?: string;
  callbackUrl: string;
  scope?: string;
  state?: string;
  clientAuth: "header" | "body";
  codeChallengeMethod?: "S256" | "plain";
  username?: string;
  password?: string;
  extraAuth?: Record<string, string>;
  extraToken?: Record<string, string>;
}

export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

export function buildAuthorizationUrl(
  config: OAuth2Config,
  extras: { state: string; challenge?: string; verifier?: string }
): string {
  const u = new URL(config.authUrl);
  u.searchParams.set("response_type", config.grantType === "implicit" ? "token" : "code");
  u.searchParams.set("client_id", config.clientId);
  u.searchParams.set("redirect_uri", config.callbackUrl);
  u.searchParams.set("state", extras.state);
  if (config.scope) u.searchParams.set("scope", config.scope);
  if (config.grantType === "authorization_code_pkce" && extras.challenge) {
    u.searchParams.set("code_challenge", extras.challenge);
    u.searchParams.set("code_challenge_method", config.codeChallengeMethod ?? "S256");
  }
  for (const [k, v] of Object.entries(config.extraAuth ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

export function parseCallbackUrl(url: string): { code?: string; state?: string; accessToken?: string; error?: string } {
  const u = new URL(url);
  const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
  const q = u.searchParams;
  return {
    code: q.get("code") ?? undefined,
    state: q.get("state") ?? hash.get("state") ?? undefined,
    accessToken: hash.get("access_token") ?? q.get("access_token") ?? undefined,
    error: q.get("error") ?? hash.get("error") ?? undefined
  };
}

async function tokenRequest(url: string, body: Record<string, string>, clientAuth: "header" | "body", clientId: string, clientSecret?: string) {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  const params = new URLSearchParams(body);
  if (clientAuth === "header" && clientSecret) {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    params.set("client_id", clientId);
    if (clientSecret) params.set("client_secret", clientSecret);
  }
  const res = await request(url, { method: "POST", headers, body: params.toString() });
  const text = await res.body.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = Object.fromEntries(new URLSearchParams(text));
  }
  if (res.statusCode >= 400) {
    throw new Error(`OAuth token error (${res.statusCode}): ${text.slice(0, 500)}`);
  }
  return json;
}

export async function exchangeCode(config: OAuth2Config, code: string, verifier?: string) {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: config.callbackUrl,
    ...config.extraToken
  };
  if (verifier) body.code_verifier = verifier;
  return tokenRequest(config.accessTokenUrl, body, config.clientAuth, config.clientId, config.clientSecret);
}

export async function clientCredentials(config: OAuth2Config) {
  return tokenRequest(
    config.accessTokenUrl,
    { grant_type: "client_credentials", scope: config.scope ?? "", ...config.extraToken },
    config.clientAuth,
    config.clientId,
    config.clientSecret
  );
}

export async function passwordGrant(config: OAuth2Config) {
  return tokenRequest(
    config.accessTokenUrl,
    {
      grant_type: "password",
      username: config.username ?? "",
      password: config.password ?? "",
      scope: config.scope ?? "",
      ...config.extraToken
    },
    config.clientAuth,
    config.clientId,
    config.clientSecret
  );
}

export async function refreshAccessToken(config: OAuth2Config, refreshToken: string) {
  return tokenRequest(
    config.refreshTokenUrl || config.accessTokenUrl,
    { grant_type: "refresh_token", refresh_token: refreshToken },
    config.clientAuth,
    config.clientId,
    config.clientSecret
  );
}
