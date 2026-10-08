import { app, BrowserWindow, Menu, session, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { CSP, DEV_CSP } from "./security/csp.js";
import { registerIpc } from "./ipc/register.js";
import { restoreSession } from "./services/cloud.js";
import { appBrand } from "./config.js";
import { openAccount } from "./services/studio.js";

app.setName(appBrand.productName);
app.setAppUserModelId(appBrand.appId);

if (process.env.NODE_ENV !== "development") {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: appBrand.productName,
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
  installCsp();
  registerIpc();
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
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
