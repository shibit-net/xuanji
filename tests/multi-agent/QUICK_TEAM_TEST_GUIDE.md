# QuickTeamTool 模板测试 - 详细测试指南

## 测试执行说明

本测试需要在主会话中执行 `quick_team` 工具。以下是详细的测试步骤和数据收集指南。

---

## 📝 测试 1: code-review 模板

### 目标
审查 `src/core/tools/QuickTeamTool.ts` 的代码质量

### 执行命令参数
```
template: code-review
goal: Review src/core/tools/QuickTeamTool.ts for code quality, architecture, security, and performance. Provide specific recommendations for improvement.
target: src/core/tools/QuickTeamTool.ts
```

### 预期团队配置
- **策略**: sequential
- **成员**:
  1. Architecture Reviewer - 审查整体架构设计
  2. Security Reviewer - 检查安全隐患
  3. Performance Reviewer - 分析性能优化点

### 预期执行流程
1. Architecture Reviewer 先审查，输出架构分析
2. Security Reviewer 基于代码审查安全性（不依赖上一个输出）
3. Performance Reviewer 最后审查性能

### 需要记录的数据
- [ ] 总执行时间（秒）
- [ ] 总 Token 使用（input / output）
- [ ] 执行轮数
- [ ] 各成员执行时间
- [ ] 各成员 Token 使用
- [ ] 各成员发现的具体问题
- [ ] 是否按预期顺序执行
- [ ] 输出格式是否清晰

### 评估标准
1. **团队配置合理性** (1-10分)
   - 3个成员是否各司其职
   - 顺序是否合理
   
2. **输出质量** (1-10分)
   - 是否发现真实问题
   - 建议是否可操作
   - 是否有重复内容
   
3. **执行效率** (1-10分)
   - 时间是否合理
   - Token 使用是否高效
   - 是否有不必要的等待

---

## 🔍 测试 2: research 模板

### 目标
调研 TypeScript multi-agent 系统架构的最佳实践

### 执行命令参数
```
template: research
goal: Research TypeScript multi-agent system architecture patterns and best practices. Focus on: 1) Agent communication patterns, 2) State management, 3) Error handling strategies, 4) Performance optimization techniques.
```

### 预期团队配置
- **策略**: parallel
- **成员**:
  1. Documentation Researcher - 搜索官方文档和论文
  2. Code Example Analyst - 分析开源代码实现
  3. Community Practice Researcher - 调研社区实践和博客

### 预期执行流程
- 三个成员**并行**搜索不同来源
- 同时开始，同时结束（或接近）
- 最终综合输出

### 需要记录的数据
- [ ] 总执行时间（秒）
- [ ] 总 Token 使用（input / output）
- [ ] 执行轮数
- [ ] 各成员执行时间（应该接近）
- [ ] 各成员 Token 使用
- [ ] 各成员研究的来源类型
- [ ] 是否真正并行执行
- [ ] 信息是否有重叠

### 评估标准
1. **信息覆盖度** (1-10分)
   - 是否覆盖文档、代码、社区三个维度
   - 信息是否全面
   
2. **研究深度** (1-10分)
   - 是否深入分析
   - 是否提供实用建议
   
3. **并行效率** (1-10分)
   - 是否真正并行
   - 时间是否比顺序快
   - 是否有资源竞争

---

## 💬 测试 3: architecture-debate 模板

### 目标
讨论团队成员是否应该共享内存上下文

### 执行命令参数
```
template: architecture-debate
goal: Debate and decide: Should team members share memory context during execution in a multi-agent system? Consider: 1) Performance impact, 2) Context consistency, 3) Implementation complexity, 4) Privacy concerns.
max_rounds: 3
```

### 预期团队配置
- **策略**: debate
- **成员**:
  1. Simplicity Advocate - 倾向简单方案
  2. Scalability Advocate - 倾向可扩展方案
  3. Pragmatic Advocate - 倾向实用方案

### 预期执行流程
- Round 1: 各方提出初始观点
- Round 2: 针对其他方观点进行反驳或补充
- Round 3: 综合考虑，尝试达成共识
- 最终输出综合决策

### 需要记录的数据
- [ ] 总执行时间（秒）
- [ ] 总 Token 使用（input / output）
- [ ] 实际执行轮数（应该 ≤ 3）
- [ ] 各成员执行时间
- [ ] 各成员 Token 使用
- [ ] 各轮次的观点变化
- [ ] 是否达成共识
- [ ] 最终决策质量

### 评估标准
1. **观点多样性** (1-10分)
   - 三个视角是否有明显差异
   - 是否有深度分析
   
2. **辩论质量** (1-10分)
   - 是否有实质性交锋
   - 是否逐步收敛
   - 是否避免重复
   
3. **决策合理性** (1-10分)
   - 最终决策是否平衡各方
   - 是否可行
   - 是否考虑全面

---

## 📊 数据收集模板

### 测试结果记录表

#### 测试 1: code-review

| 指标 | 数值 |
|------|------|
| 总执行时间 | _____ 秒 |
| Token 输入 | _____ tokens |
| Token 输出 | _____ tokens |
| 执行轮数 | _____ |
| 成功状态 | ✅/❌ |

**成员执行详情**:

| 成员 | 执行时间 | Token In | Token Out | 状态 | 发现问题数 |
|------|---------|----------|-----------|------|-----------|
| Architecture Reviewer | ___s | ___ | ___ | ✅/❌ | ___ |
| Security Reviewer | ___s | ___ | ___ | ✅/❌ | ___ |
| Performance Reviewer | ___s | ___ | ___ | ✅/❌ | ___ |

**发现的问题**:
1. 
2. 
3. 

**评分**:
- 团队配置合理性: ___/10
- 输出质量: ___/10
- 执行效率: ___/10

---

#### 测试 2: research

| 指标 | 数值 |
|------|------|
| 总执行时间 | _____ 秒 |
| Token 输入 | _____ tokens |
| Token 输出 | _____ tokens |
| 执行轮数 | _____ |
| 成功状态 | ✅/❌ |

**成员执行详情**:

| 成员 | 执行时间 | Token In | Token Out | 状态 | 信息来源数 |
|------|---------|----------|-----------|------|-----------|
| Documentation Researcher | ___s | ___ | ___ | ✅/❌ | ___ |
| Code Example Analyst | ___s | ___ | ___ | ✅/❌ | ___ |
| Community Practice Researcher | ___s | ___ | ___ | ✅/❌ | ___ |

**研究发现**:
1. 
2. 
3. 

**评分**:
- 信息覆盖度: ___/10
- 研究深度: ___/10
- 并行效率: ___/10

---

#### 测试 3: architecture-debate

| 指标 | 数值 |
|------|------|
| 总执行时间 | _____ 秒 |
| Token 输入 | _____ tokens |
| Token 输出 | _____ tokens |
| 执行轮数 | _____ (max 3) |
| 成功状态 | ✅/❌ |

**成员执行详情**:

| 成员 | 执行时间 | Token In | Token Out | 状态 | 观点轮数 |
|------|---------|----------|-----------|------|---------|
| Simplicity Advocate | ___s | ___ | ___ | ✅/❌ | ___ |
| Scalability Advocate | ___s | ___ | ___ | ✅/❌ | ___ |
| Pragmatic Advocate | ___s | ___ | ___ | ✅/❌ | ___ |

**辩论过程**:
- Round 1: 
- Round 2: 
- Round 3: 
- 最终共识: 

**评分**:
- 观点多样性: ___/10
- 辩论质量: ___/10
- 决策合理性: ___/10

---

## 🎯 综合分析要点

### 性能对比
对比三个模板的执行效率：
- 哪个模板最快？
- Token 使用是否合理？
- 是否有性能瓶颈？

### 策略效果
- sequential 是否真的顺序执行？
- parallel 是否真的并行？
- debate 是否有多轮交互？

### 输出质量
- 哪个模板的输出最有价值？
- 是否有模板配置问题？
- 成员角色是否清晰？

### 发现的问题
记录所有发现的 bug、性能问题、配置问题

### 改进建议
基于测试结果提出改进建议

---

## 🚀 开始测试

**测试时间**: 2024-03-24 09:15

**执行方式**: 
在主会话中逐个执行 quick_team 工具调用，记录详细数据。

**注意事项**:
1. 确保每个测试完整执行完毕后再开始下一个
2. 准确记录所有时间和 Token 数据
3. 保存完整的输出日志
4. 记录任何异常或错误

**测试负责人**: Coder Agent
**测试状态**: 准备就绪 ✅
