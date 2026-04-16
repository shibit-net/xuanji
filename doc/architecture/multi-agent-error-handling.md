# 多 Agent 协作时的错误处理机制

## 核心问题：如果一个 Agent 的 LLM 调用失败了怎么办？

答案：**根据不同的协作模式，有不同的处理策略**。

---

## 1. 错误捕获机制

### 1.1 单个 Agent 的错误处理

每个子 Agent 执行时，错误会被捕获并封装到结果中：

```typescript
// TeamManager.ts - executeMemberTask
try {
  // 执行子代理
  const factoryResult = await this.subAgentFactory.createAndRun(member.role, {
    task: enrichedTask,
    depth: this.depth + 1,
    timeout: this.context!.config.timeout,
    systemPrompt: member.systemPrompt,
    tools: member.tools,
  });

  result = {
    result: factoryResult.result,
    tokensUsed: factoryResult.tokensUsed,
    duration: factoryResult.duration,
    timedOut: factoryResult.timedOut,
    iterations: factoryResult.iterations,
  };

  const executionResult: TaskExecutionResult = {
    taskId: tid,
    memberId: member.id,
    result: result.result,
    success: !result.timedOut && !('hasError' in result && result.hasError),
    duration: result.duration,
    tokensUsed: result.tokensUsed,
  };

  return executionResult;
  
} catch (error) {
  // 🔑 错误被捕获，返回失败结果（不会抛出异常）
  const duration = Date.now() - startTime;
  const errMsg = error instanceof Error ? error.message : String(error);

  return {
    taskId: tid,
    memberId: member.id,
    result: '',
    success: false,  // ← 标记为失败
    duration,
    tokensUsed: { input: 0, output: 0 },
    error: errMsg,   // ← 错误信息
  };
}
```

**关键点：**
- 错误不会向上抛出，而是封装到 `TaskExecutionResult` 中
- `success: false` 标记任务失败
- `error` 字段包含错误信息

### 1.2 SubAgentFactory 的错误处理

```typescript
// SubAgentFactory.ts - createAndRun
try {
  const runPromise = agentLoop.run(options.task);
  runPromise.catch(() => {});  // 防止 unhandled rejection

  if (context.timeout > 0) {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        agentLoop.stop();
        timedOut = true;
        reject(new Error(`Sub-agent timed out after ${context.timeout}ms`));
      }, context.timeout);
    });

    await Promise.race([runPromise, timeoutPromise]);
  } else {
    await runPromise;
  }
} catch (error: any) {
  if (!timedOut) {
    log.error(`[${subAgentId}] Error:`, error.message);
    outputText += `\n\n[Error] ${error.message}`;  // ← 错误追加到输出
  }
} finally {
  if (timeoutTimer) {
    clearTimeout(timeoutTimer);
  }
}

// 返回结果（即使出错也返回）
return {
  result: outputText || (timedOut ? `Timed out after ${context.timeout}ms` : 'No output'),
  tokensUsed: state.tokenUsage,
  duration,
  timedOut,
  iterations: state.currentIteration,
};
```

**关键点：**
- 超时保护：超过时间限制会自动停止
- 错误信息追加到输出文本中
- 始终返回结果对象（不抛出异常）

### 1.3 ErrorRecovery 错误分类

```typescript
// ErrorRecovery.ts
static isFatalError(error: Error): boolean {
  const msg = error.message.toLowerCase();

  // 认证错误（致命）
  if (msg.includes('api_key') || msg.includes('authentication') || 
      msg.includes('unauthorized') || msg.includes('403')) {
    return true;
  }

  // 网络错误（致命）
  if (msg.includes('econnrefused') || msg.includes('enotfound') || 
      msg.includes('getaddrinfo')) {
    return true;
  }

  // 无效配置（致命）
  if (msg.includes('unsupported model') || msg.includes('not supported')) {
    return true;
  }

  // 参数错误（致命）
  if (msg.includes('invalid') && msg.includes('parameter')) {
    return true;
  }

  return false;
}
```

**错误类型：**
- **致命错误**：API Key 错误、网络连接失败、配置错误 → 立即停止
- **可重试错误**：限流、服务端临时故障 → 可以重试（但默认只重试 1 次）

---

## 2. 不同协作模式的错误处理策略

### 2.1 顺序执行（Sequential）

```typescript
// TeamManager.ts - executeSequential
for (const member of members) {
  if (!this.running) break;

  const result = await this.executeMemberTask(member, goal, results);
  results.push(result);

  if (!result.success) {
    log.warn(`Member ${member.id} failed, stopping sequential execution`);
    break;  // 🔑 遇到失败立即停止，不执行后续成员
  }
}

return results;
```

**策略：Fail-Fast（快速失败）**
- 一个成员失败，立即停止整个流程
- 后续成员不再执行
- 适合：流水线式任务，前面失败后面无法继续

**示例：**
```
Agent A: 成功 ✓
Agent B: 失败 ✗  ← 停止
Agent C: 未执行
Agent D: 未执行
```

### 2.2 并行执行（Parallel）

```typescript
// TeamManager.ts - executeParallel
const members = this.context!.config.members;
const MAX_CONCURRENT = 3;

if (members.length <= MAX_CONCURRENT) {
  // 成员数不超过并发上限，直接全部并行
  return Promise.all(members.map(member => 
    this.executeMemberTask(member, goal, [])
  ));
}

// 分批并行，每批最多 MAX_CONCURRENT 个
const results: TaskExecutionResult[] = [];
for (let i = 0; i < members.length; i += MAX_CONCURRENT) {
  if (!this.running) break;
  const batch = members.slice(i, i + MAX_CONCURRENT);
  const batchResults = await Promise.all(
    batch.map(member => this.executeMemberTask(member, goal, []))
  );
  results.push(...batchResults);
}
return results;
```

**策略：Best-Effort（尽力而为）**
- 所有成员并行执行，互不影响
- 一个成员失败不影响其他成员
- 所有成员执行完毕后，返回所有结果（包括失败的）
- 适合：独立的并行任务，失败不影响其他任务

**示例：**
```
Agent A: 成功 ✓
Agent B: 失败 ✗  ← 不影响其他
Agent C: 成功 ✓
Agent D: 成功 ✓

最终结果：3 成功，1 失败
```

### 2.3 层级执行（Hierarchical）

```typescript
// TeamManager.ts - executeHierarchical
const members = this.getSortedMembers();

// 主 agent（优先级最高）
const leader = members[0];
const leaderResult = await this.executeMemberTask(leader, goal, []);
results.push(leaderResult);

if (!leaderResult.success) {
  return results;  // 🔑 Leader 失败，直接返回，不执行 Worker
}

// 根据主 agent 的输出，分配给其他成员
const workers = members.slice(1);
const workerPromises = workers.map(worker =>
  this.executeMemberTask(
    worker,
    `Based on the leader's analysis:\n${leaderResult.result}\n\nYour task: ${goal}`,
    results,
  )
);

const workerResults = await Promise.all(workerPromises);
results.push(...workerResults);

return results;
```

**策略：Leader-Dependent（依赖 Leader）**
- Leader 失败 → 整个任务失败，Worker 不执行
- Leader 成功 → Worker 并行执行，失败不影响其他 Worker
- 适合：有明确层级的任务，Leader 的分析是后续工作的基础

**示例：**
```
场景 1：Leader 失败
Leader: 失败 ✗  ← 停止
Worker A: 未执行
Worker B: 未执行

场景 2：Leader 成功，Worker 部分失败
Leader: 成功 ✓
Worker A: 成功 ✓
Worker B: 失败 ✗  ← 不影响其他
Worker C: 成功 ✓

最终结果：Leader + 2 个 Worker 成功，1 个 Worker 失败
```

### 2.4 辩论模式（Debate）

```typescript
// TeamManager.ts - executeDebate
for (let round = 0; round < maxRounds && this.running; round++) {
  this.context!.currentRound = round + 1;
  log.info(`Debate round ${round + 1}/${maxRounds}`);

  // 每轮所有成员发言
  for (const member of members) {
    const previousResults = results.filter(r => 
      r.taskId.startsWith(`debate-round-${round}`)
    );
    const context = previousResults.length > 0
      ? `Previous opinions:\n${previousResults.map(r => 
          `${r.memberId}: ${r.result}`
        ).join('\n\n')}`
      : '';

    const taskDescription = context
      ? `${goal}\n\n${context}\n\nYour turn to respond:`
      : goal;

    const result = await this.executeMemberTask(
      member,
      taskDescription,
      results,
      `debate-round-${round + 1}-${member.id}`,
    );
    results.push(result);
    
    // 🔑 注意：即使失败也会继续，失败的观点也会被记录
  }

  // 检查是否达成共识
  const roundResults = results.slice(-members.length);
  const allAgree = roundResults.every(r =>
    r.result.toLowerCase().includes('agree') || 
    r.result.toLowerCase().includes('consensus')
  );

  if (allAgree) {
    log.info('Consensus reached, ending debate');
    break;
  }
}

return results;
```

**策略：Continue-on-Error（继续执行）**
- 一个成员失败，其他成员继续发言
- 失败的成员在下一轮可以重新尝试
- 失败的观点也会被记录（作为空结果或错误信息）
- 适合：辩论讨论，一个人失败不应该终止整个讨论

**示例：**
```
Round 1:
Agent A: 成功 ✓ "我认为方案 X"
Agent B: 失败 ✗ (LLM 调用失败)
Agent C: 成功 ✓ "我同意 A"

Round 2:
Agent A: 成功 ✓ "考虑到 C 的意见..."
Agent B: 成功 ✓ "我现在认为方案 Y"  ← 重新尝试成功
Agent C: 成功 ✓ "我同意 B"

最终结果：6 次发言，1 次失败，5 次成功
```

### 2.5 流水线（Pipeline）

```typescript
// TeamManager.ts - executePipeline
let currentInput = goal;

for (const member of members) {
  if (!this.running) break;

  const result = await this.executeMemberTask(member, currentInput, results);
  results.push(result);

  if (!result.success) {
    log.warn(`Pipeline failed at member ${member.id}`);
    break;  // 🔑 遇到失败立即停止
  }

  // 下一个成员的输入是当前成员的输出
  currentInput = result.result;
}

return results;
```

**策略：Fail-Fast（快速失败）**
- 与顺序执行类似，一个成员失败立即停止
- 因为下一个成员依赖上一个成员的输出
- 适合：数据处理流水线，前面失败后面无法继续

**示例：**
```
Agent A: 成功 ✓ → 输出 "数据 A"
Agent B: 失败 ✗  ← 停止
Agent C: 未执行
Agent D: 未执行
```

---

## 3. 错误处理的最佳实践

### 3.1 错误信息传递

失败的 Agent 的错误信息会被记录到结果中：

```typescript
{
  taskId: "task-agent-b-123456",
  memberId: "agent-b",
  result: "",  // 空结果
  success: false,
  duration: 1234,
  tokensUsed: { input: 0, output: 0 },
  error: "API authentication failed: Invalid API key"  // ← 错误信息
}
```

### 3.2 结果聚合

团队执行完成后，会聚合所有成员的结果：

```typescript
// TeamManager.ts - aggregateResults
private aggregateResults(results: TaskExecutionResult[]): string {
  if (results.length === 0) {
    return 'No results to aggregate';
  }

  // 按成员分组
  const byMember = new Map<string, TaskExecutionResult[]>();
  for (const result of results) {
    const existing = byMember.get(result.memberId) || [];
    existing.push(result);
    byMember.set(result.memberId, existing);
  }

  // 构建聚合报告
  let report = `Team Execution Summary:\n\n`;
  
  for (const [memberId, memberResults] of byMember) {
    report += `## ${memberId}\n`;
    for (const result of memberResults) {
      if (result.success) {
        report += `✓ ${result.result}\n\n`;
      } else {
        report += `✗ Failed: ${result.error || 'Unknown error'}\n\n`;
      }
    }
  }

  return report;
}
```

### 3.3 超时保护

每个子 Agent 都有超时保护：

```typescript
// SubAgentFactory.ts
if (context.timeout > 0) {
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => {
      agentLoop.stop();  // ← 停止 Agent
      timedOut = true;
      reject(new Error(`Sub-agent timed out after ${context.timeout}ms`));
    }, context.timeout);
  });

  await Promise.race([runPromise, timeoutPromise]);
}
```

**默认超时：**
- 单个子 Agent：5 分钟（300,000 ms）
- 可通过配置调整

### 3.4 Hook 事件通知

错误会通过 Hook 系统通知：

```typescript
// TeamManager.ts
if (this.hookRegistry) {
  this.hookRegistry.emit('TeamMemberEnd', {
    teamId: `team-${this.context!.startTime}`,
    data: {
      memberId: member.id,
      success: executionResult.success,  // ← 成功/失败状态
      duration: executionResult.duration,
    },
  }).catch((err) => {
    log.debug('TeamMemberEnd hook emit failed:', err);
  });
}
```

---

## 4. 错误处理策略对比

| 协作模式 | 错误策略 | 一个失败的影响 | 适用场景 |
|---------|---------|--------------|---------|
| **Sequential** | Fail-Fast | 立即停止，后续不执行 | 流水线式任务 |
| **Parallel** | Best-Effort | 不影响其他成员 | 独立并行任务 |
| **Hierarchical** | Leader-Dependent | Leader 失败全部停止<br>Worker 失败不影响其他 | 有层级的任务 |
| **Debate** | Continue-on-Error | 继续执行，下轮可重试 | 辩论讨论 |
| **Pipeline** | Fail-Fast | 立即停止，后续不执行 | 数据处理流水线 |

---

## 5. 用户视角的错误处理

### 5.1 错误可见性

用户可以看到：
- 哪个 Agent 失败了
- 失败的原因（错误信息）
- 失败的时间点
- 其他 Agent 的执行结果

### 5.2 错误恢复

**自动恢复：**
- 辩论模式：失败的 Agent 在下一轮可以重新尝试
- 其他模式：不自动重试（避免浪费资源）

**手动恢复：**
- 用户可以查看错误信息
- 修复问题（如 API Key、网络）后重新执行

### 5.3 部分成功

并行模式和辩论模式支持部分成功：
- 即使部分 Agent 失败，也会返回成功 Agent 的结果
- 用户可以基于部分结果继续工作

---

## 6. 总结

**核心设计原则：**

1. **错误隔离**：一个 Agent 的错误不会导致整个系统崩溃
2. **错误封装**：错误信息封装到结果对象中，不向上抛出异常
3. **策略灵活**：根据协作模式选择合适的错误处理策略
4. **信息透明**：错误信息对用户可见，便于诊断和修复
5. **资源保护**：超时机制防止 Agent 无限期挂起

**关键代码位置：**
- `TeamManager.ts::executeMemberTask()` - 单个成员的错误捕获
- `SubAgentFactory.ts::createAndRun()` - 子 Agent 的错误处理和超时
- `ErrorRecovery.ts` - 错误分类和格式化
- `TeamManager.ts::executeXXX()` - 各协作模式的错误策略
