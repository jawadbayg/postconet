import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";
import type { Tree, RequestRecord } from "../screens/Studio";
import { DispatchLoaderFill } from "./DispatchLoader";

export type SidebarAction = "rename" | "delete" | "share" | "export";

export type DragItem = { kind: "request"; id: string; collectionId: string };
export type DropTarget =
  | { kind: "collection"; id: string }
  | { kind: "folder"; id: string; collectionId: string }
  | { kind: "request"; id: string; collectionId: string; folderId: string | null };

type MenuTarget = { kind: "collection" | "folder" | "request"; id: string; name: string; collectionId?: string };

export type SidebarFocus = { token: number; collectionId: string; folderId: string | null; highlightId: string };

export function Sidebar(props: {
  tree: Tree | null;
  activeId: string | null;
  focus?: SidebarFocus | null;
  onOpen: (req: RequestRecord) => void;
  onNewCollection: () => void;
  onNewFolder: (collectionId: string, parentId: string | null) => void;
  onNewRequest: (collectionId: string, folderId: string | null) => void;
  onAction: (action: SidebarAction, target: MenuTarget) => void;
  onDrop: (item: DragItem, target: DropTarget) => void;
}) {
  if (!props.tree) return <DispatchLoaderFill size={120} />;
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
          <div className="px-2 py-6 text-xs text-[var(--muted)]">Create a collection to save requests.</div>
        )}
        {props.tree.collections.map((col) => (
          <CollectionBlock
            key={col.id}
            col={col}
            activeId={props.activeId}
            focus={props.focus}
            onOpen={props.onOpen}
            onNewFolder={props.onNewFolder}
            onNewRequest={props.onNewRequest}
            onAction={props.onAction}
            onDrop={props.onDrop}
          />
        ))}
      </div>
    </div>
  );
}

function CollectionBlock(props: {
  col: Tree["collections"][number];
  activeId: string | null;
  focus?: SidebarFocus | null;
  onOpen: (req: RequestRecord) => void;
  onNewFolder: (collectionId: string, parentId: string | null) => void;
  onNewRequest: (collectionId: string, folderId: string | null) => void;
  onAction: (action: SidebarAction, target: MenuTarget) => void;
  onDrop: (item: DragItem, target: DropTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const col = props.col;
  const rowRef = useRef<HTMLDivElement>(null);
  const expanded = open;
  const highlighted = props.focus?.highlightId === col.id;
  useEffect(() => {
    if (props.focus?.collectionId === col.id) setOpen(true);
  }, [props.focus?.token, props.focus?.collectionId, col.id]);
  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted, props.focus?.token]);
  return (
    <div ref={rowRef} className="mb-2">
      <DropRow
        className={`group flex items-center justify-between rounded px-2 py-1 hover:bg-[var(--canvas)] ${highlighted ? "bg-[var(--canvas)]" : ""}`}
        onDropItem={(item) => {
          setOpen(true);
          props.onDrop(item, { kind: "collection", id: col.id });
        }}
      >
        <span className="flex min-w-0 items-center gap-1">
          <Twistie open={expanded} onToggle={() => setOpen((v) => !v)} />
          <button type="button" className="truncate text-left font-medium" onClick={() => setOpen((v) => !v)}>
            {col.name}
          </button>
        </span>
        <span className="flex items-center gap-1 text-[10px] text-[var(--accent)]">
          <button
            onClick={() => {
              setOpen(true);
              props.onNewFolder(col.id, null);
            }}
          >
            Folder
          </button>
          <button
            onClick={() => {
              setOpen(true);
              props.onNewRequest(col.id, null);
            }}
          >
            Req
          </button>
          <ItemMenu onAction={(action) => props.onAction(action, { kind: "collection", id: col.id, name: col.name })} share />
        </span>
      </DropRow>
      {expanded && (
        <>
          {col.folders
            .filter((f) => !f.parentId)
            .map((folder) => (
              <FolderBlock
                key={folder.id}
                folder={folder}
                collectionId={col.id}
                folders={col.folders}
                requests={col.requests}
                depth={1}
                activeId={props.activeId}
                focus={props.focus}
                onOpen={props.onOpen}
                onNewFolder={props.onNewFolder}
                onNewRequest={props.onNewRequest}
                onAction={props.onAction}
                onDrop={props.onDrop}
              />
            ))}
          {col.requests
            .filter((r) => !r.folderId)
            .map((req) => (
              <RequestRow
                key={req.id}
                req={req}
                depth={1}
                active={props.activeId === req.id}
                reveal={props.focus?.highlightId === req.id ? props.focus.token : undefined}
                onOpen={props.onOpen}
                onAction={(action) => props.onAction(action, { kind: "request", id: req.id, name: req.name, collectionId: col.id })}
                onDrop={props.onDrop}
              />
            ))}
        </>
      )}
    </div>
  );
}

function FolderBlock(props: {
  folder: Tree["collections"][number]["folders"][number];
  collectionId: string;
  folders: Tree["collections"][number]["folders"];
  requests: RequestRecord[];
  depth: number;
  activeId: string | null;
  focus?: SidebarFocus | null;
  onOpen: (req: RequestRecord) => void;
  onNewFolder: (collectionId: string, parentId: string | null) => void;
  onNewRequest: (collectionId: string, folderId: string | null) => void;
  onAction: (action: SidebarAction, target: MenuTarget) => void;
  onDrop: (item: DragItem, target: DropTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open;
  const highlighted = props.focus?.highlightId === props.folder.id;
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = props.focus?.folderId;
    if (!target || props.focus?.collectionId !== props.collectionId) return;
    if (target === props.folder.id || folderContains(props.folders, props.folder.id, target)) setOpen(true);
  }, [props.focus?.token, props.focus?.folderId, props.focus?.collectionId, props.collectionId, props.folder.id, props.folders]);
  useEffect(() => {
    if (highlighted) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted, props.focus?.token]);
  return (
    <div ref={rowRef} style={{ marginLeft: props.depth * 8 }}>
      <DropRow
        className={`group flex cursor-pointer items-center justify-between rounded px-2 py-0.5 text-[var(--muted)] hover:bg-[var(--canvas)] ${highlighted ? "bg-[var(--canvas)]" : ""}`}
        onClick={() => setOpen((v) => !v)}
        onDropItem={(item) => {
          setOpen(true);
          props.onDrop(item, { kind: "folder", id: props.folder.id, collectionId: props.collectionId });
        }}
      >
        <span className="flex min-w-0 flex-1 items-center gap-1">
          <Twistie open={expanded} onToggle={() => setOpen((v) => !v)} />
          <span className="truncate text-left">{props.folder.name}</span>
        </span>
        <ItemMenu
          extras={[
            {
              label: "Add Folder",
              onClick: () => {
                setOpen(true);
                props.onNewFolder(props.collectionId, props.folder.id);
              }
            },
            {
              label: "Add Request",
              onClick: () => {
                setOpen(true);
                props.onNewRequest(props.collectionId, props.folder.id);
              }
            }
          ]}
          onAction={(action) =>
            props.onAction(action, { kind: "folder", id: props.folder.id, name: props.folder.name, collectionId: props.collectionId })
          }
          share
        />
      </DropRow>
      {expanded && (
        <>
          {props.folders
            .filter((f) => f.parentId === props.folder.id)
            .map((child) => (
              <FolderBlock
                key={child.id}
                {...props}
                folder={child}
                depth={props.depth + 1}
              />
            ))}
          {props.requests
            .filter((r) => r.folderId === props.folder.id)
            .map((req) => (
              <RequestRow
                key={req.id}
                req={req}
                depth={0}
                active={props.activeId === req.id}
                reveal={props.focus?.highlightId === req.id ? props.focus.token : undefined}
                onOpen={props.onOpen}
                onAction={(action) =>
                  props.onAction(action, { kind: "request", id: req.id, name: req.name, collectionId: props.collectionId })
                }
                onDrop={props.onDrop}
              />
            ))}
        </>
      )}
    </div>
  );
}

function Twistie({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <button
      type="button"
      className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--canvas)] hover:text-[var(--fg)]"
      aria-label={open ? "Collapse" : "Expand"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Icon size={14} strokeWidth={2} />
    </button>
  );
}

function RequestRow({
  req,
  active,
  reveal,
  onOpen,
  onAction,
  onDrop,
  depth
}: {
  req: RequestRecord;
  active: boolean;
  reveal?: number;
  onOpen: (r: RequestRecord) => void;
  onAction: (action: SidebarAction) => void;
  onDrop: (item: DragItem, target: DropTarget) => void;
  depth: number;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const method = String((req.document as { method?: string }).method ?? req.protocol).toUpperCase();
  useEffect(() => {
    if (reveal) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [reveal]);
  return (
    <div ref={rowRef}>
    <DropRow
      className={`group flex w-full items-center rounded px-2 py-1 text-xs ${active ? "bg-[var(--canvas)]" : "hover:bg-[var(--canvas)]"}`}
      style={{ marginLeft: depth * 8 }}
      onDropItem={(item) =>
        onDrop(item, { kind: "request", id: req.id, collectionId: req.collectionId, folderId: req.folderId })
      }
    >
      <Grabber item={{ kind: "request", id: req.id, collectionId: req.collectionId }} />
      <button onClick={() => onOpen(req)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
        <span className={`w-12 shrink-0 font-mono text-[10px] font-semibold method-${method}`}>{method.slice(0, 6)}</span>
        <span className="truncate">{req.name}</span>
      </button>
      <ItemMenu onAction={onAction} share />
    </DropRow>
    </div>
  );
}

function Grabber({ item }: { item: DragItem }) {
  return (
    <span
      draggable
      onDragStart={(e) => {
        const payload = JSON.stringify(item);
        e.dataTransfer.setData("application/json", payload);
        e.dataTransfer.setData("text/plain", payload);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={(e) => e.stopPropagation()}
      className="shrink-0 cursor-grab touch-none px-0.5 text-[var(--muted)] opacity-40 hover:text-[var(--fg)] group-hover:opacity-100 active:cursor-grabbing"
      aria-label="Drag to move"
      title="Drag to move"
    >
      <GripVertical size={14} />
    </span>
  );
}

function DropRow(props: {
  className: string;
  style?: CSSProperties;
  onClick?: () => void;
  onDropItem: (item: DragItem) => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={`${props.className} ${over ? "ring-1 ring-inset ring-[var(--accent)]" : ""}`}
      style={props.style}
      onClick={props.onClick}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        try {
          const raw = e.dataTransfer.getData("application/json") || e.dataTransfer.getData("text/plain");
          if (!raw) return;
          props.onDropItem(JSON.parse(raw) as DragItem);
        } catch {
          /* ignore malformed drag data */
        }
      }}
    >
      {props.children}
    </div>
  );
}

function ItemMenu(props: {
  onAction: (action: SidebarAction) => void;
  share: boolean;
  extras?: { label: string; onClick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="rounded px-1 text-[var(--muted)] opacity-0 hover:bg-[var(--canvas)] group-hover:opacity-100"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Actions"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-[var(--border)] bg-[var(--panel)] py-1 text-xs shadow-lg">
          {props.extras?.map((extra) => (
            <MenuItem key={extra.label} label={extra.label} onClick={() => (setOpen(false), extra.onClick())} />
          ))}
          <MenuItem label="Rename" onClick={() => (setOpen(false), props.onAction("rename"))} />
          <MenuItem label="Export JSON" onClick={() => (setOpen(false), props.onAction("export"))} />
          {props.share && <MenuItem label="Share / access" onClick={() => (setOpen(false), props.onAction("share"))} />}
          <MenuItem label="Delete" danger onClick={() => (setOpen(false), props.onAction("delete"))} />
        </div>
      )}
    </div>
  );
}

function folderContains(folders: Array<{ id: string; parentId: string | null }>, ancestorId: string, folderId: string) {
  let current = folders.find((f) => f.id === folderId);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    if (current.parentId === ancestorId) return true;
    seen.add(current.id);
    const parentId = current.parentId;
    current = folders.find((f) => f.id === parentId);
  }
  return false;
}

function MenuItem(props: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      className={`block w-full px-3 py-1.5 text-left hover:bg-[var(--canvas)] ${props.danger ? "text-red-600" : ""}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onClick();
      }}
    >
      {props.label}
    </button>
  );
}
