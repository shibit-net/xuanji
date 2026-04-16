# 质量审计修复任务清单

> **基于**: QUALITY_AUDIT_ROUND_3.md  
> **目标**: 测试通过率 96.5% → 98%+  
> **截止日期**: 2025-04-07

---

## 🚨 本周必须完成（P0）

### [ ] 1. 修复 Electron 集成测试（13 failures）
- **负责人**: 待分配
- **工时**: 4 小时
- **文件**: `test/integration/electron-integration.test.ts`
- **任务**:
  - [ ] Mock `electron` 模块 (`ipcMain`, `contextBridge`, `app`)
  - [ ] Mock `ChatSession` 类
  - [ ] Mock IM Adapters (`DingTalkBot`, `LarkBot`)
  - [ ] 验证所有 IPC handlers 正常工作
- **验收标准**: 所有 13 个测试通过

### [ ] 2. 补充 butler 模块测试（0% → 60%+）
- **负责人**: 待分配
- **工时**: 6 小时
- **文件**: 
  - `test/unit/butler/ProactiveButler.test.ts` (新建)
  - `test/unit/butler/ButlerDecisionEngine.test.ts` (新建)
- **任务**:
  - [ ] 测试主动推送逻辑
  - [ ] 测试决策引擎
  - [ ] 测试提醒触发条件
  - [ ] 测试用户偏好学习
- **验收标准**: 覆盖率 ≥ 60%，核心路径全覆盖

### [ ] 3. 补充 auth 模块测试（0% → 80%+）
- **负责人**: 待分配
- **工时**: 4 小时
- **文件**:
  - `test/unit/auth/AuthService.test.ts` (新建)
  - `test/integration/auth-flow.test.ts` (新建)
- **任务**:
  - [ ] 测试登录/登出流程
  - [ ] 测试 token 刷新
  - [ ] 测试权限校验
  - [ ] 测试会话过期处理
- **验收标准**: 覆盖率 ≥ 80%

---

## ⏰ 两周内完成（P1）

### [ ] 4. 修复配置验证测试（2 failures）
- **工时**: 1 小时
- **文件**: `test/unit/config/ConfigValidator.test.ts`, `GlobalConfig.test.ts`
- **任务**:
  - [ ] 更新测试断言匹配新错误信息格式
  - [ ] 验证环境变量映射逻辑

### [ ] 5. 修复遥测统计测试（2 failures）
- **工时**: 2 小时
- **文件**: `test/unit/telemetry/DailyUsageStats.test.ts`
- **任务**:
  - [ ] 修复日期填充逻辑（处理时区）
  - [ ] 更新成本计算公式

### [ ] 6. 修复 ChatSession 测试（4 failures）
- **工时**: 4 小时
- **文件**: `test/unit/chat/ChatSession.test.ts`
- **任务**:
  - [ ] 适配新的依赖注入方式
  - [ ] 处理异步初始化
  - [ ] 更新所有 mock

### [ ] 7. 修复 MemoryManager 测试（4 failures）
- **工时**: 3 小时
- **文件**: `test/unit/memory/MemoryManager.test.ts`, `test/integration/session-memory-integration.test.ts`
- **任务**:
  - [ ] 适配新的 Markdown 格式
  - [ ] 更新截断逻辑测试

### [ ] 8. 补充 tiangong 模块测试（0% → 50%+）
- **工时**: 5 小时
- **文件**:
  - `test/unit/tiangong/PackageManager.test.ts` (新建)
  - `test/unit/tiangong/SubscriptionManager.test.ts` (新建)
- **任务**:
  - [ ] 测试包搜索/安装
  - [ ] 测试订阅管理
  - [ ] 测试版本检查
- **验收标准**: 覆盖率 ≥ 50%

### [ ] 9. 更新 CHANGELOG（v0.2.0 → v0.9.0）
- **工时**: 3 小时
- **文件**: `CHANGELOG.md`
- **任务**:
  - [ ] 从 Git 提交历史提取变更
  - [ ] 分类整理（feat/fix/refactor/breaking）
  - [ ] 补充 v0.3.0 ~ v0.9.0 的所有版本

---

## 📅 一个月内完成（P2）

### [ ] 10. 修复 HttpTransport 超时问题
- **工时**: 1 小时
- **文件**: `test/unit/mcp/HttpTransport.test.ts`

### [ ] 11. 优化 ChatSession 架构
- **工时**: 8 小时
- **任务**:
  - [ ] 引入 Facade 模式简化依赖
  - [ ] 减少构造函数参数
  - [ ] 改进初始化流程

### [ ] 12. 编写 Butler 使用指南
- **工时**: 4 小时
- **文件**: `docs/guides/butler-system.md`

### [ ] 13. 编写 Multi-Agent 最佳实践
- **工时**: 4 小时
- **文件**: `docs/guides/multi-agent-best-practices.md`

### [ ] 14. 启用 TypeScript strict 模式
- **工时**: 16 小时
- **任务**:
  - [ ] 配置 `strict: true`
  - [ ] 逐模块消除类型错误
  - [ ] 更新类型定义

### [ ] 15. 其他零散测试修复（11 failures）
- **工时**: 6 小时
- **分布**: BashTool, PersistentShell, WorkflowSkills, 等

---

## 📊 进度跟踪

| 阶段 | 任务数 | 已完成 | 进度 | 截止日期 |
|------|--------|--------|------|----------|
| P0 本周 | 3 | 0 | 0% | 2025-03-31 |
| P1 两周 | 6 | 0 | 0% | 2025-04-07 |
| P2 一月 | 6 | 0 | 0% | 2025-04-24 |

**总计**: 15 个主任务，预计 70 小时工作量

---

## 🎯 每日站会检查点

### 每日需回答的问题
1. 昨天完成了哪些任务？
2. 今天计划完成哪些任务？
3. 有什么阻碍需要解决？

### 每周回顾（周五）
1. 本周完成任务数 / 计划任务数
2. 测试通过率变化趋势
3. 下周重点任务

---

## 🛠️ 快速命令

### 运行特定模块测试
```bash
# Electron 集成
npx vitest run test/integration/electron-integration.test.ts

# Butler 模块
npx vitest run test/unit/butler/

# Auth 模块
npx vitest run test/unit/auth/

# 仅失败测试
npx vitest run --reporter=verbose 2>&1 | grep "❌"
```

### 检查覆盖率
```bash
npx vitest run --coverage test/unit/butler/
npx vitest run --coverage test/unit/auth/
npx vitest run --coverage test/unit/tiangong/
```

### 生成测试报告
```bash
npx vitest run --reporter=html
open html/index.html
```

---

## 📎 相关文档

- [质量审计报告](./QUALITY_AUDIT_ROUND_3.md)
- [失败测试详情](./failed-tests-detail.md)
- [项目开发规范](../../.xuanji/rules.md)

---

**最后更新**: 2025-03-24  
**下次更新**: 每日同步
