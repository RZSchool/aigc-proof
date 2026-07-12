import path from "node:path";

import { app, BrowserWindow, session } from "electron";

import { registerIpc } from "./ipc";
import { isAllowedNavigation, parseQaPort } from "./security";

const qaPort = parseQaPort(process.argv);
if (qaPort !== undefined) {
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", String(qaPort));
}

const developmentUrl = process.env.AIGC_PROOF_DEV_SERVER_URL;
const developmentOrigin = developmentUrl
  ? new URL(developmentUrl).origin
  : undefined;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1040,
    minHeight: 720,
    show: false,
    title: "AIGC-Proof Workbench 0.1.0",
    backgroundColor: "#f4f1ea",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: qaPort !== undefined || developmentUrl !== undefined,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (!isAllowedNavigation(target, developmentOrigin)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("did-finish-load", () => window.show());
  window.webContents.on("before-input-event", (event, input) => {
    if (developmentUrl === undefined && input.key === "F12")
      event.preventDefault();
  });
  window.webContents.on("will-prevent-unload", (event) =>
    event.preventDefault(),
  );

  if (developmentUrl) {
    void window.loadURL(developmentUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return window;
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedNavigation(details.url, developmentOrigin);
    callback({ cancel: !allowed });
  });
  const state = await registerIpc();
  if (!state.ok) {
    throw new Error(`${state.error.code}: ${state.error.message}`);
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
