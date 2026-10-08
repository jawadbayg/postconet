import { describe, expect, it } from "vitest";
import { applyAuth } from "../src/auth/apply.js";
import { hawkHeader } from "../src/auth/hawk.js";
import { signAwsV4 } from "../src/auth/aws.js";
import { oauth1Header } from "../src/auth/oauth1.js";
import { generatePkce, parseCallbackUrl, buildAuthorizationUrl } from "../src/auth/oauth2.js";
import { signJwtBearer } from "../src/auth/jwt.js";

describe("auth helpers", () => {
  it("basic and api key", async () => {
    const basic = await applyAuth({
      auth: { type: "basic", params: { username: "a", password: "b" } },
      method: "GET",
      url: "https://x.test/",
      headers: {},
      body: Buffer.alloc(0)
    });
    expect(basic.headers[0]?.value.startsWith("Basic ")).toBe(true);
    const key = await applyAuth({
      auth: { type: "apikey", params: { key: "X-Key", value: "1", in: "header" } },
      method: "GET",
      url: "https://x.test/",
      headers: {},
      body: Buffer.alloc(0)
    });
    expect(key.headers[0]?.key).toBe("X-Key");
  });

  it("signs jwt hs256", async () => {
    const token = await signJwtBearer({ algorithm: "HS256", secret: "supersecret", payload: { sub: "1" } });
    expect(token.split(".")).toHaveLength(3);
  });

  it("builds oauth pkce + validates callback state shape", () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier.length).toBeGreaterThan(20);
    const url = buildAuthorizationUrl(
      {
        grantType: "authorization_code_pkce",
        authUrl: "https://auth.example/authorize",
        accessTokenUrl: "https://auth.example/token",
        clientId: "abc",
        callbackUrl: "http://127.0.0.1:9999/oauth/callback",
        clientAuth: "body"
      },
      { state: "st", challenge }
    );
    expect(url).toContain("code_challenge");
    const parsed = parseCallbackUrl("http://127.0.0.1:9999/oauth/callback?code=xyz&state=st");
    expect(parsed.code).toBe("xyz");
    expect(parsed.state).toBe("st");
  });

  it("produces hawk, aws, oauth1 headers", () => {
    expect(hawkHeader({ id: "id", key: "key", algorithm: "sha256", method: "GET", url: "https://x.test/a" })).toContain("Hawk");
    const aws = signAwsV4({
      method: "GET",
      url: "https://s3.amazonaws.com/bucket",
      headers: {},
      body: "",
      accessKey: "AKIA",
      secretKey: "secret",
      region: "us-east-1",
      service: "s3"
    });
    expect(aws.authorization).toContain("AWS4-HMAC-SHA256");
    expect(
      oauth1Header({
        method: "GET",
        url: "https://x.test/a",
        consumerKey: "ck",
        consumerSecret: "cs",
        signatureMethod: "HMAC-SHA1"
      })
    ).toContain("OAuth");
  });
});
