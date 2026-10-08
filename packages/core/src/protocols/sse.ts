import { request } from "undici";

export interface SseEvent {
  id?: string;
  event?: string;
  data: string;
  receivedAt: string;
}

export async function collectSse(opts: {
  url: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  maxEvents?: number;
}): Promise<SseEvent[]> {
  const res = await request(opts.url, { method: "GET", headers: { accept: "text/event-stream", ...opts.headers }, signal: opts.signal });
  const events: SseEvent[] = [];
  let buf = "";
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString("utf8");
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const ev: SseEvent = { data: "", receivedAt: new Date().toISOString() };
      for (const line of part.split("\n")) {
        if (line.startsWith("data:")) ev.data += (ev.data ? "\n" : "") + line.slice(5).trimStart();
        else if (line.startsWith("event:")) ev.event = line.slice(6).trim();
        else if (line.startsWith("id:")) ev.id = line.slice(3).trim();
      }
      events.push(ev);
      if (opts.maxEvents && events.length >= opts.maxEvents) return events;
    }
  }
  return events;
}
