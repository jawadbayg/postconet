import { isCloudUser, type SessionInfo } from "../App";

function syncStatusLabel(state: string | undefined, signedInCloud: boolean) {
  if (!signedInCloud) return "Offline";
  if (state === "offline") return "Offline";
  if (state === "failed" || state === "conflicted") return "Sync failed";
  if (state === "syncing") return "Syncing";
  return "Synced";
}

export function StatusBar(props: { sync: SessionInfo }) {
  const signedIn = isCloudUser(props.sync.user);
  const hydrating = props.sync.hydration?.phase && props.sync.hydration.phase !== "Ready";
  const label = hydrating
    ? "Syncing"
    : syncStatusLabel(props.sync.state, Boolean(props.sync.cloudConfigured && signedIn));
  const tone =
    label === "Sync failed" ? "text-red-600" : label === "Syncing" ? "text-[var(--accent)]" : label === "Offline" ? "text-[var(--muted)]" : "text-emerald-700";
  return (
    <footer className="relative z-40 flex h-7 shrink-0 items-center border-t border-[var(--border)] bg-[var(--panel)] px-3 text-[11px] text-[var(--muted)]">
      <div className="flex items-center gap-3">
        <span>{signedIn ? props.sync.user?.email || props.sync.user?.displayName : "Local workspace"}</span>
        <span className={tone}>{label}</span>
        {props.sync.error && label === "Sync failed" && <span className="max-w-xs truncate">{props.sync.error}</span>}
      </div>
    </footer>
  );
}
