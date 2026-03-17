# 意图识别系统 - 剩余工作清单

## 当前状态

✅ **已完成**：
1. 核心类型定义（`types.ts`）
2. UniversalIntentScanner（扫描模块）
3. IntentRegistry（注册表）
4. VectorIntentMatcher（向量匹配）
5. LLMIntentClassifier（LLM 分类）
6. IntentLearner（自动学习）
7. IntentRouter（路由器）
8. CapabilityAssembler（能力组装器）
9. 集成到 ChatSession
10. 优化为使用 lightProvider

## 待完成任务

### 1. 功能验证（优先级：高）

**目标**：验证意图识别系统在实际运行中是否正常工作

**步骤**：
```bash
# 1. 启动 Xuanji
npm run dev

# 2. 测试编程相关意图（首次，应该走 LLM 分类）
> 帮我写一个 TypeScript 函数，计算斐波那契数列

# 观察日志，应该看到：
# - ⏳ 初始化意图路由器...
# - ✓ 意图路由器初始化完成: 总意图类型: X, 注册模块: Y
# - ⚠️  向量未命中，使用 LLM 分析...
# - ✓ LLM 识别: code-assistant (置信度: 0.95)
# - 📚 学习意图: skill.code-assistant
# - ✓ 创建新意图: skill.code-assistant

# 3. 等待 2-3 秒（学习完成）

# 4. 再次测试相同意图（应该走向量匹配）
> 用 JavaScript 写一个快速排序算法

# 观察日志，应该看到：
# - ✓ 向量匹配命中: skill.code-assistant (置信度: 0.85)
# - ✓ 增强意图 skill.code-assistant

# 5. 测试生活相关意图（新意图）
> 提醒我明天下午3点开会

# 观察日志，应该看到：
# - ⚠️  向量未命中，使用 LLM 分析...
# - ✓ LLM 识别: life-secretary (置信度: 0.90)
# - 📚 学习意图: skill.life-secretary
```

**预期结果**：
- ✅ 首次使用某个 Skill：LLM 分类（~1-2s）
- ✅ 后续使用相同 Skill：向量匹配（~30-50ms）
- ✅ 自动学习：生成并保存向量
- ✅ 持久化：重启后向量仍然存在

**验证文件**：
- `~/.xuanji/learned-intents.json`（学习的意图）
- `~/.xuanji/cache/intent-vectors.json`（向量缓存）

### 2. 编写集成测试（优先级：中）

**文件**：`test/integration/intent-router.test.ts`

**测试用例**：
```typescript
describe('IntentRouter Integration', () => {
  it('should initialize successfully', async () => {
    // 测试初始化
  });

  it('should classify intent using LLM on first use', async () => {
    // 测试 LLM 分类（首次）
  });

  it('should match intent using vector on subsequent use', async () => {
    // 测试向量匹配（后续）
  });

  it('should learn from LLM classification', async () => {
    // 测试自动学习
  });

  it('should enhance intent with new samples', async () => {
    // 测试样本增强
  });

  it('should persist learned intents', async () => {
    // 测试持久化
  });
});
```

### 3. 编写单元测试（优先级：低）

**文件**：
- `test/unit/intent/IntentRegistry.test.ts`
- `test/unit/intent/VectorIntentMatcher.test.ts`
- `test/unit/intent/LLMIntentClassifier.test.ts`
- `test/unit/intent/IntentLearner.test.ts`
- `test/unit/intent/IntentRouter.test.ts`

**测试覆盖率目标**：> 80%

### 4. 文档完善（优先级：低）

**待更新文档**：
- `README.md`：添加意图识别系统说明
- `doc/prd/xuanji/auto-learning-intent.md`：更新实现状态
- 添加使用示例和最佳实践

### 5. 性能优化（可选）

**可选优化点**：
- 向量匹配性能分析（目标 < 50ms）
- LLM 分类性能分析（目标 < 2s）
- 缓存策略优化
- 并发学习优化

## 下一步行动

### 立即行动
1. **手动测试验证**（30 分钟）
   - 运行 `npm run dev`
   - 执行上述测试用例
   - 验证日志输出
   - 检查学习文件

2. **修复发现的问题**（如果有）

### 短期行动
3. **编写集成测试**（2 小时）
   - 创建测试文件
   - 实现核心测试用例
   - 验证测试通过

### 长期行动（可选）
4. **编写单元测试**（4 小时）
5. **文档完善**（2 小时）
6. **性能优化**（可选）

## 完成后的下一阶段

### Phase: lightProvider 迁移到 Agent 架构

**目标**：将 lightProvider 的使用场景逐步迁移到独立的 Agent

**计划**：
1. Phase 1: IntentAnalyzer Agent（替代 IntentRouter 中的 lightProvider）
2. Phase 2: Compressor Agent（替代 ContextCompressor 中的 lightProvider）
3. Phase 3: 完全移除 lightProvider 概念（如果所有场景都迁移完成）

**参考文档**：`doc/prd/xuanji/intent-analyzer-agent-design.md`

---

## 备注

- 当前意图识别系统已经集成到 ChatSession，可以立即使用
- 所有类型检查通过（意图相关文件无错误）
- 自动学习功能已实现，无需手动添加 intentMeta
- 使用 lightProvider（Haiku）进行 LLM 分类，成本低、速度快
