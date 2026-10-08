import { useEffect, useState } from "react";

const ACTIONS = [
  { id: "new", label: "New request" },
  { id: "import", label: "Import collection / cURL / OpenAPI" },
  { id: "send", label: "Send request" }
];

export function CommandPalette(props: { onClose: () => void; onAction: (id: string) => void }) {
  const [q, setQ] = useState("");
  const items = ACTIONS.filter((a) => a.label.toLowerCase().includes(q.toLowerCase()));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24" onClick={props.onClose}>
      <div className="w-[520px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <input autoFocus className="w-full border-b border-[var(--border)] bg-transparent px-4 py-3 text-sm outline-none" placeholder="Command palette" value={q} onChange={(e) => setQ(e.target.value)} />
        <div>
          {items.map((item) => (
            <button key={item.id} className="block w-full px-4 py-2 text-left text-sm hover:bg-[var(--canvas)]" onClick={() => props.onAction(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
