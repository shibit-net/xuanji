# Xuanji 三端配置共享系统

## 概述

Xuanji 实现了统一的配置管理，所有三个交互端点（CLI、IM 机器人、Electron GUI）共享同一个配置文件，避免重复配置。

## 配置文件位置

所有配置统一存储在：**`~/.xuanji/config.json`**

```json
{
  "apiKey": "sk-...",
  "model": "claude-haiku-4-5-20251001",
  "maxTokens": 4096,
  "baseURL": "https://shibit.net",
  "theme": "dark",
  "dingtalk": {
    "appKey": "xxx",
    "appSecret": "xxx"
  },
  "feishu": {
    "appId": "xxx",
    "appSecret": "xxx"
  },
  "wecom": {
    "corpId": "xxx",
    "secret": "xxx",
    "agentId": "xxx",
    "token": "32字符随机字符串",
    "encodingAESKey": "43字符随机字符串",
    "port": 9880
  }
}
```

## 三端工作流程

### 1. Electron GUI 配置设置面板

```
用户在 GUI 设置面板输入配置
        ↓
[保存配置] 按钮 → IPC: config.save()
        ↓
Electron 主进程 → writeConfig() → ~/.xuanji/config.json
        ↓
返回成功响应 → UI 显示 "配置已保存"
```

**核心代码流**：
- **UI**: `settings-panel.js` → `window.XuanjiIPC.config.save(settings)`
- **IPC 处理**: `main.ts` → `ipcMain.handle('config:save', ...)`
- **持久化**: `writeConfig()` → `fs.writeFileSync(configPath, ...)`

### 2. CLI 模式加载配置

```
xuanji 启动
        ↓
ConfigLoader.load()
        ↓
优先级加载:
  1. CLI 参数 (-m model 等)
  2. 环境变量 (XUANJI_API_KEY 等)
  3. ~/.xuanji/config.json
  4. 默认值
        ↓
创建 ChatSession
```

**配置读取代码**：
```typescript
// src/core/config/ConfigLoader.ts
const fileConfig = readFile('~/.xuanji/config.json');  // 从文件读取
const mergedConfig = { ...defaults, ...fileConfig, ...envConfig, ...cliArgs };
```

### 3. IM 机器人启动

```
GUI [钉钉机器人] → [启动] 按钮
        ↓
IPC: bot.start('dingtalk', config)
        ↓
Electron 主进程 → DingtalkBot.start(session)
        ↓
DingtalkBot 从 config 参数读取:
  - appKey, appSecret
  - 建立 WebSocket 连接到钉钉
        ↓
返回成功 → UI 显示 "运行中"
```

**IM 机器人配置读取**：
```typescript
// src/adapters/electron/main.ts
ipcMain.handle('bot:start', async (_event, botType, config) => {
  let bot;
  switch (botType) {
    case 'dingtalk':
      const { DingtalkBot } = await import('../im/DingtalkBot');
      bot = new DingtalkBot(config);  // 使用传入的 config
      break;
    // ...
  }
  await bot.start(session);
});
```

## 配置修改场景

### 场景 1：通过 GUI 修改 API Key

```
1. 打开 Electron GUI
2. 进入 [设置] 面板
3. 输入新的 API Key
4. 点击 [保存配置]
   ↓
   IPC: config.save() → ~/.xuanji/config.json
   ↓
5. 关闭 GUI
6. 运行 CLI 命令: xuanji -p "测试"
   ↓
   CLI 从 ~/.xuanji/config.json 读取新的 API Key
   ✓ 使用新配置成功调用 LLM
```

### 场景 2：通过 GUI 启动钉钉机器人

```
1. 打开 Electron GUI
2. 进入 [设置] 面板 → 钉钉机器人 → 输入 App Key/Secret
3. 点击 [保存配置] → 保存到 ~/.xuanji/config.json
4. 点击 [启动] → DingtalkBot 启动
   ↓
   WebSocket 连接钉钉
   ✓ 在群里 @钉钉机器人 可收到回复
```

### 场景 3：通过 CLI 启动钉钉机器人

```
1. 配置环境变量或编辑 ~/.xuanji/config.json:
   {
     "dingtalk": {
       "appKey": "xxx",
       "appSecret": "xxx"
     }
   }

2. 运行命令: xuanji bot --dingtalk
   ↓
   CLI 从 ~/.xuanji/config.json 读取钉钉配置
   DingtalkBot 启动
   ✓ 在群里 @钉钉机器人 可收到回复
```

### 场景 4：重置 GUI 配置

```
1. 打开 Electron GUI
2. 进入 [设置] 面板
3. 点击 [重置] 按钮
   ↓
   resetSettings() 构建默认配置对象
   IPC: config.save(defaultSettings)
   ↓
   ~/.xuanji/config.json 被重置为:
   {
     "apiKey": "",
     "model": "claude-haiku-4-5-20251001",
     "maxTokens": 4096,
     ...
   }
   ✓ UI 刷新为空/默认值
```

## 配置加载顺序（优先级）

### Electron GUI

```
系统默认值 (hardcoded)
       ↓
IPC: config.load() → ~/.xuanji/config.json
       ↓
渲染进程 UI 显示加载的配置
```

### CLI 命令行

```
系统默认值
       ↓
环境变量 (XUANJI_API_KEY, XUANJI_MODEL 等)
       ↓
~/.xuanji/config.json 文件配置
       ↓
CLI 参数 (-m model 等) [最高优先级]
```

### IM 机器人

```
系统默认值
       ↓
环境变量 (DINGTALK_APP_KEY 等)
       ↓
~/.xuanji/config.json 文件配置
       ↓
启动命令参数
```

## 配置文件结构详解

| 字段 | 类型 | 说明 | 来源 |
|------|------|------|------|
| `apiKey` | string | LLM API Key (sk-...) | GUI/环境变量/CLI |
| `model` | string | LLM 模型名称 | GUI/环境变量/CLI |
| `maxTokens` | number | LLM 最大输出 Token | GUI/环境变量 |
| `baseURL` | string | API 基础 URL | GUI/环境变量 |
| `theme` | string | UI 主题 (dark/light/auto) | GUI 设置 |
| `dingtalk.appKey` | string | 钉钉应用 App Key | GUI/环境变量 |
| `dingtalk.appSecret` | string | 钉钉应用 Secret | GUI/环境变量 |
| `feishu.appId` | string | 飞书应用 App ID | GUI/环境变量 |
| `feishu.appSecret` | string | 飞书应用 Secret | GUI/环境变量 |
| `wecom.corpId` | string | 企业微信 Corp ID | GUI/环境变量 |
| `wecom.secret` | string | 企业微信应用 Secret | GUI/环境变量 |
| `wecom.agentId` | string | 企业微信 Agent ID | GUI/环境变量 |
| `wecom.token` | string | 企业微信回调 Token (32 字符) | GUI 自动生成/手动输入 |
| `wecom.encodingAESKey` | string | 企业微信回调 AESKey (43 字符) | GUI 自动生成/手动输入 |
| `wecom.port` | number | 企业微信回调服务监听端口 | GUI/环境变量（默认 9880） |

## 环境变量映射

CLI 和 IM 机器人支持以下环境变量覆盖配置：

```bash
# LLM 配置
XUANJI_API_KEY=sk-...
XUANJI_MODEL=claude-sonnet-4-20250514
XUANJI_MAX_TOKENS=8000
XUANJI_BASE_URL=https://api.anthropic.com

# 钉钉机器人
DINGTALK_APP_KEY=xxx
DINGTALK_APP_SECRET=xxx

# 飞书机器人
FEISHU_APP_ID=xxx
FEISHU_APP_SECRET=xxx

# 企业微信机器人
WECOM_CORP_ID=xxx
WECOM_SECRET=xxx
WECOM_AGENT_ID=xxx
WECOM_TOKEN=xxxxx
WECOM_ENCODING_AES_KEY=xxxxx
WECOM_PORT=9880
```

## IPC 通信接口

### config.load()

**请求**：
```javascript
await window.XuanjiIPC.config.load()
```

**响应**：
```javascript
{
  success: true,
  data: {
    apiKey: "sk-...",
    model: "claude-haiku-4-5-20251001",
    // ...
  }
}
```

### config.save(config)

**请求**：
```javascript
await window.XuanjiIPC.config.save({
  apiKey: "sk-...",
  model: "claude-sonnet-4-20250514",
  // ...
})
```

**响应**：
```javascript
{
  success: true
}
```

## 文件实现

### Electron 主进程 (main.ts)

```typescript
// 配置文件路径
function getConfigPath(): string {
  return path.join(os.homedir(), '.xuanji', 'config.json');
}

// 读取配置
ipcMain.handle('config:load', async () => {
  const config = readConfig();
  return { success: true, data: config };
});

// 保存配置
ipcMain.handle('config:save', async (_event, config) => {
  writeConfig(config);
  return { success: true };
});
```

### Preload 脚本 (preload.ts)

```typescript
const xuanjiAPI = {
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config) => ipcRenderer.invoke('config:save', config),
  },
  // ...
};

contextBridge.exposeInMainWorld('xuanji', xuanjiAPI);
```

### 设置面板 (settings-panel.js)

```javascript
// 加载配置
async function loadSettings() {
  var result = await window.XuanjiIPC.config.load();
  if (result.success) {
    var settings = result.data || {};
    settingApiKey.value = settings.apiKey || '';
    // ...
  }
}

// 保存配置
async function saveSettings() {
  var settings = {
    apiKey: settingApiKey.value,
    model: settingModel.value,
    // ...
  };
  var result = await window.XuanjiIPC.config.save(settings);
}

// 重置配置
async function resetSettings() {
  var defaultSettings = { ... };
  var result = await window.XuanjiIPC.config.save(defaultSettings);
}
```

## 验证和测试

### 手动测试流程

```bash
# 1. 启动 Electron GUI
npm run dev:electron

# 2. 在 GUI 设置面板输入 API Key，点击保存
# 验证: ~/.xuanji/config.json 包含新的 API Key

# 3. 关闭 GUI，启动 CLI
xuanji -p "测试"
# 验证: CLI 能读取到 GUI 中设置的 API Key，成功调用 LLM

# 4. 重启 GUI，验证设置面板显示之前保存的配置
npm run dev:electron
# 验证: API Key 字段显示之前保存的值
```

### 自动化测试

所有配置共享功能已通过 `test/integration/electron-integration.test.ts` 验证：

```bash
npm test
# 测试项目:
# ✓ 配置加载/保存
# ✓ IPC 通信
# ✓ IM 机器人启停
# ✓ 253 个测试全部通过
```

## 常见问题

### Q: 为什么我在 GUI 中保存的配置在 CLI 中看不到？

**A**: 确保 ~/.xuanji/config.json 文件已被正确创建：
```bash
cat ~/.xuanji/config.json
# 应该看到 JSON 格式的配置内容
```

### Q: 能同时运行多个 Electron GUI 实例吗？

**A**: 可以，但配置会互相覆盖。多个实例会同时读写 ~/.xuanji/config.json，最后一个保存的配置将生效。

### Q: 环境变量优先级比配置文件高吗？

**A**: 在 CLI 中，优先级为：CLI 参数 > 环境变量 > ~/.xuanji/config.json > 默认值。

在 Electron GUI 中，IPC 直接读写 ~/.xuanji/config.json，不会受环境变量影响。

### Q: 如何在 CI/CD 中预设配置？

**A**: 可以在启动 Electron GUI 前创建 ~/.xuanji/config.json：
```bash
mkdir -p ~/.xuanji
cat > ~/.xuanji/config.json <<EOF
{
  "apiKey": "sk-test-key",
  "model": "claude-haiku-4-5-20251001",
  "dingtalk": { "appKey": "...", "appSecret": "..." }
}
EOF

npm run dev:electron
```

---

**状态**: ✅ 三端配置共享系统实现完成，所有 253 个测试通过。
