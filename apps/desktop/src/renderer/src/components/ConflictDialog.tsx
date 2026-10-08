import { useState } from "react";
import type { RequestRecord } from "../screens/Studio";

function summary(req: RequestRecord) {
  const doc = req.document as { method?: string; url?: string; body?: { raw?: string } };
  const body = doc.body?.raw?.trim() ? doc.body.raw.slice(0, 240) : "(empty body)";
  return {
    name: req.name,
    version: req.version,
    method: String(doc.method ?? "GET"),
    url: String(doc.url ?? ""),
    body
  };
}

export function ConflictDialog(props: {
  draft: RequestRecord;
  latest: RequestRecord;
  deleted?: boolean;
  onCancel: () => void;
  onUseLatest: () => void;
  onReplaceMine: () => void;
  onSaveAsNew: () => void;
}) {
  const [confirm, setConfirm] = useState<"latest" | "mine" | null>(null);
  const mine = summary(props.draft);
  const theirs = summary(props.latest);

  if (confirm) {
    const discarding = confirm === "latest";
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
        <div className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 shadow-lg">
          <div className="text-sm font-medium">{discarding ? "Use the latest saved version?" : "Replace the latest version with yours?"}</div>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {discarding
              ? "Your unsaved draft will be discarded."
              : "This overwrites the version another developer just saved."}
          </p>
          <div className="mt-4 flex justify-end gap-2 text-xs">
            <button className="rounded-md border border-[var(--border)] px-3 py-1.5" onClick={() => setConfirm(null)}>
              Back
            </button>
            <button
              className={`rounded-md px-3 py-1.5 text-white ${discarding ? "bg-[var(--accent)]" : "bg-red-600"}`}
              onClick={() => (discarding ? props.onUseLatest() : props.onReplaceMine())}
            >
              {discarding ? "Discard draft" : "Overwrite"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-3xl rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 shadow-lg">
        <div className="text-sm font-medium">This API changed while you were editing</div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {props.deleted
            ? "The latest saved copy was deleted. You can still keep your draft as a new request."
            : "Your draft was not overwritten. Choose how to continue."}
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <VersionCard title={`Your draft (v${mine.version})`} item={mine} />
          <VersionCard title={props.deleted ? "Latest (deleted)" : `Latest saved (v${theirs.version})`} item={theirs} />
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2 text-xs">
          <button className="rounded-md border border-[var(--border)] px-3 py-1.5" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="rounded-md border border-[var(--border)] px-3 py-1.5" onClick={props.onSaveAsNew}>
            Save as new request
          </button>
          {!props.deleted && (
            <button className="rounded-md border border-[var(--border)] px-3 py-1.5" onClick={() => setConfirm("latest")}>
              Use latest
            </button>
          )}
          {!props.deleted && (
            <button className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-white" onClick={() => setConfirm("mine")}>
              Replace with mine
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function VersionCard({ title, item }: { title: string; item: ReturnType<typeof summary> }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--canvas)] p-3 text-xs">
      <div className="font-medium">{title}</div>
      <div className="mt-2 truncate">{item.name}</div>
      <div className="mt-1 font-mono text-[11px]">
        {item.method} {item.url || "(no URL)"}
      </div>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-[var(--muted)]">{item.body}</pre>
    </div>
  );
}
