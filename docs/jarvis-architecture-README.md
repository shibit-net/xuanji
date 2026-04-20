# 贾维斯架构完整实现方案

> 完全采用贾维斯的三层架构，保留xuanji的优势

## 📋 目录

- [架构总览](#架构总览)
- [核心优势](#核心优势)
- [模块说明](#模块说明)
- [实施步骤](#实施步骤)
- [使用示例](#使用示例)
- [性能对比](#性能对比)
- [FAQ](#faq)

---

## 🏗️ 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    用户交互层 (保留xuanji)                     │
│              Ink Terminal UI / Electron Desktop              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│              核心调度层 (贾维斯架构 - 主Agent)                  │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              MainAgent (固定Prompt)                  │   │
│  │  职责：需求解析 → 任务拆分 → 调度子Agent → 结果汇总   │   │
│  └─────────────────────────────────────────────────────┘   │
│         ↓              ↓              ↓              ↓       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │意图识别器│  │任务规划器│  │Prompt库  │  │结果汇总器│  │
│  │ Parser  │  │ Planner  │  │  Store   │  │Aggregator│  │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  │
│                                                               │
│  🔧 保留xuanji优势：                                          │
│  • 使用TeamManager作为调度引擎                                │
│  • 复用5种协调策略                                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│            专业执行层 (贾维斯架构 - 子Agent)                   │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          SubAgent (动态Prompt + 场景感知)            │   │
│  │  职责：场景识别 → 加载Prompt → 执行任务 → 返回结果    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                               │
│  🔧 保留xuanji优势：                                          │
│  • 使用AgentLoop作为执行引擎                                  │
│  • 复用完整的工具生态                                         │
│  • 保留上下文压缩、Token管理等能力                            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  工具/服务层 (保留xuanji)                      │
│  Read | Write | Edit | Bash | Grep | Glob | WebSearch ...  │
└─────────────────────────────────────────────────────────────┘
```

---

## ✨ 核心优势

### 保留xuanji优势
- ✅ **TeamManager的5种协调策略**：sequential/parallel/hierarchical/debate/pipeline
- ✅ **AgentLoop的高效执行**：减少不必要的LLM调用
- ✅ **完整的工具生态**：Read/Write/Edit/Bash/Grep/Glob等
- ✅ **权限控制和沙箱隔离**：保护系统安全
- ✅ **上下文压缩**：自动管理Token使用
- ✅ **Token管理和成本追踪**：实时监控费用
- ✅ **开发者友好的CLI体验**：流式输出、代码高亮

### 融合贾维斯优势
- ✅ **主Agent固定Prompt**：职责清晰，只做调度
- ✅ **子Agent动态Prompt**：根据场景自动切换
- ✅ **场景识别自动化**：规则引擎 + LLM兜底
- ✅ **专业子Agent预设**：8种专业Agent（coder/debugger/reviewer等）
- ✅ **统一口吻包装**：结果汇总，体验一致

---

## 📦 模块说明

### 1. MainAgent（主调度Agent）

**文件：** `src/core/agent/jarvis/MainAgent.ts`

**职责：**
- 需求解析：识别用户意图和任务类型
- 任务拆分：将复杂任务拆分为子任务
- 策略选择：选择最佳执行策略
- 子Agent调度：调用专业子Agent执行任务
- 结果汇总：统一口吻包装，返回给用户

**核心特点：**
- 固定Prompt：不参与专业任务执行
- 职责单一：只做调度，不做专业输出
- 复用xuanji：使用TeamManager作为调度引擎

### 2. IntentParser（意图识别器）

**文件：** `src/core/agent/jarvis/IntentParser.ts`

**职责：**
- 快速识别用户意图（编程场景分类）
- 判断任务复杂度（简单/复杂）
- 提取关键信息（关键词、置信度）

**优化策略：**
- 规则引擎优先（0ms，覆盖80%常见场景）
- LRU缓存（<1ms，相似问题复用）
- 轻量LLM兜底（~200ms，复杂场景）

**支持的意图类型：**
- `code_generation` - 写代码
- `debugging` - 调试
- `code_review` - 审查
- `testing` - 测试
- `refactoring` - 重构
- `explanation` - 讲解
- `exploration` - 探索
- `planning` - 规划

### 3. TaskPlanner（任务规划器）

**文件：** `src/core/agent/jarvis/TaskPlanner.ts`

**职责：**
- 将意图转换为可执行的任务计划
- 智能拆分复杂任务
- 识别任务依赖关系
- 推荐最佳执行策略

**支持的策略：**
- `single` - 单任务直接执行
- `sequential` - 串行执行（任务有依赖）
- `parallel` - 并行执行（任务独立）
- `hierarchical` - 层级执行（planner规划 + workers执行）
- `debate` - 辩论模式（多角度评估）
- `pipeline` - 流水线（数据流式处理）

### 4. PromptStore（Prompt库）

**文件：** `src/core/agent/jarvis/PromptStore.ts`

**职责：**
- 存储所有场景的Prompt模板
- 提供场景到Prompt的映射
- 支持动态参数替换

**核心场景配置：**

| 场景 | Agent | 温度值 | 工具 | 说明 |
|------|-------|--------|------|------|
| write_code | coder | 0.2 | read/write/edit/bash | 严谨、可直接运行 |
| debug | debugger | 0.3 | read/edit/bash/grep | 细致、步骤清晰 |
| review | reviewer | 0.3 | read/grep/glob | 批判性、优化建议 |
| test | tester | 0.2 | read/write/edit/bash | 全面、覆盖边界 |
| refactor | refactorer | 0.3 | read/write/edit/grep | 改进、保持功能 |
| explain | explainer | 0.7 | read/web_search | 通俗、易理解 |
| explore | explorer | 0.5 | glob/grep/read | 广度、快速定位 |
| plan | planner | 0.4 | read/glob/grep | 结构化、架构清晰 |

### 5. ResultAggregator（结果汇总器）

**文件：** `src/core/agent/jarvis/ResultAggregator.ts`

**职责：**
- 整合多个子Agent的执行结果
- 统一口吻包装
- 格式化输出（代码高亮、结构化列表）
- 提炼关键信息

**汇总策略：**
- 单任务：直接返回
- 多任务：调用LLM统一口吻包装

---

## 🚀 实施步骤

### Phase 1: 核心模块实现（1-2周）

**Week 1:**
1. ✅ 实现IntentParser（意图识别器）
   - 规则引擎
   - LRU缓存
   - LLM兜底
2. ✅ 实现PromptStore（Prompt库）
   - 8种场景配置
   - 动态参数替换
3. ✅ 实现TaskPlanner（任务规划器）
   - 简单任务计划
   - 复杂任务拆分

**Week 2:**
4. ✅ 实现ResultAggregator（结果汇总器）
   - LLM汇总
   - 降级方案
5. ✅ 实现MainAgent（主调度Agent）
   - 集成所有模块
   - 连接TeamManager

### Phase 2: 集成测试（1周）

**Week 3:**
6. ✅ 集成MainAgent和TeamManager
   - 单任务执行测试
   - 多任务协调测试
7. ✅ 集成DynamicSubAgent和AgentLoop
   - 场景识别测试
   - 动态Prompt测试
8. ✅ 端到端测试
   - 简单任务流程
   - 复杂任务流程

### Phase 3: 优化部署（1周）

**Week 4:**
9. ✅ 性能优化
   - 缓存优化
   - 规则引擎优化
   - LLM调用优化
10. ✅ 文档和示例
    - API文档
    - 使用示例
    - 最佳实践
11. ✅ 生产部署
    - 配置管理
    - 监控告警
    - 灰度发布

---

## 💡 使用示例

### 示例1: 简单任务（写代码）

```typescript
import { MainAgent } from '@/core/agent/jarvis/MainAgent';

const mainAgent = new MainAgent(provider, registry, config, teamManager);

// 用户输入
const userInput = "写一个用户登录接口";

// 执行
const result = await mainAgent.execute(userInput);

// 流程：
// 1. IntentParser识别意图：code_generation（规则引擎，0ms）
// 2. TaskPlanner创建计划：single任务，coder Agent，write_code场景
// 3. MainAgent调用TeamManager执行
// 4. PromptStore加载write_code场景的Prompt（温度0.2）
// 5. AgentLoop执行任务
// 6. ResultAggregator直接返回（单任务）
```

### 示例2: 复杂任务（实现用户系统）

```typescript
const userInput = "实现一个完整的用户系统，包括注册、登录、权限管理";

const result = await mainAgent.execute(userInput);

// 流程：
// 1. IntentParser识别意图：code_generation + complex（LLM，~200ms）
// 2. TaskPlanner拆分任务（LLM，~500ms）：
//    - task-1: planner Agent，plan场景，"设计用户系统架构"
//    - task-2: coder Agent，write_code场景，"实现用户注册接口"
//    - task-3: coder Agent，write_code场景，"实现用户登录接口"
//    - task-4: coder Agent，write_code场景，"实现权限管理模块"
//    - task-5: tester Agent，test场景，"编写单元测试"
//    策略：sequential（串行执行）
// 3. MainAgent调用TeamManager执行（使用sequential策略）
// 4. 每个子Agent使用对应场景的Prompt
// 5. ResultAggregator汇总所有结果（LLM，~300ms）
```

### 示例3: 调试任务

```typescript
const userInput = "修复登录接口的bug，用户无法登录";

const result = await mainAgent.execute(userInput);

// 流程：
// 1. IntentParser识别意图：debugging（规则引擎，0ms）
// 2. TaskPlanner创建计划：single任务，debugger Agent，debug场景
// 3. PromptStore加载debug场景的Prompt（温度0.3）
// 4. AgentLoop执行任务（使用read/edit/bash/grep工具）
// 5. ResultAggregator直接返回
```

---

## 📊 性能对比

### LLM调用次数对比

| 场景 | 贾维斯原方案 | xuanji原方案 | 本方案 | 优化 |
|------|-------------|-------------|--------|------|
| 简单任务 | 4次 | 1次 | 1次 | ✅ 与xuanji持平 |
| 复杂任务 | 6次 | 1次 | 3次 | ⚠️ 增加2次（拆分+汇总） |

### 响应时间对比

| 场景 | 贾维斯原方案 | xuanji原方案 | 本方案 | 说明 |
|------|-------------|-------------|--------|------|
| 简单任务 | ~2.5s | ~2s | ~2s | 规则引擎识别，0ms开销 |
| 复杂任务 | ~8s | ~5s | ~6s | 拆分+汇总各增加~500ms |

### 成本对比

| 场景 | 贾维斯原方案 | xuanji原方案 | 本方案 | 说明 |
|------|-------------|-------------|--------|------|
| 简单任务 | ~2350 tokens | ~2000 tokens | ~2000 tokens | 规则引擎识别，无额外成本 |
| 复杂任务 | ~5000 tokens | ~4000 tokens | ~4500 tokens | 拆分+汇总各增加~250 tokens |

### 优势总结

✅ **简单任务**：与xuanji持平，无额外开销
✅ **复杂任务**：增加少量开销（~20%），但获得更好的任务拆分和结果汇总
✅ **场景适配**：动态Prompt机制，专业性大幅提升
✅ **可扩展性**：易于添加新场景和新Agent

---

## ❓ FAQ

### Q1: 为什么不完全照搬贾维斯方案？

**A:** 贾维斯方案的核心优势是"动态Prompt + 场景识别"，但其调度层设计会增加LLM调用次数。本方案通过以下优化，在保留核心优势的同时，减少了性能开销：

1. **规则引擎优先**：80%的简单任务通过规则引擎识别，0ms开销
2. **LRU缓存**：相似问题复用解析结果，<1ms
3. **复用xuanji的TeamManager**：避免重复实现协调逻辑

### Q2: 如何添加新的场景？

**A:** 在PromptStore中添加新场景配置：

```typescript
promptStore.setScenePrompt('new_scene', {
  prompt: '你是...',
  temperature: 0.3,
  tools: ['read', 'write'],
  maxTokens: 3000,
});
```

### Q3: 如何自定义Agent？

**A:** 创建新的Agent配置文件：

```json5
// .xuanji/agents/my-agent.json5
{
  name: "my-agent",
  description: "我的自定义Agent",
  systemPrompt: "你是...",
  temperature: 0.3,
  tools: ["read", "write"],
}
```

### Q4: 性能开销可以接受吗？

**A:** 可以接受：

- **简单任务**：无额外开销（规则引擎识别）
- **复杂任务**：增加~20%开销，但获得更好的任务拆分和结果汇总
- **专业性提升**：动态Prompt机制带来的专业性提升远超性能开销

### Q5: 如何监控和优化？

**A:** 内置监控指标：

- LLM调用次数和耗时
- 规则引擎命中率
- 缓存命中率
- Token使用量和成本

优化建议：

1. 扩展规则引擎，提高命中率
2. 调整缓存大小，提高复用率
3. 优化Prompt长度，减少Token消耗

---

## 📝 总结

本方案成功融合了贾维斯和xuanji的优势：

✅ **完全采用贾维斯架构**：主Agent调度 + 子Agent执行 + 动态Prompt
✅ **保留xuanji优势**：TeamManager多策略 + AgentLoop高效执行 + 完整工具生态
✅ **性能优化**：规则引擎 + LRU缓存，减少不必要的LLM调用
✅ **专业性提升**：8种场景配置，动态Prompt机制
✅ **易于扩展**：支持自定义场景和Agent

**适用场景：**
- ✅ 专业编程助手（xuanji的定位）
- ✅ 场景细分需求（写代码/调试/审查/测试等）
- ✅ 复杂任务协调（多Agent协同）
- ✅ 开发者用户（关注效率和专业性）

**不适用场景：**
- ❌ 全能型个人助理（生活/工作场景）
- ❌ C端用户（需要过度包装）
- ❌ 极致性能要求（每毫秒都计较）

---

**下一步：** 开始实施Phase 1，实现核心模块！
