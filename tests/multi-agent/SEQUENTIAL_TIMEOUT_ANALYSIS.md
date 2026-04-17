# Sequential 策略超时深度分析

**分析时间**: 2026-04-18 03:30  
**分析对象**: agent_team sequential 策略第一个成员超时失败

---

## 📋 问题现象

```
策略: sequential
成员: stats_collector (第1个成员)
耗时: 60.0s (达到超时上限)
Token消耗: 30,710 in / 822 out
状态: ❌ 超时失败
后续影响: dependency_analyzer 和 risk_assessor 未执行
```

---

## 🔍 根本原因分析

### 1. 超时分配机制 ⚠️

根据 `TeamManager.ts` 的 `calculateMemberTimeout()` 方法（第 927-937 行）：

```typescript
case 'sequential': {
  // 顺序执行：前松后紧，前面成员稍宽裕，后面成员稍紧凑
  if (memberIndex !== undefined) {
    // 渐进式调整：第 1 个成员 1.2x，最后 0.8x
    const weight = 1.2 - (memberIndex / Math.max(memberCount - 1, 1)) * 0.4;
    perMemberTimeout = Math.floor(baseTimeout * weight);
  } else {
    perMemberTimeout = baseTimeout;
  }
  break;
}
```

**实际计算**:
- `baseTimeout` = 60,000ms (1分钟，默认值)
- `memberIndex` = 0 (第一个成员)
- `memberCount` = 3
- `weight` = 1.2 - (0 / 2) * 0.4 = **1.2**
- `perMemberTimeout` = 60,000 * 1.2 = **72,000ms (1.2分钟)**

**问题**: 虽然代码设计了 1.2x 的权重，但实际执行时成员配置中显式设置了 `timeout: 60000`，**显式超时优先级更高**（第 906-908 行）：

```typescript
// 优先级 1: 成员显式设置的超时
if (member.timeout) {
  return member.timeout;  // 直接返回 60,000ms
}
```

**结论**: 我们在配置中设置了 `timeout: 60000`，覆盖了自动计算的 72,000ms，导致第一个成员只有 1 分钟。

---

### 2. 任务范围过大 🔴

**配置的任务**:
```
任务：统计 xuanji 项目的代码规模。
使用 bash 工具执行：
1) find src -name '*.ts' | wc -l 统计 TS 文件数
2) cloc src --json 统计代码行数（如果有 cloc）或使用 wc -l
输出格式：JSON {"files": N, "lines": N, "modules": ["memory", "context", ...]}
限时 1 分钟。
```

**问题分析**:
- 要求统计整个 `src` 目录（99 个文件）
- 要求输出所有模块列表（需要分析目录结构）
- 使用 `explore` agent（倾向于深入探索，而非快速执行）
- Token 消耗 30,710 说明进行了大量文件读取

**explore agent 的行为特征**:
- 倾向于先理解项目结构
- 可能读取多个文件来确定模块列表
- 不会直接执行简单的 bash 命令，而是先探索再执行

---

### 3. 工具选择不当 ⚠️

**system_prompt 建议使用 `cloc`**:
```
cloc src --json 统计代码行数（如果有 cloc）或使用 wc -l
```

**问题**:
- 系统可能未安装 `cloc`
- agent 需要先尝试 `cloc`，失败后再尝试其他方法
- 这增加了额外的时间开销

---

### 4. 输出格式要求复杂 ⚠️

**要求输出 JSON 格式**:
```json
{"files": N, "lines": N, "modules": ["memory", "context", ...]}
```

**问题**:
- 需要额外分析来确定 `modules` 数组
- explore agent 可能读取 `src` 目录结构来提取模块名
- 这进一步增加了时间和 Token 消耗

---

### 5. Sequential 策略的放大效应 🔴

根据 `executeSequential()` 方法（第 408-426 行）：

```typescript
private async executeSequential(goal: string, signal?: AbortSignal): Promise<TaskExecutionResult[]> {
  const results: TaskExecutionResult[] = [];
  const members = this.getSortedMembers();

  for (let i = 0; i < members.length; i++) {
    if (!this.running || signal?.aborted) break;
    const member = members[i];

    const result = await this.executeMemberTask(member, goal, results, undefined, i, signal);
    results.push(result);

    if (!result.success) {
      log.warn(`Member ${member.id} failed, stopping sequential execution`);
      break;  // 🔴 第一个失败，整个流程终止
    }
  }

  return results;
}
```

**关键逻辑**:
- Sequential 策略是**串行执行**
- 第一个成员失败 → 立即 `break`
- 后续成员（dependency_analyzer、risk_assessor）**完全没有执行机会**

**这是 Sequential 策略的最大风险点**：
- Parallel 策略：单个失败不影响其他成员
- Sequential 策略：第一个失败 = 全盘失败

---

## 📊 Token 消耗分析

**30,710 tokens 输入说明**:

假设平均每个文件 1,500-3,000 tokens：
- 30,710 / 2,000 ≈ **15 个文件**

**可能的执行路径**:
1. 读取 `src` 目录结构（`list_directory` 或 `glob`）
2. 读取 `package.json` 理解项目类型
3. 读取 `src/memory/types.ts`（最大的类型文件）
4. 读取 `src/context/types.ts`
5. 读取 `src/session/types.ts`
6. 读取其他 10+ 个文件来理解模块结构
7. 尝试执行 `cloc` 命令（失败）
8. 尝试其他统计方法
9. 构建 JSON 输出
10. **超时** ⏰

---

## 🆚 对比：Parallel 策略的成功案例

Parallel 策略中的 4 个成员都成功了：

| 成员 | 耗时 | Token消耗 | 状态 | 超时设置 |
|------|------|-----------|------|----------|
| memory_analyzer | 24.0s | 19,518 | ✅ | 120s (2分钟) |
| context_analyzer | 20.4s | 3,710 | ✅ | 120s (2分钟) |
| session_analyzer | 25.6s | 20,940 | ✅ | 120s (2分钟) |
| tools_analyzer | 26.5s | 12,829 | ✅ | 120s (2分钟) |

**关键差异**:

| 维度 | Sequential (失败) | Parallel (成功) |
|------|------------------|----------------|
| **任务范围** | 整个 src 目录 | 单个模块（memory/context/session/tools） |
| **超时设置** | 60s (1分钟) | 120s (2分钟) |
| **输出要求** | JSON 格式 + 模块列表 | 300 字 Markdown |
| **执行方式** | 串行（失败即终止） | 并行（互不影响） |
| **Agent 类型** | explore | explore |

---

## 💡 解决方案

### 方案 1: 移除显式超时，使用自动计算 ⭐ 推荐

```typescript
{
  "id": "stats_collector",
  "role": "explore",
  // ❌ 移除这一行: timeout: 60000
  "system_prompt": "..."
}
```

**效果**: 自动计算超时 = 60,000 * 1.2 = **72,000ms (1.2分钟)**

---

### 方案 2: 增加显式超时

```typescript
{
  "id": "stats_collector",
  "role": "explore",
  "timeout": 120000,  // 2分钟
  "system_prompt": "..."
}
```

---

### 方案 3: 缩小任务范围 ⭐ 推荐

```typescript
{
  "id": "stats_collector",
  "role": "explore",
  "timeout": 90000,  // 1.5分钟
  "system_prompt": "任务：快速统计 xuanji 项目的代码规模。\n\n执行步骤：\n1. 使用 bash 执行: find src -name '*.ts' | wc -l\n2. 使用 bash 执行: find src -type f -name '*.ts' -exec wc -l {} + | tail -1\n3. 使用 bash 执行: ls -d src/*/ | xargs -n1 basename\n\n输出格式：\n- TS文件数: N\n- 总行数: N\n- 模块列表: [memory, context, ...]\n\n限时 1.5 分钟。不要读取文件内容，只使用 bash 命令。"
}
```

**关键改进**:
- ✅ 明确指定"不要读取文件内容"
- ✅ 明确指定"只使用 bash 命令"
- ✅ 提供具体的命令示例
- ✅ 简化输出格式（不要求 JSON）

---

### 方案 4: 更换 Agent 类型 ⭐ 推荐

```typescript
{
  "id": "stats_collector",
  "role": "plan",  // 改用 plan agent，更快
  "timeout": 90000,
  "system_prompt": "..."
}
```

**理由**:
- `plan` agent 更倾向于快速执行
- `explore` agent 倾向于深入探索（适合分析，不适合统计）

---

### 方案 5: 拆分任务 ⭐⭐ 最佳方案

将第一个成员的任务拆分为更小的粒度：

```typescript
{
  "id": "file_counter",
  "role": "plan",
  "timeout": 60000,
  "system_prompt": "使用 bash 执行: find src -name '*.ts' | wc -l。输出文件数量。"
},
{
  "id": "line_counter",
  "role": "plan",
  "timeout": 60000,
  "system_prompt": "接收上一步的文件数量，使用 bash 统计总行数。"
},
{
  "id": "dependency_analyzer",
  "role": "explore",
  "timeout": 90000,
  "system_prompt": "..."
}
```

---

## 📈 性能优化建议

### 对 Sequential 策略的建议

1. **第一个成员最关键** 🔴
   - 第一个成员失败 = 整个流程失败
   - 第一个成员应该是最简单、最可靠的任务
   - 建议第一个成员超时设置为 **1.5-2x baseTimeout**

2. **任务拆分要细粒度** ✅
   - 避免"统计整个项目"这种过大的任务
   - 每个成员只做一件事
   - 任务之间通过数据传递连接

3. **使用快速 Agent** ✅
   - 统计类任务：使用 `plan` agent
   - 分析类任务：使用 `explore` agent
   - 代码生成：使用 `coder` agent

4. **明确工具使用** ✅
   - 在 system_prompt 中明确指定使用哪些工具
   - 避免"如果有 X 就用 X，否则用 Y"这种模糊指令
   - 提供具体的命令示例

5. **简化输出格式** ✅
   - 避免复杂的 JSON 格式
   - 使用简单的文本输出
   - 后续成员可以解析前一个成员的输出

---

## 🎯 最佳实践总结

### ✅ DO（推荐做法）

1. **移除显式超时**，让系统自动计算（Sequential 第一个成员会得到 1.2x）
2. **缩小任务范围**，每个成员只做一件事
3. **使用快速 Agent**（plan > explore）
4. **明确工具使用**，提供具体命令示例
5. **简化输出格式**，避免复杂的 JSON
6. **第一个成员最简单**，确保成功率

### ❌ DON'T（避免做法）

1. ❌ 不要在第一个成员设置过短的显式超时
2. ❌ 不要给第一个成员分配复杂的任务
3. ❌ 不要使用"如果...否则..."这种模糊指令
4. ❌ 不要要求 explore agent 快速执行统计任务
5. ❌ 不要在 Sequential 策略中使用超过 5 个成员
6. ❌ 不要期望第一个成员失败后还能继续

---

## 📝 修正后的配置示例

```typescript
agent_team({
  goal: "顺序执行三个依赖任务：1) 统计代码行数 2) 分析依赖关系 3) 评估技术债务风险",
  members: [
    {
      id: "stats_collector",
      role: "plan",  // ✅ 改用 plan agent
      // ✅ 移除显式超时，使用自动计算（72s）
      system_prompt: "使用 bash 快速统计 xuanji 项目代码规模：\n1. find src -name '*.ts' | wc -l\n2. find src -name '*.ts' -exec wc -l {} + | tail -1\n\n输出格式：\n- TS文件数: N\n- 总行数: N\n\n限时 1 分钟。只使用 bash 命令，不要读取文件内容。"
    },
    {
      id: "dependency_analyzer",
      role: "explore",
      timeout: 120000,  // ✅ 2分钟
      system_prompt: "接收上一步的统计结果，读取 package.json 分析依赖关系。检查：1) 生产依赖数量 2) 是否有过时的包 3) 是否有安全漏洞风险。输出不超过 200 字。"
    },
    {
      id: "risk_assessor",
      role: "plan",
      timeout: 120000,  // ✅ 2分钟
      system_prompt: "接收前两步的结果（代码规模 + 依赖分析），评估技术债务风险。评估维度：1) 代码复杂度 2) 依赖健康度 3) 测试覆盖率。输出：风险等级（低/中/高）+ 3 条改进建议，不超过 250 字。"
    }
  ],
  strategy: "sequential",
  timeout: 360000  // ✅ 团队总超时 6 分钟
})
```

---

## 🔬 验证建议

重新执行修正后的配置，预期结果：

| 成员 | 预期耗时 | 预期状态 |
|------|---------|---------|
| stats_collector | 20-30s | ✅ 成功 |
| dependency_analyzer | 40-60s | ✅ 成功 |
| risk_assessor | 30-50s | ✅ 成功 |
| **总计** | **90-140s** | **✅ 全部成功** |

---

**报告生成时间**: 2026-04-18 03:35  
**分析者**: 璇玑 (Xuanji AI Butler)
