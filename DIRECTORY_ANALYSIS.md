# 璇玑 (Xuanji) 目录结构深度分析

## 📊 总体概览

**璇玑 (Xuanji)** 是一个采用**三层架构**设计的开源 AI 助手项目，支持：
- 🖥️ **CLI 终端模式** (基于 Ink/React)
- 🪟 **GUI 桌面模式** (基于 Electron)
- 🤖 **IM Bot 模式** (钉钉/飞书/企业微信)

---

## 🏗️ 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│                    用户界面层 (UI)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   终端 CLI   │  │  桌面 GUI    │  │   IM Bot     │      │
│  │   (Ink)      │  │  (Electron)  │  │  (钉钉/飞书)  │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼──────────────────┼──────────────────┼─────────────┘
          │                  │                  │
┌─────────┴──────────────────┴──────────────────┴─────────────┐
│                    适配器层 (Adapters)                        │
│  • CLI 组件适配器 (src/adapters/cli)                         │
│  • Electron 适配器 (src/adapters/electron)                   │
│  • IM 平台适配器 (src/adapters/im)                           │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────┴───────────────────────────────────┐
│                    核心业务层 (Core)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Agent     │  │  Providers  │  │   Tools     │         │
│  │  (对话循环)  │  │ (LLM适配)   │  │  (工具系统)  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   Config    │  │   Skills    │  │    i18n     │         │
│  │  (配置管理)  │  │  (技能系统)  │  │  (国际化)    │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└──────────────────────────────────────────────────────────────┘
```

---

## 📁 完整目录树

### 根目录结构

```
xuanji/
├── 📂 src/                         # 源代码主目录
│   ├── 📂 core/                    # 核心业务逻辑层 ⭐
│   ├── 📂 adapters/                # 适配器层 ⭐
│   ├── 📂 context/                 # 上下文管理 (预留)
│   ├── 📂 memory/                  # 记忆系统 (预留)
│   ├── 📂 mcp/                     # MCP 协议 (预留)
│   ├── 📂 permission/              # 权限管理 (预留)
│   ├── 📂 telemetry/               # 遥测数据 (预留)
│   └── 📄 index.ts                 # 主入口文件 🚀
│
├── 📂 test/                        # 测试文件目录
│   ├── 📂 unit/                    # 单元测试
│   │   ├── agent/
│   │   ├── chat/
│   │   ├── cli/
│   │   ├── config/
│   │   ├── im/
│   │   ├── providers/
│   │   └── tools/
│   └── 📂 integration/             # 集成测试
│
├── 📂 dist/                        # 构建输出目录
│   ├── index.js                    # CLI 编译产物
│   └── 📂 electron/                # Electron 编译产物
│       ├── main.cjs
│       ├── preload.cjs
│       └── 📂 ui/                  # 前端静态资源
│
├── 📂 .xuanji/                     # 项目级配置目录
│   └── config.json                 # 项目配置文件
│
├── 📂 node_modules/                # NPM 依赖包
├── 📂 coverage/                    # 测试覆盖率报告
├── 📂 scripts/                     # 构建和部署脚本
│
├── 📄 package.json                 # 项目配置
├── 📄 tsconfig.json                # TypeScript 配置
├── 📄 vitest.config.ts             # 测试配置
│
└── 📄 *.md                         # 文档文件
    ├── README.md
    ├── PROJECT_STRUCTURE.md
    ├── CLAUDE.md
    ├── DEVELOPMENT.md
    └── ...
```

---

## 🧠 核心层详解 (src/core/)

### 目录结构

```
src/core/
├── 📂 agent/                       # Agent 对话循环系统
│   ├── AgentLoop.ts               # 🎯 核心对话循环控制器
│   ├── StreamProcessor.ts         # 📡 流式响应处理器
│   ├── MessageManager.ts          # 💬 消息历史管理器
│   ├── ToolDispatcher.ts          # 🔧 工具调度执行器
│   ├── TokenManager.ts            # 📊 Token 计数管理器
│   ├── CostTracker.ts             # 💰 API 费用追踪器
│   ├── ErrorRecovery.ts           # 🔄 错误恢复机制
│   └── index.ts                   # 导出接口
│
├── 📂 chat/                        # 聊天会话管理
│   ├── ChatSession.ts             # 📝 会话管理类
│   └── index.ts
│
├── 📂 providers/                   # LLM 提供商适配层
│   ├── LLMProvider.ts             # 🔌 抽象接口定义
│   ├── AnthropicProvider.ts       # 🤖 Claude API 实现
│   ├── OpenAIProvider.ts          # 🤖 OpenAI API 实现
│   ├── ProviderFactory.ts         # 🏭 工厂模式创建器
│   ├── StreamEvent.ts             # 📤 流事件类型定义
│   ├── RetryPolicy.ts             # 🔁 重试策略实现
│   └── index.ts
│
├── 📂 tools/                       # 工具系统
│   ├── BaseTool.ts                # 🔨 工具基类
│   ├── ToolRegistry.ts            # 📋 工具注册表
│   ├── ReadTool.ts                # 📖 读文件工具
│   ├── WriteTool.ts               # ✍️ 写文件工具
│   ├── EditTool.ts                # ✏️ 编辑文件工具
│   ├── BashTool.ts                # ⚡ Bash 命令工具
│   └── index.ts
│
├── 📂 config/                      # 配置管理系统
│   ├── ConfigLoader.ts            # 🔧 配置加载器
│   ├── GlobalConfig.ts            # 🌍 全局配置 (~/.xuanji/)
│   ├── ProjectConfig.ts           # 📁 项目配置 (.xuanji/)
│   ├── EnvConfig.ts               # 🌱 环境变量配置
│   ├── defaults.ts                # ⚙️ 默认配置常量
│   └── index.ts
│
├── 📂 skills/                      # 技能系统 (可扩展)
│   ├── registry.ts                # 📋 技能注册表
│   ├── loader.ts                  # 📥 技能加载器
│   ├── validator.ts               # ✅ 技能验证器
│   ├── types.ts                   # 📝 类型定义
│   ├── index.ts
│   └── 📂 builtin/                # 内置技能
│       ├── init.ts
│       ├── index.ts
│       ├── 📂 agents/             # Agent 配置
│       │   └── index.ts
│       └── 📂 prompts/            # 提示词模板
│           ├── index.ts
│           ├── xuanji-assistant.ts
│           └── other-skills.ts
│
├── 📂 i18n/                        # 国际化支持
│   ├── messages.ts                # 🌐 翻译字符串
│   └── index.ts                   # i18n 工具函数
│
└── 📂 types/                       # 核心类型定义
    ├── agent.ts                   # Agent 相关类型
    ├── provider.ts                # Provider 相关类型
    ├── config.ts                  # 配置相关类型
    ├── tools.ts                   # 工具相关类型
    └── index.ts                   # 统一导出
```

### 核心模块说明

#### 1. Agent 系统 (agent/)

**AgentLoop.ts** - 核心对话循环
```typescript
class AgentLoop {
  async processUserInput(message: string): Promise<void> {
    // 1. 添加用户消息到历史
    // 2. 调用 LLM Provider
    // 3. 处理流式响应
    // 4. 执行工具调用
    // 5. 继续循环直到完成
  }
}
```

**关键流程**:
```
用户输入 → MessageManager → LLM Provider → StreamProcessor
                                  ↓
                            Tool Calls?
                                  ↓
                         ToolDispatcher → 工具执行
                                  ↓
                         结果 → MessageManager
                                  ↓
                         继续循环 or 结束
```

#### 2. Provider 系统 (providers/)

**统一接口**:
```typescript
interface LLMProvider {
  chat(
    messages: Message[],
    onEvent: (event: StreamEvent) => void
  ): Promise<void>
}
```

**支持的 Provider**:
- `AnthropicProvider`: Claude (claude-3-5-sonnet 等)
- `OpenAIProvider`: GPT (gpt-4, gpt-3.5-turbo 等)

#### 3. Tools 系统 (tools/)

| 工具名 | 文件 | 功能描述 |
|--------|------|----------|
| `read_file` | ReadTool.ts | 读取文件内容，支持分页 |
| `write_file` | WriteTool.ts | 创建或覆盖文件 |
| `edit_file` | EditTool.ts | 精确字符串替换 |
| `bash` | BashTool.ts | 执行 shell 命令 |

#### 4. Config 系统 (config/)

**三层配置优先级**:
```
环境变量 (EnvConfig)
    ↓ (覆盖)
项目配置 (ProjectConfig) .xuanji/config.json
    ↓ (覆盖)
全局配置 (GlobalConfig) ~/.xuanji/config.json
```

#### 5. Skills 系统 (skills/)

可扩展的技能框架:
- Agent 预设配置
- 提示词模板
- 自定义工具集

---

## 🔌 适配器层详解 (src/adapters/)

### 目录结构

```
src/adapters/
├── 📂 cli/                         # 终端 CLI 适配器
│   ├── 📄 index.ts                # CLI 主入口
│   ├── 📄 App.tsx                 # 🖥️ 主应用组件
│   ├── 📄 InputHandler.tsx        # ⌨️ 输入处理组件
│   ├── 📄 StatusBar.tsx           # 📊 状态栏组件
│   ├── 📄 ToolDisplay.tsx         # 🔧 工具执行展示
│   ├── 📄 Spinner.tsx             # ⏳ 加载动画
│   ├── 📄 BotsMode.tsx            # 🤖 机器人管理界面
│   ├── 📄 LogsMode.tsx            # 📋 日志查看界面
│   ├── 📄 SlashCommands.ts        # 🔪 斜杠命令处理
│   ├── 📄 Theme.ts                # 🎨 主题配置
│   ├── 📄 types.ts                # 类型定义
│   │
│   ├── 📂 settings/               # ⚙️ 设置界面
│   │   ├── SettingsMode.tsx      # 设置主界面
│   │   ├── ConfigEditor.tsx      # 配置编辑器
│   │   ├── ModelSelector.tsx     # 模型选择器
│   │   └── ThemeSelector.tsx     # 主题选择器
│   │
│   ├── 📂 components/             # 📦 可复用组件
│   │   └── ModelBadge.tsx        # 模型徽章组件
│   │
│   └── 📂 utils/                  # 🔧 工具类
│       ├── ConfigManager.ts      # 配置管理工具
│       ├── LogSystem.ts          # 日志系统
│       ├── BotManager.ts         # 机器人管理
│       ├── MarkdownFormatter.ts  # Markdown 渲染
│       └── Debounce.ts           # 防抖工具
│
├── 📂 electron/                    # 桌面 GUI 适配器
│   ├── 📄 index.ts                # Electron 主入口
│   ├── 📄 main.ts                 # 🖥️ 主进程
│   ├── 📄 preload.ts              # 🔌 预加载脚本
│   ├── 📄 electron-builder.config.js  # 📦 打包配置
│   │
│   └── 📂 ui/                     # 🎨 前端界面 (原生 HTML/CSS/JS)
│       ├── 📄 index.html          # 主页面
│       ├── 📄 styles.css          # 全局样式
│       ├── 📄 app.js              # 主应用逻辑
│       ├── 📄 chat-panel.js       # 💬 聊天面板
│       ├── 📄 settings-panel.js   # ⚙️ 设置面板
│       ├── 📄 logs-panel.js       # 📋 日志面板
│       │
│       └── 📂 lib/                # 📚 前端库
│           ├── ipc-client.js     # IPC 通信封装
│           ├── formatter.js      # 格式化工具
│           ├── theme.js          # 主题管理
│           └── i18n.js           # GUI 国际化
│
└── 📂 im/                          # IM 机器人适配器
    ├── 📄 index.ts                # IM 主入口
    ├── 📄 IMAdapter.ts            # 🔌 适配器接口
    ├── 📄 DingtalkBot.ts          # 📱 钉钉机器人
    ├── 📄 FeishuBot.ts            # 📱 飞书机器人
    ├── 📄 WecomBot.ts             # 📱 企业微信机器人
    └── 📄 MessageFormatter.ts     # 💬 消息格式化
```

### 适配器模块说明

#### 1. CLI 适配器 (adapters/cli/)

**技术栈**: Ink (React for CLI)

**关键组件**:
- `App.tsx`: 主应用，管理模式切换 (chat/settings/logs/bots)
- `InputHandler.tsx`: 处理用户输入，支持多行、历史记录
- `StatusBar.tsx`: 显示模型、token、费用等信息
- `ToolDisplay.tsx`: 实时显示工具执行过程

**斜杠命令** (SlashCommands.ts):
```
/help       - 显示帮助
/clear      - 清空对话
/reset      - 重置会话
/cost       - 查看费用
/settings   - 配置管理
/logs       - 查看日志
/bots       - 机器人管理
/theme      - 切换主题
/lang       - 切换语言
/exit       - 退出程序
```

#### 2. Electron 适配器 (adapters/electron/)

**技术栈**: Electron + 原生 HTML/CSS/JS

**进程模型**:
```
主进程 (main.ts)
    ├── 创建窗口 (BrowserWindow)
    ├── 管理 ChatSession
    ├── 处理 IPC 通信 (ipcMain)
    └── 系统托盘、菜单等

渲染进程 (ui/)
    ├── index.html (主界面)
    ├── app.js (应用逻辑)
    └── 通过 preload.ts 暴露的 API 通信
```

**IPC 通信架构**:
```typescript
// preload.ts 暴露安全的 API
window.XuanjiIPC = {
  sendMessage: (msg: string) => ipcRenderer.invoke('send-message', msg),
  onResponse: (cb) => ipcRenderer.on('ai-response', cb),
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (cfg) => ipcRenderer.invoke('set-config', cfg)
}
```

#### 3. IM 适配器 (adapters/im/)

**统一接口**:
```typescript
interface IMAdapter {
  start(session: ChatSession): Promise<void>
  stop(): Promise<void>
}
```

**平台差异**:

| 平台 | 协议 | 认证方式 | 推送方式 |
|------|------|----------|----------|
| 钉钉 | WebSocket Stream | AppKey + AppSecret | 长连接 |
| 飞书 | WebSocket | AppID + AppSecret | 长连接 |
| 企业微信 | HTTP 回调 | Token + EncodingAESKey | HTTP POST |

---

## 🧪 测试目录详解 (test/)

```
test/
├── 📂 unit/                        # 单元测试
│   ├── agent/                     # Agent 相关测试
│   ├── chat/                      # Chat 相关测试
│   ├── cli/                       # CLI 组件测试
│   ├── config/                    # 配置系统测试
│   ├── im/                        # IM 适配器测试
│   ├── providers/                 # Provider 测试
│   └── tools/                     # 工具测试
│
└── 📂 integration/                 # 集成测试
    └── (端到端测试)
```

**测试命令**:
```bash
npm test              # 运行所有测试
npm run test:watch    # 监听模式
npm run test:unit     # 仅单元测试
npm run test:ui       # 可视化测试界面
```

---

## 🔧 配置文件说明

### 用户配置文件位置

```
~/.xuanji/                          # 全局配置目录
├── config.json                    # 全局配置文件
└── logs/                          # 日志目录
    └── 2025-02-24.log             # 按日期分割的日志

项目目录/.xuanji/                   # 项目配置目录
└── config.json                    # 项目配置文件
```

### config.json 结构

```json
{
  "provider": {
    "adapter": "anthropic",           // 或 "openai"
    "model": "claude-sonnet-4-5",
    "apiKey": "sk-...",
    "baseURL": "https://api.anthropic.com",
    "maxTokens": 8192,
    "temperature": 0.7
  },
  "ui": {
    "theme": "dark",                  // "dark" | "light"
    "language": "zh"                  // "zh" | "en"
  },
  "bots": {
    "dingtalk": {
      "enabled": true,
      "appKey": "...",
      "appSecret": "...",
      "port": 8000
    },
    "feishu": {
      "enabled": false,
      "appId": "...",
      "appSecret": "..."
    },
    "wecom": {
      "enabled": false,
      "token": "...",
      "encodingAESKey": "..."
    }
  }
}
```

---

## 📦 构建产物 (dist/)

```
dist/
├── 📄 index.js                     # CLI 主入口 (ESM)
├── 📄 *.js                         # 其他编译后的模块
│
└── 📂 electron/                    # Electron 构建产物
    ├── 📄 main.cjs                # 主进程 (CommonJS)
    ├── 📄 preload.cjs             # 预加载脚本 (CommonJS)
    │
    └── 📂 ui/                      # 静态资源
        ├── index.html
        ├── styles.css
        ├── *.js
        └── lib/
```

---

## 🚀 运行流程分析

### 启动流程

#### CLI 模式
```
npm run dev
    ↓
tsx src/index.ts
    ↓
解析命令行参数
    ↓
加载配置 (ConfigLoader)
    ↓
创建 ChatSession
    ↓
启动 CLI 适配器 (Ink render)
    ↓
用户交互循环
```

#### GUI 模式
```
npm run dev:gui
    ↓
tsx src/index.ts gui
    ↓
启动 Electron 主进程
    ↓
创建 BrowserWindow
    ↓
加载 ui/index.html
    ↓
preload.ts 注入 API
    ↓
渲染进程通过 IPC 通信
```

#### Bot 模式
```
npm run dev:bot
    ↓
tsx src/index.ts bot
    ↓
读取配置中启用的 bot
    ↓
启动 IM 适配器 (DingtalkBot/FeishuBot/WecomBot)
    ↓
建立 WebSocket 连接或 HTTP 服务器
    ↓
监听消息事件
```

---

## 🎯 关键设计模式

### 1. 三层架构 (Three-Tier Architecture)

```
Adapters (适配器)
    ↓ 依赖
Core (核心业务)
    ↓ 不依赖
No external dependencies
```

**优点**:
- 业务逻辑与 UI 解耦
- 可以轻松添加新的适配器
- 核心逻辑可独立测试

### 2. 工厂模式 (Factory Pattern)

```typescript
// ProviderFactory.ts
class ProviderFactory {
  static create(config: Config): LLMProvider {
    switch (config.provider.adapter) {
      case 'anthropic': return new AnthropicProvider(config)
      case 'openai': return new OpenAIProvider(config)
    }
  }
}
```

### 3. 策略模式 (Strategy Pattern)

```typescript
// LLMProvider 是策略接口
interface LLMProvider {
  chat(messages, onEvent): Promise<void>
}

// 不同的实现是具体策略
class AnthropicProvider implements LLMProvider { ... }
class OpenAIProvider implements LLMProvider { ... }
```

### 4. 观察者模式 (Observer Pattern)

```typescript
// StreamProcessor 发射事件
onEvent({ type: 'text', content: '...' })
onEvent({ type: 'tool_call', name: 'read_file' })

// 适配器订阅事件
session.onEvent((event) => {
  if (event.type === 'text') renderText(event.content)
})
```

---

## 📊 依赖关系图

```
index.ts (主入口)
    ↓
┌───┴────┬─────────┬─────────┐
│        │         │         │
CLI    Electron    IM       
Adapter Adapter   Adapter   
    ↓        ↓         ↓
    └────────┴─────────┘
             ↓
        ChatSession
             ↓
    ┌────────┴────────┐
    ↓                 ↓
AgentLoop      ConfigLoader
    ↓                 ↓
┌───┴───┬─────┬──────┘
│       │     │
LLM    Tools Config
Provider      System
```

---

## 🔄 数据流动

### 用户消息处理流程

```
用户输入
    ↓
Adapter (CLI/GUI/Bot)
    ↓
ChatSession.sendMessage()
    ↓
AgentLoop.processUserInput()
    ↓
MessageManager.addMessage()
    ↓
LLMProvider.chat()
    ↓
StreamProcessor.processEvent()
    ↓ (流式返回)
Adapter (实时显示)
    ↓ (遇到 tool_call)
ToolDispatcher.executeTool()
    ↓
Tool (ReadTool/WriteTool/BashTool)
    ↓
返回工具结果
    ↓
继续 LLM 调用
    ↓
完成响应
```

---

## 🎨 主题系统

### CLI 主题 (adapters/cli/Theme.ts)

```typescript
export const themes = {
  dark: {
    primary: chalk.cyan,
    secondary: chalk.blue,
    success: chalk.green,
    error: chalk.red,
    warning: chalk.yellow
  },
  light: { ... }
}
```

### GUI 主题 (adapters/electron/ui/lib/theme.js)

```css
[data-theme="dark"] {
  --bg-primary: #1a1a1a;
  --text-primary: #ffffff;
  --accent: #00d4ff;
}

[data-theme="light"] {
  --bg-primary: #ffffff;
  --text-primary: #000000;
  --accent: #0066cc;
}
```

---

## 🌐 国际化系统

### 核心 i18n (core/i18n/messages.ts)

```typescript
export const messages = {
  zh: {
    'chat.greeting': '你好！我是璇玑 AI 助手。',
    'error.network': '网络错误',
    // ...
  },
  en: {
    'chat.greeting': 'Hello! I am Xuanji AI Assistant.',
    'error.network': 'Network error',
    // ...
  }
}
```

### GUI i18n (adapters/electron/ui/lib/i18n.js)

```javascript
const i18n = {
  zh: { 'button.send': '发送' },
  en: { 'button.send': 'Send' }
}
```

---

## 📝 文件命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 组件 | PascalCase | `StatusBar.tsx`, `InputHandler.tsx` |
| 类 | PascalCase | `AgentLoop.ts`, `ChatSession.ts` |
| 工具函数 | camelCase | `utils/formatMessage.ts` |
| 类型定义 | PascalCase | `types/agent.ts` → `AgentConfig` |
| 常量 | UPPER_SNAKE_CASE | `defaults.ts` → `DEFAULT_MODEL` |

---

## 🔐 安全考虑

1. **API Key 存储**: 仅存储在本地配置文件，不上传
2. **Electron preload**: 使用 contextIsolation 隔离渲染进程
3. **工具执行**: BashTool 需要用户确认敏感命令
4. **IM Bot**: 验证签名，防止伪造消息

---

## 🚧 预留扩展点

以下目录已预留，但尚未实现：

- `src/context/`: 上下文管理 (RAG、向量数据库)
- `src/memory/`: 长期记忆系统
- `src/permission/`: 权限控制系统
- `src/mcp/`: Model Context Protocol 支持
- `src/telemetry/`: 遥测和分析

---

## 🎓 学习路径建议

### 新手入门顺序

1. **阅读文档**: 
   - `PROJECT_STRUCTURE.md` (本文件)
   - `CLAUDE.md` (开发规范)
   - `THREE_TIER_QUICK_REFERENCE.md` (三端开发)

2. **运行项目**:
   ```bash
   npm install
   npm run dev          # 体验 CLI
   npm run dev:gui      # 体验 GUI
   ```

3. **理解核心流程**:
   - 查看 `src/index.ts` (入口逻辑)
   - 查看 `src/core/agent/AgentLoop.ts` (核心循环)
   - 查看 `src/core/chat/ChatSession.ts` (会话管理)

4. **探索适配器**:
   - CLI: `src/adapters/cli/App.tsx`
   - GUI: `src/adapters/electron/main.ts`
   - Bot: `src/adapters/im/DingtalkBot.ts`

5. **修改配置**:
   - 编辑 `~/.xuanji/config.json`
   - 尝试切换模型、主题、语言

6. **添加功能**:
   - 参考 `IMPLEMENTATION_CHECKLIST.md`
   - 在三端同步实现新功能

---

## 📚 相关文档索引

| 文档 | 用途 |
|------|------|
| `PROJECT_STRUCTURE.md` | 项目结构说明 (本文件) |
| `CLAUDE.md` | 开发规范和约定 |
| `THREE_TIER_QUICK_REFERENCE.md` | 三端开发快速参考 |
| `IMPLEMENTATION_CHECKLIST.md` | 功能实现检查清单 |
| `DEVELOPMENT.md` | 开发指南 |
| `CONFIG_SHARING.md` | 配置共享机制 |
| `FIXES.md` | Bug 修复记录 |

---

## 🤝 贡献指南

### 添加新功能的步骤

1. **设计核心逻辑** (`src/core/`)
2. **更新类型定义** (`src/core/types/`)
3. **实现 CLI 界面** (`src/adapters/cli/`)
4. **实现 GUI 界面** (`src/adapters/electron/ui/`)
5. **添加国际化** (`src/core/i18n/messages.ts`)
6. **编写测试** (`test/unit/`, `test/integration/`)
7. **更新文档** (README.md, 相关 .md 文件)
8. **三端测试** (CLI/GUI/Bot 都要验证)

---

## 🎉 总结

**璇玑 (Xuanji)** 的目录结构设计遵循以下原则：

✅ **清晰的分层**: Core → Adapters → UI  
✅ **高度模块化**: 每个模块职责单一  
✅ **易于扩展**: 工厂模式 + 策略模式  
✅ **多端支持**: CLI / GUI / Bot 三端统一  
✅ **配置灵活**: 环境变量 > 项目配置 > 全局配置  
✅ **国际化优先**: 中英文双语支持  

---

**最后更新**: 2025-02-24  
**项目地址**: https://github.com/shibit/xuanji  
**文档维护**: 请在修改目录结构后同步更新本文档
