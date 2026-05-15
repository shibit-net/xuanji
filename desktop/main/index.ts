import { app, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { createWindow, getMainWindow } from './window/index.js';
import { cleanupAgentProcess, getIsCleaningUp, setIsCleaningUp } from './agent/index.js';
import { registerAllIpcHandlers } from './ipc/index.js';
import { loadAuthState, setAuthState, setSessionExpiredHandler } from './config/auth.js';

// ─── DMG 自动复制到 /Applications ─────────────────────

/** 解析 .app 包路径（macOS） */
function getAppBundlePath(): string {
  const exePath = process.execPath;
  return path.dirname(path.dirname(path.dirname(exePath)));
}

/** 检测是否从 DMG 运行 */
function isRunningFromDMG(): boolean {
  return getAppBundlePath().startsWith('/Volumes/');
}

/** 静默复制应用到 /Applications 并重新启动 */
async function moveToApplications(): Promise<void> {
  const appBundlePath = getAppBundlePath();
  const appName = path.basename(appBundlePath);
  const targetPath = path.join('/Applications', appName);

  try {
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    fs.cpSync(appBundlePath, targetPath, { recursive: true });
    console.log('[Main] 已复制到 /Applications，重新启动...');

    // 重新从 /Applications 启动，detach 后立即退出当前实例
    const { spawn } = require('child_process');
    spawn('open', [targetPath], { detached: true, stdio: 'ignore' }).unref();
    app.quit();
  } catch (err: any) {
    dialog.showErrorBox('安装失败', `无法复制应用到应用程序文件夹：${err.message}\n\n请手动将 xuanji.app 拖入应用程序文件夹。`);
    // 安装失败时不退出，允许直接从 DMG 运行
  }
}

// ─── 全局异常捕获 ────────────────────────────────────

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
  // 从 DMG 运行 → 静默复制到 /Applications 并重新启动
  if (process.platform === 'darwin' && isRunningFromDMG()) {
    await moveToApplications();
    return; // 复制完成后退出，不继续初始化
  }

  const authState = await loadAuthState();
  setAuthState(authState);
  registerAllIpcHandlers();
  createWindow();

  // 注册 token 过期回调：通知 renderer 跳转登录页
  setSessionExpiredHandler(() => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:session-expired');
    }
  });

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
    try {
      await cleanupAgentProcess();
    } finally {
      app.quit();
    }
  }
});
