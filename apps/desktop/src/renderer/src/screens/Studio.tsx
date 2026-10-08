import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { invoke } from "../lib/ipc";
import type { SessionInfo } from "../App";
import { Sidebar } from "../components/Sidebar";
import { RequestWorkbench } from "../components/RequestWorkbench";
import { StatusBar } from "../components/StatusBar";
import { CommandPalette } from "../components/CommandPalette";
import { ImportModal } from "../components/ImportModal";

export type Tree = {
  workspace?: { id: string; name: string; kind: string };
  collections: Array<{
    id: string;
    name: string;
    auth: { type: string; params: Record<string, string> };
    scripts: { prerequest: string; test: string };
    variables: unknown[];
    folders: Array<{ id: string; name: string; parentId: string | null; auth: { type: string; params: Record<string, string> }; scripts: { prerequest: string; test: string } }>;
    requests: Array<RequestRecord>;
  }>;
  environments: Array<{ id: string; name: string; values: Array<{ id: string; key: string; value: string; enabled: boolean; secret: boolean }> }>;
  globals: unknown[];
};

export type RequestRecord = {
  id: string;
  name: string;
  collectionId: string;
  folderId: string | null;
  workspaceId: string;
  protocol: string;
  document: Record<string, unknown>;
  version: number;
  examples: unknown[];
  favorite: boolean;
};

export type Tab = { id: string; request: RequestRecord; dirty: boolean; pinned: boolean };

export function Studio(props: {
  session: SessionInfo;
  theme: "light" | "dark";
  onTheme: (t: "light" | "dark") => void;
  onSession: (s: SessionInfo) => void;
}) {
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; kind: string }>>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [tree, setTree] = useState<Tree | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [importer, setImporter] = useState(false);
  const [sync, setSync] = useState(props.session);
  const [search, setSearch] = useState("");

  const load = useCallback(async (id?: string) => {
    try {
      const list = await invoke<Array<{ id: string; name: string; kind: string }>>("workspace.list");
      setWorkspaces(list);
      const ws = id ?? list[0]?.id;
      if (!ws) return;
      setWorkspaceId(ws);
      const t = await invoke<Tree>("workspace.tree", { workspaceId: ws });
      setTree(t);
    } catch (error) {
      console.error("Failed to load workspace", error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!window.postconet) return;
    const off = window.postconet.on("menu", (action) => {
      if (action === "palette") setPalette(true);
      if (action === "import") setImporter(true);
      if (action === "new-request") void onNewRequest();
    });
    const offSync = window.postconet.on("sync.status", (p) => setSync((s) => ({ ...s, ...(p as SessionInfo) })));
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      off();
      offSync();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const active = tabs.find((t) => t.id === activeId) ?? null;

  async function onNewRequest() {
    if (!workspaceId || !tree?.collections[0]) {
      if (!workspaceId) return;
      const col = await invoke<{ id: string }>("workspace.createCollection", { workspaceId, name: "Collection" });
      await load(workspaceId);
      const req = await invoke<RequestRecord>("workspace.createRequest", { workspaceId, collectionId: col.id, folderId: null, name: "New request" });
      open(req);
      return;
    }
    const req = await invoke<RequestRecord>("workspace.createRequest", {
      workspaceId,
      collectionId: tree.collections[0].id,
      folderId: null,
      name: "New request"
    });
    await load(workspaceId);
    open(req);
  }

  function open(req: RequestRecord) {
    setTabs((prev) => (prev.some((t) => t.id === req.id) ? prev : [...prev, { id: req.id, request: req, dirty: false, pinned: false }]));
    setActiveId(req.id);
  }

  function updateActive(request: RequestRecord, dirty = true) {
    setTabs((prev) => prev.map((t) => (t.id === request.id ? { ...t, request, dirty } : t)));
  }

  async function saveActive() {
    if (!active) return;
    const saved = await invoke<RequestRecord>("workspace.saveRequest", active.request);
    updateActive(saved, false);
    if (workspaceId) await load(workspaceId);
  }

  const authChain = useMemo(() => {
    if (!active || !tree) return [{ type: "none", params: {} }];
    const col = tree.collections.find((c) => c.id === active.request.collectionId);
    const folder = col?.folders.find((f) => f.id === active.request.folderId);
    return [col?.auth ?? { type: "none", params: {} }, folder?.auth ?? { type: "inherit", params: {} }, (active.request.document as { auth?: { type: string; params: Record<string, string> } }).auth ?? { type: "inherit", params: {} }];
  }, [active, tree]);

  return (
    <div className="flex h-full min-h-screen flex-1 flex-col bg-[#f4f5f7] text-[#12151a] dark:bg-[#0f1115] dark:text-[#eef0f4]">
      <header className="titlebar-drag flex h-12 items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] pl-20 pr-4">
        <div className="titlebar-no-drag flex items-center gap-3 text-sm">
          <span className="font-medium">PostConet</span>
          <select
            className="rounded-md border border-[var(--border)] bg-[var(--canvas)] px-2 py-1 text-xs"
            value={workspaceId ?? ""}
            onChange={(e) => void load(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        <div className="titlebar-no-drag flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            className="w-48 rounded-md border border-[var(--border)] bg-[var(--canvas)] px-2 py-1 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && search) setPalette(true);
            }}
          />
          <button className="rounded-md border border-[var(--border)] px-2 py-1 text-xs" onClick={() => setImporter(true)}>
            Import
          </button>
          <button className="rounded-md border border-[var(--border)] px-2 py-1 text-xs" onClick={() => props.onTheme(props.theme === "dark" ? "light" : "dark")}>
            {props.theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-12 flex-col items-center gap-2 border-r border-[var(--border)] bg-[var(--panel)] py-3 text-[10px] text-[var(--muted)]">
          <RailBtn label="API" active />
          <RailBtn label="Env" />
          <RailBtn label="Hist" />
        </div>
        <PanelGroup direction="horizontal" className="flex-1">
          <Panel defaultSize={22} minSize={14}>
            <Sidebar
              tree={tree}
              onOpen={open}
              onNewCollection={async () => {
                if (!workspaceId) return;
                await invoke("workspace.createCollection", { workspaceId, name: "New collection" });
                await load(workspaceId);
              }}
              onNewFolder={async (collectionId, parentId) => {
                if (!workspaceId) return;
                await invoke("workspace.createFolder", { workspaceId, collectionId, parentId, name: "Folder" });
                await load(workspaceId);
              }}
              onNewRequest={async (collectionId, folderId) => {
                if (!workspaceId) return;
                const req = await invoke<RequestRecord>("workspace.createRequest", { workspaceId, collectionId, folderId, name: "New request" });
                await load(workspaceId);
                open(req);
              }}
              onNewEnvironment={async () => {
                if (!workspaceId) return;
                await invoke("workspace.createEnvironment", { workspaceId, name: "Environment" });
                await load(workspaceId);
              }}
              activeId={activeId}
            />
          </Panel>
          <PanelResizeHandle className="w-px bg-[var(--border)]" />
          <Panel minSize={40}>
            <RequestWorkbench
              tabs={tabs}
              activeId={activeId}
              onSelect={setActiveId}
              onClose={(id) => {
                setTabs((prev) => prev.filter((t) => t.id !== id));
                if (activeId === id) setActiveId(tabs.find((t) => t.id !== id)?.id ?? null);
              }}
              onPin={(id) => setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, pinned: !t.pinned } : t)))}
              onChange={(req) => updateActive(req, true)}
              onSave={() => void saveActive()}
              workspaceId={workspaceId}
              environmentId={environmentId}
              environments={tree?.environments ?? []}
              onEnvironment={setEnvironmentId}
              authChain={authChain}
            />
          </Panel>
        </PanelGroup>
      </div>
      <StatusBar sync={sync} onSync={() => invoke("sync.now").then((s) => setSync(s as SessionInfo))} onSignOut={() => invoke("auth.signOut").then(() => location.reload())} />
      {palette && (
        <CommandPalette
          onClose={() => setPalette(false)}
          onAction={(a) => {
            if (a === "import") setImporter(true);
            if (a === "new") void onNewRequest();
            setPalette(false);
          }}
        />
      )}
      {importer && workspaceId && (
        <ImportModal
          workspaceId={workspaceId}
          onClose={() => setImporter(false)}
          onImported={() => {
            setImporter(false);
            void load(workspaceId);
          }}
        />
      )}
    </div>
  );
}

function RailBtn({ label, active }: { label: string; active?: boolean }) {
  return (
    <div className={`flex h-10 w-10 items-center justify-center rounded-md ${active ? "bg-[var(--canvas)] font-medium text-[var(--fg)]" : ""}`}>
      {label}
    </div>
  );
}
