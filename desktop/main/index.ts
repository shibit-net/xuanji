import { app } from 'electron';
import { createWindow, getMainWindow } from './window/index.js';
import { initChatSession, cleanupAgentProcess, getIsCleaningUp, setIsCleaningUp } from './agent/index.js';
import { registerAllIpcHandlers } from './ipc/index.js';
import { loadAuthState, setAuthState } from './config/auth.js';

app.whenReady().then(async () => {
  const authState = await loadAuthState();
  setAuthState(authState);
  registerAllIpcHandlers();
  createWindow();
  // TODO: 会话初始化已移至用户登录后
  // await initChatSession();

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

let isCleaningUp = false;
app.on('before-quit', async (e) => {
  if (!getIsCleaningUp()) {
    e.preventDefault();
    setIsCleaningUp(true);
    console.log('[main] before-quit: starting cleanup...');
    await cleanupAgentProcess();
    console.log('[main] before-quit: cleanup finished, quitting app');
    setIsCleaningUp(false);
    app.quit();
  }
});
