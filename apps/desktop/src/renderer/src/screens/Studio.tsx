import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Pencil, Settings, UserPlus } from "lucide-react";
import { isCloudUser, LOCAL_USER, mergeSyncStatus, type SessionInfo } from "../App";
import { invoke } from "../lib/ipc";
import { Sidebar, type SidebarAction, type SidebarFocus, type DragItem, type DropTarget } from "../components/Sidebar";
import { AppSearch } from "../components/AppSearch";
import { RequestWorkbench } from "../components/RequestWorkbench";
import { StatusBar } from "../components/StatusBar";
import { CommandPalette } from "../components/CommandPalette";
import { ImportModal } from "../components/ImportModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ShareModal, type ShareTarget } from "../components/ShareModal";
import { ThemeToggle } from "../components/ThemeToggle";
import type { NotifyPayload } from "../components/NotificationBell";
import { EnvPanel } from "../components/EnvPanel";
import { HistoryPanel } from "../components/HistoryPanel";
import { SettingsScreen } from "../components/SettingsScreen";
import { AuthScreen } from "./AuthScreen";
import { NotificationBell } from "../components/NotificationBell";
import { BrandMark } from "../components/BrandMark";
import { ConflictDialog } from "../components/ConflictDialog";
import { downloadPostmanJson } from "../lib/postmanExport";
import { DispatchLoaderOverlay } from "../components/DispatchLoader";

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
  deletedAt?: string | null;
};

export type Tab = {
  id: string;
  request: RequestRecord;
  dirty: boolean;
  pinned: boolean;
  remoteUpdated?: boolean;
  latestRemote?: RequestRecord;
};

type SaveRequestResult =
  | { status: "saved"; request: RequestRecord }
  | { status: "conflict"; draft: RequestRecord; latest: RequestRecord; deleted?: boolean };

function asRequest(payload: unknown): RequestRecord | null {
  if (!payload || typeof payload !== "object" || !("id" in payload)) return null;
  const row = payload as RequestRecord;
  if (!row.id) return null;
  return row;
}

type Rail = "api" | "env" | "hist" | "settings";
type MenuTarget = { kind: "collection" | "folder" | "request"; id: string; name: string; collectionId?: string };
type RenameTarget = MenuTarget | { kind: "workspace"; id: string; name: string };
type WorkspaceItem = {
  id: string;
  name: string;
  kind: string;
  mine: boolean;
  ownerName: string;
  label: string;
};

export function Studio(props: {
  session: SessionInfo;
  theme: "light" | "dark";
  onTheme: (t: "light" | "dark") => void;
  onSession: (s: SessionInfo) => void;
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [tree, setTree] = useState<Tree | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [importer, setImporter] = useState(false);
  const [sync, setSync] = useState(props.session);
  const [focus, setFocus] = useState<SidebarFocus | null>(null);
  const [rail, setRail] = useState<Rail>("api");
  const [rename, setRename] = useState<RenameTarget | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirm, setConfirm] = useState<MenuTarget | null>(null);
  const [share, setShare] = useState<ShareTarget | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ draft: RequestRecord; latest: RequestRecord; deleted?: boolean } | null>(null);
  const [showSignIn, setShowSignIn] = useState(false);
  const signedIn = isCloudUser(sync.user);
  const workspaceIdRef = useRef(workspaceId);
  const activeIdRef = useRef(activeId);
  const tabsRef = useRef(tabs);
  workspaceIdRef.current = workspaceId;
  activeIdRef.current = activeId;
  tabsRef.current = tabs;

  const load = useCallback(async (id?: string) => {
    try {
      const list = await invoke<WorkspaceItem[]>("workspace.list");
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
  }, [load, props.session.user?.id]);

  useEffect(() => {
    if (!window.postconet) return;
    const off = window.postconet.on("menu", (action) => {
      if (action === "palette") setPalette(true);
      if (action === "import") setImporter(true);
      if (action === "new-request") void onNewRequest();
      if (action === "save") void persistActive();
    });
    const offSync = window.postconet.on("sync.status", (p) =>
      setSync((s) => mergeSyncStatus(s, p as SessionInfo))
    );
    const offNotify = window.postconet.on("notify", () => {
      void load(workspaceIdRef.current ?? undefined);
    });
    const offChanged = window.postconet.on("sync.changed", (raw) => {
      const event = raw as { entityType?: string; entityId?: string; op?: string; payload?: unknown };
      void load(workspaceIdRef.current ?? undefined);
      if (event.entityType !== "request" || !event.entityId) return;
      const incoming = asRequest(event.payload);
      setTabs((prev) =>
        prev.flatMap((t) => {
          if (t.id !== event.entityId) return [t];
          if (event.op === "delete") {
            if (t.dirty) {
              return [{ ...t, remoteUpdated: true, latestRemote: incoming ?? t.request }];
            }
            return [];
          }
          if (!incoming) return [t];
          if (t.dirty) return [{ ...t, remoteUpdated: true, latestRemote: incoming }];
          return [{ ...t, request: incoming, dirty: false, remoteUpdated: false, latestRemote: undefined }];
        })
      );
    });
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
      offNotify();
      offChanged();
      window.removeEventListener("keydown", onKey);
    };
  }, [load]);

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
    setRail("api");
  }

  function updateActive(request: RequestRecord, dirty = true) {
    setTabs((prev) => prev.map((t) => (t.id === request.id ? { ...t, request, dirty } : t)));
  }

  async function persistActive(opts?: { overwrite?: boolean; expectedLatest?: number }) {
    const tab = tabsRef.current.find((t) => t.id === activeIdRef.current);
    if (!tab) return;
    try {
      const result = await invoke<SaveRequestResult>("workspace.saveRequest", {
        ...tab.request,
        request: tab.request,
        overwrite: opts?.overwrite,
        expectedLatest: opts?.expectedLatest
      });
      if (result.status === "conflict") {
        setConflict({ draft: result.draft, latest: result.latest, deleted: result.deleted });
        setTabs((prev) =>
          prev.map((t) => (t.id === tab.id ? { ...t, dirty: true, remoteUpdated: true, latestRemote: result.latest } : t))
        );
        return;
      }
      setConflict(null);
      updateActive(result.request, false);
      setTabs((prev) => prev.map((t) => (t.id === result.request.id ? { ...t, remoteUpdated: false, latestRemote: undefined } : t)));
      if (workspaceIdRef.current) await load(workspaceIdRef.current);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  async function saveActive() {
    await persistActive();
  }

  function onSidebarAction(action: SidebarAction, target: MenuTarget) {
    setActionError(null);
    if (action === "rename") {
      setRename(target);
      setRenameValue(target.name);
    }
    if (action === "delete") setConfirm(target);
    if (action === "share" && workspaceId) {
      setShare({ kind: target.kind, id: target.id, name: target.name, workspaceId });
    }
    if (action === "export") void exportAsPostman(target);
  }

  async function exportAsPostman(target: MenuTarget) {
    try {
      try {
        await invoke("export.download", { kind: target.kind, id: target.id });
        return;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!msg.includes("No handler registered") && !msg.includes("export.download")) throw e;
      }
      if (!tree) throw new Error("Nothing to export");
      await downloadPostmanJson(tree, target);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDrop(item: DragItem, target: DropTarget) {
    setActionError(null);
    try {
      const collectionId = target.kind === "collection" ? target.id : target.collectionId;
      const folderId = target.kind === "folder" ? target.id : target.kind === "request" ? target.folderId : null;
      if (target.kind === "request" && target.id === item.id) return;
      await invoke("workspace.moveRequest", { requestId: item.id, collectionId, folderId });
      setTabs((prev) => prev.map((t) => (t.id === item.id ? { ...t, request: { ...t.request, collectionId, folderId } } : t)));
      if (workspaceId) await load(workspaceId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  async function addRequestHere() {
    if (!workspaceId) return;
    const current = tabs.find((t) => t.id === activeId)?.request;
    const collectionId = current?.collectionId ?? tree?.collections[0]?.id;
    const folderId = current?.folderId ?? null;
    if (!collectionId) {
      await onNewRequest();
      return;
    }
    try {
      const req = await invoke<RequestRecord>("workspace.createRequest", {
        workspaceId,
        collectionId,
        folderId,
        name: "New request"
      });
      await load(workspaceId);
      open(req);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  }

  const authChain = useMemo(() => {
    if (!active || !tree) return [{ type: "none", params: {} }];
    const col = tree.collections.find((c) => c.id === active.request.collectionId);
    const folder = col?.folders.find((f) => f.id === active.request.folderId);
    return [col?.auth ?? { type: "none", params: {} }, folder?.auth ?? { type: "inherit", params: {} }, (active.request.document as { auth?: { type: string; params: Record<string, string> } }).auth ?? { type: "inherit", params: {} }];
  }, [active, tree]);

  useEffect(() => {
    setSync(props.session);
  }, [props.session]);

  const currentWorkspace = workspaces.find((w) => w.id === workspaceId) ?? null;

  async function openSharedItem(payload: NotifyPayload) {
    if (!payload.workspaceId) return;
    setRail("api");
    await load(payload.workspaceId);
    const collectionId = payload.collectionId ?? (payload.resourceKind === "collection" ? payload.resourceId : null);
    const folderId = payload.folderId ?? (payload.resourceKind === "folder" ? payload.resourceId : null);
    const highlightId = payload.resourceId ?? collectionId ?? undefined;
    if (collectionId && highlightId) {
      setFocus({
        token: Date.now(),
        collectionId,
        folderId: folderId ?? null,
        highlightId
      });
    }
  }

  async function goLocal() {
    const payload = await invoke<Partial<SessionInfo>>("auth.signOut");
    const next = mergeSyncStatus(sync, { ...payload, user: LOCAL_USER });
    setSync(next);
    props.onSession(next);
    setTabs([]);
    setActiveId(null);
    setShare(null);
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#f4f5f7] text-[#12151a] dark:bg-[#0f1115] dark:text-[#eef0f4]">
      <header className="titlebar-drag relative z-40 flex h-12 shrink-0 items-center border-b border-[var(--border)] bg-[var(--panel)] pl-20 pr-4">
        <div className="titlebar-no-drag flex min-w-0 items-center gap-3 text-sm">
          <BrandMark size={22} />
          <span className="font-medium">PostConet</span>
          <select
            className="max-w-[240px] rounded-md border border-[var(--border)] bg-[var(--canvas)] px-2 py-1 text-xs"
            value={workspaceId ?? ""}
            onChange={(e) => void load(e.target.value)}
            title="Switch workspace. Your workspaces first, then ones shared with you."
          >
            {workspaces.some((w) => w.mine) && (
              <optgroup label="My workspaces">
                {workspaces.filter((w) => w.mine).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </optgroup>
            )}
            {workspaces.some((w) => !w.mine) && (
              <optgroup label="Shared with me">
                {workspaces.filter((w) => !w.mine).map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {currentWorkspace?.mine && (
            <button
              type="button"
              title="Rename workspace"
              aria-label="Rename workspace"
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted)]"
              onClick={() => {
                setRename({ kind: "workspace", id: currentWorkspace.id, name: currentWorkspace.name });
                setRenameValue(currentWorkspace.name);
              }}
            >
              <Pencil size={12} />
            </button>
          )}
        </div>
        <div className="titlebar-no-drag absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
          <AppSearch
            tree={tree}
            onOpenRequest={(req) => {
              open(req);
              setFocus({
                token: Date.now(),
                collectionId: req.collectionId,
                folderId: req.folderId,
                highlightId: req.id
              });
            }}
            onOpenCollection={(collectionId) => {
              setRail("api");
              setFocus({ token: Date.now(), collectionId, folderId: null, highlightId: collectionId });
            }}
            onOpenFolder={(collectionId, folderId) => {
              setRail("api");
              setFocus({ token: Date.now(), collectionId, folderId, highlightId: folderId });
            }}
            onOpenEnvironment={(environmentId) => {
              setEnvironmentId(environmentId);
              setRail("env");
            }}
          />
        </div>
        <div className="titlebar-no-drag ml-auto flex items-center gap-2">
          <button className="rounded-md border border-[var(--border)] px-2 py-1 text-xs" onClick={() => setImporter(true)}>
            Import
          </button>
          {signedIn && currentWorkspace?.mine && (
            <button
              type="button"
              className="flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-xs"
              title="Invite someone to this whole workspace"
              onClick={() =>
                setShare({
                  kind: "workspace",
                  id: currentWorkspace.id,
                  name: currentWorkspace.name,
                  workspaceId: currentWorkspace.id
                })
              }
            >
              <UserPlus size={12} />
              Invite
            </button>
          )}
          {signedIn && <NotificationBell onOpen={(payload) => void openSharedItem(payload)} />}
          <ThemeToggle theme={props.theme} onTheme={props.onTheme} />
          {!signedIn && (
            <button className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white" onClick={() => setShowSignIn(true)}>
              Sign in
            </button>
          )}
        </div>
      </header>
      {actionError && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {actionError}
        </div>
      )}
      <div className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
        {showSignIn && !signedIn ? (
          <AuthScreen
            cloudConfigured={sync.cloudConfigured}
            theme={props.theme}
            onTheme={props.onTheme}
            initialMode="signin"
            onAuthed={(user) => {
              const next = { ...sync, user };
              setSync(next);
              props.onSession(next);
              setShowSignIn(false);
            }}
            onContinueLocal={() => setShowSignIn(false)}
          />
        ) : (
        <>
        {!tree && <DispatchLoaderOverlay size={160} />}
        <div className="flex w-12 flex-col items-center gap-2 border-r border-[var(--border)] bg-[var(--panel)] py-3 text-[10px] text-[var(--muted)]">
          <RailBtn label="API" active={rail === "api"} onClick={() => setRail("api")} />
          <RailBtn label="Env" active={rail === "env"} onClick={() => setRail("env")} />
          <RailBtn label="Hist" active={rail === "hist"} onClick={() => setRail("hist")} />
          <div className="mt-auto">
            <button
              title="Settings"
              onClick={() => setRail("settings")}
              className={`flex h-10 w-10 items-center justify-center rounded-md ${rail === "settings" ? "bg-[var(--canvas)] text-[var(--fg)]" : "hover:bg-[var(--canvas)]"}`}
            >
              <Settings size={16} />
            </button>
          </div>
        </div>
        {rail === "api" && (
          <PanelGroup direction="horizontal" className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <Panel defaultSize={22} minSize={14}>
              <Sidebar
                tree={tree}
                focus={focus}
                onOpen={open}
                onNewCollection={async () => {
                  if (!workspaceId) return;
                  try {
                    await invoke("workspace.createCollection", { workspaceId, name: "New collection" });
                    await load(workspaceId);
                  } catch (e) {
                    setActionError(e instanceof Error ? e.message : String(e));
                  }
                }}
                onNewFolder={async (collectionId, parentId) => {
                  if (!workspaceId) return;
                  try {
                    await invoke("workspace.createFolder", { workspaceId, collectionId, parentId, name: "Folder" });
                    await load(workspaceId);
                  } catch (e) {
                    setActionError(e instanceof Error ? e.message : String(e));
                  }
                }}
                onNewRequest={async (collectionId, folderId) => {
                  if (!workspaceId) return;
                  try {
                    const req = await invoke<RequestRecord>("workspace.createRequest", { workspaceId, collectionId, folderId, name: "New request" });
                    await load(workspaceId);
                    open(req);
                  } catch (e) {
                    setActionError(e instanceof Error ? e.message : String(e));
                  }
                }}
                onAction={onSidebarAction}
                onDrop={onDrop}
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
                remoteUpdated={Boolean(active?.remoteUpdated)}
                onReviewRemote={() => {
                  if (active?.latestRemote) setConflict({ draft: active.request, latest: active.latestRemote });
                }}
                workspaceId={workspaceId}
                environmentId={environmentId}
                environments={tree?.environments ?? []}
                onEnvironment={setEnvironmentId}
                authChain={authChain}
                onAddRequest={() => void addRequestHere()}
              />
            </Panel>
          </PanelGroup>
        )}
        {rail === "env" && (
          <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
            <EnvPanel workspaceId={workspaceId} tree={tree} environmentId={environmentId} onEnvironment={setEnvironmentId} onReload={async () => { if (workspaceId) await load(workspaceId); }} />
          </div>
        )}
        {rail === "hist" && (
          <div className="h-full min-h-0 min-w-0 flex-1 overflow-hidden">
            <HistoryPanel workspaceId={workspaceId} onOpen={open} />
          </div>
        )}
        {rail === "settings" && (
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <SettingsScreen
              session={sync}
              theme={props.theme}
              onTheme={props.onTheme}
              onSession={props.onSession}
              workspaceId={workspaceId}
              workspaceName={currentWorkspace?.name ?? null}
              canRenameWorkspace={Boolean(currentWorkspace?.mine)}
              onWorkspaceRenamed={() => void load(workspaceId ?? undefined)}
              onSignOut={() => void goLocal()}
            />
          </div>
        )}
        </>
        )}
      </div>
      <StatusBar sync={sync} />
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
        <ImportModal workspaceId={workspaceId} onClose={() => setImporter(false)} onImported={() => { setImporter(false); void load(workspaceId); }} />
      )}
      {rename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <form
            className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                if (rename.kind === "workspace") {
                  await invoke("workspace.renameWorkspace", { id: rename.id, name: renameValue });
                } else {
                  await invoke("workspace.rename", { type: rename.kind, id: rename.id, name: renameValue });
                }
                if (rename.kind === "request") {
                  const name = renameValue.trim();
                  setTabs((prev) => prev.map((t) => (t.id === rename.id ? { ...t, request: { ...t.request, name } } : t)));
                }
                setRename(null);
                if (workspaceId) await load(workspaceId);
              } catch (err) {
                setActionError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            <div className="text-sm font-medium">Rename {rename.kind}</div>
            <input
              className="mt-3 w-full rounded-md border border-[var(--border)] bg-[var(--canvas)] px-3 py-2 text-sm"
              value={renameValue}
              onChange={(e) => {
                const name = e.target.value;
                setRenameValue(name);
                if (rename.kind === "request") {
                  setTabs((prev) => prev.map((t) => (t.id === rename.id ? { ...t, request: { ...t.request, name } } : t)));
                }
              }}
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                type="button"
                className="rounded-md border border-[var(--border)] px-3 py-1.5"
                onClick={() => {
                  if (rename.kind === "request") {
                    setTabs((prev) => prev.map((t) => (t.id === rename.id ? { ...t, request: { ...t.request, name: rename.name } } : t)));
                  }
                  setRename(null);
                }}
              >
                Cancel
              </button>
              <button className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-white">Save</button>
            </div>
          </form>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title={`Delete ${confirm.kind}?`}
          body={`“${confirm.name}” will be removed from this workspace. This syncs for anyone with access.`}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            try {
              await invoke("workspace.delete", { type: confirm.kind, id: confirm.id });
              if (confirm.kind === "request") {
                setTabs((prev) => prev.filter((t) => t.id !== confirm.id));
                if (activeId === confirm.id) setActiveId(null);
              }
              setConfirm(null);
              if (workspaceId) await load(workspaceId);
            } catch (err) {
              setActionError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}
      {share && (
        <ShareModal
          signedIn={signedIn}
          target={share}
          onClose={() => setShare(null)}
        />
      )}
      {conflict && (
        <ConflictDialog
          draft={conflict.draft}
          latest={conflict.latest}
          deleted={conflict.deleted}
          onCancel={() => setConflict(null)}
          onUseLatest={() => {
            updateActive(conflict.latest, false);
            setTabs((prev) =>
              prev.map((t) => (t.id === conflict.latest.id ? { ...t, request: conflict.latest, dirty: false, remoteUpdated: false, latestRemote: undefined } : t))
            );
            setConflict(null);
          }}
          onReplaceMine={() => {
            void persistActive({ overwrite: true, expectedLatest: conflict.latest.version });
          }}
          onSaveAsNew={async () => {
            if (!workspaceId) return;
            try {
              const created = await invoke<RequestRecord>("workspace.createRequest", {
                workspaceId,
                collectionId: conflict.draft.collectionId,
                folderId: conflict.draft.folderId,
                name: `${conflict.draft.name} (copy)`
              });
              const saved = await invoke<SaveRequestResult>("workspace.saveRequest", {
                ...created,
                document: conflict.draft.document,
                request: { ...created, document: conflict.draft.document }
              });
              setConflict(null);
              if (saved.status === "saved") {
                setTabs((prev) => prev.map((t) => (t.id === conflict.draft.id ? { ...t, remoteUpdated: false } : t)));
                open(saved.request);
              } else {
                open(created);
              }
              await load(workspaceId);
            } catch (err) {
              setActionError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      )}
    </div>
  );
}

function RailBtn({ label, active, onClick }: { label: string; active?: boolean; onClick: () => void }) {
  return (
    <button title={label} onClick={onClick} className={`flex h-10 w-10 items-center justify-center rounded-md ${active ? "bg-[var(--canvas)] font-medium text-[var(--fg)]" : "hover:bg-[var(--canvas)]"}`}>
      {label}
    </button>
  );
}
