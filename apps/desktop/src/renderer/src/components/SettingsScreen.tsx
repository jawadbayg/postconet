import { useEffect, useState } from "react";
import { invoke } from "../lib/ipc";
import type { SessionInfo } from "../App";
import { AuthScreen } from "../screens/AuthScreen";
import { ConfirmDialog } from "./ConfirmDialog";
import { isCloudUser } from "../App";

type Settings = {
  timeoutMs: number;
  followRedirects: boolean;
  tlsVerify: boolean;
  historyEnabled: boolean;
  theme?: "light" | "dark";
};

export function SettingsScreen(props: {
  session: SessionInfo;
  theme: "light" | "dark";
  onTheme: (t: "light" | "dark") => void;
  onSession: (s: SessionInfo) => void;
  workspaceId: string | null;
  onSignOut: () => void;
}) {
  const [settings, setSettings] = useState<Settings>({ timeoutMs: 30000, followRedirects: true, tlsVerify: true, historyEnabled: true, theme: "light" });
  const [conflicts, setConflicts] = useState<unknown[]>([]);
  const signedIn = isCloudUser(props.session.user);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    void invoke<Settings>("settings.get").then(setSettings).catch(() => undefined);
    if (props.workspaceId) void invoke<unknown[]>("sync.conflicts", { workspaceId: props.workspaceId }).then(setConflicts).catch(() => setConflicts([]));
  }, [props.workspaceId]);

  async function save(next: Settings) {
    setSettings(next);
    await invoke("settings.set", next);
  }

  if (authMode && !signedIn) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <AuthScreen
        cloudConfigured={props.session.cloudConfigured}
        theme={props.theme}
        onTheme={props.onTheme}
        initialMode={authMode}
        onAuthed={(user) => props.onSession({ ...props.session, user })}
        onContinueLocal={() => setAuthMode(null)}
      />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
        </div>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <h2 className="text-sm font-medium">Account</h2>
          {signedIn ? (
            <div className="mt-3 space-y-2 text-sm">
              <div>{props.session.user?.displayName || "Signed in"}</div>
              <div className="text-[var(--muted)]">{props.session.user?.email}</div>
              <button className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs" onClick={() => setConfirmLogout(true)}>
                Log out
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2 text-sm">
              <p className="text-[var(--muted)]">You’re in offline mode.</p>
              <div className="flex gap-2">
                <button className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs text-white" onClick={() => setAuthMode("signin")}>
                  Log in
                </button>
                <button className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs" onClick={() => setAuthMode("signup")}>
                  Sign up
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <h2 className="text-sm font-medium">Appearance</h2>
          <button
            className="mt-3 rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
            onClick={() => {
              const next = props.theme === "dark" ? "light" : "dark";
              props.onTheme(next);
              void save({ ...settings, theme: next });
            }}
          >
            Use {props.theme === "dark" ? "light" : "dark"} theme
          </button>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
          <h2 className="text-sm font-medium">Request defaults</h2>
          <p className="text-xs text-[var(--muted)]">Applied to new requests. Existing requests keep their own timeout and TLS settings.</p>
          <label className="flex items-center justify-between text-xs">
            Timeout (ms)
            <input
              type="number"
              className="w-28 rounded border border-[var(--border)] bg-[var(--canvas)] px-2 py-1"
              value={settings.timeoutMs}
              onChange={(e) => void save({ ...settings, timeoutMs: Number(e.target.value) })}
            />
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={settings.followRedirects} onChange={(e) => void save({ ...settings, followRedirects: e.target.checked })} />
            Follow redirects
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={settings.tlsVerify} onChange={(e) => void save({ ...settings, tlsVerify: e.target.checked })} />
            Verify TLS
          </label>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
          <h2 className="text-sm font-medium">History</h2>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={settings.historyEnabled} onChange={(e) => void save({ ...settings, historyEnabled: e.target.checked })} />
            Save request history
          </label>
          <button
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
            onClick={async () => {
              if (!props.workspaceId) return;
              await invoke("history.clear", { workspaceId: props.workspaceId });
            }}
          >
            Clear history for this workspace
          </button>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-2 text-sm">
          <h2 className="text-sm font-medium">Synchronization</h2>
          <div className="text-xs text-[var(--muted)]">
            Status: {props.session.state ?? (props.session.cloudConfigured ? "idle" : "offline")}
            {typeof props.session.pending === "number" ? ` · ${props.session.pending} queued` : ""}
          </div>
          {props.session.hydration?.phase && <div className="text-xs text-[var(--muted)]">{props.session.hydration.phase}</div>}
          {conflicts.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              {conflicts.length} concurrent edit(s) need a choice in the open request (Use latest, Replace with mine, or Save as new).
            </div>
          )}
        </section>
      </div>
      {confirmLogout && (
        <ConfirmDialog
          title="Log out?"
          body="You’ll stay in offline mode on this Mac. Sign in again when you want to sync."
          confirmLabel="Log out"
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => {
            setConfirmLogout(false);
            props.onSignOut();
          }}
        />
      )}
    </div>
  );
}
