# ExecutionWorkspace 拟人化设计

## 设计理念

从生硬的卡片布局转向温暖、拟人化的交互界面：
- ✅ **圆形头像** - Agent 不再是冷冰冰的方框，而是有表情的头像
- ✅ **呼吸动画** - 光晕脉动，像真实的生命体
- ✅ **柔和视觉** - 渐变色、圆角、阴影、毛玻璃效果
- ✅ **工具气泡** - 工具像漂浮的气泡围绕在 Agent 周围
- ✅ **连接线** - 渐变色的细线连接各个部分，像神经网络

## 视觉元素

### 1. Agent 头像系统

每个 Agent 根据模式显示不同的头像：

| 模式 | Emoji | 渐变色 | 光晕色 | 角色名 | 徽章 |
|------|-------|--------|--------|--------|------|
| Plan | 🧠 | 紫色系 | `rgba(139, 92, 246, 0.5)` | 设计师 | 📋 Plan |
| Team | 👑 | 橙色系 | `rgba(245, 158, 11, 0.5)` | 团队领导 | 👥 Team |
| SubAgent | 🤖 | 绿色系 | `rgba(16, 185, 129, 0.5)` | 执行者 | 🔀 SubAgent |
| Main | ✨ | 蓝色系 | `rgba(59, 130, 246, 0.5)` | 助手 | ▶️ 运行中 |

**头像结构**：
```tsx
<div className="relative">
  {/* 呼吸光晕 */}
  <div className="absolute inset-0 rounded-full animate-pulse"
    style={{
      background: `radial-gradient(circle, ${glow} 0%, transparent 70%)`,
      filter: 'blur(20px)',
      transform: 'scale(1.2)',
    }}
  />

  {/* 头像主体（80x80px） */}
  <div className={`w-20 h-20 rounded-full bg-gradient-to-br ${gradient}
    text-4xl shadow-2xl transform hover:scale-110
    border-4 border-white/20`}
  >
    {emoji}
  </div>

  {/* 在线状态（右上角绿点） */}
  <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full
    border-4 border-gray-900">
    <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
  </div>

  {/* 模式徽章（底部） */}
  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2">
    <div className="px-2 py-0.5 bg-gray-900/90 backdrop-blur-sm
      border border-white/20 rounded-full text-xs shadow-lg">
      {badge}
    </div>
  </div>
</div>
```

### 2. 工具气泡

工具不再是列表项，而是圆角气泡：

```tsx
<div className="flex items-center gap-2 px-3 py-2
  bg-gradient-to-r from-gray-800/80 to-gray-700/80
  backdrop-blur-sm border border-white/10 rounded-full
  shadow-lg hover:shadow-xl hover:scale-105">

  {/* 工具图标（圆形） */}
  <div className="w-6 h-6 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full">
    <span className="text-xs">🔧</span>
  </div>

  {/* 工具名称 */}
  <span className="text-sm font-medium text-white">{tool.name}</span>

  {/* 执行时长 */}
  <span className="text-xs text-gray-400">{duration}s</span>

  {/* Loading 动画 */}
  <Loader2 size={14} className="text-cyan-400 animate-spin" />

  {/* Hover 光晕 */}
  <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/20 to-blue-500/20
    rounded-full opacity-0 group-hover:opacity-100 blur-xl -z-10" />
</div>
```

**视觉效果**：
- 气泡式圆角（`rounded-full`）
- 渐变背景（从灰色到更深的灰色）
- 毛玻璃效果（`backdrop-blur-sm`）
- Hover 时放大（`hover:scale-105`）
- Hover 光晕（蓝青色渐变）

### 3. 用户消息气泡

用户输入也采用头像+气泡形式：

```tsx
<div className="flex items-start gap-6">
  {/* 用户头像（64x64px） */}
  <div className="w-16 h-16 bg-gradient-to-br from-gray-700 to-gray-800
    rounded-full text-3xl shadow-xl border-4 border-white/10">
    👤
  </div>

  {/* 消息气泡（圆角矩形） */}
  <div className="flex-1 bg-gradient-to-r from-gray-800/50 to-gray-700/50
    backdrop-blur-sm border border-white/10
    rounded-2xl rounded-tl-none px-6 py-4 shadow-lg">
    <div className="text-xs text-gray-400">用户</div>
    <div className="text-sm text-white">{message}</div>
  </div>
</div>
```

**视觉特点**：
- 左上角缺角（`rounded-tl-none`），像对话气泡
- 渐变背景 + 毛玻璃
- 阴影效果营造深度感

### 4. 连接线系统

使用渐变色细线连接各个元素：

```tsx
{/* 垂直连接线 */}
<div className="w-0.5 h-8 bg-gradient-to-b from-gray-600 to-transparent" />

{/* 水平分支线 */}
<div className="absolute -left-6 top-10 w-6 h-0.5
  bg-gradient-to-r from-gray-600 to-transparent" />

{/* 汇总连接线（向上渐变） */}
<div className="w-0.5 h-8 bg-gradient-to-t from-gray-600 to-transparent" />
```

**视觉效果**：
- 非常细（0.5px）
- 渐变消失（不会突兀结束）
- 灰色调（不抢眼）

### 5. 并行指示器

```tsx
<div className="flex items-center gap-2 text-orange-400">
  {/* 双脉动点 */}
  <div className="flex items-center gap-1">
    <div className="w-2 h-2 bg-orange-400 rounded-full animate-pulse" />
    <div className="w-2 h-2 bg-orange-400 rounded-full animate-pulse"
      style={{ animationDelay: '0.3s' }} />
  </div>
  <span>并行执行 {count} 个任务</span>
</div>
```

**动画效果**：
- 两个小圆点交替脉动（延迟 0.3s）
- 橙色表示并行（警示色）

## 布局结构

### 水平布局

```
┌─────────────────────────────────────────────────────────┐
│  👤 (用户头像)  ┌─ 用户消息气泡 ─────────────┐           │
│                │ "帮我实现登录功能"          │           │
│                └────────────────────────────┘           │
│                    │ (连接线)                            │
│                    ↓                                     │
│  ✨ (Agent头像)  ┌─ Agent 信息区 ───────────┐           │
│  [在线●]        │ Main Agent • 助手          │           │
│  [📋 Plan]      │ ✨ 设计实现方案            │           │
│                 │ 🔧 工具1  🔧 工具2       │           │
│                 └───────────────────────────┘           │
└─────────────────────────────────────────────────────────┘
```

### 头像位置

- **用户头像**：64x64px，左侧
- **Agent 头像**：80x80px，左侧，更大更突出
- **SubAgent 头像**：80x80px，缩进显示

### 信息区域

头像右侧的信息区：
- Agent 名称（文字 + 角色名）
- 当前任务（如果有）
- 工具气泡列表（横向排列，自动换行）

## 动画效果

### 1. 呼吸光晕

```css
animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
filter: blur(20px);
transform: scale(1.2);
```

**效果**：头像周围的光晕缓慢脉动，像呼吸一样。

### 2. Hover 放大

```css
transform: scale(1.1);
transition: transform 0.3s ease;
```

**效果**：鼠标悬停在头像上时，头像放大 10%。

### 3. 工具气泡 Hover

```css
transform: scale(1.05);
box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
```

**效果**：悬停时气泡轻微放大，阴影加深。

### 4. 在线状态脉动

```css
animation: pulse 2s infinite;
```

**效果**：绿色状态点持续脉动，表示 Agent 在线。

### 5. Loading 旋转

```css
animation: spin 1s linear infinite;
```

**效果**：工具气泡中的 Loading 图标持续旋转。

### 6. 并行指示器交替脉动

```tsx
<div className="animate-pulse" />
<div className="animate-pulse" style={{ animationDelay: '0.3s' }} />
```

**效果**：两个小圆点交替脉动，表示并行执行。

## 色彩系统

### 背景色

```css
bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950
```

**深色渐变**，从接近黑色到深蓝灰色。

### 头像渐变色

| 模式 | 渐变类 |
|------|--------|
| Plan | `from-purple-500 via-violet-500 to-purple-600` |
| Team | `from-orange-500 via-amber-500 to-orange-600` |
| SubAgent | `from-green-500 via-emerald-500 to-green-600` |
| Main | `from-blue-500 via-cyan-500 to-blue-600` |

**三色渐变**，中间色作为过渡，让渐变更柔和。

### 工具气泡

```css
bg-gradient-to-r from-gray-800/80 to-gray-700/80
```

**横向渐变**，从浅灰到深灰，80% 透明度。

### 边框

```css
border-white/10  /* 10% 白色 */
border-white/20  /* 20% 白色 */
```

**半透明白色边框**，让元素有轻微的边界感。

## 响应式设计

### 并行布局

```tsx
{card.children[0]?.isParallel ? (
  <div className="grid grid-cols-2 gap-6">
    {card.children.map((child) => renderAgentCard(child))}
  </div>
) : (
  <div className="space-y-6">
    {card.children.map((child) => renderAgentCard(child))}
  </div>
)}
```

**2列网格** vs **垂直堆叠**，根据是否并行自动切换。

### 工具气泡自动换行

```tsx
<div className="flex flex-wrap gap-2">
  {card.tools.map((tool) => (
    <div className="rounded-full">...</div>
  ))}
</div>
```

**flex-wrap**：当工具数量多时自动换行，不会溢出。

## 空状态设计

```tsx
<div className="text-center">
  {/* 脉动光圈 */}
  <div className="absolute inset-0 bg-blue-500/30 rounded-full animate-ping" />

  {/* 大头像 */}
  <div className="w-24 h-24 bg-gradient-to-br from-blue-500 to-purple-600
    rounded-full text-5xl shadow-2xl">
    ✨
  </div>

  {/* 提示文字 */}
  <div className="text-xl font-bold text-white">等待执行任务...</div>
  <div className="text-sm text-gray-400">发送消息后，Agent 将开始工作</div>
</div>
```

**视觉效果**：
- 大的星星 emoji（96x96px）
- 蓝紫渐变背景
- 外圈脉动光圈（`animate-ping`）
- 温馨的提示文字

## 顶部/底部状态栏

### 顶部状态栏

```tsx
<div className="flex items-center gap-3">
  {/* 圆形图标 */}
  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600
    rounded-full flex items-center justify-center shadow-lg">
    <Activity size={20} className="text-white" />
  </div>

  {/* 文字信息 */}
  <div>
    <div className="text-sm font-bold text-white">Agent 执行监视器</div>
    <div className="text-xs text-gray-400">N 个 Agent 正在工作</div>
  </div>
</div>
```

**圆形图标 + 文字**，更加统一的视觉风格。

### 底部状态栏

```tsx
{rootAgent?.status === 'running' ? (
  <>
    <Loader2 size={14} className="animate-spin text-blue-400" />
    <span className="text-white font-medium">正在执行任务...</span>
  </>
) : (
  <>
    <div className="w-2 h-2 bg-gray-600 rounded-full" />
    <span>待命中</span>
  </>
)}
```

**圆点 + 文字**，表示当前状态。

## 交互细节

### 1. Hover 效果

- **头像**：放大 10%
- **工具气泡**：放大 5% + 阴影加深 + 背景光晕
- **连接线**：无（保持静态）

### 2. 点击效果（未来）

可以添加：
- 点击头像：展开 Agent 详细信息
- 点击工具气泡：显示工具输入/输出
- 点击并行指示器：高亮并行分支

### 3. 滚动体验

```css
overflow-y-auto
```

内容区域支持垂直滚动，保持顶部/底部状态栏固定。

## 对比：生硬 vs 拟人化

| 对比项 | 生硬卡片 | 拟人化设计 |
|--------|----------|-----------|
| Agent 表示 | 方形卡片 | 圆形头像 + Emoji |
| 视觉风格 | 直角边框 | 圆角 + 渐变 + 阴影 |
| 工具展示 | 列表项 | 气泡式圆角 |
| 动画效果 | 无或简单 | 呼吸光晕 + Hover 放大 |
| 在线状态 | 无 | 绿色脉动点 |
| 用户消息 | 普通卡片 | 头像 + 对话气泡 |
| 连接线 | 无或生硬 | 渐变细线 |
| 整体感受 | 工具感 | 温暖、生动 |

## 总结

通过拟人化设计，ExecutionWorkspace 从冷冰冰的监控面板变成了温暖、生动的 Agent 工作界面：

✅ **视觉温暖**：圆角、渐变、柔和的色彩
✅ **拟人化**：头像、表情、呼吸动画
✅ **生动活泼**：脉动、放大、旋转等动画
✅ **信息清晰**：模式徽章、在线状态、执行时长
✅ **交互友好**：Hover 反馈、气泡式布局

现在的界面不再是"监控工具"，而是"和 Agent 一起工作"的感觉。
