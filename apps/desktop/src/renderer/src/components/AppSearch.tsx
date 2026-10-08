import { useEffect, useMemo, useRef, useState } from "react";
import type { RequestRecord, Tree } from "../screens/Studio";

type Hit =
  | { kind: "collection"; id: string; title: string; detail: string }
  | { kind: "folder"; id: string; collectionId: string; title: string; detail: string }
  | { kind: "request"; request: RequestRecord; title: string; detail: string }
  | { kind: "environment"; id: string; title: string; detail: string };

const KIND_LABEL: Record<Hit["kind"], string> = {
  collection: "Collection",
  folder: "Folder",
  request: "Request",
  environment: "Environment"
};

export function AppSearch(props: {
  tree: Tree | null;
  onOpenRequest: (req: RequestRecord) => void;
  onOpenCollection: (collectionId: string) => void;
  onOpenFolder: (collectionId: string, folderId: string) => void;
  onOpenEnvironment: (environmentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const hits = useMemo(() => searchTree(props.tree, query), [props.tree, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function choose(hit: Hit) {
    if (hit.kind === "request") props.onOpenRequest(hit.request);
    if (hit.kind === "collection") props.onOpenCollection(hit.id);
    if (hit.kind === "folder") props.onOpenFolder(hit.collectionId, hit.id);
    if (hit.kind === "environment") props.onOpenEnvironment(hit.id);
    setQuery("");
    setOpen(false);
  }

  const show = open && query.trim().length > 0;

  return (
    <div className="relative" ref={rootRef}>
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search"
        className="w-56 rounded-md border border-[var(--border)] bg-[var(--canvas)] px-2 py-1 text-xs"
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          }
          if (e.key === "Enter" && hits[active]) {
            e.preventDefault();
            choose(hits[active]);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {show && (
        <div className="absolute right-0 z-40 mt-1 max-h-80 w-80 overflow-auto rounded-md border border-[var(--border)] bg-[var(--panel)] py-1 text-xs shadow-lg">
          {hits.length === 0 && <div className="px-3 py-2 text-[var(--muted)]">No matches</div>}
          {hits.map((hit, index) => (
            <button
              key={`${hit.kind}:${hit.kind === "request" ? hit.request.id : hit.id}`}
              type="button"
              className={`block w-full px-3 py-1.5 text-left ${index === active ? "bg-[var(--canvas)]" : "hover:bg-[var(--canvas)]"}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(hit)}
            >
              <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{KIND_LABEL[hit.kind]}</span>
              <span className="mt-0.5 block truncate font-medium">{hit.title}</span>
              {hit.detail && <span className="block truncate text-[var(--muted)]">{hit.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function searchTree(tree: Tree | null, raw: string): Hit[] {
  const q = raw.trim().toLowerCase();
  if (!tree || !q) return [];
  const hits: Hit[] = [];
  for (const col of tree.collections) {
    if (matches(q, col.name)) hits.push({ kind: "collection", id: col.id, title: col.name, detail: "Collection" });
    for (const folder of col.folders) {
      const path = folderPath(col.folders, folder.id);
      if (matches(q, folder.name, path, col.name)) {
        hits.push({ kind: "folder", id: folder.id, collectionId: col.id, title: folder.name, detail: `${col.name} / ${path}` });
      }
    }
    for (const req of col.requests) {
      const doc = req.document as { url?: string; method?: string };
      const method = String(doc.method ?? req.protocol ?? "").toUpperCase();
      const url = doc.url ?? "";
      const folder = req.folderId ? folderPath(col.folders, req.folderId) : "";
      if (matches(q, req.name, method, url, col.name, folder)) {
        const where = [col.name, folder].filter(Boolean).join(" / ");
        hits.push({
          kind: "request",
          request: req,
          title: req.name,
          detail: [method, url, where].filter(Boolean).join(" · ")
        });
      }
    }
  }
  for (const env of tree.environments) {
    const keys = env.values.filter((v) => !v.secret).map((v) => `${v.key} ${v.value}`);
    if (matches(q, env.name, ...keys)) {
      hits.push({ kind: "environment", id: env.id, title: env.name, detail: "Environment" });
    }
  }
  return hits.slice(0, 40);
}

function matches(q: string, ...parts: Array<string | null | undefined>) {
  return parts.some((part) => (part ?? "").toLowerCase().includes(q));
}

function folderPath(folders: Array<{ id: string; name: string; parentId: string | null }>, folderId: string) {
  const names: string[] = [];
  let current = folders.find((f) => f.id === folderId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    const parentId = current.parentId;
    current = parentId ? folders.find((f) => f.id === parentId) : undefined;
  }
  return names.join(" / ");
}
