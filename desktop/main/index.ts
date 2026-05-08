import { app } from 'electron';
import { createWindow, getMainWindow } from './window/index.js';
import { cleanupAgentProcess, getIsCleaningUp, setIsCleaningUp } from './agent/index.js';
import { registerAllIpcHandlers } from './ipc/index.js';
import { loadAuthState, setAuthState } from './config/auth.js';

// 全局异常捕获 — 打包后看不到 console，写文件方便排查
process.on('uncaughtException', (err) => {
  const fs = require('fs');
  const path = require('path');
  const logPath = path.join(app.getPath('userData'), 'xuanji-crash.log');
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] UNCAUGHT: ${err.stack || err.message}\n`);
  } catch {}
  console.error('UNCAUGHT EXCEPTION:', err);
});

process.on('unhandledRejection', (reason) => {
  const fs = require('fs');
  const path = require('path');
  const logPath = path.join(app.getPath('userData'), 'xuanji-crash.log');
  try {
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason instanceof Error ? reason.stack : String(reason)}\n`);
  } catch {}
  console.error('UNHANDLED REJECTION:', reason);
});

app.whenReady().then(async () => {
  const authState = await loadAuthState();
  setAuthState(authState);
  registerAllIpcHandlers();
  createWindow();

  app.on('activate', () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async (e) => {
  if (!getIsCleaningUp()) {
    e.preventDefault();
    setIsCleaningUp(true);
    await cleanupAgentProcess();
    setIsCleaningUp(false);
    app.quit();
  }
});
