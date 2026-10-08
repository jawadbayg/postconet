import { useEffect, useState } from "react";
import { invoke } from "../lib/ipc";
import type { RequestRecord } from "../screens/Studio";

type HistItem = {
  id: string;
  createdAt: string;
  status?: number;
  url?: string;
  method?: string;
  elapsedMs?: number;
  name?: string;
  requestId?: string;
  document?: RequestRecord["document"];
};

export function HistoryPanel(props: {
  workspaceId: string | null;
  onOpen: (req: RequestRecord) => void;
}) {
  const [items, setItems] = useState<HistItem[]>([]);

  useEffect(() => {
    if (!props.workspaceId) return;
    void invoke<HistItem[]>("history.list", { workspaceId: props.workspaceId }).then(setItems).catch(() => setItems([]));
  }, [props.workspaceId]);

  return (
    <div className="flex h-full flex-col bg-[var(--canvas)]">
      <div className="border-b border-[var(--border)] bg-[var(--panel)] px-4 py-3">
        <div className="text-sm font-medium">History</div>
        <p className="mt-1 text-xs text-[var(--muted)]">Open an item to reload that request.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {items.length === 0 && <div className="p-6 text-sm text-[var(--muted)]">No requests have been sent yet.</div>}
        {items.map((item) => (
          <button
            key={item.id}
            className="flex w-full items-center gap-3 border-b border-[var(--border)] px-4 py-2 text-left text-xs hover:bg-[var(--panel)]"
            onClick={() => {
              if (!item.document || !props.workspaceId) return;
              props.onOpen({
                id: item.requestId ?? item.id,
                name: item.name || item.method || "History",
                collectionId: "",
                folderId: null,
                workspaceId: props.workspaceId,
                protocol: "http",
                document: item.document,
                version: 1,
                examples: [],
                favorite: false
              });
            }}
          >
            <span className={`w-12 font-mono font-semibold method-${item.method ?? "GET"}`}>{item.method ?? "GET"}</span>
            <span className={item.status && item.status >= 200 && item.status < 300 ? "text-emerald-600" : "text-red-600"}>{item.status ?? "—"}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[var(--muted)]">{item.url}</span>
            <span className="text-[var(--muted)]">{item.elapsedMs != null ? `${Math.round(item.elapsedMs)} ms` : ""}</span>
            <span className="text-[var(--muted)]">{new Date(item.createdAt).toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
