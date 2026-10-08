import { useEffect, useState } from "react";
import { invoke } from "../lib/ipc";

type EventRow = { at: string; type: string; payload: unknown };

export function StreamPanel(props: {
  requestId: string;
  protocol: "websocket" | "sse" | "mqtt" | "socketio";
  url: string;
}) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [status, setStatus] = useState("disconnected");
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");
  const id = `${props.protocol}:${props.requestId}`;

  useEffect(() => {
    return window.postconet.on("conn.event", (raw) => {
      const p = raw as { id: string; type: string; msg?: unknown; error?: string; reason?: string };
      if (p.id !== id) return;
      if (p.type === "open") setStatus("connected");
      if (p.type === "close") setStatus("disconnected");
      if (p.type === "error") setStatus("error");
      setEvents((prev) => [...prev, { at: new Date().toISOString(), type: p.type, payload: p.msg ?? p.error ?? p.reason }]);
    });
  }, [id]);

  const visible = events.filter((e) => JSON.stringify(e.payload).toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex h-full flex-col p-3 text-xs">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-[var(--canvas)] px-2 py-1">{status}</span>
        <button className="rounded bg-[var(--accent)] px-2 py-1 text-white" onClick={() => invoke("conn.open", { id, protocol: props.protocol, url: props.url })}>
          Connect
        </button>
        <button className="rounded border border-[var(--border)] px-2 py-1" onClick={() => invoke("conn.close", { id })}>
          Disconnect
        </button>
        <input className="ml-auto w-40 rounded border border-[var(--border)] bg-[var(--canvas)] px-2 py-1" placeholder="Search events" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {props.protocol !== "sse" && (
        <div className="mb-2 flex gap-2">
          <input className="flex-1 rounded border border-[var(--border)] bg-[var(--canvas)] px-2 py-1 font-mono" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message" />
          <button className="rounded border border-[var(--border)] px-2 py-1" onClick={() => invoke("conn.send", { id, data: draft })}>
            Send
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto font-mono">
        {visible.map((e, i) => (
          <div key={i} className="border-b border-[var(--border)] py-1">
            <span className="text-[var(--muted)]">{e.at} {e.type}</span> {JSON.stringify(e.payload)}
          </div>
        ))}
      </div>
    </div>
  );
}
