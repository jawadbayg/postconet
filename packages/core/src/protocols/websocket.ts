import WebSocket from "ws";

export interface WsMessage {
  direction: "in" | "out";
  binary: boolean;
  data: string;
  receivedAt: string;
}

export function connectWebSocket(opts: {
  url: string;
  protocols?: string[];
  headers?: Record<string, string>;
  onMessage: (msg: WsMessage) => void;
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: Error) => void;
}): { send: (data: string | Buffer) => void; close: () => void } {
  const ws = new WebSocket(opts.url, opts.protocols, { headers: opts.headers });
  ws.on("open", () => opts.onOpen?.());
  ws.on("message", (data, isBinary) => {
    opts.onMessage({
      direction: "in",
      binary: Boolean(isBinary),
      data: isBinary ? Buffer.from(data as Buffer).toString("base64") : String(data),
      receivedAt: new Date().toISOString()
    });
  });
  ws.on("close", (code, reason) => opts.onClose?.(code, reason.toString()));
  ws.on("error", (err) => opts.onError?.(err));
  return {
    send: (data) => {
      ws.send(data);
    },
    close: () => ws.close()
  };
}
