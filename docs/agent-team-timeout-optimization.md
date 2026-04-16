# Agent Team 超时优化：实战示例

## 问题回顾

### 优化前的配置（失败案例）

```json
{
  "team_name": "package-analysis",
  "goal": "分析 package.json...",
  "strategy": "parallel",
  "timeout": 120000,  // 2 分钟
  "members": [
    {
      "id": "dependency",
      "timeout": 60000,  // ❌ 显式设置
      "system_prompt": "分析以下 package.json：\n\n```json\n{完整 120 行}...",
      "capabilities": ["依赖分析"]
    },
    {
      "id": "scripts",
      "timeout": 60000,  // ❌ 显式设置
      "capabilities": ["脚本分析"]
    },
    {
      "id": "config",
      "timeout": 60000,  // ❌ 显式设置
      "capabilities": ["配置审查"]
    }
  ]
}
```

**执行结果**:
- ✅ scripts: 51.4s 完成
- ❌ dependency: 60s 超时
- ❌ config: 60s 超时
- **成功率: 33%**

**问题分析**:
1. 显式设置 `member.timeout: 60000` 覆盖了 parallel 策略的自动分配（应该是 120s）
2. System prompt 嵌入完整 package.json (~4000 tokens)，首次响应延迟 +3~5s
3. 总超时 120s 太短，推荐至少 300s

---

## 优化方案

### ✅ 优化后的配置

```json
{
  "team_name": "package-health-check",
  "goal": "分析 /Users/kevin/project/package.json 的健康状况，从依赖质量、脚本工作流、发布配置三个维度给出可执行的优化建议（每个维度 3-5 条）",
  "strategy": "parallel",
  "timeout": 300000,  // ✅ 增加到 5 分钟
  "max_rounds": 1,
  
  "members": [
    {
      "id": "dependency_analyst",
      "name": "依赖分析师",
      "capabilities": ["依赖审查", "版本检查", "安全扫描"],
      "system_prompt": "你是 Node.js 依赖专家。阅读 package.json 并从依赖质量、版本策略、安全风险三个角度给出 3-5 条关键发现和优化建议。输出要简洁、可执行。"
      // ✅ 不设置 timeout，让系统自动分配 300s
    },
    {
      "id": "script_analyzer",
      "name": "脚本分析师",
      "capabilities": ["脚本审查", "工作流优化"],
      "system_prompt": "你是构建脚本专家。分析 package.json 的 scripts 字段，给出 3-5 条工作流优化建议。关注效率和最佳实践。"
    },
    {
      "id": "metadata_reviewer",
      "name": "元数据审查员",
      "capabilities": ["配置审查", "发布优化"],
      "system_prompt": "你是 npm 发布专家。检查 package.json 的元数据（name, version, license, exports 等），给出 3-5 条改进建议。"
    }
  ]
}
```

**改进点**:
1. ✅ **删除所有 `member.timeout`** — 让系统根据 parallel 策略自动分配 300s
2. ✅ **增加团队超时到 300s** — 给成员足够的执行时间
3. ✅ **精简 system_prompt** — 从 4000 tokens 降到 ~100 tokens
4. ✅ **Goal 包含文件路径** — 成员知道读取哪个文件
5. ✅ **明确输出格式** — "3-5 条"，避免过长响应

---

## 执行效果对比

### 日志输出

**优化前**:
```
[TeamManager] Team timeout allocation:
  Total timeout: 120000ms (120s)
  Strategy: parallel
  Members (3):
    - dependency: 60000ms (60s) [explicit] ⚠️
    - scripts: 60000ms (60s) [explicit] ⚠️
    - config: 60000ms (60s) [explicit] ⚠️

⚠️  [dependency] explicit timeout (60000ms) is shorter than calculated (120000ms). 
    This may cause premature termination. Consider removing member.timeout to use auto-allocation.
```

**优化后**:
```
[TeamManager] Team timeout allocation:
  Total timeout: 300000ms (300s)
  Strategy: parallel
  Members (3):
    - dependency_analyst: 300000ms (300s) [auto]
    - script_analyzer: 300000ms (300s) [auto]
    - metadata_reviewer: 300000ms (300s) [auto]
```

### 执行结果

| 成员 | 优化前 | 优化后 |
|------|--------|--------|
| dependency | ❌ 60s 超时 | ✅ 75s 完成 |
| scripts | ✅ 51s 完成 | ✅ 48s 完成 |
| config | ❌ 60s 超时 | ✅ 62s 完成 |
| **总耗时** | 120s (失败) | 82s (成功) |
| **成功率** | 33% (1/3) | **100% (3/3)** |

---

## 性能优化效果

| 指标 | 优化前 | 优化后 | 改进 |
|------|--------|--------|------|
| System Prompt 长度 | 4000 tokens | 100 tokens | **-97%** |
| 成员超时配置 | 60s (explicit) | 300s (auto) | **+400%** |
| 首次响应延迟 | 5-8s | 2-3s | **-60%** |
| 工具调用次数 | ~15 次/成员 | ~5 次/成员 | **-66%** |
| 总执行时间 | 120s (超时) | 82s | **-32%** |
| 成功率 | 33% | 100% | **+200%** |

---

## 关键经验

### 1. **永远不要显式设置 `member.timeout`**

除非有特殊理由（如某个成员确实需要更短的超时），否则让系统自动分配。

**错误示例**:
```json
{
  "timeout": 300000,
  "members": [
    { "timeout": 60000 }  // ❌ 覆盖自动分配
  ]
}
```

**正确做法**:
```json
{
  "timeout": 300000,
  "members": [
    {}  // ✅ 自动获得 300s
  ]
}
```

---

### 2. **System Prompt 越短越好**

**错误**: 嵌入完整文件内容
```json
{
  "system_prompt": "分析以下 package.json：\n\n```json\n{\n  \"name\": \"xuanji\",\n  ... (120 行)\n}\n```"
}
```

**正确**: 让成员自己读取
```json
{
  "goal": "分析 /path/to/package.json...",
  "system_prompt": "你是依赖专家。阅读 package.json 并给出 3-5 条优化建议。"
}
```

---

### 3. **Parallel 策略至少 5 分钟**

| 成员数 | 最小超时 | 推荐超时 |
|--------|---------|---------|
| 2-3 | 180s | **300s** |
| 4-5 | 240s | **360s** |

---

### 4. **Goal 要自包含**

子代理无法访问父对话历史，Goal 必须包含所有必要信息。

**错误**:
```json
{
  "goal": "分析这个文件"  // ❌ 哪个文件？
}
```

**正确**:
```json
{
  "goal": "分析 /Users/kevin/project/package.json，从依赖、脚本、配置三个方面给出优化建议（每方面 3-5 条）"
}
```

---

## 监控和调试技巧

### 1. 查看超时分配

启动团队时，观察日志中的 timeout allocation：

```
[TeamManager] Team timeout allocation:
  Members (3):
    - analyst: 300000ms (300s) [auto]     ← 好
    - coder: 60000ms (60s) [explicit] ⚠️  ← 警告
```

看到 `[explicit] ⚠️` 立即检查配置。

---

### 2. 超时警告

运行时警告说明配置有问题：

```
⚠️  [coder] explicit timeout (60000ms) is shorter than calculated (300000ms). 
    This may cause premature termination.
```

**解决**: 删除 `member.timeout` 字段。

---

### 3. 执行日志分析

```
[dependency_analyst] Tool calls: 12 iterations in 58s  ← 正常
[script_analyzer] Tool calls: 3 iterations in 62s     ← 可能任务太简单或卡住
```

- 迭代次数接近 `maxIterations` (15) → 任务太复杂
- 迭代次数少但接近超时 → 检查网络或 API 延迟

---

## 完整示例代码

### CLI 调用

```bash
xuanji agent-team \
  --team-name "package-health-check" \
  --strategy parallel \
  --timeout 300000 \
  --goal "分析 /path/to/package.json，给出优化建议" \
  --member id=dep,capabilities="依赖审查,版本检查" \
  --member id=scripts,capabilities="脚本分析" \
  --member id=meta,capabilities="配置审查"
```

### 编程调用

```typescript
import { TeamTool } from '@/core/tools/TeamTool';

const result = await teamTool.execute({
  team_name: 'package-health-check',
  goal: '分析 /Users/kevin/project/package.json，给出优化建议（每个维度 3-5 条）',
  strategy: 'parallel',
  timeout: 300000,  // 5 分钟
  members: [
    {
      id: 'dependency',
      capabilities: ['依赖审查', '版本检查'],
      system_prompt: '你是依赖专家。阅读 package.json 并给出 3-5 条优化建议。',
    },
    {
      id: 'scripts',
      capabilities: ['脚本分析'],
      system_prompt: '你是脚本专家。分析 scripts 字段并给出 3-5 条优化建议。',
    },
    {
      id: 'metadata',
      capabilities: ['配置审查'],
      system_prompt: '你是发布专家。检查元数据并给出 3-5 条改进建议。',
    },
  ],
});
```

---

## 相关文档

- [Agent Team 配置最佳实践](./agent-team-best-practices.md)
- [超时问题深度分析](/tmp/agent_team_timeout_analysis.md)
- [TeamManager API 文档](../src/core/agent/team/TeamManager.ts)

