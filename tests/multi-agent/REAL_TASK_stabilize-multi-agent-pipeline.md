# 真实多 Agent 协调测试任务

## 任务名称
恢复多 Agent 测试链路可执行性（Stabilize Multi-Agent Test Pipeline）

## 为什么这是“真实任务”
这个任务直接对应当前项目里已经暴露的问题：
- `task` 工具在某些测试链路中会出现依赖未注入异常
- `tests/multi-agent/quick-test.ts` 受 `tsconfig.json` 的 `include` 范围影响，`@/*` 路径别名在 `tests/**` 目录下可能无法正确解析

任务完成后，会直接提升多 Agent 功能回归测试的可执行性与可信度。

---

## 目标
让多 Agent 相关测试链路在本地可稳定运行，并产出可复现的验证报告。

---

## 推荐团队编排（用于测试协调能力）
策略：`pipeline`

### 成员 1：诊断负责人（plan）
- role: `plan`
- 职责：
  - 审查 `tests/multi-agent/quick-test.ts`、`tsconfig.json`、`src/core/tools/TaskTool.ts`
  - 明确“根因 -> 方案 -> 验证标准”
- 输出要求：
  - 一份结构化修复计划（最多 10 条）
  - 每条附对应文件路径

### 成员 2：修复执行者（coder）
- role: `coder`
- 职责：
  - 按成员 1 的方案实施代码修复
  - 只做最小必要改动，避免引入额外重构
- 输出要求：
  - 变更文件清单
  - 每个文件的改动目的

### 成员 3：验证与审计（explore）
- role: `explore`
- 职责：
  - 运行并记录验证命令
  - 检查是否满足验收标准
- 输出要求：
  - 命令 + 结果摘要（通过/失败）
  - 失败时给出下一步最小修复建议

---

## 验收标准（必须可验证）
1. `tsconfig.json` 对测试目录覆盖完整（`tests/**` 与 `test/**` 一致可编译）
2. 多 Agent 核心集成测试可执行（至少覆盖：`multi-agent-tools`、`team-subagent-integration`）
3. `TaskTool` 相关依赖注入路径在测试场景中有明确保障（代码或测试层）
4. 产出一份最终报告：
   - 根因
   - 修复点
   - 验证结果
   - 仍存风险

---

## 建议执行命令（验证成员使用）
```bash
npm run typecheck
npm run test -- test/integration/multi-agent-tools.test.ts
npm run test -- test/integration/team-subagent-integration.test.ts
```

---

## 可直接用于 `agent_team` 的输入示例
```json
{
  "team_name": "Multi-Agent Stabilization Team",
  "goal": "修复并验证 xuanji 项目多 Agent 测试链路：解决 tests 目录路径别名解析与 task 依赖注入稳定性问题，最终产出可复现验证报告。上下文：关键文件在 tests/multi-agent/quick-test.ts、tsconfig.json、src/core/tools/TaskTool.ts、test/integration/multi-agent-tools.test.ts、test/integration/team-subagent-integration.test.ts。输出必须包含根因、改动清单、验证命令结果、剩余风险。",
  "strategy": "pipeline",
  "members": [
    {
      "id": "diagnosis-lead",
      "role": "plan",
      "name": "Diagnosis Lead",
      "capabilities": ["root cause analysis", "test strategy", "risk assessment"]
    },
    {
      "id": "fix-implementer",
      "role": "coder",
      "name": "Fix Implementer",
      "capabilities": ["typescript", "test harness", "minimal patching"]
    },
    {
      "id": "verification-auditor",
      "role": "explore",
      "name": "Verification Auditor",
      "capabilities": ["test execution", "result auditing", "regression checks"]
    }
  ],
  "max_rounds": 5,
  "timeout": 600000
}
```
