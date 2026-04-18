import { registerAuthIpcHandlers } from './auth.js';
import { registerModelsIpcHandlers } from './models.js';
import { registerWindowIpcHandlers } from './window.js';
import { registerAgentIpcHandlers } from './agent.js';
import { registerSettingsIpcHandlers } from './settings.js';
import { registerSessionIpcHandlers } from './session.js';
import { registerMemoryIpcHandlers } from './memory.js';
import { registerToolsIpcHandlers } from './tools.js';
import { registerPermissionIpcHandlers } from './permission.js';
import { registerLogsIpcHandlers } from './logs.js';
import { registerAdvancedIpcHandlers } from './advanced.js';

function registerAllIpcHandlers() {
  registerAuthIpcHandlers();
  registerModelsIpcHandlers();
  registerWindowIpcHandlers();
  registerAgentIpcHandlers();
  registerSettingsIpcHandlers();
  registerSessionIpcHandlers();
  registerMemoryIpcHandlers();
  registerToolsIpcHandlers();
  registerPermissionIpcHandlers();
  registerLogsIpcHandlers();
  registerAdvancedIpcHandlers();
}

export { registerAllIpcHandlers };
