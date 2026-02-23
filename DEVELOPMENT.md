# 璇玑 (Xuanji) 开发指南

## 快速开始

### 本地调试

**CLI 交互模式**（推荐日常开发）
```bash
npm run dev
```
- 启动终端交互式 CLI
- 支持 `/help` 命令查看帮助
- 按 `Ctrl+C` 退出
- 修改代码后自动热加载（tsx 支持）

**GUI 桌面模式**（调试 Electron 应用）
```bash
npm run dev:gui
```
- 启动 Electron 桌面应用
- 自动打开 DevTools（控制台）
- 可以实时调试 UI 和 IPC 通信
- 修改代码后需要手动重启应用

**Bot 模式**（调试 IM 机器人）
```bash
npm run dev:bot
```
- 启动 IM 机器人服务
- 支持钉钉/飞书/企业微信
- 日志输出到 `~/.xuanji/logs/`

---

## 构建

**完整构建**（生产环境前必须执行）
```bash
npm run build
```
- 清理旧产物
- 编译 CLI (Node.js)
- 编译 Electron 主进程
- 生成到 `dist/` 目录

**仅构建 CLI**
```bash
npm run build:cli
```

**仅构建 Electron**
```bash
npm run build:electron
```

**监视模式构建**（开发时使用）
```bash
npm run build:watch
```
- 监视源文件变化，自动增量构建
- 用于 GUI 开发，避免完整重建

---

## 打包分发

**打包应用**（所有平台）
```bash
npm run dist
```
- 输出到 `release/` 目录
- 生成对应平台的安装包

**仅 macOS**
```bash
npm run dist:mac
```

**仅 Windows**
```bash
npm run dist:win
```

---

## 测试与质量

**运行所有测试**
```bash
npm run test
```

**监视模式测试**（开发时使用）
```bash
npm run test:watch
```
- 监视测试文件变化，自动重新运行
- 推荐在开发过程中持续运行

**测试 UI**（可视化界面）
```bash
npm run test:ui
```
- 启动浏览器测试界面
- 可视化查看测试覆盖率

**仅单元测试**
```bash
npm run test:unit
```

**代码检查**
```bash
npm run lint
```
- 使用 ESLint 检查代码风格
- 自动修复：`npm run lint -- --fix`

**类型检查**
```bash
npm run typecheck
```
- 运行 TypeScript 类型检查
- 不生成编译产物

---

## 清理

**清除所有构建产物**
```bash
npm run clean
```
- 删除 `dist/` 和 `release/` 目录

---

## 常见工作流

### 新增功能开发
```bash
# 1. 启动 CLI 进行交互测试
npm run dev

# 2. 另开一个终端运行单元测试
npm run test:watch

# 3. 代码完成后检查质量
npm run lint
npm run typecheck

# 4. 确保测试通过
npm run test
```

### GUI 界面开发
```bash
# 1. 启动 GUI（带 DevTools）
npm run dev:gui

# 2. 在 DevTools 中调试
# - 检查控制台输出
# - 查看网络请求
# - 调试 IPC 通信

# 3. 修改代码后重启应用
```

### 发布新版本
```bash
# 1. 完整构建
npm run build

# 2. 运行所有测试
npm run test

# 3. 打包应用
npm run dist

# 4. 在 release/ 目录中找到安装包
ls -la release/
```

---

## 环境变量

### 开发环境
```bash
# 启用 Node.js 调试
NODE_DEBUG=* npm run dev

# 启用 Electron 日志
ELECTRON_ENABLE_LOGGING=1 npm run dev:gui

# 指定模型
XUANJI_MODEL=claude-3-sonnet-20250219 npm run dev
```

### 配置文件
- **全局配置**: `~/.xuanji/config.json`
- **项目配置**: `.xuanji/config.json`
- **日志**: `~/.xuanji/logs/YYYY-MM-DD.log`

---

## 调试技巧

### 打印调试日志
```typescript
console.error(`[DEBUG] message`);  // 输出到 stderr
console.log(`[INFO] message`);      // 输出到 stdout
```

### 启用详细日志
```bash
DEBUG=* npm run dev
```

### 查看 Electron 主进程日志
```bash
npm run dev:gui 2>&1 | grep -E "\[DEBUG\]|\[ERROR\]"
```

### 查看应用日志
```bash
tail -f ~/.xuanji/logs/$(date +%Y-%m-%d).log
```

---

## 故障排除

### TypeScript 编译错误
```bash
npm run typecheck    # 查看详细错误
npm run lint -- --fix  # 自动修复
```

### 构建失败
```bash
npm run clean        # 清理缓存
npm run build        # 重新构建
```

### GUI 无法启动
```bash
# 检查 Electron 是否正确安装
npm ls electron

# 重新安装依赖
rm -rf node_modules package-lock.json
npm install
```

### 测试失败
```bash
npm run test:watch   # 监视模式便于调试
npm run test:ui      # 使用 UI 查看详细结果
```

---

## 项目结构

```
xuanji/
├── src/
│   ├── index.ts              # 主入口
│   ├── adapters/
│   │   ├── cli/              # Ink CLI 组件
│   │   ├── electron/         # Electron 主进程 + UI
│   │   └── im/               # IM 机器人适配器
│   ├── core/                 # 核心逻辑（Agent、Chat、Tools）
│   ├── providers/            # LLM Provider 实现
│   └── tools/                # 工具定义
├── test/                     # 测试文件
├── dist/                     # 编译输出（Git 忽略）
├── release/                  # 打包输出（Git 忽略）
└── package.json
```

---

## 贡献指南

提交代码前：
```bash
npm run typecheck   # 类型检查
npm run lint -- --fix  # 代码格式检查
npm run test        # 单元测试
```

确保所有检查都通过再提交 PR。
