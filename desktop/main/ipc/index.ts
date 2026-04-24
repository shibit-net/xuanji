import { registerAuthIpcHandlers } from './auth.js';
import { registerModelsIpcHandlers } from './models.js';
import { registerWindowIpcHandlers } from './window.js';
import { registerAgentIpcHandlers } from './agent.js';
import { registerSettingsIpcHandlers } from './settings.js';
import { registerSessionIpcHandlers } from './session.js';
import { registerToolsIpcHandlers } from './tools.js';
import { registerPermissionIpcHandlers } from './permission.js';
import { registerLogsIpcHandlers } from './logs.js';
import { registerAdvancedIpcHandlers } from './advanced.js';
import { registerDownloadHandlers } from './download.js';

function registerAllIpcHandlers() {
  registerAuthIpcHandlers();
  registerModelsIpcHandlers();
  registerWindowIpcHandlers();
  registerAgentIpcHandlers();
  registerSettingsIpcHandlers();
  registerSessionIpcHandlers();
  registerToolsIpcHandlers();
  registerPermissionIpcHandlers();
  registerLogsIpcHandlers();
  registerAdvancedIpcHandlers();
  registerDownloadHandlers();
}

export { registerAllIpcHandlers };
