# 璇玑 (Xuanji) 项目结构说明

## 📋 项目概览

**璇玑 (Xuanji)** 是一个开源的 AI 助手项目，支持**三种运行模式**：
- 🖥️ **CLI 模式**: 终端交互式应用
- 🪟 **GUI 模式**: Electron 桌面应用
- 🤖 **IM Bot 模式**: 即时通讯机器人（钉钉、飞书、企业微信）

---

## 🏗️ 整体架构

项目采用**三层架构**设计：

```
┌─────────────────────────────────────────────────────┐
│              Adapters (适配器层)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │   CLI    │  │   GUI    │  │  IM Bot  │          │
│  │  (Ink)   │  │(Electron)│  │ (钉钉等) │          │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
└───────┼─────────────┼─────────────┼────────────────┘
        │             │             │
┌───────┴─────────────┴─────────────┴────────────────┐
│                Core (核心层)                         │
│  • Agent (对话循环)                                  │
│  • Chat (会话管理)                                   │
│  • Providers (LLM 适配)                             │
│  • Tools (工具系统)                                  │
│  • Config (配置管理)                                 │
│  • Skills (技能系统)                                 │
│  • i18n (国际化)                                     │
└─────────────────────────────────────────────────────┘
```

---

## 📁 目录结构详解

### 根目录

```
xuanji/
├── src/                     # 源代码目录
├── dist/                    # 编译输出目录
├── test/                    # 测试文件目录
├── node_modules/            # 依赖包
├── .xuanji/                 # 项目级配置目录
├── scripts/                 # 构建脚本
├── coverage/                # 测试覆盖率报告
├── package.json             # 项目配置
├── tsconfig.json            # TypeScript 配置
├── vitest.config.ts         # 测试配置
└── *.md                     # 文档文件
```

### src/ 源代码结构

```
src/
├── index.ts                 # 🚀 主入口文件
│
├── core/                    # 🧠 核心业务逻辑层
│   ├── agent/              # Agent 对话循环
│   │   ├── AgentLoop.ts    # 主循环控制
│   │   ├── StreamProcessor.ts   # 流式处理
│   │   ├── MessageManager.ts    # 消息管理
│   │   ├── ToolDispatcher.ts    # 工具调度
│   │   ├── TokenManager.ts      # Token 管理
│   │   ├── CostTracker.ts       # 费用追踪
│   │   └── ErrorRecovery.ts     # 错误恢复
│   │
│   ├── chat/               # 聊天会话
│   │   └── ChatSession.ts  # 会话管理
│   │
│   ├── providers/          # LLM 提供商适配
│   │   ├── LLMProvider.ts       # 抽象接口
│   │   ├── AnthropicProvider.ts # Claude API
│   │   ├── OpenAIProvider.ts    # OpenAI API
│   │   ├── ProviderFactory.ts   # 工厂模式
│   │   ├── StreamEvent.ts       # 流事件定义
│   │   └── RetryPolicy.ts       # 重试策略
│   │
│   ├── tools/              # 工具系统
│   │   ├── BaseTool.ts     # 工具基类
│   │   ├── ToolRegistry.ts # 工具注册表
│   │   ├── ReadTool.ts     # 读文件
│   │   ├── WriteTool.ts    # 写文件
│   │   ├── EditTool.ts     # 编辑文件
│   │   └── BashTool.ts     # 执行命令
│   │
│   ├── config/             # 配置管理
│   │   ├── ConfigLoader.ts      # 配置加载器
│   │   ├── GlobalConfig.ts      # 全局配置
│   │   ├── ProjectConfig.ts     # 项目配置
│   │   ├── EnvConfig.ts         # 环境变量
│   │   └── defaults.ts          # 默认配置
│   │
│   ├── skills/             # 技能系统
│   │   ├── registry.ts     # 技能注册表
│   │   ├── loader.ts       # 技能加载器
│   │   ├── validator.ts    # 技能验证
│   │   ├── types.ts        # 类型定义
│   │   └── builtin/        # 内置技能
│   │       ├── agents/     # Agent 配置
│   │       └── prompts/    # 提示词模板
│   │
│   ├── i18n/               # 国际化
│   │   ├── messages.ts     # 翻译字符串
│   │   └── index.ts        # i18n 接口
│   │
│   └── types/              # 核心类型定义
│       ├── agent.ts
│       ├── provider.ts
│       ├── config.ts
│       ├── tools.ts
│       └── index.ts
│
├── adapters/               # 🔌 适配器层
│   ├── cli/               # 终端 CLI (Ink React)
│   │   ├── App.tsx        # 主应用组件
│   │   ├── InputHandler.tsx     # 输入处理
│   │   ├── StatusBar.tsx        # 状态栏
│   │   ├── ToolDisplay.tsx      # 工具显示
│   │   ├── Spinner.tsx          # 加载动画
│   │   ├── BotsMode.tsx         # 机器人管理
│   │   ├── LogsMode.tsx         # 日志查看
│   │   ├── SlashCommands.ts     # 命令处理
│   │   ├── Theme.ts             # 主题配置
│   │   ├── settings/            # 设置界面
│   │   │   ├── SettingsMode.tsx
│   │   │   ├── ConfigEditor.tsx
│   │   │   ├── ModelSelector.tsx
│   │   │   └── ThemeSelector.tsx
│   │   ├── components/          # 可复用组件
│   │   │   └── ModelBadge.tsx
│   │   └── utils/               # 工具类
│   │       ├── ConfigManager.ts
│   │       ├── LogSystem.ts
│   │       └── ThemeManager.ts
│   │
│   ├── electron/          # 桌面 GUI (Electron)
│   │   ├── main.ts        # 主进程
│   │   ├── preload.ts     # 预加载脚本
│   │   ├── index.ts       # 入口
│   │   ├── electron-builder.config.js   # 打包配置
│   │   └── ui/            # 前端界面 (原生 HTML/CSS/JS)
│   │       ├── index.html
│   │       ├── styles.css
│   │       ├── script.js
│   │       ├── settings.html
│   │       ├── settings.js
│   │       └── lib/
│   │           └── i18n.js     # GUI 国际化
│   │
│   └── im/                # IM 机器人适配器
│       ├── IMAdapter.ts        # 适配器接口
│       ├── DingtalkBot.ts      # 钉钉机器人
│       ├── FeishuBot.ts        # 飞书机器人
│       ├── WecomBot.ts         # 企业微信机器人
│       ├── MessageFormatter.ts # 消息格式化
│       └── index.ts
│
├── tools/                  # 🔧 (向后兼容的工具别名)
├── types/                  # 📝 (向后兼容的类型别名)
├── providers/              # 🤖 (向后兼容的 Provider 别名)
├── config/                 # ⚙️ (向后兼容的配置别名)
├── agent/                  # 🤖 (向后兼容的 Agent 别名)
├── cli/                    # 💻 (向后兼容的 CLI 别名)
│
├── context/                # 📚 上下文管理 (预留)
├── memory/                 # 🧠 记忆系统 (预留)
├── permission/             # 🔐 权限管理 (预留)
├── mcp/                    # 🔗 MCP 协议支持 (预留)
└── telemetry/              # 📊 遥测数据 (预留)
```

---

## 🎯 核心模块说明

### 1. src/index.ts - 主入口

负责解析命令行参数，根据模式启动不同的适配器：

```typescript
// CLI 交互模式
xuanji
npm run dev

// CLI 非交互模式
xuanji "你的问题"
npm run dev "你的问题"

// GUI 桌面模式
xuanji gui
npm run dev:gui

// IM Bot 模式
xuanji bot --dingtalk
npm run dev:bot
```

### 2. src/core/ - 核心层

#### core/agent/ - Agent 对话循环

- **AgentLoop**: 核心对话循环，管理用户输入、AI 响应、工具调用的完整流程
- **StreamProcessor**: 处理流式响应，实时返回 AI 输出
- **MessageManager**: 管理对话历史、上下文窗口
- **ToolDispatcher**: 调度工具执行（bash、read、write、edit）
- **TokenManager**: 跟踪 token 使用量
- **CostTracker**: 计算 API 费用
- **ErrorRecovery**: 错误处理和重试机制

#### core/chat/ - 聊天会话

- **ChatSession**: 会话管理，封装 AgentLoop 和配置初始化

#### core/providers/ - LLM 提供商

支持多个 LLM 提供商，统一接口：

```typescript
interface LLMProvider {
  chat(messages: Message[], onEvent: (event: StreamEvent) => void): Promise<void>
}
```

- **AnthropicProvider**: Claude API (claude-3-5-sonnet 等)
- **OpenAIProvider**: OpenAI API (gpt-4, gpt-3.5-turbo 等)
- **ProviderFactory**: 根据配置自动创建对应的 Provider

#### core/tools/ - 工具系统

AI Agent 可以调用的工具集合：

| 工具 | 功能 | 示例 |
|------|------|------|
| `read_file` | 读取文件 | `read_file({ path: "src/index.ts" })` |
| `write_file` | 写入文件 | `write_file({ path: "output.txt", content: "..." })` |
| `edit_file` | 编辑文件 | `edit_file({ path: "file.ts", old_string: "...", new_string: "..." })` |
| `bash` | 执行命令 | `bash({ command: "ls -la" })` |

#### core/config/ - 配置管理

**三层配置系统**（优先级从高到低）：

1. **环境变量** (EnvConfig): `XUANJI_API_KEY`, `XUANJI_MODEL` 等
2. **项目配置** (ProjectConfig): `.xuanji/config.json`
3. **全局配置** (GlobalConfig): `~/.xuanji/config.json`

配置示例：

```json
{
  "provider": {
    "adapter": "anthropic",
    "model": "claude-sonnet-4-5-20250929",
    "apiKey": "sk-...",
    "baseURL": "https://api.anthropic.com"
  },
  "ui": {
    "theme": "dark",
    "language": "zh"
  },
  "bots": {
    "dingtalk": {
      "enabled": true,
      "appKey": "...",
      "appSecret": "..."
    }
  }
}
```

#### core/skills/ - 技能系统

可扩展的 Agent 技能框架：

- **registry**: 技能注册和管理
- **loader**: 从目录加载技能
- **validator**: 验证技能配置
- **builtin/**: 内置技能（agents、prompts）

#### core/i18n/ - 国际化

支持中英文双语：

```typescript
// messages.ts
export const messages = {
  zh: { 'chat.greeting': '你好' },
  en: { 'chat.greeting': 'Hello' }
}
```

### 3. src/adapters/ - 适配器层

#### adapters/cli/ - 终端 CLI

基于 **Ink** (React for CLI) 构建的交互式终端应用：

- 实时显示 AI 响应
- 支持斜杠命令 (`/help`, `/clear`, `/settings` 等)
- 彩色主题、状态栏、工具执行可视化
- 完整的设置管理界面

**关键组件**:
- `App.tsx`: 主应用组件，管理模式切换
- `InputHandler.tsx`: 处理用户输入
- `settings/SettingsMode.tsx`: 配置编辑界面
- `utils/ConfigManager.ts`: 配置读写

#### adapters/electron/ - 桌面 GUI

基于 **Electron** 的桌面应用：

- **main.ts**: 主进程，管理窗口、IPC 通信
- **preload.ts**: 预加载脚本，暴露安全的 IPC 接口给渲染进程
- **ui/**: 前端界面（原生 HTML/CSS/JS，未使用前端框架）

**IPC 架构**:

```
Renderer Process (UI)          Main Process
     ↓                              ↓
  preload.ts                    main.ts
     ↓                              ↓
window.XuanjiIPC.* ←→ ipcRenderer ←→ ipcMain ←→ ChatSession
```

**主要功能**:
- 聊天界面
- 设置页面
- 实时流式响应
- 工具执行日志
- 配置持久化

#### adapters/im/ - IM 机器人

支持企业 IM 平台的机器人适配器：

| 平台 | 协议 | 文件 |
|------|------|------|
| 钉钉 | WebSocket Stream | `DingtalkBot.ts` |
| 飞书 | WebSocket | `FeishuBot.ts` |
| 企业微信 | HTTP 回调 | `WecomBot.ts` |

**共同接口**:

```typescript
interface IMAdapter {
  start(session: ChatSession): Promise<void>
  stop(): Promise<void>
}
```

---

## 🚀 运行模式详解

### CLI 模式

```bash
# 交互式聊天
npm run dev

# 一次性提问
npm run dev "用 Python 写一个快速排序"

# 指定模型
npm run dev -- -m "gpt-4" "你的问题"
```

**支持的斜杠命令**:
- `/help` - 显示帮助
- `/clear` - 清空对话
- `/reset` - 重置会话
- `/cost` - 查看费用
- `/settings` - 配置管理
- `/logs` - 查看日志
- `/bots` - 机器人管理
- `/theme` - 切换主题
- `/lang` - 切换语言
- `/exit` - 退出

### GUI 模式

```bash
# 启动 GUI
npm run dev:gui

# 启动并打开开发者工具
npm run dev:gui -- --devtools
```

**功能**:
- 多标签聊天
- 实时流式响应
- 工具执行可视化
- 配置编辑器
- 主题切换

### IM Bot 模式

```bash
# 自动启动已配置的机器人
npm run dev:bot

# 启动指定平台
npm run dev:bot -- --dingtalk
npm run dev:bot -- --feishu
npm run dev:bot -- --wecom

# 后台运行（使用 pm2）
pm2 start xuanji -- bot --dingtalk
```

**配置方式**:
1. 在 `~/.xuanji/config.json` 中配置凭证
2. 使用环境变量 (`DINGTALK_APP_KEY` 等)
3. 命令行参数

---

## 🔧 开发工作流

### 构建和测试

```bash
# 安装依赖
npm install

# 开发模式运行
npm run dev           # CLI
npm run dev:gui       # GUI
npm run dev:bot       # Bot

# 构建
npm run build         # 构建所有
npm run build:cli     # 仅构建 CLI
npm run build:electron # 仅构建 Electron

# 打包应用
npm run dist          # 打包为可分发应用
npm run dist:mac      # macOS 应用
npm run dist:win      # Windows 应用

# 测试
npm test              # 运行测试
npm run test:watch    # 监听模式
npm run test:ui       # 可视化测试

# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 清理
npm run clean
```

### 添加新功能

**必须在三端都实现**（参考 `THREE_TIER_QUICK_REFERENCE.md`）：

1. **核心逻辑**: 在 `src/core/` 实现
2. **GUI 界面**: 在 `src/adapters/electron/ui/` 添加 UI
3. **CLI 组件**: 在 `src/adapters/cli/` 添加 Ink 组件
4. **国际化**: 在 `src/core/i18n/messages.ts` 添加翻译
5. **测试**: 三端都要手动测试

---

## 📝 配置文件位置

- **全局配置**: `~/.xuanji/config.json`
- **项目配置**: `.xuanji/config.json` (项目根目录)
- **日志文件**: `~/.xuanji/logs/YYYY-MM-DD.log`
- **环境变量**: `.env` 或系统环境变量

---

## 🎯 关键设计原则

1. **三层架构**: Core (核心) → Adapters (适配器) → UI (用户界面)
2. **统一接口**: 所有 LLM Provider 实现相同接口
3. **可扩展**: 工具、技能、Provider 都可扩展
4. **配置优先级**: 环境变量 > 项目配置 > 全局配置
5. **国际化优先**: 所有用户可见文本都要翻译
6. **三端一致**: 新功能必须在 CLI、GUI、Bot 三端都实现

---

## 📚 相关文档

- `CLAUDE.md` - 项目规范和开发约定
- `THREE_TIER_QUICK_REFERENCE.md` - 三端开发快速参考
- `IMPLEMENTATION_CHECKLIST.md` - 完整实现检查清单
- `DEVELOPMENT.md` - 开发指南
- `CONFIG_SHARING.md` - 配置共享机制

---

## 🤝 贡献指南

1. Fork 项目
2. 创建功能分支
3. 确保 `npm run typecheck` 通过
4. 在三端都测试功能
5. 提交 Pull Request

---

**最后更新**: 2025-02-23  
**项目地址**: https://github.com/shibit/xuanji  
**许可证**: MIT
