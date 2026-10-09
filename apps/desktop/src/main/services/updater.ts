import { app, BrowserWindow } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready"; version: string }
  | { state: "up-to-date" }
  | { state: "error"; message: string };

let status: UpdateStatus = { state: "idle" };
let pendingVersion = "";
let started = false;
let checkTimer: ReturnType<typeof setInterval> | null = null;

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function emit(next: UpdateStatus) {
  status = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("update.status", status);
  }
}

export function updateStatus(): UpdateStatus {
  return status;
}

export function currentVersion(): string {
  return app.getVersion();
}

/** Updates only run inside an installed build. `pnpm dev` never checks. */
export function updatesSupported(): boolean {
  return app.isPackaged;
}

export function startAutoUpdater() {
  if (started || !updatesSupported()) return;
  started = true;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m: unknown) => console.log("[updater]", m),
    warn: (m: unknown) => console.warn("[updater]", m),
    error: (m: unknown) => console.error("[updater]", m),
    debug: (m: unknown) => console.debug("[updater]", m)
  };

  autoUpdater.on("checking-for-update", () => emit({ state: "checking" }));
  autoUpdater.on("update-available", (info) => {
    pendingVersion = info.version;
    emit({ state: "available", version: info.version });
  });
  autoUpdater.on("update-not-available", () => emit({ state: "up-to-date" }));
  autoUpdater.on("download-progress", (p) => emit({ state: "downloading", version: pendingVersion, percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => emit({ state: "ready", version: info.version }));
  autoUpdater.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[updater] failed", message);
    emit({ state: "error", message });
  });

  // Give the window a moment to appear before hitting the network.
  setTimeout(() => void checkForUpdates(), 5000);
  checkTimer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
  app.on("before-quit", () => {
    if (checkTimer) clearInterval(checkTimer);
  });
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!updatesSupported()) return status;
  if (status.state === "downloading" || status.state === "ready") return status;
  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ state: "error", message });
  }
  return status;
}

export function installUpdate() {
  if (status.state !== "ready") throw new Error("No update has been downloaded yet.");
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { installing: true };
}
