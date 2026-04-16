# 真实多 Agent 协调测试任务（V3）

## 任务名称
修复 Butler/Reminder 决策链路可靠性（Butler Reminder Reliability Hardening）

## 任务背景（真实问题）
当前代码里有一组真实且可复现的问题，适合检验多 Agent 协作能力：
- `src/butler/ProactiveButler.ts` 的 `estimateUserOnlineStatus()` 内部异步查询未被等待，函数几乎总是返回 `isOnline: false`
- `src/core/tools/ReminderCheckTool.ts` 暴露了 `includeUpcoming` 参数，但执行逻辑未真正使用它控制“未来 N 天”窗口
- Butler/Reminder 关键链路缺少针对性测试，回归风险高（目前仅有 `memory-flush-e2e`，无 butler/reminder 专项测试）

这个任务不是演示题，而是直接提升“主动提醒是否可信”的真实工程任务。

---

## 目标
在最小改动前提下完成一次端到端修复与验证：
1. 修正在线状态推断逻辑
2. 让 `includeUpcoming` 参数真正生效
3. 补齐最少必要测试，防止回归
4. 产出可审计报告

---

## 团队编排（用于测试协调能力）
策略：`pipeline`

### Agent A：诊断与方案负责人（plan）
职责：
- 审查并定位根因：
  - `src/butler/ProactiveButler.ts`
  - `src/core/tools/ReminderCheckTool.ts`
  - `src/reminder/ReminderEngine.ts`
  - `test/integration/memory-flush-e2e.test.ts`
- 输出“问题 -> 根因 -> 最小修复点 -> 验证点 -> 风险”

输出要求：
- 最多 10 条行动项
- 每条必须附文件路径
- 每条必须可验证

### Agent B：修复执行者（coder）
职责：
- 严格按 Agent A 的计划改动
- 仅做最小必要变更，禁止顺手重构
- 新增测试优先覆盖：
  - Butler 在线状态推断
  - Reminder upcoming 窗口参数

输出要求：
- 变更文件清单
- 每个文件一句话说明“改了什么、为什么”
- 关键 patch 摘要

### Agent C：验证审计员（explore）
职责：
- 运行验证命令并记录 exit code
- 对照验收标准逐条判定
- 对失败项给出最小下一步修复建议

输出要求：
- 命令 + exit code + 结果摘要
- 验收项打勾/打叉
- 剩余风险清单

---

## 验收标准（必须可验证）
1. `estimateUserOnlineStatus()` 的返回值不再被“未等待的异步查询”短路，存在可测试的在线判定路径
2. `reminder_check` 的 `includeUpcoming` 参数可控制 upcoming 提醒窗口（例如 1 天与 7 天结果不同）
3. 新增或更新测试覆盖上述两点，并可稳定执行
4. 现有关键集成测试不被破坏（至少 `multi-agent-tools` 与 `team-subagent-integration` 可执行）
5. 产出最终报告，包含：根因、修复点、验证结果、剩余风险

---

## 建议验证命令（审计员执行）
```bash
npm run typecheck
npm run test -- test/integration/multi-agent-tools.test.ts
npm run test -- test/integration/team-subagent-integration.test.ts
npm run test -- test/integration/memory-flush-e2e.test.ts
npm run test -- test/integration/butler-reminder-integration.test.ts
```

---

## 交付物
- 最小代码补丁
- 测试执行日志
- 最终报告（Markdown）

建议报告文件名：
- `tests/multi-agent/REAL_TASK_V3_REPORT.md`

---

## 一次性投喂给多 Agent 的任务指令
```text
目标：修复 xuanji 中 Butler/Reminder 决策链路的两个真实问题，并补齐最少必要测试，保证回归可控。

已知线索：
- ProactiveButler 的在线状态推断疑似被异步调用短路
- reminder_check 的 includeUpcoming 参数疑似未生效

执行方式：pipeline 三角色
- plan：输出根因与最小修复计划（含文件路径与验证点）
- coder：按计划改动，不做额外重构
- explore：执行验证命令，输出通过/失败与剩余风险

硬性要求：
- 只改必要文件
- 每个改动有理由
- 必须新增/更新测试覆盖两个修复点
- 输出最终报告（根因/修复/验证/风险）
```
