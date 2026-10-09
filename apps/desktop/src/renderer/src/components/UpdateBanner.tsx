import { useEffect, useState } from "react";
import { invoke } from "../lib/ipc";

type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "up-to-date" }
  | { state: "error"; message: string };

export function UpdateBanner() {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!window.postconet) return;
    void invoke<UpdateStatus>("update.status").then(setStatus).catch(() => undefined);
    return window.postconet.on("update.status", (payload) => setStatus(payload as UpdateStatus));
  }, []);

  if (status.state === "downloading") {
    return (
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--panel)] px-4 py-1.5 text-xs text-[var(--muted)]">
        <span>Downloading update {status.version}… {status.percent}%</span>
      </div>
    );
  }

  if (status.state !== "ready" || dismissed === status.version) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
      <span>Version {status.version} is ready to install.</span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          disabled={installing}
          className="rounded-md bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          onClick={() => {
            setInstalling(true);
            void invoke("update.install").catch(() => setInstalling(false));
          }}
        >
          {installing ? "Restarting…" : "Install and restart"}
        </button>
        <button type="button" className="rounded-md px-2 py-1 hover:bg-emerald-100 dark:hover:bg-emerald-900" onClick={() => setDismissed(status.version)}>
          Later
        </button>
      </span>
    </div>
  );
}
