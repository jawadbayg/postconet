export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    postconet: {
      invoke: (channel: string, payload?: unknown) => Promise<IpcResult<unknown>>;
      on: (channel: string, listener: (payload: unknown) => void) => () => void;
    };
  }
}

export async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  if (!window.postconet) {
    throw new Error("The desktop bridge is not available. Restart the app.");
  }
  const res = (await window.postconet.invoke(channel, payload)) as IpcResult<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
