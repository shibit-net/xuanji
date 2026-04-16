# 真实多 Agent 协调测试任务（V2）

## 任务名称
多 Agent 故障隔离与回归稳定性验证（Fault Isolation & Regression Stability）

## 任务背景（真实问题）
当前项目里，多 Agent 测试链路存在已知不稳定点：
- `task` 工具在部分场景有依赖注入异常
- `tests/**` 与 `test/**` 的类型检查与路径别名覆盖历史上出现过不一致
- 多 Agent 相关集成测试需要一个“可复现、可审计”的标准流程

这个任务的目标不是做演示，而是让测试链路可重复执行、失败可定位、结果可审计。

---

## 目标
在不做大重构的前提下，完成一次真实多 Agent 协作：
1. 明确根因与修复边界
2. 落地最小改动
3. 跑通关键验证命令
4. 输出可复用报告

---

## 团队编排（用于测试协调能力）
策略：`pipeline`

### Agent A：诊断负责人（plan）
职责：
- 审查以下文件并给出根因分析：
  - `tests/multi-agent/quick-test.ts`
  - `tsconfig.json`
  - `src/core/tools/TaskTool.ts`
  - `test/integration/multi-agent-tools.test.ts`
  - `test/integration/team-subagent-integration.test.ts`
- 输出“问题 -> 根因 -> 最小修复方案 -> 风险”

输出格式：
- 最多 10 条行动项
- 每条必须带文件路径
- 每条必须有可验证结果

### Agent B：修复执行者（coder）
职责：
- 严格按 Agent A 计划实施
- 只做最小必要变更，禁止顺手重构
- 保持 TypeScript 严格模式兼容

输出格式：
- 变更文件清单
- 每个文件一句话说明“改了什么、为什么”
- 关键 patch 摘要

### Agent C：验证审计员（explore）
职责：
- 执行验证命令并记录结果
- 判定是否满足验收标准
- 对失败项给最小下一步修复建议

输出格式：
- 命令 + exit code + 结果摘要
- 验收标准逐条打勾/打叉
- 剩余风险清单

---

## 验收标准（必须全部可验证）
1. `tsconfig.json` 对 `test/**` 与 `tests/**` 的编译覆盖清晰且一致
2. 以下集成测试可执行并有明确结果：
   - `test/integration/multi-agent-tools.test.ts`
   - `test/integration/team-subagent-integration.test.ts`
3. `TaskTool` 在测试链路中的依赖注入保障明确（代码或测试桩）
4. 输出最终报告，至少包含：
   - 根因
   - 修复点
   - 验证结果
   - 剩余风险

---

## 验证命令（审计员执行）
```bash
npm run typecheck
npm run test -- test/integration/multi-agent-tools.test.ts
npm run test -- test/integration/team-subagent-integration.test.ts
npm run test:multi-agent:quick
```

---

## 交付物
- 代码改动（最小 patch）
- 测试执行日志
- 最终报告（Markdown）

建议文件名：
- `tests/multi-agent/REAL_TASK_V2_REPORT.md`

---

## 一次性投喂给多 Agent 的任务指令
```text
目标：修复并验证 xuanji 多 Agent 测试链路稳定性。聚焦 task 依赖注入、tests/test 目录类型检查覆盖、关键集成测试可执行性。

执行方式：pipeline 三角色
- plan：给根因与最小修复计划（含文件路径与验证点）
- coder：按计划改动，不做额外重构
- explore：执行验证命令，输出通过/失败与剩余风险

硬性要求：
- 只改必要文件
- 每个改动有理由
- 输出最终报告（根因/修复/验证/风险）
```
