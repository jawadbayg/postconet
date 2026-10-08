export function ConfirmDialog(props: {
  title: string;
  body: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 shadow-lg">
        <div className="text-sm font-medium">{props.title}</div>
        <p className="mt-2 text-sm text-[var(--muted)]">{props.body}</p>
        <div className="mt-4 flex justify-end gap-2 text-xs">
          <button className="rounded-md border border-[var(--border)] px-3 py-1.5" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="rounded-md bg-red-600 px-3 py-1.5 text-white" onClick={props.onConfirm}>
            {props.confirmLabel ?? "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
