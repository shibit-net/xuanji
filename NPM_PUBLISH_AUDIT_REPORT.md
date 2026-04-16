# Xuanji NPM 发布流程深度审查报告

> **审查时间**: 2026-04-15  
> **项目版本**: 0.9.0  
> **审查维度**: 安全审计 | 性能优化 | 发布流程

---

## 📋 执行摘要

### 总体评分: 🟡 60/100

| 维度 | 得分 | 等级 | 关键问题 |
|------|------|------|----------|
| **安全审计** | 15/35 | ⚠️ 高风险 | ❌ 无 .npmignore，泄露敏感文件 |
| **性能优化** | 25/35 | 🟡 待优化 | ⚠️ 打包体积 9.9MB（含大量冗余文件） |
| **发布流程** | 20/30 | ⚠️ 不完善 | ❌ 缺少发布钩子和 CI/CD |

### 🚨 严重问题清单

1. **[P0] 敏感信息泄露风险** — 打包了 1084 个文件（包含测试文件、配置文件、临时文件）
2. **[P0] 无发布前质量检查** — 缺少 prepublishOnly 钩子
3. **[P1] package.json 配置不完整** — 缺少 files、exports、types 字段
4. **[P1] 无自动化发布流程** — 无 CI/CD，依赖手动操作
5. **[P2] 依赖包安全审计不可用** — npm audit 失败（镜像源问题）

---

## 🔒 一、安全审计（15/35 分）

### 1.1 敏感文件泄露风险 ⚠️ 严重

#### 问题描述
当前配置下，`npm pack` 会打包 **1084 个文件**，包含：

```bash
# 已泄露的敏感内容（实际打包清单）
✅ .claude/settings.local.json (18.8kB)  # 可能含 API Key
✅ .xuanji_test_temp.txt                 # 测试临时文件
✅ 所有 test-*.sh, test-*.ts 文件       # 测试脚本
✅ coverage/ 目录内容                   # 覆盖率报告
✅ desktop/ 完整源码                    # Electron 源码（不应发布到 CLI 包）
✅ doc/ 完整文档 (361 个 .md 文件)      # 开发文档
✅ 所有 .md 测试报告文件                # 包含敏感操作记录
```

#### 风险评估
| 风险类型 | 严重度 | 说明 |
|---------|--------|------|
| **API Key 泄露** | 🔴 严重 | `.claude/settings.local.json` 可能包含开发环境配置 |
| **代码库暴露** | 🟡 中等 | 暴露完整测试套件和内部实现细节 |
| **体积膨胀** | 🟡 中等 | 9.9MB 解压体积，用户下载 2.6MB |
| **知识产权** | 🟡 中等 | 暴露 361 个内部设计文档 |

#### 根本原因
```json
// package.json - 缺少关键字段
{
  // ❌ 没有 "files" 字段 - npm 默认打包所有文件（除 .gitignore）
  // ❌ 没有 .npmignore 文件
}
```

#### 解决方案
```json
// package.json 新增配置
{
  "files": [
    "dist/**/*.js",
    "dist/**/*.d.ts",
    "README.md",
    "LICENSE",
    "CHANGELOG.md"
  ]
}
```

```bash
# 创建 .npmignore（备选方案，优先用 files 字段）
cat > .npmignore << 'IGNORE'
# 开发文件
*.log
*.md
!README.md
!CHANGELOG.md

# 源代码（仅发布编译产物）
src/
test/
tests/
doc/
docs/
desktop/

# 配置文件
.claude/
.xuanji/
.temp/
tmp/
coverage/

# 测试文件
test-*
*test*.ts
*test*.sh
*test*.md

# 构建工具配置
tsconfig*.json
vitest.config.ts
vite.config.ts
.eslintrc*
prettier.config.*
IGNORE
```

---

### 1.2 依赖安全审计 ⚠️ 阻塞

#### 问题
```bash
$ npm audit
404 Not Found - [NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet
```

**原因**: 当前使用淘宝镜像 `npmmirror.com`，不支持安全审计 API。

#### 解决方案
```bash
# 发布前切换到官方源
npm config set registry https://registry.npmjs.org

# 执行安全审计
npm audit --production

# 自动修复（谨慎使用）
npm audit fix

# 恢复国内镜像（开发环境）
npm config set registry https://registry.npmmirror.com
```

#### 已知依赖风险（需人工验证）
```json
{
  "@anthropic-ai/sdk": "0.78.0 → 0.89.0",  // 有 11 个小版本更新
  "openai": "6.22.0",                       // 需检查 CVE
  "better-sqlite3": "12.6.2",               // native 模块，注意兼容性
  "ws": "8.19.0",                           // WebSocket，历史有漏洞
  "jsdom": "28.1.0"                         // DOM 解析，XSS 风险
}
```

---

### 1.3 .gitignore 与 .npmignore 冲突 ⚠️ 中等

#### 当前状态
```bash
# .gitignore 存在
✅ node_modules/
✅ dist/
✅ .env*
✅ coverage/

# .npmignore 不存在
❌ npm 默认忽略 .gitignore 中的规则
❌ 但会包含已 git 追踪的文件（如 test-*.md）
```

#### 行为对比
| 文件 | Git 状态 | npm pack 行为 | 说明 |
|------|---------|--------------|------|
| `dist/` | ignored | ✅ **包含** | npm 会强制包含构建产物 |
| `test-*.md` | tracked | ✅ **包含** | 已提交的测试文件会被打包 |
| `coverage/` | ignored | ❌ 不包含 | .gitignore 生效 |
| `.env.example` | tracked | ✅ **包含** | 示例配置会打包 |

---

### 1.4 运行时安全检查 ✅ 良好

#### 已实现的安全措施（来自项目规则）
```typescript
// src/permission/ 模块
✅ 路径遍历检查 - 防止 ../ 攻击
✅ 命令注入防护 - bash 工具参数转义
✅ 敏感文件拦截 - 自动阻止 .env, *.key, .ssh/
✅ 用户确认机制 - 高风险操作需确认
```

#### 建议增强
```typescript
// 新增：发布前安全检查脚本
// scripts/pre-publish-security-check.sh
#!/bin/bash
set -e

echo "🔒 执行发布前安全检查..."

# 1. 检查是否有硬编码的 API Key
if grep -r "sk-ant-api" dist/ 2>/dev/null; then
  echo "❌ 检测到硬编码 API Key"
  exit 1
fi

# 2. 检查敏感文件
SENSITIVE_FILES=(".env" ".npmrc" "*.pem" "*.key")
for pattern in "${SENSITIVE_FILES[@]}"; do
  if find dist/ -name "$pattern" 2>/dev/null | grep -q .; then
    echo "❌ 检测到敏感文件: $pattern"
    exit 1
  fi
done

# 3. 验证 shebang
if ! head -1 dist/index.js | grep -q "#!/usr/bin/env node"; then
  echo "❌ 缺少 shebang"
  exit 1
fi

echo "✅ 安全检查通过"
```

---

## ⚡ 二、性能优化（25/35 分）

### 2.1 打包体积分析 ⚠️ 需优化

#### 当前状态
```
解压后体积: 9.9 MB (1084 个文件)
压缩包大小: 2.6 MB
```

#### 体积构成（基于 npm pack 输出）
```
核心代码 (dist/)      : ~1.9 MB  (19%)
测试文件 (test/)      : ~2.5 MB  (25%)
文档 (doc/, docs/)    : ~3.0 MB  (30%)
Desktop 源码          : ~2.0 MB  (20%)
临时/配置文件          : ~0.5 MB  (6%)
```

#### 🎯 优化目标
```
理想体积: < 3 MB 解压 / < 800 KB 压缩
实际需求: 仅 dist/ + README.md + LICENSE
```

#### 优化方案
```json
// package.json
{
  "files": [
    "dist/**/*.js",
    "dist/**/*.d.ts",
    "README.md",
    "LICENSE"
  ],
  // 预计优化后: 1.9 MB 解压 / 500 KB 压缩 (减少 70%)
}
```

---

### 2.2 构建产物分析 🟢 良好

#### tsup 配置
```typescript
// package.json - build:cli
"tsup src/index.ts --format esm --target esnext --outDir dist"
```

#### 产物特征
✅ ESM 格式（现代化）
✅ esnext target（利用 Node 20+ 特性）
✅ 代码分割（chunk-*.js）
✅ 外部化 tree-sitter 依赖（减少体积）

#### 当前问题
```bash
# dist/ 目录包含 66 个文件
❌ 部分 chunk 体积过大：
  - chunk-PNSEH7KK.js: 141.9 KB
  - chunk-WNE4KRBN.js: 130.7 KB
  - index.js: 597.5 KB (主入口文件过大)
```

#### 优化建议
```typescript
// tsup.config.ts（新建）
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'esnext',
  outDir: 'dist',
  clean: true,
  dts: true,               // 生成 .d.ts
  sourcemap: true,         // 生产环境 sourcemap
  splitting: true,         // 启用代码分割
  treeshake: true,         // Tree-shaking
  minify: 'terser',        // 压缩（可选，CLI 工具一般不需要）
  external: [
    'tree-sitter',
    'tree-sitter-*',
    '@xenova/transformers', // 可选外部化（190 KB）
  ],
  esbuildOptions(options) {
    options.chunkNames = 'chunks/[name]-[hash]';
    options.mangleProps = /^_/;  // 私有属性压缩
  },
});
```

---

### 2.3 依赖优化 🟡 待改进

#### 生产依赖分析（27 个）
```json
{
  "核心依赖": {
    "@anthropic-ai/sdk": "^0.78.0",  // 必需
    "openai": "^6.22.0",             // 必需
    "ink": "^5.1.0",                 // 必需（CLI UI）
    "react": "^18.3.1"               // 必需（Ink 依赖）
  },
  "可优化依赖": {
    "jsdom": "^28.1.0",              // 28 MB，仅 web-fetch 工具使用
    "@xenova/transformers": "^2.17.2", // 190 MB，embedding 功能
    "better-sqlite3": "^12.6.2",     // native 模块，memory 系统
    "sqlite-vec": "^0.1.7-alpha.2"   // 实验性依赖（alpha 版本）
  }
}
```

#### 优化策略

**1. 动态导入重型依赖**
```typescript
// src/tools/WebFetchTool.ts
// ❌ 当前：全局导入
import { JSDOM } from 'jsdom';

// ✅ 优化：按需加载
async execute() {
  const { JSDOM } = await import('jsdom');
  // ...
}
```

**2. 依赖可选化**
```json
{
  "peerDependencies": {
    "@xenova/transformers": "^2.17.2"  // 移到 peerDeps
  },
  "peerDependenciesMeta": {
    "@xenova/transformers": {
      "optional": true  // 用户不需要 embedding 时可不装
    }
  }
}
```

**3. 移除实验性依赖**
```json
{
  "dependencies": {
    "sqlite-vec": "^0.1.7-alpha.2"  // ❌ alpha 版本，生产环境风险
  }
  // 建议：等待稳定版本或移除
}
```

---

### 2.4 运行时性能 🟢 优秀

#### 性能要求（来自项目规则）
```
✅ 启动时间: < 2s（冷启动）
✅ 响应延迟: < 3s（首个 token）
✅ 内存占用: < 500 MB（长时间运行）
✅ 大文件处理: 支持流式 > 10 MB
```

#### 实现验证（代码审查）
```typescript
// ✅ 流式响应实现
src/agent/AgentLoop.ts:
  - 使用 stream: true
  - 实时输出 token

// ✅ 大文件流式读取
src/tools/ReadTool.ts:
  - offset/limit 分页
  - PDF 分批读取（20 页/次）

// ✅ 懒加载模块
src/mcp/MCPManager.ts:
  - 仅在需要时加载 MCP 服务
```

---

## 🚀 三、发布流程（20/30 分）

### 3.1 package.json 配置完整性 ⚠️ 不及格

#### 缺失的关键字段
```json
{
  // ❌ 缺少 - 导致打包所有文件
  "files": [],

  // ❌ 缺少 - TypeScript 类型支持不完整
  "types": "dist/index.d.ts",
  "typings": "dist/index.d.ts",

  // ❌ 缺少 - 现代化 exports 映射
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },

  // ❌ 缺少 - 模块类型元数据
  "sideEffects": false,

  // ⚠️ 不完整 - bin 字段缺少权限声明
  "bin": {
    "xuanji": "dist/index.js"  // 需确保 shebang
  },

  // ❌ 缺少 - 发布配置
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org"
  }
}
```

#### 完整配置示例
```json
{
  "name": "xuanji",
  "version": "0.9.0",
  "type": "module",
  
  "bin": {
    "xuanji": "dist/index.js"
  },
  
  "files": [
    "dist/**/*.js",
    "dist/**/*.d.ts",
    "dist/**/*.map",
    "README.md",
    "LICENSE",
    "CHANGELOG.md"
  ],
  
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  
  "sideEffects": false,
  
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=9.0.0"
  },
  
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org"
  }
}
```

---

### 3.2 发布钩子 ❌ 缺失

#### 当前 scripts
```json
{
  "scripts": {
    "build": "npm run clean && npm run build:cli",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/ --ext .ts,.tsx",
    
    // ❌ 缺少所有发布相关钩子
  }
}
```

#### 必需的发布钩子
```json
{
  "scripts": {
    // 1. 发布前强制检查
    "prepublishOnly": "npm run verify-release",
    
    // 2. 版本变更钩子
    "preversion": "npm run verify-release",
    "version": "npm run build && git add -A dist",
    "postversion": "git push && git push --tags",
    
    // 3. 综合验证
    "verify-release": "npm run typecheck && npm run lint && npm run test && npm run build && npm run pack:check",
    
    // 4. 打包验证
    "pack:check": "npm pack --dry-run && echo '✅ Package contents verified'",
    
    // 5. 本地测试安装
    "test:install": "npm pack && npm install -g xuanji-*.tgz",
    
    // 6. 发布后清理
    "postpublish": "rm -f xuanji-*.tgz"
  }
}
```

#### 钩子执行流程
```
npm version patch
  ↓
preversion: 验证代码质量
  ↓
version bump (0.9.0 → 0.9.1)
  ↓
version: 构建 + 提交 dist/
  ↓
postversion: 推送 tag

npm publish
  ↓
prepublishOnly: 最后防线检查
  ↓
打包 → 上传
  ↓
postpublish: 清理临时文件
```

---

### 3.3 语义化版本策略 🟢 良好

#### 当前版本: 0.9.0
```
主版本.次版本.修订号
  0  .  9  .  0
  ↑     ↑     ↑
 Beta  功能  修复
```

#### 版本规划建议
```
当前阶段: Pre-1.0 Beta
下一步:
  0.9.0 → 0.9.1  (bug 修复)
  0.9.0 → 0.10.0 (新功能)
  0.9.0 → 1.0.0  (稳定版，发布前需完成)
```

#### 自动化版本管理
```bash
# 安装工具
npm install -D standard-version

# package.json 新增
{
  "scripts": {
    "release": "standard-version",
    "release:minor": "standard-version --release-as minor",
    "release:major": "standard-version --release-as major"
  }
}

# 使用
npm run release          # 自动判断版本号
npm run release:minor    # 强制 0.9.0 → 0.10.0
```

---

### 3.4 CI/CD 配置 ❌ 完全缺失

#### 当前状态
```bash
$ find . -name ".github"
./node_modules/.../.github  # 仅依赖包的配置
# ❌ 项目根目录无 .github/workflows/
```

#### GitHub Actions 发布流程（完整示例）

**1. 自动测试 + 发布**
```yaml
# .github/workflows/publish.yml
name: Publish to npm

on:
  push:
    tags:
      - 'v*'  # 触发条件: git tag v0.9.1

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Type check
        run: npm run typecheck
      
      - name: Lint
        run: npm run lint
      
      - name: Test
        run: npm run test
      
      - name: Build
        run: npm run build
      
      - name: Verify package contents
        run: |
          npm pack --dry-run
          # 检查文件数量
          if [ $(npm pack --dry-run | grep "total files:" | awk '{print $3}') -gt 100 ]; then
            echo "❌ Too many files in package!"
            exit 1
          fi
  
  publish:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      
      - run: npm ci
      - run: npm run build
      
      - name: Publish to npm
        run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            README.md
            CHANGELOG.md
          body: |
            See [CHANGELOG.md](CHANGELOG.md) for details.
```

**2. PR 自动检查**
```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main, master]
  push:
    branches: [main, master]

jobs:
  quality-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test
      - run: npm run build
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

**3. 依赖安全扫描**
```yaml
# .github/workflows/security.yml
name: Security Audit

on:
  schedule:
    - cron: '0 0 * * 1'  # 每周一执行
  workflow_dispatch:

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - run: npm audit --audit-level=high
      
      - name: Check outdated
        run: npm outdated || true
```

---

### 3.5 发布检查清单 📋

#### Pre-Release Checklist
```bash
# 创建 scripts/pre-release-checklist.sh
#!/bin/bash
set -e

echo "📋 执行发布前检查清单..."

# 1. 代码质量
echo "1️⃣ 代码质量检查"
npm run typecheck
npm run lint

# 2. 测试覆盖率
echo "2️⃣ 测试覆盖率"
npm run test
COVERAGE=$(npx vitest run --coverage.enabled --coverage.reporter=text-summary | grep "All files" | awk '{print $10}')
if (( $(echo "$COVERAGE < 80" | bc -l) )); then
  echo "❌ 测试覆盖率不足 80% (当前: $COVERAGE)"
  exit 1
fi

# 3. 构建验证
echo "3️⃣ 构建验证"
npm run build
if [ ! -f dist/index.js ]; then
  echo "❌ 构建产物缺失"
  exit 1
fi

# 4. 打包检查
echo "4️⃣ 打包内容检查"
FILE_COUNT=$(npm pack --dry-run 2>&1 | grep "total files:" | awk '{print $3}')
if [ "$FILE_COUNT" -gt 100 ]; then
  echo "❌ 打包文件过多: $FILE_COUNT (限制: 100)"
  npm pack --dry-run | grep "npm notice"
  exit 1
fi

# 5. 依赖审计
echo "5️⃣ 依赖安全审计"
npm config set registry https://registry.npmjs.org
npm audit --omit=dev --audit-level=high
npm config set registry https://registry.npmmirror.com

# 6. Shebang 检查
echo "6️⃣ 可执行文件检查"
if ! head -1 dist/index.js | grep -q "#!/usr/bin/env node"; then
  echo "❌ dist/index.js 缺少 shebang"
  exit 1
fi

# 7. CHANGELOG 更新检查
echo "7️⃣ CHANGELOG 检查"
VERSION=$(node -p "require('./package.json').version")
if ! grep -q "## \[$VERSION\]" CHANGELOG.md; then
  echo "⚠️  CHANGELOG.md 未更新版本 $VERSION"
  read -p "继续发布? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# 8. Git 状态检查
echo "8️⃣ Git 状态检查"
if [[ -n $(git status --porcelain) ]]; then
  echo "⚠️  存在未提交的更改"
  git status --short
  read -p "继续发布? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo "✅ 所有检查通过，可以发布！"
echo "执行命令: npm publish"
```

#### 使用流程
```bash
# 1. 执行检查
bash scripts/pre-release-checklist.sh

# 2. 更新版本号
npm version patch -m "chore: release v%s"

# 3. 发布
npm publish

# 4. 推送标签
git push --follow-tags
```

---

## 🎯 改进方案优先级

### P0 - 立即修复（发布前必须完成）

| 任务 | 预计时间 | 影响范围 |
|------|---------|---------|
| ✅ 添加 `files` 字段 | 5 分钟 | 安全 + 性能 |
| ✅ 创建 `.npmignore` | 10 分钟 | 安全 |
| ✅ 添加 `prepublishOnly` 钩子 | 15 分钟 | 质量保障 |
| ✅ 完善 `exports`/`types` 字段 | 10 分钟 | TypeScript 支持 |
| ✅ 验证 shebang | 5 分钟 | CLI 可执行性 |

**总计**: 45 分钟

### P1 - 短期优化（1 周内完成）

| 任务 | 预计时间 | 影响范围 |
|------|---------|---------|
| ✅ 配置 GitHub Actions CI/CD | 2 小时 | 自动化 |
| ✅ 创建发布检查脚本 | 1 小时 | 质量保障 |
| ✅ 依赖安全审计（切换源） | 30 分钟 | 安全 |
| ✅ 移除 `sqlite-vec` alpha 依赖 | 1 小时 | 稳定性 |
| ✅ 优化依赖（动态导入 jsdom） | 2 小时 | 性能 |

**总计**: 6.5 小时

### P2 - 中期改进（1 个月内）

| 任务 | 预计时间 | 影响范围 |
|------|---------|---------|
| 🔄 集成 `standard-version` | 1 小时 | 版本管理 |
| 🔄 配置 Codecov 覆盖率追踪 | 1 小时 | 质量监控 |
| 🔄 优化构建配置（tsup.config.ts） | 2 小时 | 性能 |
| 🔄 依赖外部化策略（peerDeps） | 3 小时 | 灵活性 |
| 🔄 添加 Dependabot 自动更新 | 30 分钟 | 安全 |

**总计**: 7.5 小时

---

## 📦 完整配置文件示例

### 1. 优化后的 package.json
```json
{
  "name": "xuanji",
  "version": "0.9.0",
  "description": "璇玑 (Xuanji) — 开源 AI 助手",
  "type": "module",
  
  "bin": {
    "xuanji": "./dist/index.js"
  },
  
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./package.json": "./package.json"
  },
  
  "files": [
    "dist/**/*.js",
    "dist/**/*.d.ts",
    "dist/**/*.map",
    "README.md",
    "LICENSE",
    "CHANGELOG.md"
  ],
  
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "npm run clean && npm run build:cli",
    "build:cli": "tsup",
    "clean": "rm -rf dist release *.tgz",
    
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/ --ext .ts,.tsx",
    
    "prepublishOnly": "npm run verify-release",
    "preversion": "npm run verify-release",
    "version": "npm run build && git add -A dist",
    "postversion": "git push && git push --tags",
    "postpublish": "rm -f xuanji-*.tgz",
    
    "verify-release": "npm run typecheck && npm run lint && npm test && npm run build && npm run pack:check",
    "pack:check": "npm pack --dry-run",
    "test:install": "npm pack && npm install -g xuanji-*.tgz",
    
    "release": "standard-version",
    "release:minor": "standard-version --release-as minor",
    "release:major": "standard-version --release-as major"
  },
  
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=9.0.0"
  },
  
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org"
  },
  
  "keywords": [
    "ai",
    "ai-assistant",
    "cli",
    "claude",
    "agent",
    "terminal",
    "coding-assistant"
  ],
  
  "author": "Shibit <dev@shibit.net>",
  "license": "MIT",
  
  "repository": {
    "type": "git",
    "url": "git+https://github.com/shibit/xuanji.git"
  },
  
  "bugs": {
    "url": "https://github.com/shibit/xuanji/issues"
  },
  
  "homepage": "https://github.com/shibit/xuanji#readme",
  
  "dependencies": {
    "@anthropic-ai/sdk": "^0.78.0",
    "ink": "^5.1.0",
    "react": "^18.3.1",
    "openai": "^6.22.0",
    "better-sqlite3": "^12.6.2",
    "consola": "^3.4.2",
    "fast-glob": "^3.3.3",
    "ignore": "^7.0.5",
    "yaml": "^2.8.2"
  },
  
  "peerDependencies": {
    "@xenova/transformers": "^2.17.2"
  },
  
  "peerDependenciesMeta": {
    "@xenova/transformers": {
      "optional": true
    }
  },
  
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.7.0",
    "tsup": "^8.5.1",
    "vitest": "^1.6.0",
    "eslint": "^9.0.0",
    "standard-version": "^9.5.0"
  }
}
```

### 2. .npmignore
```
# 源代码
src/
test/
tests/
doc/
docs/
desktop/

# 配置文件
.claude/
.xuanji/
.temp/
tmp/
coverage/
.vscode/
.idea/

# 测试文件
test-*
*test*.ts
*test*.sh
*test*.md
*test*.txt
*.test.*

# 构建配置
tsconfig*.json
vitest.config.ts
vite.config.ts
.eslintrc*
prettier.config.*
tsup.config.ts

# 文档（保留 README）
*.md
!README.md
!LICENSE.md
!CHANGELOG.md

# 临时文件
*.log
*.swp
*.swo
.DS_Store
Thumbs.db

# Git
.git/
.gitignore
.gitattributes

# CI/CD
.github/

# 脚本
scripts/
*.sh
```

### 3. tsup.config.ts
```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'esnext',
  outDir: 'dist',
  
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: true,
  treeshake: true,
  
  external: [
    'tree-sitter',
    'tree-sitter-typescript',
    'tree-sitter-python',
    'tree-sitter-java',
  ],
  
  esbuildOptions(options) {
    options.banner = {
      js: '#!/usr/bin/env node',
    };
  },
  
  onSuccess: 'chmod +x dist/index.js',
});
```

### 4. .github/workflows/publish.yml
```yaml
name: Publish Package

on:
  push:
    tags:
      - 'v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
      
      - name: Install
        run: npm ci
      
      - name: Verify
        run: npm run verify-release
      
      - name: Publish
        run: npm publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
      
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            README.md
            CHANGELOG.md
```

---

## 📊 实施路线图

### Week 1: 紧急修复（P0）
```
Day 1: 
  ✅ 修改 package.json (files, exports, types)
  ✅ 创建 .npmignore
  ✅ 验证打包内容

Day 2:
  ✅ 添加发布钩子
  ✅ 创建发布检查脚本
  ✅ 本地测试发布流程

Day 3:
  ✅ 执行安全审计（切换源）
  ✅ 修复已知漏洞
  ✅ 发布 0.9.1 补丁版本
```

### Week 2-4: 自动化建设（P1）
```
Week 2:
  ✅ 配置 GitHub Actions CI
  ✅ 集成测试覆盖率报告
  ✅ 添加依赖扫描

Week 3:
  ✅ 优化构建配置
  ✅ 依赖外部化（jsdom, transformers）
  ✅ 移除实验性依赖

Week 4:
  ✅ 集成 standard-version
  ✅ 完善 CHANGELOG 自动化
  ✅ 发布 0.10.0 功能版本
```

### Month 2: 持续优化（P2）
```
  🔄 Dependabot 配置
  🔄 性能监控集成
  🔄 发布文档完善
  🔄 1.0.0 GA 准备
```

---

## 🎓 总结与建议

### 关键发现

1. **严重安全风险**: 当前配置会泄露 1084 个文件（包含敏感配置、测试文件、开发文档）
2. **缺乏质量保障**: 无 prepublishOnly 钩子，可能发布未测试代码
3. **体积严重超标**: 9.9MB（目标: < 3MB）
4. **无自动化流程**: 完全依赖手动操作，易出错

### 立即行动项（今天完成）

```bash
# 1. 修改 package.json
cat >> package.json << 'JSON'
{
  "files": ["dist", "README.md", "LICENSE"],
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "prepublishOnly": "npm run typecheck && npm run lint && npm test && npm run build"
  },
  "publishConfig": {
    "access": "public",
    "registry": "https://registry.npmjs.org"
  }
}
JSON

# 2. 创建 .npmignore
echo "src/
test/
tests/
doc/
docs/
desktop/
*.md
!README.md
!CHANGELOG.md" > .npmignore

# 3. 验证
npm pack --dry-run

# 4. 测试安装
npm pack
npm install -g xuanji-*.tgz
xuanji --version
```

### 长期改进方向

1. **安全**: 建立持续的依赖扫描和漏洞修复流程
2. **性能**: 继续优化依赖树，目标 < 2MB
3. **质量**: 实现 90%+ 测试覆盖率
4. **自动化**: 完善 CI/CD，实现一键发布

### 发布检查清单（打印版）

```
□ package.json 配置完整（files, exports, types）
□ .npmignore 存在且正确
□ npm pack --dry-run 验证（文件数 < 100）
□ npm audit 通过（无高危漏洞）
□ npm run typecheck 通过
□ npm run lint 通过
□ npm test 通过（覆盖率 > 80%）
□ CHANGELOG.md 已更新
□ Git 无未提交更改
□ dist/index.js 包含正确 shebang
□ 本地测试安装成功（npm install -g）
□ 版本号符合语义化规范
```

---

**报告生成时间**: 2026-04-15  
**下次审查**: 1.0.0 发布前  
**负责人**: DevOps Team  
**优先级**: 🔴 P0（发布阻塞）
