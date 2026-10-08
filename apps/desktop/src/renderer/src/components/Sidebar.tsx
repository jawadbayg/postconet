import type { Tree, RequestRecord } from "../screens/Studio";

export function Sidebar(props: {
  tree: Tree | null;
  activeId: string | null;
  onOpen: (req: RequestRecord) => void;
  onNewCollection: () => void;
  onNewFolder: (collectionId: string, parentId: string | null) => void;
  onNewRequest: (collectionId: string, folderId: string | null) => void;
  onNewEnvironment: () => void;
}) {
  if (!props.tree) return <div className="p-3 text-xs text-[#667085]">Loading collections…</div>;
  return (
    <div className="flex h-full flex-col bg-[var(--panel)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Collections</span>
        <button className="text-xs text-[var(--accent)]" onClick={props.onNewCollection}>
          New
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2 text-sm">
        {props.tree.collections.length === 0 && (
          <div className="px-2 py-6 text-xs text-[var(--muted)]">Create a collection to save requests. Sample imports are labeled as sample content.</div>
        )}
        {props.tree.collections.map((col) => (
          <div key={col.id} className="mb-2">
            <div className="flex items-center justify-between rounded px-2 py-1 hover:bg-[var(--canvas)]">
              <span className="truncate font-medium">{col.name}</span>
              <span className="flex gap-1 text-[10px] text-[var(--accent)]">
                <button onClick={() => props.onNewFolder(col.id, null)}>Folder</button>
                <button onClick={() => props.onNewRequest(col.id, null)}>Req</button>
              </span>
            </div>
            {col.folders
              .filter((f) => !f.parentId)
              .map((folder) => (
                <div key={folder.id} className="ml-3">
                  <div className="flex items-center justify-between px-2 py-0.5 text-[var(--muted)]">
                    <span>{folder.name}</span>
                    <button className="text-[10px] text-[var(--accent)]" onClick={() => props.onNewRequest(col.id, folder.id)}>
                      +
                    </button>
                  </div>
                  {col.requests
                    .filter((r) => r.folderId === folder.id)
                    .map((req) => (
                      <RequestRow key={req.id} req={req} active={props.activeId === req.id} onOpen={props.onOpen} />
                    ))}
                </div>
              ))}
            {col.requests
              .filter((r) => !r.folderId)
              .map((req) => (
                <RequestRow key={req.id} req={req} active={props.activeId === req.id} onOpen={props.onOpen} />
              ))}
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--border)] p-2">
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-[var(--muted)]">
          Environments
          <button className="text-[var(--accent)]" onClick={props.onNewEnvironment}>
            New
          </button>
        </div>
        {props.tree.environments.map((env) => (
          <div key={env.id} className="truncate px-2 py-0.5 text-xs">
            {env.name}
          </div>
        ))}
      </div>
    </div>
  );
}

function RequestRow({ req, active, onOpen }: { req: RequestRecord; active: boolean; onOpen: (r: RequestRecord) => void }) {
  const method = String((req.document as { method?: string }).method ?? req.protocol).toUpperCase();
  return (
    <button
      onClick={() => onOpen(req)}
      className={`ml-3 flex w-[calc(100%-0.75rem)] items-center gap-2 rounded px-2 py-1 text-left text-xs ${active ? "bg-[var(--canvas)]" : "hover:bg-[var(--canvas)]"}`}
    >
      <span className={`w-12 shrink-0 font-mono text-[10px] font-semibold method-${method}`}>{method.slice(0, 6)}</span>
      <span className="truncate">{req.name}</span>
    </button>
  );
}
