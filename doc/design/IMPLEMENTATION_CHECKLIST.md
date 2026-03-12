# 璇玑 (Xuanji) 两层实现检查清单

## 📋 核心原则：**必须在 GUI 和 CLI 都实现，IM Bot 自动继承**

❌ 错误做法: 只在 GUI 或只在 CLI 上实现新功能
✅ 正确做法: 在 **GUI + CLI** 都实现，IM Bot 会自动复用 CLI 的 ChatSession

**架构**:
- **GUI** (Electron): 独立的图形界面，自己的 i18n 和交互
- **CLI** (终端): 共享的核心逻辑和 i18n 系统，支持斜杠命令
- **IM Bot**: CLI 的另一种启动方式，直接调用 CLI 的 ChatSession，无需额外功能代码

新增功能 = GUI 实现 + CLI 实现（IM Bot 自动获得 CLI 的所有功能）

---

## 🎯 两层实现对应关系

### 例 1: 添加新命令 `/status`

**GUI 端**:
```javascript
// src/adapters/electron/ui/settings-panel.js
// 在设置面板中添加"Status"选项卡
// 显示会话状态信息（通过 IPC 调用 ChatSession 的方法）
```

**CLI 端**:
```typescript
// src/adapters/cli/App.tsx
case '/status':
  // 显示状态信息
  break;

// src/adapters/cli/SlashCommands.ts
'/status': '显示当前会话状态',
```

**IM Bot 端** (自动):
```typescript
// src/adapters/im/DingtalkBot.ts
// 当接收到 @机器人 /status 时
// 自动调用 ChatSession.run('/status')
// ChatSession 会处理该命令（和 CLI 相同）
```

---

### 例 2: 添加新配置项 `maxRetries`

**核心部分** (GUI + CLI + IM Bot 都用):
```typescript
// src/core/config/defaults.ts
export const DEFAULT_CONFIG: AppConfig = {
  retry: {
    maxRetries: 3,  // ← 新增
    // ...
  }
}

// src/core/types/config.ts
export interface RetryConfig {
  maxRetries: number;  // ← 新增类型
}
```

**GUI 端**:
```html
<!-- src/adapters/electron/ui/index.html -->
<label for="settingMaxRetries" data-i18n="gui.settings.max_retries">Max Retries</label>
<input type="number" id="settingMaxRetries">
```

```javascript
// src/adapters/electron/ui/settings-panel.js
settingMaxRetries.value = config.retry?.maxRetries || 3;
// 保存时:
config.retry.maxRetries = parseInt(settingMaxRetries.value);
```

**CLI 端**:
```typescript
// src/adapters/cli/settings/RetrySettings.tsx
<Text>{t('retry.max_retries')}</Text>
<input value={maxRetries} />
// 保存时更新配置
```

**IM Bot 端** (自动):
```typescript
// src/adapters/im/DingtalkBot.ts
// 从加载的配置中自动读取 maxRetries
const config = await configManager.load();
const maxRetries = config.retry?.maxRetries || 3;
// ChatSession 会使用该配置
```

---

## 📝 新功能实现完整检查清单

### 第一步：规划核心逻辑
- [ ] 定义功能的核心业务逻辑
- [ ] 添加类型定义到 `src/core/types/`
- [ ] 添加配置项到 `src/core/config/defaults.ts`
- [ ] 添加 i18n 字符串到 `src/core/i18n/messages.ts`（中英文）

### 第二步：GUI 端实现
- [ ] 添加 HTML 界面元素
- [ ] 添加 i18n 属性 (`data-i18n`)
- [ ] 实现交互逻辑 (JavaScript)
- [ ] 通过 IPC 与主进程通信
- [ ] 配置能保存到 `~/.xuanji/config.json`
- [ ] 在 GUI 上测试功能完整

### 第三步：CLI 端实现
- [ ] 添加 React 组件 (Ink)
- [ ] 添加命令处理 (如果是命令)
- [ ] 在 `SlashCommands.ts` 注册命令
- [ ] 所有字符串已国际化
- [ ] 配置能加载和保存
- [ ] 在 CLI 上测试功能完整

### 第四步：IM Bot 验证（自动）
- [ ] IM Bot 能启动且连接正常
- [ ] IM Bot 接收消息并能正确调用 ChatSession
- [ ] IM Bot 将 ChatSession 的响应转发回 IM 平台
- [ ] 日志信息正确记录

### 第五步：统一验证
- [ ] `npm run typecheck` 通过
- [ ] 所有 i18n key 都已翻译（中英文）
- [ ] GUI 端功能完整可用
- [ ] CLI 端功能完整可用
- [ ] IM Bot 能正确转发 CLI 的功能

---

## 🔄 功能矩阵：确保 GUI 和 CLI 都实现了

使用这个表格验证新功能是否在两端都实现了（IM Bot 会自动通过 ChatSession 获得 CLI 的功能）：

```
功能名称: _______________________

┌─────────────────┬──────┬──────────────────┐
│                 │ GUI  │ CLI & IM Bot     │
├─────────────────┼──────┼──────────────────┤
│ 界面/命令       │ [ ]  │ [ ]              │
│ 配置读写        │ [ ]  │ [ ]              │
│ i18n (中英文)   │ [ ]  │ [ ]              │
│ 错误处理        │ [ ]  │ [ ]              │
│ 功能测试        │ [ ]  │ [ ]              │
└─────────────────┴──────┴──────────────────┘

所有 GUI 和 CLI 复选框都勾选后，IM Bot 会自动工作！
```

---

## 💡 实现建议

### 1. 共享逻辑优先
```
核心逻辑 (src/core/)
    ↓
    ├→ GUI 适配 (IPC 通信)
    ├→ CLI 适配 (Ink 组件)
    └→ Bot 适配 (ChatSession)
```

### 2. 复用类型定义
```typescript
// ✅ 正确：定义一次，三端都用
export interface MyConfig {
  key: string;
}

// ❌ 错误：在各端分别定义
// GUI: interface MyConfigGUI { ... }
// CLI: interface MyConfigCLI { ... }
```

### 3. 统一 i18n
```typescript
// src/core/i18n/messages.ts (中英文都写)
'feature.title': '功能标题',
'feature.error': '功能错误',

// GUI 使用: window.XuanjiI18n.t('feature.title')
// CLI 使用: t('feature.title')
// Bot 使用: t('feature.title')
```

### 4. 分层实现顺序
1. **先实现核心逻辑** (最容易测试，所有端都用)
2. **再实现 CLI** (无 UI 依赖，最简单，会自动被 IM Bot 使用)
3. **再实现 GUI** (需要 IPC，UI 最复杂)
4. **验证 IM Bot** (会自动继承 CLI 的功能，无需新代码)

---

## 🚀 实现示例：添加 `/reset` 命令

### 步骤 1: 核心逻辑 (所有端共用)
```typescript
// src/core/chat/ChatSession.ts (已有)
public reset(): void {
  this.messages = [];
  this.state = { ... };
}
```

### 步骤 2: GUI 端
```html
<!-- src/adapters/electron/ui/index.html -->
<button id="resetBtn" data-i18n="gui.input.reset">Reset</button>
```

```javascript
// src/adapters/electron/ui/chat-panel.js
resetBtn.addEventListener('click', async function () {
  await window.XuanjiIPC.chat.reset();
  clearMessages();
  updateStatus({ tokenUsage: { input: 0, output: 0 }, cost: 0 });
});
```

### 步骤 3: CLI 端
```typescript
// src/adapters/cli/App.tsx
case '/reset':
  session?.reset();
  this.setState({ messages: [] });
  return;

// src/adapters/cli/SlashCommands.ts
'/reset': t('cmd.reset_desc'),  // '重置会话'
```

### 步骤 4: IM Bot 端 (自动)
```typescript
// src/index.ts (bot 启动时)
await session.init();  // ← ChatSession 已有 reset() 方法

// Bot 接收消息时（自动处理，无需额外代码）
// ChatSession 内部处理 reset 逻辑，Bot 直接返回响应
```

### 步骤 5: i18n
```typescript
// src/core/i18n/messages.ts
'cmd.reset': '/reset',
'cmd.reset_desc': '重置会话 (清空历史和 token 计数)',

// 对应英文
'cmd.reset': '/reset',
'cmd.reset_desc': 'Reset session (clear history and token count)',
```

### 步骤 6: 验证
```bash
npm run typecheck           # ✓ 通过

npm run dev                 # ✓ CLI: /reset 有效
npm run dev gui             # ✓ GUI: Reset 按钮有效
npm run dev -- bot          # ✓ Bot: 自动继承 /reset 功能
```

---

## ⚠️ 常见错误

| 错误 | 问题 | 解决 |
|------|------|------|
| 只在 GUI 实现 | CLI 缺少功能，IM Bot 无法自动继承 | 补充 CLI 实现 |
| 只在 CLI 实现 | GUI 缺少相应界面 | 补充 GUI 实现 |
| i18n 不完整 | 某端显示 key 而不是翻译 | 检查所有 messages.ts key |
| 类型不一致 | 两端数据格式不同 | 在 `src/core/types/` 统一定义 |
| 配置重复定义 | 维护困难，容易不同步 | 用共享的 defaults.ts |
| 忽视 IM Bot | 虽然 CLI 功能完整但 Bot 无法工作 | 确保 ChatSession 支持该功能 |

---

## 📊 实现进度追踪

新功能命名: `_______________________`

```
核心逻辑:     [ ] [ ] [ ] 开发中 完成
GUI 实现:     [ ] [ ] [ ] 开发中 完成
CLI 实现:     [ ] [ ] [ ] 开发中 完成
Bot 验证:     [ ] [ ] [ ] 测试中 完成
i18n:         [ ] [ ] [ ] 补充中 完成
typecheck:    [ ] [ ] [ ] 检查中 通过
三端测试:     [ ] [ ] [ ] 测试中 全部通过 ✅
```

---

## 📚 参考资源

- `src/index.ts` - CLI 和 Bot 启动逻辑
- `src/adapters/cli/App.tsx` - CLI UI 入口
- `src/adapters/electron/main.ts` - GUI 主进程
- `src/adapters/electron/ui/app.js` - GUI UI 入口
- `src/core/chat/ChatSession.ts` - 核心聊天逻辑
- `src/core/config/defaults.ts` - 默认配置
- `src/core/i18n/messages.ts` - 所有翻译

---

**最后更新**: 2025-02-23
**关键原则**: 新功能必须在 GUI + CLI 都实现！IM Bot 会自动通过 ChatSession 继承 CLI 的所有功能。


---

## 🖥️ 两个 UI 层 + IM Bot 启动方式

### GUI (Electron) - 独立 UI 层
```bash
npm run dev gui              # 启动 GUI 开发模式
npm run dev gui -- --devtools  # 启动并打开 DevTools
```
**验证位置**: `src/adapters/electron/`
**主要文件**:
- `main.ts` - Electron 主进程
- `preload.ts` - IPC 安全桥接
- `ui/index.html` - 页面结构
- `ui/app.js` - 初始化逻辑
- `ui/chat-panel.js` - 对话面板
- `ui/settings-panel.js` - 设置面板
- `ui/logs-panel.js` - 日志面板

### CLI (终端) - 独立 UI 层
```bash
npm run dev                  # 启动 CLI 交互模式
npm run dev "your prompt"    # 非交互模式
npm run dev -- /help         # 显示帮助
npm run dev -- /settings     # 进入设置面板
```
**验证位置**: `src/adapters/cli/`
**主要文件**:
- `App.tsx` - 主 UI 组件
- `SlashCommands.ts` - 命令定义
- `settings/UiSettings.tsx` - UI 设置面板
- `settings/LlmSettings.tsx` - LLM 配置面板
- `BotsMode.tsx` - 机器人管理

### IM Bot - CLI 的另一种启动入口
```bash
npm run dev -- bot                    # 自动启动 config.json 中 enabled 的机器人
npm run dev -- bot --dingtalk         # 启动钉钉机器人（复用 CLI 的 ChatSession）
npm run dev -- bot --feishu           # 启动飞书机器人（复用 CLI 的 ChatSession）
npm run dev -- bot --wecom            # 启动企业微信机器人（复用 CLI 的 ChatSession）
```
**验证位置**: `src/adapters/im/`
**主要文件**:
- `DingtalkBot.ts` - 钉钉适配器（消息 I/O）
- `FeishuBot.ts` - 飞书适配器（消息 I/O）
- `WecomBot.ts` - 企业微信适配器（消息 I/O）
- `IMAdapter.ts` - 通用接口
- `MessageFormatter.ts` - 消息格式转换

**说明**:
- IM Bot 直接使用 CLI 的 `ChatSession`，无需重新实现功能
- IM Bot 只负责处理 IM 消息的 I/O（接收→ChatSession→响应）
- CLI 的所有新功能（斜杠命令、配置、i18n）自动被 IM Bot 继承

---

## 🎯 新功能实现检查清单

### 第一步：实现功能逻辑
- [ ] 在 `src/core/` 或 `src/` 中实现核心逻辑
- [ ] 编写类型定义 (`src/core/types/`)
- [ ] 添加必要的配置字段到 `src/core/config/`

### 第二步：GUI 适配
- [ ] 在 `src/adapters/electron/ui/` 中添加界面
- [ ] 在 HTML/JS 中完成 i18n（中英文）
- [ ] 通过 IPC 与主进程通信 (预定义的 API)
- [ ] 处理错误和加载状态
- [ ] 测试 GUI 启动和交互

**GUI 验证**:
```bash
npm run dev gui
# 验证：
# 1. 界面显示正确
# 2. 点击按钮/输入工作
# 3. 配置能保存到 ~/.xuanji/config.json
# 4. DevTools 无报错
```

### 第三步：CLI 适配
- [ ] 在 `src/adapters/cli/` 中添加 Ink React 组件
- [ ] 添加命令处理到 `App.tsx` (如 `/mycommand`)
- [ ] 在 `SlashCommands.ts` 中注册命令
- [ ] 完成所有字符串的 i18n
- [ ] 处理终端交互（按键、导航等）
- [ ] 测试 CLI 启动和命令

**CLI 验证**:
```bash
npm run dev
# 验证：
# 1. Ink UI 显示正确
# 2. 命令能执行
# 3. 配置能加载和保存
# 4. 中英文切换工作
```

### 第四步：IM Bot 验证（自动）
- [ ] IM Bot 能启动且连接正常
- [ ] IM Bot 接收消息并调用 ChatSession 处理
- [ ] ChatSession 的响应正确转发到 IM 平台
- [ ] 日志信息正确记录

**IM Bot 验证**:
```bash
npm run dev -- bot --dingtalk
# 验证：
# 1. 机器人成功连接
# 2. 能接收外部消息
# 3. 能回复消息（使用 CLI 的功能）
# 4. 日志正确记录到 ~/.xuanji/logs/
# 5. Ctrl+C 能优雅关闭

npm run dev -- bot --feishu
npm run dev -- bot --wecom
# 同上
```

### 第五步：类型检查和 i18n
- [ ] 运行 `npm run typecheck` 无报错
- [ ] 所有用户消息都翻译为中英文
- [ ] 检查 `src/core/i18n/messages.ts` 有对应的 key
- [ ] 检查 GUI 的 `ui/lib/i18n.js` 有对应的 key

**验证命令**:
```bash
npm run typecheck    # 必须通过
npm run dev          # 启动 CLI
/lang               # 切换语言，验证翻译
```

---

## 📝 已验证的功能列表

### ✅ i18n 国际化 (中英文切换)
- **GUI**: 完整实现
  - 在 UI 设置面板可选择语言
  - 实时应用语言变化
  - 配置持久化

- **CLI**: 完整实现
  - `/lang` 命令切换语言
  - 在设置面板可选择语言
  - 实时应用语言变化

- **IM Bot**: ⚠️ 需要集成
  - 需要导入 CLI 的 i18n 模块
  - 机器人启动和错误日志应使用 `t()` 翻译
  - 从 config.json 加载语言设置后应调用 `setLanguage()`

### ✅ 配置管理 (config.json)
- **GUI**: 完整实现
  - 所有配置通过 IPC 保存和加载

- **CLI**: 完整实现
  - ConfigManager 加载和保存配置

- **IM Bot**: 完整实现
  - 机器人配置从 config.json 读取

---

## 🔍 单元测试和集成测试

### GUI 测试
```bash
# 启动 GUI，手动测试：
npm run dev gui

# 检查清单：
- [ ] 页面能加载
- [ ] 能输入消息
- [ ] 能切换语言和主题
- [ ] DevTools 无错误
- [ ] 配置能保存
```

### CLI 测试
```bash
npm run dev

# 检查清单：
- [ ] 终端 UI 显示正确
- [ ] 能输入消息和命令
- [ ] /help 显示完整
- [ ] /lang 能切换语言
- [ ] /settings 能修改配置
- [ ] 消息能输入和发送
```

### IM Bot 测试
```bash
# 配置钉钉机器人凭证，然后：
npm run dev -- bot --dingtalk

# 检查清单：
- [ ] 机器人成功连接
- [ ] 能接收外部消息
- [ ] 能回复消息
- [ ] 日志正确记录
- [ ] 错误消息有意义
```

---

## 🚀 部署检查

部署前必须验证：

```bash
# 1. 类型检查
npm run typecheck

# 2. 构建 GUI
npm run build

# 3. 构建成功后测试三种启动方式
npm run dev gui       # GUI 工作
npm run dev           # CLI 工作
npm run dev -- bot    # Bot 工作

# 4. 检查日志文件
ls ~/.xuanji/logs/
cat ~/.xuanji/logs/2025-02-*.log | jq .
```

---

## 💡 最佳实践

### 共享代码位置

| 需求 | 位置 | 说明 |
|------|------|------|
| 核心业务逻辑 | `src/core/` | ChatSession, Config, i18n 等 |
| 类型定义 | `src/core/types/` | 所有 TypeScript 类型 |
| 翻译字符串 | `src/core/i18n/messages.ts` | 中英文翻译 |
| 配置管理 | `src/core/config/` | 配置加载和保存 |
| 错误处理 | `src/core/` | 统一的错误类型 |

### GUI 特有代码
- `src/adapters/electron/` - Electron 主进程和 IPC
- `src/adapters/electron/ui/` - 前端 HTML/CSS/JS
- `src/adapters/electron/ui/lib/` - 浏览器端工具库

### CLI 特有代码
- `src/adapters/cli/` - Ink React 组件
- `src/adapters/cli/types.ts` - CLI 特定类型

### IM Bot 特有代码
- `src/adapters/im/` - 各个 IM 平台适配器
- `src/index.ts` - Bot 模式启动逻辑

### 避免重复
❌ 不要：在 GUI 和 CLI 中重复实现同样的逻辑
✅ 要：将共享逻辑放在 `src/core/`，两端都导入使用

---

## 📚 相关文档

- `CLAUDE.md` - 项目规范和约定
- `src/core/i18n/messages.ts` - 所有翻译字符串
- `src/adapters/electron/ui/lib/i18n.js` - GUI i18n 模块
- `src/core/chat/ChatSession.ts` - 核心聊天逻辑

---

## 🆘 常见问题

### Q: 为什么 GUI 改动后 CLI 也要改？
A: 因为 GUI 和 CLI 使用相同的核心代码（如 ChatSession），改动核心逻辑会影响两端。必须确保两端都能工作。

### Q: IM Bot 为什么要特别关注？
A: IM Bot 运行在服务器，没有交互界面。如果功能在 Bot 中失败，用户会收不到回复。必须测试真实场景。

### Q: 新增 i18n 字符串该写在哪？
A: 写在 `src/core/i18n/messages.ts` 中，GUI 和 CLI 都会自动使用。

### Q: 怎么验证配置在三端都能保存？
```bash
# 1. GUI 中修改设置后检查
cat ~/.xuanji/config.json | jq .

# 2. CLI 中修改设置后检查
cat ~/.xuanji/config.json | jq .

# 3. Bot 启动时检查日志
npm run dev -- bot 2>&1 | grep -i config
```

---

**最后更新**: 2025-02-23
**维护者**: Xuanji 开发团队
