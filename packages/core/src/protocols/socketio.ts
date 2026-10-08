import { io, type Socket } from "socket.io-client";

export function connectSocketIo(opts: {
  url: string;
  namespace?: string;
  transports?: Array<"websocket" | "polling">;
  extraHeaders?: Record<string, string>;
  onEvent: (event: string, args: unknown[]) => void;
  onConnect?: () => void;
  onDisconnect?: (reason: string) => void;
  onError?: (err: Error) => void;
}): { emit: (event: string, ...args: unknown[]) => void; ack: (event: string, args: unknown[], timeoutMs: number) => Promise<unknown>; close: () => void } {
  const socket: Socket = io(`${opts.url}${opts.namespace ?? ""}`, {
    transports: opts.transports ?? ["websocket", "polling"],
    extraHeaders: opts.extraHeaders,
    autoConnect: true
  });
  socket.onAny((event, ...args) => opts.onEvent(event, args));
  socket.on("connect", () => opts.onConnect?.());
  socket.on("disconnect", (reason) => opts.onDisconnect?.(reason));
  socket.on("connect_error", (err) => opts.onError?.(err));
  return {
    emit: (event, ...args) => {
      socket.emit(event, ...args);
    },
    ack: (event, args, timeoutMs) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("ack timeout")), timeoutMs);
        socket.emit(event, ...args, (response: unknown) => {
          clearTimeout(t);
          resolve(response);
        });
      }),
    close: () => socket.close()
  };
}
