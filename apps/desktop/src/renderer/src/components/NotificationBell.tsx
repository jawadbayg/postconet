import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { invoke } from "../lib/ipc";

type Note = { id: string; title: string; body?: string | null; read_at: string | null; created_at: string };

export function NotificationBell() {
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
        <div className="absolute right-0 z-30 mt-1 w-80 rounded-md border border-[var(--border)] bg-[var(--panel)] p-2 shadow-lg">
          {notes.length === 0 && <div className="p-3 text-xs text-[var(--muted)]">No notifications</div>}
          {notes.map((note) => (
            <button
              key={note.id}
              className="mb-1 block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--canvas)]"
              onClick={() => {
                void invoke("notifications.read", { id: note.id }).then(refresh);
              }}
            >
              <div className="font-medium">{note.title}</div>
              {note.body && <div className="text-[var(--muted)]">{note.body}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
