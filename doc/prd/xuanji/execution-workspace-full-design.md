# Xuanji 完整执行流程可视化设计

## 执行流程分析（基于源码）

### 阶段1：输入处理 (Input Processing)
```
用户输入 → 输入验证 → 会话初始化
```

### 阶段2：意图分析 (Intent Analysis)
```
VectorSkillMatcher（向量语义匹配）
    ↓ 降级
filterByIntent（正则匹配）
    ↓
Skill激活（确定使用哪个Skill）
```
- 涉及文件：`src/core/skills/VectorSkillMatcher.ts`
- 输出：激活的Skill列表

### 阶段3：上下文准备 (Context Preparation)
```
┌─────────────────────┐
│ MemoryRetriever     │ → 向量检索 + 关键词降级
│ ProjectContext      │ → 项目文件结构
│ SystemPrompt        │ → 组装System Prompt
└─────────────────────┘
```
- 涉及文件：`src/memory/HybridRetriever.ts`、`src/context/ProjectContext.ts`

### 阶段4：ReAct 执行循环 (Agent Loop)
```
┌───────────────────────────────────────┐
│  AgentLoop (ReAct循环)                │
├───────────────────────────────────────┤
│                                       │
│  1. LLM Thinking                      │
│     ↓                                 │
│  2. 工具选择                           │
│     ↓                                 │
│  3. 权限检查 (PermissionGuard)         │
│     ↓                                 │
│  4. 工具执行 (ToolRegistry)            │
│     ├─ 文件操作 (Read/Write/Edit)     │
│     ├─ Bash命令                       │
│     ├─ 记忆操作 (MemoryStore/Search)  │
│     ├─ SubAgent调度 (Task/QuickTeam)  │
│     └─ TODO管理                       │
│     ↓                                 │
│  5. 结果处理                           │
│     ↓                                 │
│  6. 判断继续/结束                      │
│     │                                 │
│     └──→ 循环（最大25次迭代）          │
│                                       │
└───────────────────────────────────────┘
```
- 涉及文件：`src/core/agent/AgentLoop.ts`
- 关键事件：onText、onThinking、onToolStart、onToolEnd

### 阶段5：SubAgent 并行执行 (SubAgent Orchestration)
```
TaskTool.execute()
    ↓
SubAgentContext 创建
    ↓
    ┌──────────────┬──────────────┬──────────────┐
    │ SubAgent 1   │ SubAgent 2   │ SubAgent 3   │
    │  (并行执行)   │  (并行执行)   │  (并行执行)   │
    ├──────────────┼──────────────┼──────────────┤
    │ ReAct循环    │ ReAct循环    │ ReAct循环    │
    │ 受限工具集   │ 受限工具集   │ 受限工具集   │
    └──────────────┴──────────────┴──────────────┘
                    ↓
            结果汇总返回主Agent
```
- 涉及文件：`src/core/tools/TodoStorageTool.ts`、`src/core/tools/QuickTeamTool.ts`
- 限制：最大嵌套3层、并发3个、超时300s
- 受限工具：ALWAYS_RESTRICTED_TOOLS（TaskTool不能递归）

### 阶段6：记忆提取 (Memory Extraction)
```
自动触发时机：
- on-save: 用户执行 /save 命令
- on-evict: 消息淘汰（达到上限）
- periodic: 每N轮对话后
- cleanup: 会话退出时

提取链：
SmartMemoryExtractorV2 (高质量LLM)
    ↓ 降级
SmartMemoryExtractor (标准LLM)
    ↓ 降级
MemoryCompactor (基于规则)
```
- 涉及文件：`src/memory/extractors/SmartMemoryExtractorV2.ts`

### 阶段7：结果汇总 (Result Aggregation)
```
收集所有输出
    ↓
Token统计（input/output/cached）
    ↓
成本计算（$0.XXXX）
    ↓
消息历史更新
```

---

## 可视化工作区设计

### 布局结构

```
┌────────────────────────────────────────────────────────────┐
│  顶部状态栏                                                  │
│  [Agent状态] [当前阶段] [Token统计] [成本] [迭代次数]         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  主Canvas绘制区域（流程图 + 动画）                           │
│                                                            │
│  ┌──────────┐                                             │
│  │用户输入  │                                             │
│  └────┬─────┘                                             │
│       │                                                    │
│       ↓                                                    │
│  ┌──────────┐  ┌──────────┐                              │
│  │Skill匹配 │──│记忆检索  │                              │
│  └────┬─────┘  └────┬─────┘                              │
│       └─────────────┘                                     │
│              ↓                                             │
│       ┌─────────────┐                                     │
│       │ Main Agent  │ (脉冲动画)                          │
│       │  ReAct循环  │                                     │
│       └──────┬──────┘                                     │
│              │                                             │
│        ┌─────┼─────┐                                      │
│        ↓     ↓     ↓                                      │
│   ┌─────┐ ┌─────┐ ┌─────┐                                │
│   │Sub1 │ │Sub2 │ │Sub3 │ (并行Agent)                    │
│   └──┬──┘ └──┬──┘ └──┬──┘                                │
│      │       │       │                                     │
│      └───────┼───────┘                                     │
│              ↓                                             │
│       ┌─────────────┐                                     │
│       │  工具执行层  │                                     │
│       │  [工具卡片]  │ (水平时间线)                        │
│       └─────────────┘                                     │
│                                                            │
│  右侧实时日志流（滚动）                                      │
│  [时间] Skill匹配: code-assistant                          │
│  [时间] 记忆检索: 3条相关记忆                               │
│  [时间] 工具调用: Read README.md                           │
│  [时间] 工具完成: 2341 tokens (152ms)                      │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  底部信息卡片                                               │
│  [TODO进度条] [Token明细] [成本] [活动工具列表]             │
└────────────────────────────────────────────────────────────┘
```

### 动画效果

#### 1. Agent节点动画
- **运行中**：蓝色脉冲（外圈光晕呼吸）
- **完成**：绿色渐变（从中心扩散）
- **失败**：红色抖动（左右震动）
- **思考中**：紫色旋转（小圆圈绕大圆）

#### 2. 连线动画
- **数据流动**：虚线移动（dashOffset动画）
- **粒子流**：小圆点沿路径移动
- **箭头指示**：方向箭头闪烁

#### 3. 工具执行动画
- **加载中**：旋转圆环（Loading spinner）
- **成功**：绿色对勾从小到大
- **失败**：红色叉号闪烁

#### 4. SubAgent分叉动画
- 从主Agent节点分裂出多个子节点
- 子节点从中心向外扩散
- 连线逐渐绘制

### 交互功能

#### 1. 节点点击
- 点击Agent节点：显示详细信息（当前任务、执行时长、Token使用）
- 点击工具节点：显示输入参数和输出结果
- 点击阶段节点：显示该阶段的日志

#### 2. 时间线控制
- 暂停/播放按钮
- 时间轴拖拽（回看历史执行过程）
- 速度控制（0.5x / 1x / 2x）

#### 3. 过滤器
- 按Agent过滤（只看Main Agent）
- 按工具类型过滤（只看文件操作）
- 按状态过滤（只看失败的工具）

### 数据来源

#### 从 executionStore 获取
```typescript
- rootAgent: AgentExecutionNode           // Agent执行树
- toolExecutions: ToolExecution[]         // 工具调用记录
- todos: TodoItem[]                       // TODO列表
- permissionInteractions: PermissionInteraction[] // 权限交互
- systemStatus: SystemStatus              // 系统状态
```

#### 需要新增的事件（未来）
```typescript
// IPC事件扩展
'agent:skill-matched'     // Skill匹配完成
'agent:memory-retrieved'  // 记忆检索完成
'agent:context-prepared'  // 上下文准备完成
'agent:iteration-start'   // 新迭代开始
'agent:sub-agent-start'   // SubAgent启动
'agent:sub-agent-end'     // SubAgent结束
```

---

## Canvas绘制逻辑

### 1. 分层绘制

```typescript
// Layer 1: 背景网格
drawGrid(ctx);

// Layer 2: 连线
drawConnections(ctx);

// Layer 3: 节点
drawNodes(ctx);

// Layer 4: 动画粒子
drawParticles(ctx);

// Layer 5: 标签文字
drawLabels(ctx);
```

### 2. 坐标系统

```typescript
// 使用相对坐标，适应不同屏幕尺寸
const scale = Math.min(width / 800, height / 600);

// 节点定位（百分比）
const nodePositions = {
  input: { x: 0.1, y: 0.1 },    // 10%, 10%
  skill: { x: 0.3, y: 0.1 },    // 30%, 10%
  memory: { x: 0.5, y: 0.1 },   // 50%, 10%
  // ...
};
```

### 3. 性能优化

- 使用 `requestAnimationFrame` 控制帧率
- 仅在状态变化时重绘
- 离屏Canvas预渲染静态部分
- 使用Canvas分层（多个Canvas叠加）

---

## 实现技术栈

- **Canvas API**: 主绘制引擎
- **React Hooks**: 状态管理和生命周期
- **Zustand Store**: 执行状态数据源
- **requestAnimationFrame**: 动画循环
- **Path2D**: 复杂路径绘制

---

## 示例：具体场景可视化

### 场景：用户请求"帮我实现登录功能"

```
1. [用户输入] → 显示输入气泡

2. [Skill匹配] → code-assistant (0.92分) ✓
   日志：匹配到Skill: code-assistant (置信度: 0.92)

3. [记忆检索] → 检索到3条相关记忆
   日志：检索记忆: 3条 (向量检索: 2, 关键词: 1)

4. [Main Agent] → 启动，状态=运行中
   日志：Main Agent启动，任务: 实现登录功能

5. [Plan模式判断] → 进入Plan模式
   日志：进入Plan模式，开始设计实现方案

6. [工具调用] → Glob查找相关文件
   日志：工具调用: Glob(pattern="**/*auth*")

7. [工具执行] → 找到 src/auth/login.ts
   日志：工具完成: 找到5个文件 (82ms)

8. [SubAgent分叉] → 创建2个SubAgent
   - SubAgent1: 实现后端API
   - SubAgent2: 实现前端表单
   日志：启动SubAgent: 2个并行任务

9. [SubAgent1工具] → Write(file="src/api/login.ts")
   日志：SubAgent1 → Write工具 → 创建登录API

10. [SubAgent2工具] → Write(file="src/components/LoginForm.tsx")
    日志：SubAgent2 → Write工具 → 创建登录表单

11. [权限检查] → 请求用户确认写入文件
    日志：权限请求: 写入2个新文件

12. [用户批准] → 继续执行
    日志：权限批准，继续执行

13. [SubAgent完成] → 汇总结果
    日志：SubAgent1完成 (3.2s), SubAgent2完成 (2.8s)

14. [TODO创建] → 创建测试TODO
    日志：创建TODO: 编写登录功能单元测试

15. [结果汇总] → 生成最终输出
    日志：完成，Token: 4.2K, 成本: $0.0156

16. [输出] → 显示给用户
```

可视化效果：
- 所有阶段按时间顺序从上到下展开
- SubAgent1和SubAgent2并排显示（表示并行）
- 工具调用在时间线上水平排列
- 连线动画表示数据流动方向
- 节点颜色变化表示状态转换

---

## 开发优先级

### P0 - 核心流程
- [ ] Canvas基础绘制框架
- [ ] 流程节点定义和布局
- [ ] 连线绘制（静态）
- [ ] 状态驱动的节点激活

### P1 - 动画效果
- [ ] 节点脉冲动画
- [ ] 连线流动动画
- [ ] 工具加载动画
- [ ] SubAgent分叉动画

### P2 - 交互功能
- [ ] 节点点击详情
- [ ] 实时日志流
- [ ] 时间线回放
- [ ] 过滤器

### P3 - 扩展功能
- [ ] 导出执行流程图（PNG/SVG）
- [ ] 执行统计分析
- [ ] 性能火焰图

---

## 配置选项

```typescript
interface WorkspaceConfig {
  // 动画
  enableAnimation: boolean;        // 是否启用动画
  animationSpeed: number;          // 动画速度 (0.5x ~ 2x)

  // 布局
  nodeSize: 'small' | 'medium' | 'large';  // 节点大小
  layoutMode: 'vertical' | 'horizontal';   // 布局方向

  // 显示
  showLabels: boolean;             // 显示标签
  showLogs: boolean;               // 显示日志流
  showStats: boolean;              // 显示统计信息

  // 过滤
  filterAgents: string[];          // 过滤Agent
  filterTools: string[];           // 过滤工具类型
}
```
