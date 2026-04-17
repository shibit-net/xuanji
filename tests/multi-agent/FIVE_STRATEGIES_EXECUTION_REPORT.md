# Agent Team 五种策略执行报告

**执行时间**: 2026-04-18 03:17-03:25  
**执行者**: 璇玑 (Xuanji AI Butler)  
**项目**: xuanji - 开源 AI 编程助手

---

## 📊 执行概览

| 策略 | 耗时 | 成员数 | Token消耗 (in/out) | 状态 | 轮次 |
|------|------|--------|-------------------|------|------|
| **Parallel** | 52.1s | 4 | 54,391 / 2,606 | ✅ 成功 | 0 |
| **Sequential** | 60.0s | 1 | 30,710 / 822 | ❌ 超时 | 0 |
| **Hierarchical** | 89.1s | 4 | 42,621 / 1,870 | ✅ 成功 | 0 |
| **Debate** | 258.9s | 15 (3×5轮) | 66,171 / 5,534 | ✅ 成功 | 5 |
| **Pipeline** | 39.5s | 3 | 3,598 / 2,534 | ⚠️ 部分成功 | 0 |
| **总计** | **499.6s** | **27** | **197,491 / 13,366** | **3.5/5** | **5** |

**成功率**: 70% (3.5/5)  
**平均耗时**: 99.9s/策略  
**Token效率**: 14.8 tokens/s (in), 26.8 ms/token (out)

---

## 🔍 策略详细结果

### 1️⃣ Parallel（并行执行）⭐ 最快

**场景**: 并行分析 xuanji 核心模块（memory/context/session/tools）

**配置**:
- 4 个成员，每个分析一个模块
- 每个成员限时 2 分钟
- 使用 explore agent
- 输出限制 300 字

**结果**: ✅ 全部成功
- memory_analyzer: 24.0s
- context_analyzer: 20.4s
- session_analyzer: 25.6s
- tools_analyzer: 26.5s

**关键发现**:
- ✅ Memory 模块：访问计数同步更新可能成为瓶颈
- ✅ Context 模块：缺少索引持久化
- ✅ Session 模块：并发控制需加强
- ✅ Tools 模块：权限控制覆盖不足

**性能**: 🚀 最快策略，4 个任务并行完成仅需 52.1s

---

### 2️⃣ Sequential（顺序执行）

**场景**: 顺序执行三个依赖任务（代码统计 → 依赖分析 → 风险评估）

**配置**:
- 3 个成员，顺序执行
- stats_collector (1分钟) → dependency_analyzer (1.5分钟) → risk_assessor (1.5分钟)

**结果**: ❌ 第一阶段超时失败
- stats_collector: 60.0s 超时，消耗 30,710 tokens

**失败原因**:
- 任务范围过大：要求统计整个项目的代码行数
- 工具选择不当：尝试使用 cloc 但未安装
- 超时设置过短：1 分钟不足以完成统计任务

**教训**: 
- ⚠️ Sequential 策略对第一个成员的超时设置要求更高
- ⚠️ 任务拆分要更细粒度，避免单个成员负担过重

---

### 3️⃣ Hierarchical（层级协调）

**场景**: Leader 协调 3 个 workers 分析不同子系统（adapters/core/mcp）

**配置**:
- 1 个 Leader (priority=10) + 3 个 Workers (priority=1)
- Leader 限时 1 分钟，Workers 限时 1.5 分钟
- 使用 plan agent (Leader) + explore agent (Workers)

**结果**: ✅ 全部成功
- leader: 13.8s (分配任务)
- worker_adapters: 21.0s
- worker_core: 19.6s
- worker_mcp: 75.4s (最慢)

**关键发现**:
- ✅ Adapters: 基于 Ink(React)，支持流式输出和多模式切换
- ✅ Core: ReAct 循环核心，5 层配置优先级，Provider 抽象设计优秀
- ✅ MCP: 实现 JSON-RPC 2.0，支持 stdio/SSE/HTTP 三种传输协议

**性能**: Leader 快速分配任务，Workers 并行执行，总耗时 89.1s

**注意**: 必须设置 priority 字段，否则会报错

---

### 4️⃣ Debate（辩论模式）🔥 最耗时

**场景**: 技术选型辩论 - 是否将 better-sqlite3 替换为 libsql

**配置**:
- 3 个成员：proponent (支持方) / opponent (反对方) / judge (评审方)
- 每轮限时 1-1.5 分钟
- 使用 plan agent

**结果**: ✅ 5 轮辩论后达成共识
- 总耗时: 258.9s
- 总轮次: 5 轮
- 成员执行: 15 次 (3×5)

**辩论过程**:
1. **第 1 轮**: 支持方提出远程同步优势，反对方强调稳定性
2. **第 2 轮**: 支持方反驳生态成熟度，反对方强调本地优先
3. **第 3 轮**: 双方针对性能和安全性展开辩论
4. **第 4 轮**: 支持方提出竞品压力，反对方强调供应链安全
5. **第 5 轮**: 评审方给出最终建议

**最终结论**: **保持 better-sqlite3，预留扩展接口**

**理由**:
- xuanji 定位为本地优先的 AI 助手
- 当前无真实用户反馈多设备同步需求
- 迁移成本高，libsql 生态不成熟
- 现有架构已可扩展，未来可通过插件支持云后端

**性能**: 🐢 最慢策略，但充分论证了技术决策

---

### 5️⃣ Pipeline（流水线）

**场景**: 数据流水线 - 提取依赖 → 分类分析 → 生成报告

**配置**:
- 3 个成员，流水线执行
- extractor (1分钟) → classifier (1.5分钟) → reporter (2分钟)
- 使用 explore + plan + doc-writer agents

**结果**: ⚠️ 部分成功（前两阶段成功，第三阶段失败）
- extractor: 18.8s ✅
- classifier: 20.7s ✅
- reporter: 0.0s ❌ (doc-writer agent 配置缺失)

**失败原因**:
- doc-writer agent 在当前环境中未配置
- 应该使用 plan 或 explore agent 替代

**教训**:
- ⚠️ 使用 agent_team 前必须确认 agent 可用性
- ⚠️ 可以调用 list_agents 工具检查可用 agent

---

## 📈 性能对比分析

### 速度排名
1. 🥇 **Pipeline** (39.5s) - 但部分失败
2. 🥈 **Parallel** (52.1s) - 最快且成功
3. 🥉 **Sequential** (60.0s) - 超时失败
4. **Hierarchical** (89.1s) - 稳定成功
5. **Debate** (258.9s) - 充分论证

### Token 效率排名
1. **Pipeline**: 6,132 tokens / 39.5s = 155 tokens/s
2. **Parallel**: 56,997 tokens / 52.1s = 1,094 tokens/s
3. **Hierarchical**: 44,491 tokens / 89.1s = 499 tokens/s
4. **Sequential**: 31,532 tokens / 60.0s = 526 tokens/s
5. **Debate**: 71,705 tokens / 258.9s = 277 tokens/s

### 适用场景总结

| 策略 | 最佳场景 | 优点 | 缺点 |
|------|---------|------|------|
| **Parallel** | 独立任务，无依赖 | 最快，高效 | 无法处理依赖关系 |
| **Sequential** | 有明确顺序依赖 | 逻辑清晰 | 慢，容易超时 |
| **Hierarchical** | 需要动态任务分配 | 灵活，可协调 | 需要设置 priority |
| **Debate** | 技术选型，方案对比 | 充分论证 | 最慢，Token 消耗大 |
| **Pipeline** | 数据流转，ETL | 数据流清晰 | 依赖 agent 配置 |

---

## 💡 关键经验教训

### ✅ 成功经验

1. **Parallel 优先**: 对于独立任务，parallel 策略最快最高效
2. **明确输出限制**: 每个成员输出不超过 150-300 字，避免超时
3. **使用快速工具**: 优先使用 glob/grep，避免逐文件读取
4. **合理设置超时**: 单个成员 60-120s，团队总计 300-600s
5. **Debate 适合决策**: 技术选型等重大决策使用 debate 充分论证

### ⚠️ 失败教训

1. **Sequential 易超时**: 第一个成员超时会导致整个流程失败
2. **任务范围要明确**: 避免"统计整个项目"这种过大的任务
3. **检查 agent 可用性**: 使用前确认 agent 配置存在
4. **Hierarchical 需要 priority**: 必须设置 priority 字段
5. **Pipeline 依赖传递**: 确保前一阶段输出格式符合后一阶段输入要求

---

## 🚀 改进建议

### 对 xuanji 项目的建议

1. **Memory 模块优化**:
   - 批量更新访问计数，避免高频写入
   - 增加 LRU 缓存层
   - 向量计算异步化

2. **Context 模块优化**:
   - 添加索引持久化机制
   - 异步化同步操作（fs.existsSync → fs.promises.exists）
   - 优化大项目性能

3. **Session 模块优化**:
   - 加强并发写入冲突检测
   - 在所有写操作中使用 _writeLock

4. **Tools 模块优化**:
   - 扩大权限控制覆盖范围
   - WriteTool/EditTool 强制调用权限检查

5. **技术选型**:
   - 保持 better-sqlite3
   - 预留扩展接口，未来支持云同步

### 对 agent_team 工具的建议

1. **超时分配优化**: 已完成（commit 90f061a）
2. **错误提示优化**: Hierarchical 缺少 priority 时给出更明确的错误提示
3. **Agent 可用性检查**: 执行前自动检查 agent 配置是否存在
4. **降级策略**: 自动降级到单个 task 工具
5. **性能监控**: 添加每个成员的 Token 消耗和耗时监控

---

## 📝 总结

本次测试成功覆盖了 agent_team 的五种策略，验证了：

✅ **Parallel** 是最常用、最高效的策略  
✅ **Hierarchical** 适合需要动态协调的场景  
✅ **Debate** 适合技术决策和方案对比  
⚠️ **Sequential** 容易超时，需要谨慎使用  
⚠️ **Pipeline** 依赖 agent 配置，需要提前检查

**总体评价**: agent_team 工具功能强大，五种策略覆盖了不同的协作场景。通过合理的任务拆分、超时设置和工具选择，可以高效完成复杂的多 Agent 协作任务。

---

**报告生成时间**: 2026-04-18 03:25  
**报告生成者**: 璇玑 (Xuanji AI Butler)
