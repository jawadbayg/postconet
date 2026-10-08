import type { SessionInfo } from "../App";

function syncStatusLabel(state: string | undefined, signedInCloud: boolean) {
  if (!signedInCloud) return "Offline";
  if (state === "offline") return "Offline";
  if (state === "failed") return "Sync failed";
  if (state === "syncing") return "Syncing";
  return "Synced";
}

export function StatusBar(props: { sync: SessionInfo; onSignOut: () => void }) {
  const hydrating = props.sync.hydration?.phase && props.sync.hydration.phase !== "Ready";
  const label = hydrating
    ? `${props.sync.hydration?.phase}${props.sync.hydration?.detail ? `: ${props.sync.hydration.detail}` : ""}`
    : syncStatusLabel(props.sync.state, Boolean(props.sync.cloudConfigured && props.sync.user && props.sync.user.id !== "local"));
  const tone =
    label === "Sync failed" ? "text-red-600" : label === "Syncing" ? "text-[var(--accent)]" : label === "Offline" ? "text-[var(--muted)]" : "text-emerald-700";
  return (
    <footer className="flex h-7 items-center justify-between border-t border-[var(--border)] bg-[var(--panel)] px-3 text-[11px] text-[var(--muted)]">
      <div className="flex items-center gap-3">
        <span>{props.sync.user?.email || "Local workspace"}</span>
        <span className={tone}>{label}</span>
        {typeof props.sync.pending === "number" && props.sync.pending > 0 && <span>{props.sync.pending} queued</span>}
        {props.sync.error && label === "Sync failed" && <span className="max-w-xs truncate">{props.sync.error}</span>}
      </div>
      <div className="flex items-center gap-3">
        {props.sync.user?.id !== "local" && (
          <button className="hover:text-[var(--fg)]" onClick={props.onSignOut}>
            Sign out
          </button>
        )}
      </div>
    </footer>
  );
}
