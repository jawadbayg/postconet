import { useMemo, useState } from "react";
import type { Tree } from "../screens/Studio";

export function MoveModal(props: {
  tree: Tree;
  title: string;
  excludeFolderIds?: string[];
  onCancel: () => void;
  onMove: (collectionId: string, folderId: string | null) => void;
}) {
  const [collectionId, setCollectionId] = useState(props.tree.collections[0]?.id ?? "");
  const [folderId, setFolderId] = useState<string>("");
  const folders = useMemo(
    () => (props.tree.collections.find((c) => c.id === collectionId)?.folders ?? []).filter((f) => !props.excludeFolderIds?.includes(f.id)),
    [collectionId, props.tree, props.excludeFolderIds]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 shadow-lg">
        <div className="text-sm font-medium">{props.title}</div>
        <label className="mt-3 block text-xs">
          Collection
          <select className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5" value={collectionId} onChange={(e) => { setCollectionId(e.target.value); setFolderId(""); }}>
            {props.tree.collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-xs">
          Folder
          <select className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--canvas)] px-2 py-1.5" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">Collection root</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 flex justify-end gap-2 text-xs">
          <button className="rounded-md border border-[var(--border)] px-3 py-1.5" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-white disabled:opacity-50" disabled={!collectionId} onClick={() => props.onMove(collectionId, folderId || null)}>
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
