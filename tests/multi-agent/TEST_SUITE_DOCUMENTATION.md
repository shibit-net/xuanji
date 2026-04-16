# Xuanji Multi-Agent 测试套件 - 完整说明

## 📦 创建的文件

### 1. 核心测试文件

#### `tests/multi-agent/comprehensive-test.ts`
**完整的测试套件实现**

- **行数**: 804 行
- **功能**: 
  - 测试所有 OrchestrateTool 策略（Sequential, Parallel, Debate, Hierarchical, Pipeline）
  - 测试 PipelineTool 的基础和复杂工作流
  - 测试所有 QuickTeamTool 模板（5个）
  - 自动收集性能数据和错误信息
  - 生成详细的 Markdown 报告

- **测试用例**:
  1. `testOrchestrateSequential()` - 3阶段代码审查（架构→安全→性能）
  2. `testOrchestrateParallel()` - 多源并行研究（文档+代码+社区）
  3. `testOrchestrateDebate()` - 架构决策辩论（3方观点）
  4. `testOrchestrateHierarchical()` - 分层功能开发（技术负责人→开发→QA）
  5. `testOrchestratePipeline()` - TODO分析流水线（提取→分类→优先级→报告）
  6. `testPipelineBasic()` - 基础3步链（分析→总结→建议）
  7. `testPipelineComplex()` - 复杂4步工作流（提取→清洗→分析→报告）
  8. `testQuickTeamCodeReview()` - code-review模板
  9. `testQuickTeamResearch()` - research模板
  10. `testQuickTeamArchitectureDebate()` - architecture-debate模板
  11. `testQuickTeamDataPipeline()` - data-pipeline模板
  12. `testQuickTeamFeatureDevelopment()` - feature-development模板

- **输出数据**:
  - 每个测试的成功/失败状态
  - 执行时间（毫秒级）
  - Token使用量（输入/输出/总计）
  - 错误信息
  - 团队成员执行详情
  - 轮次数量

#### `tests/multi-agent/quick-test.ts`
**快速验证测试**

- **行数**: 157 行
- **功能**: 运行3个关键测试用例快速验证功能
- **测试用例**:
  1. Orchestrate Sequential - 快速代码审查
  2. Pipeline - 基础数据流
  3. QuickTeam - code-review模板

- **用途**: 
  - CI/CD 快速验证
  - 开发过程中的冒烟测试
  - 功能基本验证

#### `tests/multi-agent/analyze-results.ts`
**测试结果分析工具**

- **行数**: 290 行
- **功能**:
  - 解析多个测试报告
  - 生成趋势分析（成功率、性能、Token使用）
  - 识别常见问题
  - 提供优化建议

- **分析维度**:
  - 成功率趋势（最近5次）
  - 性能趋势（平均执行时间）
  - Token使用趋势
  - 常见错误统计
  - 自动生成建议

### 2. 辅助文件

#### `tests/multi-agent/run-comprehensive-test.sh`
**测试运行脚本**

```bash
#!/bin/bash
# 完整的测试执行脚本
# - 检查依赖
# - 编译TypeScript
# - 运行测试
# - 报告结果
```

#### `tests/multi-agent/README.md`
**测试文档**

- 测试覆盖说明
- 运行指南
- 测试用例详细说明
- 性能基准
- 问题排查指南
- CI/CD集成示例

### 3. 配置更新

#### `package.json`
添加了测试脚本：
```json
{
  "scripts": {
    "test:multi-agent:quick": "tsx tests/multi-agent/quick-test.ts",
    "test:multi-agent:full": "tsx tests/multi-agent/comprehensive-test.ts"
  }
}
```

## 🚀 使用方法

### 快速开始

```bash
# 1. 快速测试（3个核心用例，~3分钟）
npm run test:multi-agent:quick

# 2. 完整测试（12个用例，~30-60分钟）
npm run test:multi-agent:full

# 3. 分析测试结果
npx tsx tests/multi-agent/analyze-results.ts
```

### 高级用法

```bash
# 直接运行测试文件
npx tsx tests/multi-agent/comprehensive-test.ts

# 使用脚本（带依赖检查和编译）
./tests/multi-agent/run-comprehensive-test.sh

# 查看生成的报告
cat tests/multi-agent/test-report-*.md | less
```

## 📊 输出报告格式

每次测试运行会生成 `test-report-YYYY-MM-DDTHH-mm-ss.md`，包含：

### 1. 摘要部分
- 总测试数、通过数、失败数
- 成功率百分比
- 总执行时间和平均时间

### 2. Token使用统计
- 输入Token数量
- 输出Token数量
- 总Token数量
- 平均每测试Token使用

### 3. 工具维度分解
- 按工具类型（orchestrate/pipeline/quick_team）
- 每个工具的成功率、时间、Token使用

### 4. 详细测试结果
每个测试包含：
- ✅/❌ 状态
- 测试名称
- 工具类型
- 策略/模板
- 执行时间
- Token使用
- 轮次数
- 成员数量
- 错误信息（如果失败）

### 5. 问题列表
- 所有失败测试的错误摘要
- 编号列表

### 6. 优化建议
基于结果自动生成：
- 失败率过高警告
- 性能优化建议
- Token使用优化建议

## 📈 性能基准

### 预期指标（Claude 3.7 Sonnet）

| 测试类型 | 测试数 | 预期时间 | 预期Token |
|---------|--------|----------|-----------|
| Quick   | 3      | 2-5分钟  | 10K-30K   |
| Full    | 12     | 30-60分钟| 200K-500K |

### 各策略预期

| 策略 | 成员数 | 预期时间 | 预期Token |
|------|--------|----------|-----------|
| Sequential | 3 | 3-8分钟 | 15K-40K |
| Parallel | 3 | 2-5分钟 | 15K-40K |
| Debate | 3 | 5-10分钟 | 20K-60K |
| Hierarchical | 3 | 4-8分钟 | 18K-45K |
| Pipeline | 4 | 6-12分钟 | 25K-70K |

## 🔍 测试覆盖矩阵

### OrchestrateTool

| 策略 | 测试用例 | 覆盖点 |
|------|---------|--------|
| Sequential | 3阶段代码审查 | 顺序执行、独立分析、结果聚合 |
| Parallel | 多源研究 | 并行执行、知识综合、异步协调 |
| Debate | 架构决策 | 多轮辩论、观点碰撞、共识达成 |
| Hierarchical | 功能开发 | 分层管理、任务委派、优先级 |
| Pipeline | TODO分析 | 数据传递、阶段转换、流式处理 |

### PipelineTool

| 测试用例 | 步骤数 | 覆盖点 |
|---------|--------|--------|
| Basic | 3 | 简单链式、模板替换、输出传递 |
| Complex | 4 | 复杂工作流、多步骤、数据转换 |

### QuickTeamTool

| 模板 | 覆盖点 |
|------|--------|
| code-review | 预定义成员、顺序策略 |
| research | 并行研究、知识整合 |
| architecture-debate | 辩论模式、多观点 |
| data-pipeline | 流水线处理 |
| feature-development | 分层开发 |

## 🐛 常见问题

### 1. 测试超时
**症状**: "Timeout" 错误

**解决**:
```typescript
// 增加timeout参数
timeout: 600000, // 10分钟
```

### 2. Token超限
**症状**: "Context length exceeded"

**解决**:
- 使用更轻量的模型（haiku）
- 减少成员数量
- 简化任务描述

### 3. 依赖错误
**症状**: "Cannot find module"

**解决**:
```bash
npm install
npm run build
```

### 4. API Key 未设置
**症状**: "API key not found"

**解决**:
```bash
export ANTHROPIC_API_KEY=your_key_here
```

## 📝 扩展测试

### 添加新的测试用例

1. 在 `comprehensive-test.ts` 中添加方法：

```typescript
async testMyNewCase() {
  return this.runTest(
    'My New Test Case',
    'orchestrate',
    {
      team_name: 'My Team',
      goal: 'My goal',
      strategy: 'sequential',
      members: [/* ... */],
    },
    'sequential',
  );
}
```

2. 在 `runAllTests()` 中调用：

```typescript
await this.testMyNewCase();
```

### 自定义报告格式

修改 `formatMarkdownReport()` 方法添加自定义部分。

### 集成到 CI/CD

```yaml
# .github/workflows/test.yml
name: Multi-Agent Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm run test:multi-agent:quick
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
      - uses: actions/upload-artifact@v2
        if: always()
        with:
          name: test-reports
          path: tests/multi-agent/test-report-*.md
```

## 🎯 测试目标

1. **功能验证**: 确保所有策略和模板正常工作
2. **性能基准**: 建立性能基准数据
3. **稳定性检查**: 识别不稳定的测试用例
4. **回归检测**: 防止功能退化
5. **文档化**: 提供使用示例和最佳实践

## 📊 成功标准

- ✅ 所有测试通过率 >= 95%
- ✅ 平均执行时间 <= 60s/测试
- ✅ Token使用在预期范围内
- ✅ 无超时错误
- ✅ 报告生成正确

## 🔄 持续改进

1. 定期运行完整测试套件
2. 分析测试结果趋势
3. 根据建议优化代码
4. 更新性能基准
5. 扩展测试覆盖

---

**创建时间**: 2024年
**作者**: Xuanji Test Team
**版本**: 1.0.0
