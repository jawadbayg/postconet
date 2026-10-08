import { createServer, type Server } from "node:http";
import type { SavedExample, SavedRequest } from "../types.js";

export function startLocalMock(opts: {
  port?: number;
  requests: SavedRequest[];
}): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const match = opts.requests.find((r) => {
      const doc = r.document as { method?: string; url?: string };
      const path = (() => {
        try {
          return new URL(doc.url ?? "", "http://local").pathname;
        } catch {
          return doc.url ?? "";
        }
      })();
      return (doc.method ?? "GET").toUpperCase() === (req.method ?? "GET").toUpperCase() && url.pathname === path;
    });
    const example: SavedExample | undefined = match?.examples[0];
    res.statusCode = example?.status ?? (match ? 200 : 404);
    for (const h of example?.headers ?? []) res.setHeader(h.key, h.value);
    res.end(example?.body ?? (match ? "{}" : "No example"));
  });
  return new Promise((resolve, reject) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return reject(new Error("bind failed"));
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r, j) => server.close((e) => (e ? j(e) : r())))
      });
    });
  });
}
