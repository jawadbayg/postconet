import { BrowserWindow } from "electron";
import { collectSse, connectWebSocket, connectMqtt, connectSocketIo } from "@postconet/core";

const live = new Map<string, { close: () => void }>();

function emit(channel: string, payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

export async function openConnection(opts: {
  id: string;
  protocol: "websocket" | "sse" | "mqtt" | "socketio";
  url: string;
  headers?: Record<string, string>;
  mqtt?: { clientId: string; username?: string; password?: string };
  socketio?: { namespace?: string };
}) {
  closeConnection(opts.id);
  if (opts.protocol === "websocket") {
    const conn = connectWebSocket({
      url: opts.url,
      headers: opts.headers,
      onOpen: () => emit("conn.event", { id: opts.id, type: "open" }),
      onMessage: (msg) => emit("conn.event", { id: opts.id, type: "message", msg }),
      onClose: (code, reason) => emit("conn.event", { id: opts.id, type: "close", code, reason }),
      onError: (err) => emit("conn.event", { id: opts.id, type: "error", error: err.message })
    });
    live.set(opts.id, conn);
    return { ok: true };
  }
  if (opts.protocol === "sse") {
    const ac = new AbortController();
    live.set(opts.id, { close: () => ac.abort() });
    void collectSse({ url: opts.url, headers: opts.headers, signal: ac.signal }).then((events) => {
      for (const ev of events) emit("conn.event", { id: opts.id, type: "message", msg: ev });
      emit("conn.event", { id: opts.id, type: "close" });
    }).catch((err: Error) => emit("conn.event", { id: opts.id, type: "error", error: err.message }));
    return { ok: true };
  }
  if (opts.protocol === "mqtt") {
    const conn = connectMqtt({
      url: opts.url,
      clientId: opts.mqtt?.clientId ?? `postconet-${Date.now()}`,
      username: opts.mqtt?.username,
      password: opts.mqtt?.password,
      onConnect: () => emit("conn.event", { id: opts.id, type: "open" }),
      onMessage: (topic, payload, retained) =>
        emit("conn.event", { id: opts.id, type: "message", msg: { topic, data: payload.toString("utf8"), retained } }),
      onError: (err) => emit("conn.event", { id: opts.id, type: "error", error: err.message })
    });
    live.set(opts.id, conn);
    return { ok: true };
  }
  const conn = connectSocketIo({
    url: opts.url,
    namespace: opts.socketio?.namespace,
    extraHeaders: opts.headers,
    onConnect: () => emit("conn.event", { id: opts.id, type: "open" }),
    onEvent: (event, args) => emit("conn.event", { id: opts.id, type: "message", msg: { event, args } }),
    onDisconnect: (reason) => emit("conn.event", { id: opts.id, type: "close", reason }),
    onError: (err) => emit("conn.event", { id: opts.id, type: "error", error: err.message })
  });
  live.set(opts.id, conn);
  return { ok: true };
}

export function sendConnection(id: string, data: string, extra?: { topic?: string; event?: string }) {
  const conn = live.get(id) as
    | { send?: (d: string) => void; publish?: (topic: string, payload: string, qos: 0 | 1 | 2, retain: boolean) => void; emit?: (event: string, ...args: unknown[]) => void; close: () => void }
    | undefined;
  if (!conn) throw new Error("Not connected");
  if (conn.send) conn.send(data);
  else if (conn.publish && extra?.topic) conn.publish(extra.topic, data, 0, false);
  else if (conn.emit && extra?.event) conn.emit(extra.event, data);
  return { ok: true };
}

export function closeConnection(id: string) {
  live.get(id)?.close();
  live.delete(id);
  return { closed: true };
}
