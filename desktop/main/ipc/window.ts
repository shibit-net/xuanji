import { ipcMain, app } from 'electron';
import { minimizeWindow, maximizeWindow, closeWindow } from '../window/index.js';

function registerWindowIpcHandlers() {
  ipcMain.handle('app:version', () => {
    return app.getVersion();
  });

  ipcMain.on('window:minimize', () => {
    minimizeWindow();
  });

  ipcMain.on('window:maximize', () => {
    maximizeWindow();
  });

  ipcMain.on('window:close', () => {
    closeWindow();
  });
}

export { registerWindowIpcHandlers };
