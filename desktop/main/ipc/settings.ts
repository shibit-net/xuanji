import { ipcMain } from 'electron';
import { sendRequest, isSessionReady } from '../agent/index.js';

function registerSettingsIpcHandlers() {
  // 直接从磁盘读取用户配置，不依赖 session 初始化
  // 用于新用户引导流程：先判断是否有 fallbackProvider → 决定路由
  ipcMain.handle('settings:read-disk-config', async (_event, userId?: string) => {
    try {
      const path = require('node:path');
      const os = require('node:os');
      const fs = require('node:fs');
      const uid = userId || 'default';
      const configPath = path.join(os.homedir(), '.xuanji', 'users', uid, 'config.json');
      console.log(`[DIAG] read-disk-config: uid=${uid}, path=${configPath}, exists=${fs.existsSync(configPath)}`);
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(raw);
        console.log(`[DIAG] read-disk-config: found, has fallbackProvider=`, JSON.stringify(config.fallbackProvider));
        return { success: true, config };
      }
      return { success: false, error: '配置文件不存在' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('settings:get-config', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('get-config');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('settings:get-full-config', async () => {
    if (!isSessionReady()) {
      return { success: false, error: '会话未初始化' };
    }

    try {
      return await sendRequest('get-full-config');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });

  ipcMain.handle('settings:update-config', async (_event, data: any) => {
    try {
      // fallbackProvider 配置不依赖 session，直接写入磁盘
      if (data?.section === 'fallbackProvider') {
        const path = require('node:path');
        const os = require('node:os');
        const fs = require('node:fs/promises');
        const { existsSync, mkdirSync } = require('node:fs');
        // 优先使用传入的 userId，没有则用 default
        const uid = data.userId || 'default';
        const configPath = path.join(os.homedir(), '.xuanji', 'users', uid, 'config.json');
        console.log(`[DIAG] write fallbackProvider: uid=${uid}, path=${configPath}`);

        let diskConfig: Record<string, any> = {};
        try {
          const raw = await fs.readFile(configPath, 'utf-8');
          diskConfig = JSON.parse(raw);
        } catch {
          // 文件不存在，从空对象开始
        }

        // 写入 fallbackProvider 字段
        diskConfig.fallbackProvider = data.sectionData;

        const dir = path.dirname(configPath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        await fs.writeFile(configPath, JSON.stringify(diskConfig, null, 2), 'utf-8');
        console.log(`[DIAG] write fallbackProvider done, content:`, JSON.stringify(diskConfig.fallbackProvider));
        return { success: true };
      }

      // 其他配置 section 需要 session
      if (!isSessionReady()) {
        return { success: false, error: '会话未初始化' };
      }

      return await sendRequest('update-config', data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });
}

export { registerSettingsIpcHandlers };
