import { registerAuthIpcHandlers } from './auth.js';
import { registerModelsIpcHandlers } from './models.js';
import { registerWindowIpcHandlers } from './window.js';
import { registerAgentIpcHandlers, registerSystemIpcHandlers } from './agent.js';
import { registerSettingsIpcHandlers } from './settings.js';
import { registerSessionIpcHandlers } from './session.js';
import { registerToolsIpcHandlers } from './tools.js';
import { registerPermissionIpcHandlers } from './permission.js';
import { registerLogsIpcHandlers } from './logs.js';
import { registerAdvancedIpcHandlers } from './advanced.js';
import { registerDownloadHandlers } from './download.js';

function registerAllIpcHandlers() {
  const safeRegister = (name: string, fn: () => void) => {
    try {
      fn();
    } catch (err) {
      console.error(`[IPC] Failed to register ${name} handlers:`, err);
    }
  };
  safeRegister('auth', registerAuthIpcHandlers);
  safeRegister('models', registerModelsIpcHandlers);
  safeRegister('window', registerWindowIpcHandlers);
  safeRegister('agent', registerAgentIpcHandlers);
  safeRegister('settings', registerSettingsIpcHandlers);
  safeRegister('session', registerSessionIpcHandlers);
  safeRegister('tools', registerToolsIpcHandlers);
  safeRegister('permission', registerPermissionIpcHandlers);
  safeRegister('logs', registerLogsIpcHandlers);
  safeRegister('advanced', registerAdvancedIpcHandlers);
  safeRegister('download', registerDownloadHandlers);
  safeRegister('system', registerSystemIpcHandlers);
}

export { registerAllIpcHandlers };
