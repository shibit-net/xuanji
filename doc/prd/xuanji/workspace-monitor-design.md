# Workspace Monitor 设计文档

## 1. 功能定位

**Work Space** 是璇玑桌面应用的实时运行状态监控中心，以 Agent 视角用拟人化的方式展示当前时刻的运行状态。

### 核心特性
- ✅ 实时展示一个或多个 Agent 的运行状态
- ✅ Canvas 动画渲染，提供流畅的视觉体验
- ✅ 拟人化设计，Agent 作为"工作者"展示
- ✅ 仅展示当前状态，不保留历史记录
- ✅ 展示协作关系、任务分配、资源消耗

---

## 2. 界面布局

### 2.1 位置设计

```
┌─────────────────────────────────────────────────────────────┐
│                        Title Bar                             │
├─────────────────────────────────────────────────────────────┤
│ Side │                                            │ Work     │
│ bar  │        Message List                        │ Space   │
│      │        (60-70%)                            │ (30-40%)│
│      │                                            │         │
│      ├────────────────────────────────────────────┤         │
│      │        Input Area                          │         │
├─────────────────────────────────────────────────────────────┤
│                      Status Bar                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Work Space 内部结构

```
┌─────────────────────────────────┐
│  🎯 Work Space                  │
├─────────────────────────────────┤
│                                 │
│      ╭──────╮                  │
│      │Agent │ ← 主 Agent       │
│      │ 🤖  │   (中心节点)      │
│      ╰──┬───╯                  │
│        / \                      │
│       /   \   子 Agent 连接     │
│    ╭─╯     ╰─╮                 │
│    │🔧      🔍│ ← 子 Agent      │
│    ╰──────────╯                │
│                                 │
│  Token: 1,234  ⏱ 2.5s         │
└─────────────────────────────────┘
```

---

## 3. 可视化设计

### 3.1 主 Agent（中心节点）

#### 外观
- **形状**: 圆形 (直径 80px)
- **内容**:
  - Agent 头像/图标（居中）
  - 状态光环（外围）
  - 名称标签（下方）
- **状态光环**:
  - `idle`: 灰色，静态
  - `thinking`: 蓝色，脉冲动画（1s周期）
  - `executing`: 绿色，旋转动画
  - `waiting`: 黄色，闪烁动画
  - `error`: 红色，抖动动画

#### 气泡展示
- **思考气泡**:
  - 位置：Agent 上方
  - 内容：当前思考内容（最多 50 字）
  - 样式：圆角矩形，半透明背景
- **工具气泡**:
  - 位置：Agent 右侧
  - 内容：工具名称 + 执行状态
  - 动画：执行时发射粒子效果

### 3.2 子 Agent（环绕节点）

#### 布局算法
- 使用**圆形布局**：子 Agent 均匀分布在主 Agent 周围
- 半径：150px
- 角度：`2π / childCount * index`
- 最大显示数量：8 个（超过则显示"..."）

#### 外观
- **形状**: 小圆形 (直径 50px)
- **内容**:
  - 工具图标/名称首字母
  - 状态指示点
- **连接线**:
  - 主 Agent → 子 Agent：实线
  - 子 Agent 间协作：虚线
  - 颜色：根据任务类型区分
  - 动画：流动的粒子（表示数据传输）

#### 任务卡片（悬停显示）
```
┌─────────────────┐
│ 🔧 Read Tool    │
│ ────────────    │
│ 状态: 执行中    │
│ 耗时: 123ms     │
│ Token: 45       │
└─────────────────┘
```

### 3.3 统计信息区域

位置：Canvas 底部

```
┌───────────────────────────────┐
│ 🪙 Token: 1,234 (+12)         │
│ ⏱ 耗时: 2.5s                  │
│ 🔄 轮次: 3                     │
└───────────────────────────────┘
```

- **Token 计数器**: 滚动数字动画
- **耗时**: 实时计时器
- **轮次**: 当前迭代次数

---

## 4. 动画效果

### 4.1 状态动画

| 状态 | 动画效果 |
|------|---------|
| `thinking` | 光环脉冲（缩放 1.0 → 1.1 → 1.0，1s周期） |
| `executing` | 光环旋转（360度，2s周期） |
| `waiting` | 光环闪烁（透明度 0.3 → 1.0 → 0.3，0.8s周期） |
| `error` | 节点抖动（x 偏移 ±3px，0.1s周期） |

### 4.2 工具执行动画

```
主 Agent → 发射粒子 → 子 Agent (工具) → 粒子回传 → 主 Agent
```

- **发射粒子**: 小圆点从主 Agent 沿连接线移动到子 Agent
- **粒子颜色**: 绿色（成功）、红色（失败）
- **速度**: 200px/s
- **粒子数量**: 3-5 个

### 4.3 Token 消耗动画

```
Token: 1,234 → 1,246 (滚动数字动画，0.5s)
       ↑↑↑
     +12 (绿色，淡出动画)
```

### 4.4 协作关系动画

子 Agent 之间的虚线连接上，流动的小圆点表示数据传输：
- 速度: 100px/s
- 颜色: 蓝色
- 间隔: 30px

---

## 5. 数据源设计

### 5.1 状态数据结构

```typescript
interface WorkspaceState {
  // 主 Agent
  mainAgent: {
    id: string;
    name: string;
    status: 'idle' | 'thinking' | 'executing' | 'waiting' | 'error';
    currentThought?: string;  // 当前思考
    currentTool?: string;     // 当前工具
  };

  // 子 Agent 列表
  subAgents: Array<{
    id: string;
    name: string;
    type: 'tool' | 'agent';
    status: 'idle' | 'running' | 'success' | 'error';
    task?: string;            // 任务描述
    duration?: number;        // 耗时 (ms)
    tokenUsage?: number;      // Token 消耗
    progress?: number;        // 进度 (0-1)
  }>;

  // 协作关系
  collaborations: Array<{
    from: string;  // Agent ID
    to: string;    // Agent ID
    type: 'task' | 'data';  // 任务分配 | 数据传输
    active: boolean;        // 是否活跃
  }>;

  // 统计信息
  stats: {
    totalTokens: number;
    currentTokenDelta: number;  // 本轮增量
    duration: number;           // 总耗时 (s)
    iteration: number;          // 迭代轮次
  };
}
```

### 5.2 数据来源

从 `runtimeStore` 获取数据：

```typescript
// 主 Agent 状态
const mainAgent = useRuntimeStore((state) => ({
  id: 'main',
  name: state.agentStatus?.name || 'Xuanji',
  status: state.agentStatus?.status || 'idle',
  currentThought: state.agentStatus?.currentThought,
  currentTool: state.agentStatus?.currentTool?.name,
}));

// 工具执行 → 映射为子 Agent
const toolExecutions = useRuntimeStore((state) => state.toolExecutions);
const subAgents = toolExecutions.map(tool => ({
  id: tool.id,
  name: tool.name,
  type: 'tool',
  status: tool.status,
  duration: tool.duration,
}));

// 统计信息
const stats = useRuntimeStore((state) => ({
  totalTokens: state.totalTokens || 0,
  currentTokenDelta: state.currentTokenDelta || 0,
  duration: state.sessionDuration || 0,
  iteration: state.currentIteration || 0,
}));
```

---

## 6. 技术实现

### 6.1 核心组件

```
WorkspaceMonitor/
├── index.tsx              # 主组件（容器）
├── CanvasRenderer.ts      # Canvas 渲染引擎
├── AnimationEngine.ts     # 动画引擎
├── LayoutEngine.ts        # 布局算法
└── types.ts               # 类型定义
```

### 6.2 渲染架构

```typescript
class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private animationFrame: number;
  private state: WorkspaceState;

  // 渲染循环 (60 FPS)
  private renderLoop() {
    this.clear();
    this.drawMainAgent();
    this.drawSubAgents();
    this.drawConnections();
    this.drawStats();
    this.animationFrame = requestAnimationFrame(() => this.renderLoop());
  }

  // 绘制主 Agent
  private drawMainAgent() {
    const { x, y, radius, status } = this.layout.mainAgent;

    // 1. 绘制状态光环
    this.drawHalo(x, y, radius, status);

    // 2. 绘制 Agent 圆形
    this.drawCircle(x, y, radius);

    // 3. 绘制图标
    this.drawIcon(x, y, '🤖');

    // 4. 绘制气泡
    if (this.state.mainAgent.currentThought) {
      this.drawBubble(x, y - radius - 20, this.state.mainAgent.currentThought);
    }
  }

  // 绘制子 Agent
  private drawSubAgents() {
    this.state.subAgents.forEach((agent, index) => {
      const pos = this.layout.getSubAgentPosition(index);
      this.drawSubAgent(pos.x, pos.y, agent);
    });
  }

  // 绘制连接线
  private drawConnections() {
    this.state.collaborations.forEach(collab => {
      const from = this.layout.getAgentPosition(collab.from);
      const to = this.layout.getAgentPosition(collab.to);
      this.drawAnimatedLine(from, to, collab.active);
    });
  }
}
```

### 6.3 布局引擎

```typescript
class LayoutEngine {
  private centerX: number;
  private centerY: number;
  private mainRadius = 40;
  private subRadius = 25;
  private orbitRadius = 150;

  // 计算子 Agent 位置（圆形布局）
  getSubAgentPosition(index: number, total: number): Point {
    const angle = (2 * Math.PI / total) * index - Math.PI / 2;  // 从顶部开始
    return {
      x: this.centerX + Math.cos(angle) * this.orbitRadius,
      y: this.centerY + Math.sin(angle) * this.orbitRadius,
    };
  }

  // 计算连接线路径（贝塞尔曲线）
  getConnectionPath(from: Point, to: Point): Path {
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const controlOffset = 30;

    return {
      start: from,
      control: { x: midX, y: midY - controlOffset },
      end: to,
    };
  }
}
```

### 6.4 动画引擎

```typescript
class AnimationEngine {
  private animations: Map<string, Animation> = new Map();

  // 注册动画
  register(id: string, animation: Animation) {
    this.animations.set(id, animation);
  }

  // 更新所有动画（每帧调用）
  update(deltaTime: number) {
    this.animations.forEach((anim, id) => {
      anim.update(deltaTime);
      if (anim.isComplete()) {
        this.animations.delete(id);
      }
    });
  }

  // 预定义动画
  pulseAnimation(target: Circle, period: number): Animation {
    return {
      update: (time) => {
        const scale = 1 + 0.1 * Math.sin(2 * Math.PI * time / period);
        target.scale = scale;
      },
    };
  }

  particleAnimation(from: Point, to: Point, duration: number): Animation {
    const particles: Particle[] = [];
    for (let i = 0; i < 5; i++) {
      particles.push({
        x: from.x,
        y: from.y,
        progress: i / 5,  // 间隔分布
      });
    }

    return {
      update: (time) => {
        particles.forEach(p => {
          p.progress += deltaTime / duration;
          if (p.progress > 1) p.progress = 0;  // 循环

          // 贝塞尔曲线插值
          p.x = bezier(from.x, to.x, p.progress);
          p.y = bezier(from.y, to.y, p.progress);
        });
      },
      draw: (ctx) => {
        particles.forEach(p => {
          ctx.fillStyle = '#4ade80';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
          ctx.fill();
        });
      },
    };
  }
}
```

---

## 7. 交互设计

### 7.1 悬停交互

- **主 Agent**: 显示完整思考内容（不截断）
- **子 Agent**: 显示详细任务卡片
- **连接线**: 高亮相关的 Agent 节点

### 7.2 点击交互

- **主 Agent**: 无操作（避免干扰）
- **子 Agent**: 展开工具执行详情（在右侧面板）
- **统计区域**: 显示完整统计信息

---

## 8. 性能优化

### 8.1 渲染优化

- **分层渲染**: 背景层（静态） + 动画层（动态）
- **离屏 Canvas**: 预渲染复杂图形
- **脏区域检测**: 只重绘变化区域
- **节流**: 限制状态更新频率（100ms）

### 8.2 内存优化

- **对象池**: 复用粒子对象
- **定时清理**: 完成的动画及时移除
- **限制数量**: 最多显示 8 个子 Agent

---

## 9. 实现计划

### Phase 1: 基础框架（1 天）
- [x] 创建 WorkspaceMonitor 组件
- [x] 集成到 ChatArea 布局
- [x] 实现 Canvas 基础渲染循环
- [x] 实现 LayoutEngine 布局算法

### Phase 2: 主 Agent 可视化（1 天）
- [x] 绘制主 Agent 节点
- [x] 实现状态光环动画
- [x] 实现思考气泡
- [x] 实现工具执行提示

### Phase 3: 子 Agent 系统（2 天）
- [x] 实现圆形布局算法
- [x] 绘制子 Agent 节点
- [x] 实现连接线动画
- [x] 实现粒子流动效果

### Phase 4: 统计与交互（1 天）
- [x] 实现 Token 计数器动画
- [x] 实现耗时计时器
- [x] 实现悬停交互
- [x] 性能优化

---

## 10. 示例场景

### 场景 1: 单 Agent 执行工具

```
状态:
- 主 Agent: "正在读取文件 package.json"
- 子 Agent: Read Tool (执行中)
- Token: +23

可视化:
     💭 "读取配置文件"
       ↓
     ╭──╮
     │🤖│ (绿色光环旋转)
     ╰──╯
       ↓ (粒子流动)
     ╭──╮
     │📄│ Read Tool
     ╰──╯
```

### 场景 2: 多 Agent 协作

```
状态:
- 主 Agent: "分析项目结构"
- 子 Agent 1: Glob (查找文件)
- 子 Agent 2: Read (读取文件)
- 子 Agent 3: Grep (搜索内容)
- 协作: Glob → Read, Read → Grep

可视化:
        ╭──╮
        │🔍│ Grep
        ╰──╯
          ↑ (虚线，数据传输)
     ╭──╮│
     │📄│ Read
     ╰──╯
       ↑
     ╭──╮
     │🤖│ (蓝色脉冲)
     ╰──╯
       ↓
     ╭──╮
     │🗂│ Glob
     ╰──╯
```

---

## 11. 设计原则

1. **简洁优先**: 避免信息过载，只展示关键状态
2. **动画克制**: 动画增强理解，不干扰阅读
3. **性能第一**: 保证 60 FPS，不阻塞主线程
4. **语义清晰**: 颜色、形状、动画都有明确含义
5. **实时响应**: 状态变化立即反映在可视化上

---

## 12. 未来扩展

- **3D 可视化**: 使用 Three.js 实现 3D 场景
- **Agent 画像**: 根据任务类型显示不同的 Agent 形象
- **声音反馈**: 工具执行完成时播放提示音
- **历史回放**: 支持回放某一轮执行的过程
- **自定义主题**: 支持用户自定义颜色和动画风格
