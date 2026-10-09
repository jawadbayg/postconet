import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { invoke } from "../lib/ipc";

export type NotifyPayload = {
  workspaceId?: string;
  resourceKind?: "workspace" | "collection" | "folder" | "request";
  resourceId?: string;
  collectionId?: string | null;
  folderId?: string | null;
  name?: string;
  ownerLabel?: string;
};

type Note = {
  id: string;
  title: string;
  body?: string | null;
  payload?: NotifyPayload | null;
  read_at: string | null;
  created_at: string;
};

export function NotificationBell(props: { onOpen?: (payload: NotifyPayload) => void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);

  async function refresh() {
    try {
      const list = await invoke<Note[]>("notifications.list");
      setNotes(list);
    } catch {
      setNotes([]);
    }
  }

  useEffect(() => {
    void refresh();
    if (!window.postconet) return;
    return window.postconet.on("notify", () => {
      void refresh();
    });
  }, []);

  const unread = notes.filter((n) => !n.read_at).length;

  return (
    <div className="relative">
      <button
        type="button"
        title="Inbox"
        aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}
        className="relative flex items-center justify-center rounded-md border border-[var(--border)] px-2 py-1"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={14} />
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-[var(--accent)] px-1 text-center text-[10px] leading-4 text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 max-h-96 w-96 overflow-auto rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 shadow-lg">
          {notes.length === 0 && <div className="p-3 text-xs text-[var(--muted)]">No notifications</div>}
          {notes.map((note) => (
            <button
              key={note.id}
              className="mb-1 block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--canvas)]"
              onClick={() => {
                void invoke("notifications.read", { id: note.id }).then(refresh);
                setOpen(false);
                if (note.payload?.workspaceId) props.onOpen?.(note.payload);
              }}
            >
              <div className="font-medium">{note.title}</div>
              {note.body && <div className="mt-0.5 whitespace-pre-wrap text-[var(--muted)]">{note.body}</div>}
              {note.payload?.workspaceId && (
                <div className="mt-1 text-[11px] text-[var(--accent)]">Open in sidebar</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
