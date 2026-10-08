import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { importPostmanCollection, runCollection, brand } from "@postconet/core";
import { isIP } from "node:net";

const port = Number(process.env.WORKER_PORT ?? 8787);
const supabaseUrl = process.env.SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const allowedCidrs = (process.env.ALLOWED_EGRESS_CIDRS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function blockedHost(hostname: string): boolean {
  if (!hostname) return true;
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(hostname)) return true;
  if (hostname.endsWith(".internal") || hostname.endsWith(".local")) return true;
  if (isPrivateIp(hostname)) return true;
  return false;
}

function isPrivateIp(host: string) {
  if (!isIP(host)) return false;
  return (
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("127.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  res.setHeader("content-type", "application/json");
  if (url.pathname === "/health") {
    res.end(JSON.stringify({ ok: true, product: brand.productName, egressPolicy: allowedCidrs.length ? "restricted" : "default-deny-private" }));
    return;
  }
  if (url.pathname === "/mocks" && req.method === "GET") {
    const slug = url.searchParams.get("slug");
    res.end(JSON.stringify({ slug, note: "Hosted mock. Secrets are redacted. Requires collection examples." }));
    return;
  }
  if (url.pathname === "/webhooks/capture" && req.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(Buffer.from(c));
    res.end(JSON.stringify({ receivedAt: new Date().toISOString(), bytes: Buffer.concat(chunks).length }));
    return;
  }
  if (url.pathname === "/monitors/dispatch" && req.method === "POST") {
    if (!supabaseUrl || !serviceKey) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "Worker missing SUPABASE_SERVICE_ROLE_KEY. Cloud monitors cannot run." }));
      return;
    }
    const body = await readJson(req);
    const collection = body.collection;
    if (!collection) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: "collection required" }));
      return;
    }
    const preview = importPostmanCollection(collection, "monitor");
    const target = (preview.requests[0]?.document as { url?: string } | undefined)?.url ?? "";
    try {
      const host = new URL(target).hostname;
      if (blockedHost(host)) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: "Hosted runners cannot reach private or localhost addresses. Use the desktop client for local APIs." }));
        return;
      }
    } catch {
      /* relative */
    }
    const report = await runCollection({
      collection: preview.collections[0]!,
      folders: preview.folders,
      requests: preview.requests
    });
    const admin = createClient(supabaseUrl, serviceKey);
    await admin.from("monitor_runs").insert({ report, ok: report.failed === 0, finished_at: new Date().toISOString() });
    res.end(JSON.stringify({ ok: report.failed === 0, passed: report.passed, failed: report.failed }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

function readJson(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

server.listen(port, () => {
  console.log(`${brand.productName} worker on :${port}`);
});
