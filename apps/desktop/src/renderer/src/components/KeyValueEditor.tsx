type Item = { id: string; key: string; value: string; enabled: boolean };

export function KeyValueEditor(props: { items: Item[]; onChange: (items: Item[]) => void; valuePlaceholder?: string }) {
  function update(id: string, patch: Partial<Item>) {
    props.onChange(props.items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }
  function add() {
    props.onChange([...props.items, { id: crypto.randomUUID(), key: "", value: "", enabled: true }]);
  }
  return (
    <div className="text-xs">
      <div className="grid grid-cols-[24px_1fr_1fr_28px] gap-1 border-b border-[var(--border)] px-2 py-1 text-[10px] uppercase text-[var(--muted)]">
        <span />
        <span>Key</span>
        <span>{props.valuePlaceholder ?? "Value"}</span>
        <span />
      </div>
      {props.items.map((item) => (
        <div key={item.id} className="grid grid-cols-[24px_1fr_1fr_28px] items-center gap-1 border-b border-[var(--border)] px-2 py-1">
          <input type="checkbox" checked={item.enabled} onChange={(e) => update(item.id, { enabled: e.target.checked })} />
          <input className="bg-transparent outline-none" value={item.key} placeholder="Key" onChange={(e) => update(item.id, { key: e.target.value })} />
          <input className="bg-transparent outline-none" value={item.value} placeholder="Value" onChange={(e) => update(item.id, { value: e.target.value })} />
          <button className="text-[var(--muted)]" onClick={() => props.onChange(props.items.filter((i) => i.id !== item.id))}>
            ×
          </button>
        </div>
      ))}
      <button className="px-2 py-1 text-[var(--accent)]" onClick={add}>
        Add
      </button>
    </div>
  );
}
