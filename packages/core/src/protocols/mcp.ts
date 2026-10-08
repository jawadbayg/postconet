import { request } from "undici";
import { spawn, type ChildProcess } from "node:child_process";

export interface McpTrust {
  command: string;
  args: string[];
  trusted: boolean;
}

export async function mcpInitializeHttp(url: string, headers: Record<string, string> = {}) {
  const res = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "PostConet API Studio", version: "0.1.0" } }
    })
  });
  const text = await res.body.text();
  return { status: res.statusCode, body: text };
}

export function mcpStartStdio(trust: McpTrust): ChildProcess {
  if (!trust.trusted) {
    throw new Error("Local MCP processes require an explicit trust confirmation. Importing a collection never starts a process.");
  }
  return spawn(trust.command, trust.args, { stdio: ["pipe", "pipe", "pipe"] });
}
