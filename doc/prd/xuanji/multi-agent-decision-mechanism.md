# Multi-Agent 决策机制设计

## 概述

Xuanji 的 Multi-Agent 系统采用**分层决策模型**，主 Agent (LLM) 主导决策，系统提供智能辅助。

---

## 决策层次

```
┌───────────────────────────────────────────────────────────┐
│              Level 1: 用户意图理解                          │
│  • 用户输入 → 主 Agent 分析                                 │
│  • 识别任务类型（单任务 vs 多任务 vs 工作流）                │
│  • 识别领域（编程 / 数据分析 / 金融 / 生活管理等）            │
└───────────────────────────────────────────────────────────┘
                          ↓
┌───────────────────────────────────────────────────────────┐
│              Level 2: 工具选择决策（主 Agent）              │
│  • 单任务 → task tool                                      │
│  • 工作流 → agent_chain tool                               │
│  • 团队协作 → agent_team tool                              │
│  • 手动编排 → 多次 task 调用                                │
└───────────────────────────────────────────────────────────┘
                          ↓
┌───────────────────────────────────────────────────────────┐
│              Level 3: Agent 选择决策（混合模式）            │
│  Option A: 主 Agent 直接指定                               │
│    - 用户明确："用 stock-analyst 分析"                     │
│    - LLM 已知："这是股票任务，用 stock-analyst"            │
│                                                            │
│  Option B: 系统辅助推荐                                     │
│    - LLM 调用 list_agents 查看可用 Agent                   │
│    - LLM 调用 match_agent 获取推荐                         │
│    - LLM 基于推荐做最终决策                                 │
│                                                            │
│  Option C: 完全自动（未来）                                 │
│    - task({ description, auto_select: true })             │
│    - 系统自动匹配最佳 Agent                                 │
└───────────────────────────────────────────────────────────┘
                          ↓
┌───────────────────────────────────────────────────────────┐
│              Level 4: 执行与监控（系统层）                  │
│  • SubAgent 执行任务                                        │
│  • 上下文自动传递（chain / sequential / pipeline）         │
│  • 结果聚合返回主 Agent                                     │
│  • 主 Agent 评估结果，决定下一步                            │
└───────────────────────────────────────────────────────────┘
```

---

## 决策流程示例

### **场景 1: 简单任务（单步）**

```
用户: "帮我搜索项目中所有使用 React 的文件"

主 Agent 思考:
  → 这是简单的代码搜索任务
  → 使用 task tool
  → Agent 选择：explore（快速只读）

决策:
  task({ agent_id: 'explore', description: '搜索所有 React 文件' })

执行:
  explore Agent → 使用 grep 工具 → 返回文件列表
```

### **场景 2: 工作流（多步串联）**

```
用户: "分析这个 CSV 的股票数据，清洗后生成趋势报告"

主 Agent 思考:
  → 这是数据处理工作流（提取 → 清洗 → 分析 → 报告）
  → 需要多步串联，使用 agent_chain
  → 需要选择合适的 Agent

决策过程:
  1. 调用 list_agents({ filter: { tags: ['data'] } })
     → 系统返回：data-extractor, data-cleaner, data-analyst, report-generator

  2. 主 Agent 决策使用 agent_chain:
     agent_chain({
       chain: [
         { agent_id: 'data-extractor', task: '读取 CSV' },
         { agent_id: 'data-cleaner', task: '清洗 {{previous_output}}' },
         { agent_id: 'data-analyst', task: '分析 {{previous_output}}' },
         { agent_id: 'report-generator', task: '生成报告 {{previous_output}}' }
       ]
     })

执行:
  Chain 自动串联执行 → 每步输出传给下一步 → 返回最终报告
```

### **场景 3: 智能推荐（不确定用哪个 Agent）**

```
用户: "帮我评估一下这个投资机会"

主 Agent 思考:
  → 这是金融分析任务
  → 不确定用哪个 Agent（stock-analyst? investment-advisor? risk-assessor?）
  → 使用 match_agent 获取推荐

决策过程:
  1. 调用 match_agent({
       task_description: '评估投资机会',
       domain_hint: 'finance'
     })

  2. 系统返回推荐:
     Top 3:
     1. investment-advisor (92% match) - 专业投资建议
     2. stock-analyst (78% match) - 股票数据分析
     3. risk-assessor (65% match) - 风险评估

  3. 主 Agent 决策:
     task({ agent_id: 'investment-advisor', description: '评估投资机会...' })

执行:
  investment-advisor Agent → 分析 → 返回建议
```

### **场景 4: 团队协作（多角度）**

```
用户: "全面审查这个 PR，包括安全、性能、代码风格"

主 Agent 思考:
  → 需要多角度审查（3+ 专家）
  → 可以并行执行
  → 使用 agent_team，策略 parallel

决策:
  agent_team({
    strategy: 'parallel',
    goal: '全面审查 PR #456',
    members: [
      { agent_id: 'security-auditor', capabilities: ['安全漏洞扫描'] },
      { agent_id: 'performance-analyzer', capabilities: ['性能分析'] },
      { agent_id: 'style-checker', capabilities: ['代码风格检查'] }
    ]
  })

执行:
  3 个 Agent 并行执行 → 各自返回审查结果 → 聚合返回主 Agent
```

---

## 工具职责划分

| 工具 | 职责 | 谁决策 | 上下文传递 |
|------|------|--------|----------|
| **task** | 单 Agent 执行单任务 | LLM 选择 agent_id | 手动（LLM 编排） |
| **agent_chain** | 链式串联执行 | LLM 定义链条 | 自动（output → input） |
| **agent_team** | 团队协作 | LLM 选择策略和成员 | 自动（按策略） |
| **list_agents** | 查询可用 Agent | LLM 主动调用 | N/A（查询工具） |
| **match_agent** | 智能推荐 Agent | 系统推荐，LLM 决策 | N/A（推荐工具） |

---

## 决策权限

### **主 Agent (LLM) 拥有完全控制权**

✅ **可以做的决策**：
- 选择使用哪个工具（task / chain / team）
- 选择具体的 Agent ID
- 定义工作流顺序
- 决定是否使用推荐
- 评估结果并决定下一步

❌ **不能做的事**：
- 绕过安全限制（权限由 Agent Profile 定义）
- 创建不存在的 Agent（必须在 Registry 中注册）
- 超过并发限制（系统强制）

### **系统提供的辅助**

✅ **自动化功能**：
- 上下文传递（chain / sequential / pipeline）
- Agent 匹配推荐（向量 + 关键词）
- 并发管理（限制 3 个并发）
- 结果聚合

❌ **不会自动做的事**：
- 不会替 LLM 选择 Agent（除非明确要求 auto_select）
- 不会改变 LLM 定义的工作流
- 不会修改任务描述

---

## 智能匹配算法

### **MatchAgentTool 评分机制**

```typescript
总分 = 向量相似度(40%) + 关键词匹配(30%) + 标签匹配(20%) + 能力匹配(10%)
```

**1. 向量相似度（40% 权重）**
- 任务描述 embedding vs Agent 能力描述 embedding
- 余弦相似度 [0, 1]
- 需要 EmbeddingService 可用

**2. 关键词匹配（30% 权重）**
- 提取任务描述中的关键词
- 匹配 Agent 的 ID / name / description / capabilities / tags
- 匹配比例 = 匹配词数 / 总词数

**3. 标签匹配（20% 权重）**
- 如果提供 domain_hint
- 检查 Agent.tags 是否包含该 domain
- 二值：匹配 = 1，不匹配 = 0

**4. 能力匹配（10% 权重）**
- 任务描述与 Agent.capabilities 的重叠度
- 匹配比例 = 匹配能力数 / 总能力数

### **示例评分**

```
任务: "分析 $AAPL 的财报数据，预测下季度盈利"
domain_hint: "finance"

Agent: stock-analyst
  - 向量相似度: 0.85 (描述高度相关)
  - 关键词: 0.6 (财报、分析、预测 匹配)
  - 标签: 1.0 (tags 包含 "finance")
  - 能力: 0.7 (财报分析、预测 匹配)
  → 总分: 0.85*0.4 + 0.6*0.3 + 1.0*0.2 + 0.7*0.1 = 0.77 (77%)

Agent: code-reviewer
  - 向量相似度: 0.2 (不相关)
  - 关键词: 0.1
  - 标签: 0.0
  - 能力: 0.0
  → 总分: 0.09 (9%)
```

---

## 未来扩展

### **Phase 1: 学习与优化**

```typescript
// 记录每个决策的成功率
{
  agent_id: 'stock-analyst',
  task_pattern: '分析股票',
  success_count: 152,
  failure_count: 8,
  success_rate: 0.95,
  avg_duration: 8500
}

// 动态调整推荐权重
if (历史成功率高) {
  推荐分数 += 0.1
}
```

### **Phase 2: 自动路由**

```typescript
task({
  description: '分析股票数据',
  auto_select: true  // 系统自动选择最佳 Agent
})

// 系统内部执行 match_agent，直接使用 top-1
```

### **Phase 3: 自适应策略**

```typescript
agent_team({
  goal: '优化网站性能',
  auto_strategy: true,  // 系统自动选择 sequential / parallel / hierarchical
  auto_members: true    // 系统自动选择成员
})

// 基于任务类型和历史数据自动决策
```

---

## 总结

### **当前实现（v1.0）**

✅ **决策主体**：主 Agent (LLM)
✅ **辅助工具**：list_agents, match_agent
✅ **执行模式**：task, agent_chain, agent_team
✅ **上下文传递**：自动化（chain/sequential/pipeline）

### **设计原则**

1. **LLM 主导**：所有关键决策由 LLM 做出
2. **系统辅助**：提供信息和推荐，但不替代决策
3. **用户透明**：用户可以通过明确指令覆盖任何自动行为
4. **渐进增强**：从手动编排 → 辅助推荐 → 自动路由

### **关键优势**

- 🎯 **灵活性**：LLM 可以根据上下文灵活调整策略
- 🧠 **智能化**：系统提供向量匹配等智能推荐
- 🔒 **可控性**：用户/LLM 始终拥有最终控制权
- 📈 **可扩展**：未来可以引入学习和自适应机制
