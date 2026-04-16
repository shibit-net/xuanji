# QuickTeamTool 快速测试命令

## 🎯 三个核心测试

### 测试 1️⃣: Code Review 模板
```bash
# 在主会话中执行以下描述：
"使用 quick_team 工具执行 code-review 模板，审查 src/core/tools/QuickTeamTool.ts 的代码质量、安全性和性能。"
```

**参数**:
- template: `code-review`
- goal: `Review src/core/tools/QuickTeamTool.ts for code quality, architecture, security, and performance`
- target: `src/core/tools/QuickTeamTool.ts`

**预期结果**:
- ✅ 3个成员顺序执行
- ✅ 输出架构、安全、性能分析
- ⏱️ 45-90秒
- 🎯 8k-15k tokens

---

### 测试 2️⃣: Research 模板
```bash
# 在主会话中执行以下描述：
"使用 quick_team 工具执行 research 模板，调研 TypeScript multi-agent 系统的架构模式和最佳实践。"
```

**参数**:
- template: `research`
- goal: `Research TypeScript multi-agent system architecture patterns and best practices`

**预期结果**:
- ✅ 3个成员并行搜索
- ✅ 覆盖文档、代码、社区
- ⏱️ 30-60秒（比顺序快）
- 🎯 12k-20k tokens

---

### 测试 3️⃣: Architecture Debate 模板
```bash
# 在主会话中执行以下描述：
"使用 quick_team 工具执行 architecture-debate 模板，讨论 multi-agent 系统中团队成员是否应该共享内存上下文。"
```

**参数**:
- template: `architecture-debate`
- goal: `Debate whether team members should share memory context during execution in a multi-agent system`
- max_rounds: `3`

**预期结果**:
- ✅ 3个成员多轮辩论
- ✅ 观点差异明显
- ✅ 最终达成共识
- ⏱️ 60-120秒
- 🎯 10k-18k tokens

---

## 📊 数据收集要点

每个测试记录：
1. ⏱️ **时间数据**
   - 总执行时间
   - 各成员执行时间
   - 时间戳

2. 🎯 **Token 数据**
   - 总 input tokens
   - 总 output tokens
   - 各成员 token 使用

3. ✅ **执行状态**
   - 成功/失败
   - 执行轮数
   - 是否超时

4. 📝 **输出质量**
   - 发现的问题数量
   - 建议可行性
   - 信息覆盖度

---

## 🔍 关键验证点

### Sequential 验证 (code-review)
- [ ] 成员按顺序执行（不并行）
- [ ] 每个成员独立输出
- [ ] 输出不重复

### Parallel 验证 (research)
- [ ] 成员同时执行（时间接近）
- [ ] 信息来源不同
- [ ] 输出互补

### Debate 验证 (architecture-debate)
- [ ] 有多轮交互（≤3轮）
- [ ] 观点有差异
- [ ] 最终达成共识

---

## 📁 测试输出文件

- `test-1-code-review.md` - Code Review 测试结果
- `test-2-research.md` - Research 测试结果
- `test-3-debate.md` - Debate 测试结果
- `FINAL_SUMMARY.md` - 综合分析报告

---

## 🚀 开始测试

**当前状态**: ⏳ 等待主会话执行  
**测试准备**: ✅ 完成  
**文档准备**: ✅ 完成  

**下一步**: 在主会话中按顺序执行三个测试命令
