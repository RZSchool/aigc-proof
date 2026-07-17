import path from "node:path";

import { HostContractError } from "@aigc-proof/host-contracts";
import { app, BrowserWindow, dialog, Menu, session } from "electron";

import { registerIpc, type RegisteredIpcRuntime } from "./ipc";
import { loadQaSelectionProvider } from "./qa-selections";
import { isAllowedNavigation, parseQaPort } from "./security";
import { UtilitySupervisor } from "./utility-supervisor";

const qaPort = parseQaPort(process.argv);
if (qaPort !== undefined) {
  app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
  app.commandLine.appendSwitch("remote-debugging-port", String(qaPort));
  const signerService = process.env.AIGC_PROOF_QA_SIGNER_SERVICE;
  if (
    !/^org\.aigcproof\.qa\.[A-Za-z0-9.-]{1,100}$/u.test(signerService ?? "")
  ) {
    throw new Error("QA signer service namespace is missing or invalid.");
  }
  process.env.AIGC_PROOF_TEST_SIGNER_ENABLED = "1";
  process.env.AIGC_PROOF_TEST_SIGNER_SERVICE = signerService;
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
    title: "AIGC-Proof Workbench 1.1.0",
    backgroundColor: "#f4f1ea",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: qaPort !== undefined || developmentUrl !== undefined,
      additionalArguments:
        qaPort !== undefined ? ["--aigc-proof-preload-qa"] : [],
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

let registeredRuntime: RegisteredIpcRuntime | undefined;
let allowingQuit = false;

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedNavigation(details.url, developmentOrigin);
    callback({ cancel: !allowed });
  });
  try {
    const utility = new UtilitySupervisor();
    const qaSelections = await loadQaSelectionProvider(
      process.argv,
      qaPort !== undefined,
    );
    registeredRuntime = await registerIpc(
      utility,
      qaSelections,
      qaPort !== undefined,
    );
    createWindow();
  } catch (error) {
    const code =
      error instanceof HostContractError
        ? error.code
        : "NATIVE_DISCOVERY_INVALID";
    const message =
      error instanceof Error
        ? error.message
        : "Native compatibility check failed.";
    dialog.showErrorBox(
      "AIGC-Proof compatibility check failed",
      `[${code}] ${message}\n\nProof operations were not registered.`,
    );
    app.exit(1);
    return;
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", (event) => {
  if (allowingQuit || !registeredRuntime) return;
  event.preventDefault();
  void registeredRuntime.close().finally(() => {
    allowingQuit = true;
    app.quit();
  });
});
