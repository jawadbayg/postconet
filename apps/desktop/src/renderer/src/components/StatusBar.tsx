import type { SessionInfo } from "../App";

export function StatusBar(props: { sync: SessionInfo; onSync: () => void; onSignOut: () => void }) {
  const label =
    props.sync.hydration?.phase && props.sync.hydration.phase !== "Ready"
      ? `${props.sync.hydration.phase}${props.sync.hydration.detail ? `: ${props.sync.hydration.detail}` : ""}`
      : props.sync.state ?? (props.sync.cloudConfigured ? "idle" : "local-only");
  return (
    <footer className="flex h-7 items-center justify-between border-t border-[var(--border)] bg-[var(--panel)] px-3 text-[11px] text-[var(--muted)]">
      <div className="flex items-center gap-3">
        <span>{props.sync.user?.email || "Local workspace"}</span>
        <button className="hover:text-[var(--fg)]" onClick={props.onSync}>
          Sync: {label}
        </button>
        {!props.sync.cloudConfigured && <span>Cloud not configured</span>}
      </div>
      <div className="flex items-center gap-3">
        <span>Private secrets stay local unless you share them</span>
        {props.sync.user?.id !== "local" && (
          <button className="hover:text-[var(--fg)]" onClick={props.onSignOut}>
            Sign out
          </button>
        )}
      </div>
    </footer>
  );
}
