import { useState } from "react";
import { invoke } from "../lib/ipc";

type Preview = {
  format: string;
  title: string;
  issues: Array<{ level: string; path: string; message: string }>;
  missingFiles: string[];
  collections: unknown[];
  requests: unknown[];
  folders: unknown[];
  environments: unknown[];
};

export function ImportModal(props: { workspaceId: string; onClose: () => void; onImported: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const p = await invoke<Preview>("import.preview", { text, workspaceId: props.workspaceId });
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    setBusy(true);
    try {
      await invoke("import.commit", preview);
      props.onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function fromFile() {
    const file = await invoke<{ path: string; text: string } | null>("dialog.openFile");
    if (file?.text) {
      setText(file.text);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={props.onClose}>
      <div className="flex h-[70vh] w-[720px] flex-col rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3 text-sm font-medium">
          Import
          <button onClick={props.onClose}>×</button>
        </div>
        <textarea className="min-h-0 flex-1 bg-[var(--canvas)] p-3 font-mono text-xs outline-none" value={text} onChange={(e) => setText(e.target.value)} />
        {preview && (
          <div className="max-h-40 overflow-auto border-t border-[var(--border)] p-3 text-xs">
            <div>
              Format: {preview.format} — {preview.title} — {preview.requests.length} requests
            </div>
            {preview.missingFiles.length > 0 && (
              <div className="text-amber-600">Missing file attachments (not imported): {preview.missingFiles.join(", ")}</div>
            )}
            {preview.issues.map((i, idx) => (
              <div key={idx} className={i.level === "error" ? "text-red-600" : "text-[var(--muted)]"}>
                {i.level}: {i.path} {i.message}
              </div>
            ))}
          </div>
        )}
        {error && <div className="px-4 text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button className="text-xs" onClick={() => void fromFile()}>
            Choose file
          </button>
          <button className="rounded-md border border-[var(--border)] px-3 py-1 text-xs" onClick={() => void runPreview()} disabled={busy}>
            Preview
          </button>
          <button className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs text-white disabled:opacity-50" onClick={() => void commit()} disabled={!preview || busy}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
