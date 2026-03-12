# 三端完整实现快速参考卡

## 🎯 核心原则：**功能必须在三端都实现**

```
新功能 ≠ 只在 GUI 实现
新功能 = GUI 实现 + CLI 实现 + IM Bot 实现
```

---

## 🚀 快速启动命令

```bash
# GUI (Electron 桌面应用)
npm run dev gui              # 启动 GUI
npm run dev gui -- --devtools  # 启动 GUI 并打开开发者工具

# CLI (终端交互应用)
npm run dev                  # 交互模式
npm run dev "你的问题"       # 非交互模式
npm run dev -- /help        # 显示帮助

# IM Bot (聊天机器人)
npm run dev -- bot                  # 自动启动已配置的机器人
npm run dev -- bot --dingtalk       # 启动钉钉机器人
npm run dev -- bot --feishu         # 启动飞书机器人
npm run dev -- bot --wecom          # 启动企业微信机器人
```

---

## 📋 新功能实现检查清单

### 1️⃣ 编码阶段
- [ ] 核心逻辑完成（`src/core/`）
- [ ] GUI 界面实现（`src/adapters/electron/`）
- [ ] CLI 组件实现（`src/adapters/cli/`）
- [ ] 所有消息都已国际化（中英文）
- [ ] `npm run typecheck` 通过

### 2️⃣ 测试阶段

#### GUI 测试
```bash
npm run dev gui
# ✓ 页面能加载
# ✓ 功能能操作
# ✓ 配置能保存
# ✓ DevTools 无错误
```

#### CLI 测试
```bash
npm run dev
# ✓ 终端 UI 显示正确
# ✓ 命令能执行
# ✓ 配置能加载/保存
# ✓ 中英文切换工作
```

#### IM Bot 测试
```bash
npm run dev -- bot --dingtalk
# ✓ 机器人成功启动
# ✓ 能接收和回复消息
# ✓ 日志正确记录
# ✓ Ctrl+C 能优雅关闭
```

---

## 📁 代码位置速查

| 功能 | 位置 | 文件 |
|------|------|------|
| 核心业务逻辑 | `src/core/` | `chat/`, `config/`, `types/` |
| 中英文翻译 | `src/core/i18n/` | `messages.ts`, `index.ts` |
| GUI 界面 | `src/adapters/electron/ui/` | `index.html`, `*.js` |
| GUI i18n | `src/adapters/electron/ui/lib/` | `i18n.js` |
| GUI 主进程 | `src/adapters/electron/` | `main.ts`, `preload.ts` |
| CLI 组件 | `src/adapters/cli/` | `App.tsx`, `settings/` |
| CLI i18n | `src/core/i18n/` | `messages.ts` (共用) |
| IM Bot 适配 | `src/adapters/im/` | `DingtalkBot.ts` 等 |

---

## 🔍 调试命令速查

```bash
# TypeScript 类型检查
npm run typecheck

# 启动 CLI 的语言测试
npm run dev
/lang          # 切换语言

# 启动 GUI 开发者工具
npm run dev gui -- --devtools
# DevTools → Console → 运行:
window.XuanjiI18n.getLanguage()
window.XuanjiI18n.t('gui.chat.user_role')

# 查看配置文件
cat ~/.xuanji/config.json | jq .

# 查看日志
tail -f ~/.xuanji/logs/2025-*.log

# 测试 IPC 通信 (GUI DevTools Console)
window.XuanjiIPC.config.load().then(r => console.log(r))
window.XuanjiIPC.chat.init().then(r => console.log(r))
```

---

## ⚙️ 配置位置

- **全局配置**: `~/.xuanji/config.json`
- **日志目录**: `~/.xuanji/logs/`
- **项目级配置**: `.xuanji/config.json` (项目目录)

### 配置文件示例
```json
{
  "provider": {
    "model": "[CC]claude-sonnet-4-5-20250929",
    "apiKey": "sk-...",
    "adapter": "anthropic",
    "baseURL": "https://shibit.net"
  },
  "ui": {
    "theme": "dark",
    "language": "en"
  },
  "bots": {
    "dingtalk": { "appKey": "...", "appSecret": "..." },
    "feishu": { "appId": "...", "appSecret": "..." },
    "wecom": { "corpId": "...", "secret": "..." }
  }
}
```

---

## 🎯 验证三端都能工作

```bash
# 一键验证脚本
echo "=== 1. 类型检查 ===" && \
npm run typecheck && \
echo "✓ 通过" && \

echo -e "\n=== 2. 快速启动 CLI ===" && \
timeout 5 npm run dev -- /help || true && \
echo "✓ CLI 正常" && \

echo -e "\n=== 3. 快速启动 GUI ===" && \
timeout 5 npm run dev gui 2>&1 | grep -q "started" && \
echo "✓ GUI 正常" || echo "⚠ GUI 启动较慢，请手动测试" && \

echo -e "\n所有检查完成！"
```

---

## ❌ 常见问题快速解决

| 问题 | 解决方案 |
|------|--------|
| GUI 显示不正确 | 打开 DevTools (`npm run dev gui -- --devtools`)，查看 Console 错误 |
| i18n 不生效 | 检查 `src/core/i18n/messages.ts` 是否有对应 key |
| 配置保存失败 | 检查 `~/.xuanji/` 目录权限，查看日志 |
| IM Bot 不连接 | 检查凭证配置，查看 `~/.xuanji/logs/` 中的错误日志 |
| typecheck 报错 | 确保所有 TypeScript 文件都正确导入类型定义 |

---

## 📚 详细文档

- `IMPLEMENTATION_CHECKLIST.md` - 完整的实现检查清单
- `CLAUDE.md` - 项目规范和约定
- `src/core/i18n/messages.ts` - 所有翻译字符串
- `src/adapters/electron/ui/lib/i18n.js` - GUI i18n 实现
- `src/index.ts` - CLI 启动逻辑
- `src/adapters/electron/main.ts` - GUI 主进程

---

**最后更新**: 2025-02-23
**用途**: 新功能开发时快速参考
