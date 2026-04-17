# Xuanji 依赖分析报告

## 📊 依赖统计

| 类别 | 数量 | 占比 |
|------|------|------|
| UI 框架 | 7 | 11.7% |
| AI SDK | 3 | 5.0% |
| 数据库 | 3 | 5.0% |
| 工具类 | 23 | 38.3% |
| 其他 | 24 | 40.0% |
| **总计** | **60** | **100%** |

## 🔑 重点依赖说明

**核心 AI 能力**：`@anthropic-ai/sdk` 和 `openai` 提供 LLM 接口，`@xenova/transformers` 支持本地模型推理，构成智能核心。

**UI 渲染**：基于 `ink` + `react` 实现终端 UI，7 个相关依赖占比较低，架构清晰。

**代码分析**：`tree-sitter` 系列（Java/Python/TypeScript）提供 AST 解析能力，支持多语言项目感知。

**向量存储**：`better-sqlite3` + `sqlite-vec` 实现轻量级向量数据库，无需外部服务。

**文档处理**：覆盖 PDF/HTML/Markdown/DOCX 全链路，支持多格式知识提取（`pdf-parse`、`jsdom`、`turndown`、`marked`）。

## 💡 优化建议

1. **精简工具链**：23 个工具类依赖偏多，建议合并功能相似的库（如 `fast-glob` 可替代部分文件操作）。

2. **类型定义清理**：8 个 `@types/*` 包可在 TypeScript 5.0+ 中通过 `moduleResolution: bundler` 减少。

3. **构建优化**：`tsup` + `vite` 双构建工具存在冗余，建议统一到 `tsup`（CLI）+ `vite`（Electron）。

4. **运行时瘦身**：`electron` 和 `@larksuiteoapi/node-sdk` 为可选功能，建议拆分为独立 optional dependencies。

5. **安全审计**：定期运行 `npm audit`，重点关注 `ws`、`jsdom` 等网络相关库的漏洞更新。
