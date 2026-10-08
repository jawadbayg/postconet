import { useEffect, useState } from "react";
import { invoke } from "../lib/ipc";
import type { Tree } from "../screens/Studio";

type Env = Tree["environments"][number];

export function EnvPanel(props: {
  workspaceId: string | null;
  tree: Tree | null;
  environmentId: string | null;
  onEnvironment: (id: string | null) => void;
  onReload: () => Promise<void>;
}) {
  const envs = props.tree?.environments ?? [];
  const selected = envs.find((e) => e.id === (props.environmentId ?? envs[0]?.id)) ?? null;
  const [name, setName] = useState(selected?.name ?? "");
  const [values, setValues] = useState(selected?.values ?? []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(selected?.name ?? "");
    setValues(selected?.values ?? []);
  }, [selected?.id]);

  async function save() {
    if (!selected) return;
    setError(null);
    try {
      await invoke("workspace.saveEnvironment", { ...selected, name, values });
      await props.onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex h-full min-h-0">
      <div className="w-56 shrink-0 border-r border-[var(--border)] bg-[var(--panel)]">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 text-xs">
          <span className="font-medium uppercase tracking-wide text-[var(--muted)]">Environments</span>
          <button
            className="text-[var(--accent)]"
            onClick={async () => {
              if (!props.workspaceId) return;
              await invoke("workspace.createEnvironment", { workspaceId: props.workspaceId, name: "Local" });
              await props.onReload();
            }}
          >
            New
          </button>
        </div>
        <div className="p-2">
          {envs.length === 0 && (
            <div className="space-y-2 px-2 py-4 text-xs text-[var(--muted)]">
              <p>Create Local, Staging, or Production. Use variables such as base_url in request URLs.</p>
              <button
                className="text-[var(--accent)]"
                onClick={async () => {
                  if (!props.workspaceId) return;
                  for (const name of ["Local", "Staging", "Production"]) {
                    await invoke("workspace.createEnvironment", { workspaceId: props.workspaceId, name });
                  }
                  await props.onReload();
                }}
              >
                Add Local, Staging, Production
              </button>
            </div>
          )}
          {envs.map((env) => (
            <button
              key={env.id}
              onClick={() => props.onEnvironment(env.id)}
              className={`mb-1 block w-full rounded px-2 py-1.5 text-left text-xs ${env.id === selected?.id ? "bg-[var(--canvas)] font-medium" : "hover:bg-[var(--canvas)]"}`}
            >
              {env.name}
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 flex-1 overflow-auto p-4">
        {!selected ? (
          <div className="text-sm text-[var(--muted)]">No environment selected. ENV stores variables that substitute {`{{base_url}}`} and similar placeholders when you send a request.</div>
        ) : (
          <div className="max-w-xl space-y-3">
            <label className="block text-xs font-medium">
              Name
              <input className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="text-xs font-medium">Variables</div>
            <div className="rounded-md border border-[var(--border)]">
              {values.map((item) => (
                <div key={item.id} className="grid grid-cols-[1fr_1fr_56px_64px_28px] gap-1 border-b border-[var(--border)] px-2 py-1 text-xs">
                  <input className="bg-transparent outline-none" value={item.key} placeholder="base_url" onChange={(e) => setValues(values.map((v) => (v.id === item.id ? { ...v, key: e.target.value } : v)))} />
                  <input className="bg-transparent outline-none" type={item.secret ? "password" : "text"} value={item.value} placeholder="https://api.example.com" onChange={(e) => setValues(values.map((v) => (v.id === item.id ? { ...v, value: e.target.value } : v)))} />
                  <label className="flex items-center gap-1 text-[var(--muted)]">
                    <input type="checkbox" checked={item.enabled} onChange={(e) => setValues(values.map((v) => (v.id === item.id ? { ...v, enabled: e.target.checked } : v)))} />
                    on
                  </label>
                  <label className="flex items-center gap-1 text-[var(--muted)]">
                    <input type="checkbox" checked={item.secret} onChange={(e) => setValues(values.map((v) => (v.id === item.id ? { ...v, secret: e.target.checked } : v)))} />
                    secret
                  </label>
                  <button className="text-[var(--muted)]" onClick={() => setValues(values.filter((v) => v.id !== item.id))}>
                    ×
                  </button>
                </div>
              ))}
              <button className="px-2 py-1 text-xs text-[var(--accent)]" onClick={() => setValues([...values, { id: crypto.randomUUID(), key: "", value: "", enabled: true, secret: false }])}>
                Add variable
              </button>
            </div>
            {error && <div className="text-xs text-red-600">{error}</div>}
            <div className="flex gap-2">
              <button className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs text-white" onClick={() => void save()}>
                Save
              </button>
              <button
                className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs text-red-600"
                onClick={async () => {
                  if (!confirm(`Delete environment “${selected.name}”?`)) return;
                  await invoke("workspace.delete", { type: "environment", id: selected.id });
                  props.onEnvironment(null);
                  await props.onReload();
                }}
              >
                Delete
              </button>
            </div>
            <p className="text-xs text-[var(--muted)]">The active environment is used when you Send. Switch it from the request bar as well.</p>
          </div>
        )}
      </div>
    </div>
  );
}
