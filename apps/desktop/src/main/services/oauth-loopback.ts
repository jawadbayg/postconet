import { createServer } from "node:http";
import { shell } from "electron";
import {
  buildAuthorizationUrl,
  exchangeCode,
  generatePkce,
  generateState,
  parseCallbackUrl,
  type OAuth2Config
} from "@postconet/core";
import { brand } from "@postconet/core";

export async function authorizeInSystemBrowser(config: OAuth2Config): Promise<Record<string, unknown>> {
  const state = generateState();
  const pkce = config.grantType === "authorization_code_pkce" ? generatePkce() : undefined;
  const server = createServer();
  const port: number = await new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") reject(new Error("bind failed"));
      else resolve(addr.port);
    });
  });
  const callbackUrl = `http://127.0.0.1:${port}${brand.oauthCallbackPath}`;
  const url = buildAuthorizationUrl({ ...config, callbackUrl }, { state, challenge: pkce?.challenge, verifier: pkce?.verifier });
  const timeout = setTimeout(() => server.close(), 120_000);
  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    server.on("request", async (req, res) => {
      try {
        const parsed = parseCallbackUrl(`http://127.0.0.1${req.url}`);
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><body>You can close this window and return to ${brand.productName}.</body></html>`);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.state !== state) throw new Error("OAuth state mismatch");
        if (parsed.accessToken) {
          resolve({ access_token: parsed.accessToken });
          return;
        }
        if (!parsed.code) throw new Error("No authorization code");
        const token = await exchangeCode({ ...config, callbackUrl }, parsed.code, pkce?.verifier);
        resolve(token);
      } catch (error) {
        reject(error);
      } finally {
        clearTimeout(timeout);
        server.close();
      }
    });
    void shell.openExternal(url);
  });
  return result;
}
