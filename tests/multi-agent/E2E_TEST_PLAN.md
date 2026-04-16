# 真实多 Agent 测试场景执行计划

**执行方式**: 使用真实的 LLM 调用，测试实际的多 agent 协作效果  
**测试类型**: End-to-End (E2E)  
**预期成本**: < $1 (使用 Haiku 模型)

---

## 🎯 测试场景设计

### 场景 1: Code Review Team - 代码审查
**模板**: code-review  
**策略**: Sequential (顺序执行)  
**成员**: 3人 (architect, security, performance)  
**目标**: 审查 QuickTeamTool.ts 的代码质量

**预期结果**:
- ✅ 发现架构问题
- ✅ 发现安全问题  
- ✅ 发现性能问题
- ✅ 3个成员依次执行
- ✅ 执行时间 < 90s

---

### 场景 2: Research Team - 并行研究
**模板**: research  
**策略**: Parallel (并行执行)  
**成员**: 3人 (docs-researcher, code-researcher, community-researcher)  
**目标**: 研究 TypeScript multi-agent 最佳实践

**预期结果**:
- ✅ 3个成员并行执行
- ✅ 执行时间接近最慢成员（而非总和）
- ✅ 结果包含多个来源
- ✅ 执行时间 < 60s

---

### 场景 3: Architecture Debate - 架构辩论
**模板**: architecture-debate  
**策略**: Debate (辩论模式)  
**成员**: 3人 (simplicity-advocate, scalability-expert, pragmatist)  
**目标**: 辩论是否应该为 TeamManager 添加共享内存

**预期结果**:
- ✅ 多轮辩论（2-3轮）
- ✅ 包含不同观点
- ✅ 达成某种共识
- ✅ 执行时间 < 120s

---

### 场景 4: Simple Pipeline - 简单流水线
**工具**: pipeline  
**策略**: Pipeline (流水线)  
**步骤**: 2步 (探索 → 总结)  
**目标**: 分析项目中的 TODO 注释

**预期结果**:
- ✅ 数据正确传递
- ✅ {{previous_output}} 被正确替换
- ✅ 最终输出是最后一步的结果
- ✅ 执行时间 < 60s

---

### 场景 5: Feature Planning - 功能规划
**模板**: feature-development  
**策略**: Hierarchical (层级)  
**成员**: 2人 (tech-lead, backend-dev)  
**目标**: 规划一个简单的用户认证功能

**预期结果**:
- ✅ Tech Lead 先规划
- ✅ Backend Dev 基于规划执行
- ✅ 输出包含具体实现建议
- ✅ 执行时间 < 90s

---

## 📋 执行检查清单

- [ ] 场景 1: Code Review Team
- [ ] 场景 2: Research Team  
- [ ] 场景 3: Architecture Debate
- [ ] 场景 4: Simple Pipeline
- [ ] 场景 5: Feature Planning

---

## 📊 验收标准

### 功能验证
- [ ] 所有场景成功执行（无崩溃）
- [ ] 策略正确执行（sequential/parallel/debate/pipeline/hierarchical）
- [ ] 输出格式正确
- [ ] Token 统计准确

### 质量验证
- [ ] 输出内容有意义（非空或错误）
- [ ] 成员角色分工明确
- [ ] 协作效果可见

### 性能验证
- [ ] 执行时间在预期范围内
- [ ] Parallel 策略有加速效果
- [ ] 无超时或挂起

---

**开始执行时间**: 待定  
**预计总耗时**: 5-8 分钟  
**预计总成本**: $0.50 - $1.00
