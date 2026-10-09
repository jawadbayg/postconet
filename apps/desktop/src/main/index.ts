import { app, BrowserWindow, Menu, nativeImage, session, shell } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { CSP, DEV_CSP } from "./security/csp.js";
import { registerIpc } from "./ipc/register.js";
import { acceptPendingInvites, restoreSession, startSyncRuntime } from "./services/cloud.js";
import { appBrand } from "./config.js";
import { openAccount } from "./services/studio.js";
import { startAutoUpdater } from "./services/updater.js";

if (process.defaultApp) {
  app.setAsDefaultProtocolClient("postconet", process.execPath, process.argv[1] ? [process.argv[1]] : []);
} else {
  app.setAsDefaultProtocolClient("postconet");
}

function handleDeepLink(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "invite" || parsed.pathname.includes("invite")) {
      const token = parsed.searchParams.get("token");
      if (token) void acceptPendingInvites(token).catch((error) => console.error("Invite accept failed", error));
    }
  } catch (error) {
    console.error("Deep link failed", error);
  }
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});
app.on("second-instance", (_e, argv) => {
  const url = argv.find((item) => item.startsWith("postconet://"));
  if (url) handleDeepLink(url);
});

app.setName(appBrand.productName);
app.setAppUserModelId(appBrand.appId);

if (process.env.NODE_ENV !== "development") {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

function resolveAppIconPath(): string | undefined {
  const candidates = [
    join(__dirname, "../../resources/icon.png"),
    join(__dirname, "../../resources/icon.icns"),
    join(process.resourcesPath, "icon.png"),
    join(process.resourcesPath, "icon.icns")
  ];
  return candidates.find((path) => existsSync(path));
}

function applyAppIcon(win: BrowserWindow) {
  const iconPath = resolveAppIconPath();
  if (!iconPath) return;
  const image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) return;
  win.setIcon(image);
  app.dock?.setIcon(image);
}

function createWindow() {
  const iconPath = resolveAppIconPath();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: appBrand.productName,
    icon: iconPath,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: "#f4f5f7",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  });
  applyAppIcon(win);

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https:") || url.startsWith("http:")) void shell.openExternal(url);
    return { action: "deny" };
  });

  const reveal = () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  };
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error("Renderer failed to load", { code, desc, url });
    reveal();
  });
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) console.error("Renderer:", message);
  });
  win.webContents.on("did-finish-load", () => {
    void win.webContents
      .executeJavaScript("document.body && document.body.innerText")
      .then((text) => console.log("Renderer text:", String(text).slice(0, 240)))
      .catch((error) => console.error("Renderer inspect failed", error))
      .finally(reveal);
  });
  win.once("ready-to-show", reveal);
  setTimeout(reveal, 800);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void win.loadURL(rendererUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function installCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [app.isPackaged ? CSP : DEV_CSP]
      }
    });
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac
        ? [
            {
              label: appBrand.productName,
              submenu: [
                { role: "about" as const },
                { type: "separator" as const },
                { role: "services" as const },
                { type: "separator" as const },
                { role: "hide" as const },
                { role: "hideOthers" as const },
                { role: "unhide" as const },
                { type: "separator" as const },
                { role: "quit" as const }
              ]
            }
          ]
        : []),
      {
        label: "File",
        submenu: [
          { label: "New Request", accelerator: "CmdOrCtrl+N", click: () => BrowserWindow.getFocusedWindow()?.webContents.send("menu", "new-request") },
          { label: "Import…", accelerator: "CmdOrCtrl+O", click: () => BrowserWindow.getFocusedWindow()?.webContents.send("menu", "import") },
          { type: "separator" },
          isMac ? { role: "close" } : { role: "quit" }
        ]
      },
      { role: "editMenu" },
      {
        label: "Request",
        submenu: [
          { label: "Send", accelerator: "CmdOrCtrl+Enter", click: () => BrowserWindow.getFocusedWindow()?.webContents.send("menu", "send") },
          { label: "Save", accelerator: "CmdOrCtrl+S", click: () => BrowserWindow.getFocusedWindow()?.webContents.send("menu", "save") }
        ]
      },
      {
        label: "View",
        submenu: [
          { label: "Command Palette", accelerator: "CmdOrCtrl+K", click: () => BrowserWindow.getFocusedWindow()?.webContents.send("menu", "palette") },
          { label: "Find in Response", accelerator: "CmdOrCtrl+F", click: () => BrowserWindow.getFocusedWindow()?.webContents.send("menu", "find") },
          { type: "separator" },
          { role: "toggleDevTools" },
          { role: "togglefullscreen" }
        ]
      },
      { role: "windowMenu" }
    ])
  );
}

app.whenReady().then(async () => {
  const readyIcon = resolveAppIconPath();
  if (readyIcon) {
    const image = nativeImage.createFromPath(readyIcon);
    if (!image.isEmpty()) app.dock?.setIcon(image);
  }
  installCsp();
  registerIpc();
  startSyncRuntime();
  buildMenu();
  try {
    await restoreSession();
  } catch (error) {
    console.error("Session restore failed, opening local workspace", error);
    try {
      openAccount("local");
    } catch (localError) {
      console.error("Local workspace failed", localError);
    }
  }
  createWindow();
  startAutoUpdater();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
