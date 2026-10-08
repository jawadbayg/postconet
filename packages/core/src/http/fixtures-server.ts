import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { WebSocketServer } from "ws";

export interface FixtureServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function startFixtureServer(port = 0): Promise<FixtureServer> {
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = url.pathname;
    res.setHeader("x-fixture", "postconet");

    if (pathname === "/get") {
      json(res, 200, { args: queryObject(url), headers: req.headers, method: req.method });
      return;
    }
    if (pathname === "/post") {
      const body = await readBody(req);
      json(res, 200, { data: body.toString("utf8"), headers: req.headers, method: req.method });
      return;
    }
    if (pathname === "/status/401") {
      res.statusCode = 401;
      res.setHeader("www-authenticate", `Digest realm="fixture", nonce="abc", qop="auth", algorithm=MD5`);
      res.end("unauthorized");
      return;
    }
    if (pathname === "/headers") {
      json(res, 200, { headers: req.headers });
      return;
    }
    if (pathname === "/delay") {
      const ms = Number(url.searchParams.get("ms") ?? 50);
      await new Promise((r) => setTimeout(r, ms));
      json(res, 200, { delayed: ms });
      return;
    }
    if (pathname === "/graphql") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}") as { query?: string };
      json(res, 200, { data: { hello: "world", query: body.query ?? "" } });
      return;
    }
    if (pathname === "/soap") {
      const xml = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><AddResponse><result>3</result></AddResponse></soap:Body></soap:Envelope>`;
      res.setHeader("content-type", "text/xml");
      res.end(xml);
      return;
    }
    if (pathname === "/sse") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write("event: ping\ndata: {\"ok\":true}\n\n");
      res.end();
      return;
    }
    if (pathname === "/large") {
      res.end("x".repeat(1024));
      return;
    }
    if (pathname === "/echo-auth") {
      json(res, 200, { authorization: req.headers.authorization ?? null });
      return;
    }
    if (pathname === "/hash") {
      const body = await readBody(req);
      json(res, 200, { sha256: createHash("sha256").update(body).digest("hex") });
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/ws")) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.send(JSON.stringify({ type: "welcome" }));
        ws.on("message", (data) => ws.send(data));
      });
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to bind fixture server");
  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () =>
      new Promise((resolve, reject) => {
        wss.close();
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}

function queryObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  url.searchParams.forEach((value, key) => {
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  });
  return out;
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}
