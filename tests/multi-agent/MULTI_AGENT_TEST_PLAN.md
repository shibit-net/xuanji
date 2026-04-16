# 多 Agent 测试计划

**创建时间**: 2024-03-24  
**测试类型**: 单元测试 + 集成测试  
**测试工具**: Vitest

---

## 📊 现状分析

### 已有测试覆盖

| 测试文件 | 类型 | 覆盖内容 | 质量评分 |
|---------|------|---------|---------|
| `test/core/agent/team/TeamManager.test.ts` | 单元 | createTeam, 配置验证 | ⭐⭐⭐ (60%) |
| `test/unit/tools/TeamTool.test.ts` | 单元 | Schema 验证, 参数校验 | ⭐⭐⭐ (65%) |
| `test/unit/tools/QuickTeamTool.test.ts` | 单元 | Schema 验证, 模板枚举 | ⭐⭐⭐ (65%) |
| `test/unit/tools/OrchestrateTool.test.ts` | 单元 | Schema 验证, 参数校验 | ⭐⭐⭐ (65%) |
| `test/unit/tools/PipelineTool.test.ts` | 单元 | Schema 验证, 链长度 | ⭐⭐⭐ (65%) |
| `test/integration/multi-agent-tools.test.ts` | 集成 | 工具注册验证 | ⭐⭐⭐⭐ (80%) |
| `test/integration/multi-agent-actual.test.ts` | 集成 | 实际注册验证 | ⭐⭐⭐⭐ (80%) |

**整体覆盖率估计**: 约 45-50%

### 🔴 关键缺失测试

#### 1. TeamManager 核心逻辑
- ❌ **Strategy 执行测试**（最重要）
  - Sequential 顺序执行验证
  - Parallel 并行批量执行验证
  - Hierarchical Leader→Workers 验证
  - Debate 多轮辩论验证
  - Pipeline 数据流传递验证
  
- ❌ **超时与错误处理**
  - 团队整体超时
  - 单个成员超时
  - 成员执行失败中断
  - Running 标志控制

- ❌ **结果聚合测试**
  - `aggregateResults` 各策略格式
  - Token 统计正确性
  - 成员执行摘要格式

#### 2. Templates 系统
- ❌ **模板功能测试**
  - `getTeamTemplate` 获取
  - `getAvailableTemplates` 列表
  - `recommendTemplate` 推荐逻辑
  
- ❌ **模板配置验证**
  - 5 个预定义模板完整性
  - 成员 capabilities 合理性
  - systemPrompt 指导有效性

#### 3. Tool 执行与格式化
- ❌ **实际执行流程**（Mock SubAgent）
  - TeamTool 完整执行路径
  - QuickTeamTool 模板加载→执行
  - OrchestrateTool 编排执行
  - PipelineTool 链式传递
  
- ❌ **输出格式测试**
  - `formatResult` 方法验证
  - Metadata 字段完整性
  - 用户友好输出格式

#### 4. PipelineTool 特殊功能
- ❌ **变量替换机制**
  - `{{previous_output}}` 替换
  - 初始输入处理
  - 空输出处理
  
- ❌ **链式执行控制**
  - 步骤失败停止
  - 中间结果保留
  - 最终输出聚合

---

## 🎯 测试目标

### 主要目标
1. ✅ **功能完整性**: 覆盖所有策略和工具核心路径
2. ✅ **边界条件**: 超时、错误、空数据
3. ✅ **结果正确性**: 数据流、聚合、格式化
4. ✅ **Mock 隔离**: 不依赖真实 LLM 调用

### 验收标准
- ✅ 所有新测试通过（0 failure）
- ✅ 代码覆盖率提升至 75%+
- ✅ 关键路径 100% 覆盖
- ✅ 测试执行时间 < 10s（单元测试）

---

## 📝 测试用例设计

### Test Suite 1: TeamManager 策略执行
**文件**: `test/core/agent/team/TeamManagerExecution.test.ts`

```typescript
describe('TeamManager - Strategy Execution', () => {
  // Mock runSubAgent
  beforeEach(() => {
    vi.mock('@/core/agent/SubAgentLoop');
  });

  describe('Sequential Strategy', () => {
    it('应按顺序执行成员任务');
    it('前一成员失败应停止后续执行');
    it('应正确传递 previousResults');
    it('应使用最后一个成员的结果');
  });

  describe('Parallel Strategy', () => {
    it('应并行执行所有成员');
    it('应分批执行（MAX_CONCURRENT=3）');
    it('应合并所有成员的结果');
  });

  describe('Hierarchical Strategy', () => {
    it('应先执行优先级最高的 Leader');
    it('应将 Leader 结果传递给 Workers');
    it('应并行执行所有 Workers');
    it('Leader 失败应直接返回');
  });

  describe('Debate Strategy', () => {
    it('应执行多轮辩论（maxRounds）');
    it('应传递前轮观点给后续成员');
    it('达成共识应提前结束');
    it('应返回最后一轮的总结');
  });

  describe('Pipeline Strategy', () => {
    it('应顺序传递输出到输入');
    it('中间步骤失败应停止流水线');
    it('应返回最后一步的输出');
  });
});
```

### Test Suite 2: TeamManager 超时与错误
**文件**: `test/core/agent/team/TeamManagerTimeout.test.ts`

```typescript
describe('TeamManager - Timeout & Error Handling', () => {
  it('应在团队整体超时后停止');
  it('单成员超时应标记为失败');
  it('应捕获 SubAgent 执行异常');
  it('stop() 应设置 running=false');
  it('超时标志应正确传递');
});
```

### Test Suite 3: TeamManager 结果聚合
**文件**: `test/core/agent/team/TeamManagerAggregation.test.ts`

```typescript
describe('TeamManager - Result Aggregation', () => {
  describe('aggregateResults', () => {
    it('Sequential/Pipeline: 返回最后成员结果');
    it('Parallel: 合并所有成员结果（带分隔符）');
    it('Hierarchical: Leader + Workers 层级格式');
    it('Debate: 最后一轮总结');
    it('空结果: 返回默认消息');
  });

  it('应正确统计总 Token 使用量');
  it('应正确计算总执行时间');
});
```

### Test Suite 4: Templates 系统
**文件**: `test/core/agent/team/Templates.test.ts`

```typescript
describe('Team Templates', () => {
  describe('getTeamTemplate', () => {
    it('应返回已注册的模板');
    it('未知模板应返回 undefined');
  });

  describe('getAvailableTemplates', () => {
    it('应返回所有 5 个模板 ID');
  });

  describe('recommendTemplate', () => {
    it('"review" 应推荐 code-review');
    it('"research" 应推荐 research');
    it('"debate design" 应推荐 architecture-debate');
    it('"process data" 应推荐 data-pipeline');
    it('"implement feature" 应推荐 feature-development');
    it('无匹配应返回 null');
  });

  describe('Template Configurations', () => {
    it('code-review: 3 成员, sequential');
    it('research: 3 成员, parallel');
    it('architecture-debate: 3 成员, debate');
    it('data-pipeline: 4 成员, pipeline');
    it('feature-development: 4 成员, hierarchical');
  });
});
```

### Test Suite 5: Tool 执行与格式化
**文件**: `test/unit/tools/MultiAgentToolsExecution.test.ts`

```typescript
describe('Multi-Agent Tools Execution', () => {
  describe('TeamTool', () => {
    it('应创建团队并执行任务');
    it('应正确格式化结果（含元数据）');
    it('执行失败应返回错误');
  });

  describe('QuickTeamTool', () => {
    it('应根据模板创建团队');
    it('应支持 target 参数');
    it('应支持 max_rounds 参数');
    it('未知模板应返回错误');
  });

  describe('OrchestrateTool', () => {
    it('应使用 ProviderManager 获取 Provider');
    it('应传递 AgentRegistry');
    it('应正确格式化结果');
  });

  describe('PipelineTool', () => {
    it('应顺序执行链步骤');
    it('应替换 {{previous_output}}');
    it('步骤失败应停止执行');
    it('应格式化链执行结果');
  });
});
```

### Test Suite 6: PipelineTool 变量替换
**文件**: `test/unit/tools/PipelineToolVariables.test.ts`

```typescript
describe('PipelineTool - Variable Substitution', () => {
  it('应替换 {{previous_output}}');
  it('第一步无 previous_output 应使用原任务');
  it('应支持多处替换');
  it('空输出应正确传递');
  it('应在最终输出中包含所有步骤');
});
```

---

## 🛠️ Mock 策略

### 核心依赖 Mock

```typescript
// Mock SubAgentLoop
vi.mock('@/core/agent/SubAgentLoop', () => ({
  runSubAgent: vi.fn(async () => ({
    result: 'Mock SubAgent Result',
    tokensUsed: { input: 100, output: 50 },
    duration: 1000,
    timedOut: false,
    iterations: 5,
  })),
}));

// Mock Provider
const createMockProvider = () => ({
  name: 'mock',
  chat: vi.fn(async function* () {
    yield { type: 'text', text: 'Mock' };
  }),
  chatSync: vi.fn(async () => ({ content: 'Mock', stopReason: 'end_turn' })),
});

// Mock ToolRegistry
const createMockRegistry = () => ({
  register: vi.fn(),
  get: vi.fn(),
  getAll: vi.fn(() => []),
  getSchemas: vi.fn(() => []),
  has: vi.fn(() => false),
  execute: vi.fn(async () => ({ content: 'mock', isError: false })),
});
```

---

## 📦 测试文件结构

```
test/
├── core/
│   └── agent/
│       └── team/
│           ├── TeamManager.test.ts           ✅ (已有)
│           ├── TeamManagerExecution.test.ts  🆕 (策略执行)
│           ├── TeamManagerTimeout.test.ts    🆕 (超时错误)
│           ├── TeamManagerAggregation.test.ts🆕 (结果聚合)
│           └── Templates.test.ts             🆕 (模板系统)
│
└── unit/
    └── tools/
        ├── TeamTool.test.ts                  ✅ (已有)
        ├── QuickTeamTool.test.ts             ✅ (已有)
        ├── OrchestrateTool.test.ts           ✅ (已有)
        ├── PipelineTool.test.ts              ✅ (已有)
        ├── MultiAgentToolsExecution.test.ts  🆕 (执行测试)
        └── PipelineToolVariables.test.ts     🆕 (变量替换)
```

---

## 🚀 执行计划

### Phase 1: 核心逻辑测试（优先级: 🔥🔥🔥）
1. ✅ 创建 `TeamManagerExecution.test.ts` - 策略执行
2. ✅ 创建 `TeamManagerTimeout.test.ts` - 超时错误
3. ✅ 创建 `TeamManagerAggregation.test.ts` - 结果聚合

**预期时间**: 2-3 小时  
**预期新增测试**: 30-40 个

### Phase 2: 模板系统测试（优先级: 🔥🔥）
4. ✅ 创建 `Templates.test.ts` - 模板功能和配置

**预期时间**: 1 小时  
**预期新增测试**: 15-20 个

### Phase 3: 工具执行测试（优先级: 🔥）
5. ✅ 创建 `MultiAgentToolsExecution.test.ts` - 工具执行
6. ✅ 创建 `PipelineToolVariables.test.ts` - 变量替换

**预期时间**: 2 小时  
**预期新增测试**: 20-25 个

### Phase 4: 运行与验证（优先级: 🔥🔥🔥）
7. ✅ 运行所有测试: `npm test -- team`
8. ✅ 运行所有测试: `npm test -- multi-agent`
9. ✅ 检查覆盖率: `npm run test:coverage`
10. ✅ 生成测试报告

**预期时间**: 30 分钟

---

## ✅ 成功标准

### 必须达成 (P0)
- [ ] 所有新测试通过（0 failure）
- [ ] TeamManager 5 种策略 100% 覆盖
- [ ] Templates 系统 100% 覆盖
- [ ] 关键路径无 mock 泄漏
- [ ] 测试执行时间 < 15s

### 应该达成 (P1)
- [ ] 代码覆盖率提升至 75%+
- [ ] 所有边界条件覆盖
- [ ] 错误场景覆盖完整
- [ ] 测试代码清晰易维护

### 优秀标准 (P2)
- [ ] 覆盖率达到 85%+
- [ ] 性能基准测试
- [ ] 压力测试（大团队）
- [ ] 集成测试（真实调用）

---

## 📊 预期成果

### 测试文件数量
- **新增**: 6 个测试文件
- **增强**: 4 个现有测试文件
- **总计**: 10+ 测试文件

### 测试用例数量
- **新增**: 65-85 个测试用例
- **现有**: ~30 个测试用例
- **总计**: 95-115 个测试用例

### 覆盖率提升
- **当前**: ~45-50%
- **目标**: 75-80%
- **提升**: +30-35%

---

## 🐛 风险与应对

### 风险 1: Mock 依赖复杂
**应对**: 创建统一的 mock 工厂函数，复用 mock 配置

### 风险 2: 异步测试超时
**应对**: 设置合理的 timeout，使用 `vi.useFakeTimers()`

### 风险 3: 测试执行时间过长
**应对**: 优化 mock，避免真实 I/O 操作

---

## 📚 参考资料

- Vitest 官方文档: https://vitest.dev/
- Vitest Mocking Guide: https://vitest.dev/guide/mocking.html
- 项目现有测试: `test/core/agent/team/TeamManager.test.ts`
- SubAgentLoop 实现: `src/core/agent/SubAgentLoop.ts`
- TeamManager 实现: `src/core/agent/team/TeamManager.ts`

---

**最后更新**: 2024-03-24  
**状态**: ✅ 计划完成，待执行  
**预计完成时间**: 5-6 小时
