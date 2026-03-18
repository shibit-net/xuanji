# Work Space Monitor - 运行状态监控中心

## 概述

Work Space Monitor 是璇玑桌面应用的实时运行状态监控中心，以 Agent 视角用拟人化的方式展示当前时刻的运行状态。

![Work Space Monitor](https://via.placeholder.com/800x600?text=Work+Space+Monitor)

## 核心特性

- ✅ **实时可视化**: 60 FPS Canvas 动画，流畅展示 Agent 运行状态
- ✅ **拟人化设计**: Agent 作为"工作者"，工具作为"任务"，直观易懂
- ✅ **动态动画**: 脉冲、旋转、闪烁、粒子流动，丰富的视觉反馈
- ✅ **圆形布局**: 子 Agent 环绕主 Agent，视觉平衡美观
- ✅ **高性能**: 高 DPI 支持、requestAnimationFrame、自动清理
- ✅ **响应式**: 自动适配窗口大小变化

## 快速开始

### 启动 GUI

```bash
cd /Users/kevinshi/Documents/workspace/codebase/shibit/xuanji
npm run dev:gui
```

### 测试脚本

```bash
./test-workspace-monitor.sh
```

## 可视化效果

### 主 Agent 状态

| 状态 | 颜色 | 动画 | 说明 |
|------|------|------|------|
| `idle` | 灰色 | 无 | 空闲状态 |
| `thinking` | 蓝色 | 脉冲光环 | 正在思考 |
| `executing` | 绿色 | 旋转光环 | 正在执行 |
| `waiting` | 黄色 | 闪烁光环 | 等待中 |
| `error` | 红色 | 抖动 | 错误状态 |

### 子 Agent（工具）

- **图标映射**:
  - 📄 Read - 读取文件
  - ✍️ Write - 写入文件
  - ✏️ Edit - 编辑文件
  - 💻 Bash - 执行命令
  - 🔍 Grep - 搜索内容
  - 🗂️ Glob - 查找文件

- **状态指示**:
  - 🔵 运行中 - 蓝色边框 + 进度环
  - 🟢 成功 - 绿色边框
  - 🔴 失败 - 红色边框
  - ⚪ 空闲 - 灰色边框

### 连接线与粒子

- **连接线**: 贝塞尔曲线，主 Agent → 子 Agent
- **粒子流动**: 工具执行时，绿色粒子沿连接线流动
- **速度**: 200px/s

### 统计信息

```
🪙 Token: 1,234
⏱ 2.5s
🔄 轮次: 3
```

## 测试场景

### 场景 1: 单工具执行

```
用户输入: 读取 package.json 文件

预期效果:
1. 主 Agent 变为蓝色（thinking）
2. Read 工具节点出现（蓝色边框）
3. 粒子从主 Agent 流向 Read 工具
4. Read 工具完成后变为绿色
5. Token 统计更新
```

### 场景 2: 多工具协作

```
用户输入: 分析项目结构

预期效果:
1. 主 Agent 变为蓝色（thinking）
2. 多个工具节点出现（Glob、Read、Grep）
3. 多条粒子流同时流动
4. 工具依次完成，变为绿色
5. Token 统计持续更新
```

## 技术架构

### 核心模块

```
WorkspaceMonitor/
├── types.ts              # 类型定义
├── LayoutEngine.ts       # 布局算法
├── AnimationEngine.ts    # 动画引擎
├── CanvasRenderer.ts     # Canvas 渲染器
└── index.tsx             # React 组件
```

### 数据流

```
runtimeStore (Zustand)
  ↓
WorkspaceMonitor (React)
  ↓
CanvasRenderer (Canvas API)
  ├── LayoutEngine (布局计算)
  └── AnimationEngine (动画管理)
```

### 渲染循环

```javascript
requestAnimationFrame(() => {
  // 1. 更新动画
  animationEngine.update(currentTime, deltaTime);

  // 2. 清空画布
  ctx.clearRect(0, 0, width, height);

  // 3. 绘制内容
  drawConnections();
  drawSubAgents();
  drawMainAgent();
  drawStats();

  // 4. 绘制动画
  animationEngine.draw(ctx);
});
```

## 性能优化

### 已实现

- ✅ 高 DPI 支持（自动检测 devicePixelRatio）
- ✅ requestAnimationFrame（60 FPS）
- ✅ 动画自动清理（避免内存泄漏）
- ✅ 响应式布局（监听 resize 事件）

### 未来优化

- [ ] 分层渲染（背景层 + 动画层）
- [ ] 离屏 Canvas（预渲染复杂图形）
- [ ] 脏区域检测（只重绘变化区域）
- [ ] 对象池（复用粒子对象）

## 文档

- [设计文档](./doc/prd/xuanji/workspace-monitor-design.md) - 详细设计方案
- [实现总结](./doc/prd/xuanji/workspace-monitor-implementation.md) - 实现细节和测试清单

## 已知限制

### 当前版本

- ⚠️ 悬停交互未实现（鼠标悬停显示详情）
- ⚠️ Token 增量动画未实现（+12 绿色数字）
- ⚠️ 耗时统计未实现（需要 runtimeStore 支持）
- ⚠️ 子 Agent 协作关系未实现（工具之间的连接）

### 数据源限制

- runtimeStore 暂时没有以下数据：
  - 单个工具的 Token 消耗
  - 会话总耗时
  - Token 增量统计
  - 子 Agent 之间的协作关系

## 后续计划

### Phase 5: 交互增强

- [ ] 悬停检测（显示详情卡片）
- [ ] 点击交互（展开工具详情）
- [ ] Token 增量动画
- [ ] 实时耗时计时器

### Phase 6: 数据增强

- [ ] 扩展 runtimeStore 统计数据
- [ ] 子 Agent 协作关系检测
- [ ] 单个工具 Token 统计
- [ ] 会话总耗时统计

### Phase 7: 视觉优化

- [ ] 深色/浅色主题支持
- [ ] 动画缓动优化
- [ ] 字体渲染优化
- [ ] 布局算法优化

### Phase 8: 性能优化

- [ ] 分层渲染
- [ ] 离屏 Canvas
- [ ] 脏区域检测
- [ ] 对象池

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

---

**Shibit Xuanji · 璇玑** - 开源 AI 助手
