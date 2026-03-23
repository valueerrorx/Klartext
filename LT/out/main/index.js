"use strict";
const electron = require("electron");
const path = require("path");
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      spellcheck: false
    }
  });
  electron.Menu.setApplicationMenu(null);
  if (process.env.NODE_ENV === "development") {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(createWindow);
electron.app.on("window-all-closed", () => electron.app.quit());
