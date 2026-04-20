# 贾维斯架构完整实现方案

> 完全采用贾维斯的三层架构，保留xuanji的优势

## 一、架构总览

```
用户交互层 (保留xuanji)
    ↓
主Agent调度层 (贾维斯架构)
    ├─ MainAgent (固定Prompt)
    ├─ IntentParser (意图识别)
    ├─ TaskPlanner (任务规划)
    └─ ResultAggregator (结果汇总)
    ↓
子Agent执行层 (贾维斯架构 + xuanji优势)
    ├─ DynamicSubAgent (动态Prompt)
    ├─ SceneDetector (场景识别)
    ├─ PromptStore (Prompt库)
    └─ AgentLoop (复用xuanji)
    ↓
工具/服务层 (保留xuanji)
    └─ 完整工具生态
```

## 二、核心优势

### 保留xuanji优势
- ✅ TeamManager的5种协调策略
- ✅ AgentLoop的高效执行
- ✅ 完整的工具生态和权限控制
- ✅ 上下文压缩、Token管理、成本追踪
- ✅ 开发者友好的CLI体验

### 融合贾维斯优势
- ✅ 主Agent固定Prompt，职责清晰
- ✅ 子Agent动态Prompt，场景感知
- ✅ 场景识别自动化
- ✅ 专业子Agent预设（8种）

## 三、目录结构

```
src/core/agent/
├── MainAgent.ts              # 主Agent（贾维斯架构）
├── DynamicSubAgent.ts        # 动态子Agent（贾维斯架构）
├── IntentParser.ts           # 意图识别器
├── TaskPlanner.ts            # 任务规划器
├── ResultAggregator.ts       # 结果汇总器
├── SceneDetector.ts          # 场景识别器
├── PromptStore.ts            # Prompt库
├── AgentLoop.ts              # 执行引擎（保留xuanji）
├── TeamManager.ts            # 协调引擎（保留xuanji）
└── presets/                  # 预设Agent配置
    ├── coder.json5           # 编码Agent
    ├── debugger.json5        # 调试Agent
    ├── reviewer.json5        # 审查Agent
    ├── tester.json5          # 测试Agent
    ├── explainer.json5       # 讲解Agent
    ├── explorer.json5        # 探索Agent
    ├── planner.json5         # 规划Agent
    └── refactorer.json5      # 重构Agent
```

## 四、实现步骤

### Phase 1: 核心模块（1-2周）
1. ✅ 实现MainAgent
2. ✅ 实现IntentParser
3. ✅ 实现TaskPlanner
4. ✅ 实现DynamicSubAgent
5. ✅ 实现PromptStore

### Phase 2: 集成测试（1周）
6. ✅ 集成MainAgent和TeamManager
7. ✅ 集成DynamicSubAgent和AgentLoop
8. ✅ 端到端测试

### Phase 3: 优化部署（1周）
9. ✅ 性能优化（缓存、规则引擎）
10. ✅ 文档和示例
11. ✅ 生产部署

---

# 详细实现代码

## 文件1: src/core/agent/MainAgent.ts
