# Xuanji 记忆系统实施计划

## 开发策略

**并行开发两条主线**：
1. **主线 1**：记忆管理界面（用户可见可控）
2. **主线 2**：错误记忆系统 Phase 1（记住 bug，避免重犯）

**预计时间**：4-6 周

---

## 主线 1：记忆管理界面（2-3 周）

### 目标
让用户能够查看、搜索、编辑、删除所有记忆（对话、知识、错误）

### Week 1：后端基础 + 数据模型

#### Task 1.1：记忆数据存储（2 天）
- [ ] 创建 `src/memory/MemoryStore.ts`（统一的记忆存储接口）
- [ ] SQLite 数据库设计
  ```sql
  -- 记忆表
  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,  -- 'exchange' | 'fact' | 'preference' | 'skill' | 'error'
    content TEXT NOT NULL,
    metadata JSON,
    quality JSON,        -- {accuracy, confidence, recency, ...}
    provenance JSON,     -- {source, sessionId, timestamp, ...}
    embedding BLOB,
    hidden BOOLEAN DEFAULT 0,
    created_at INTEGER,
    updated_at INTEGER
  );

  -- 向量索引（sqlite-vec）
  CREATE VIRTUAL TABLE memory_vec USING vec0(
    id TEXT PRIMARY KEY,
    embedding FLOAT[384]
  );
  ```
- [ ] 基本 CRUD 操作（add, get, update, delete, query）
- [ ] 向量检索集成（使用现有 VectorStore）

#### Task 1.2：IPC Bridge（1 天）
- [ ] 创建 `desktop/main/memory-bridge.ts`
- [ ] IPC handlers：
  - `memory:search` - 搜索记忆（支持语义搜索）
  - `memory:get` - 获取单条记忆
  - `memory:update` - 更新记忆
  - `memory:delete` - 删除记忆
  - `memory:feedback` - 反馈记忆质量（👍👎）
  - `memory:export` - 导出记忆为 JSON
  - `memory:import` - 导入记忆
- [ ] 注册到 main process

#### Task 1.3：类型定义扩展（0.5 天）
- [ ] 扩展 `desktop/renderer/types/models.ts`
  ```typescript
  export interface Memory {
    id: string;
    type: 'exchange' | 'fact' | 'preference' | 'skill' | 'error';
    content: string;
    metadata: Record<string, any>;
    quality: MemoryQuality;
    provenance: MemoryProvenance;
    hidden: boolean;
    createdAt: string;
    updatedAt: string;
  }

  export interface MemoryQuality {
    accuracy: number;
    confidence: number;
    recency: number;
    useCount: number;
    lastUsed: number;
  }

  export interface MemoryProvenance {
    source: 'user_explicit' | 'conversation' | 'file_analysis' | 'web_search';
    originalContext: {
      sessionId?: string;
      messageId?: string;
      filePath?: string;
      timestamp: number;
    };
  }
  ```

### Week 2：前端界面

#### Task 1.4：记忆浏览器（2 天）
- [ ] 创建 `desktop/renderer/views/MemoryBrowser.tsx`
- [ ] 功能：
  - 记忆列表（分页，每页 20 条）
  - 搜索框（语义搜索）
  - 过滤器（类型、时间范围、质量阈值、显示隐藏）
  - 统计面板（总数、类型分布）
  - 导出/导入按钮
- [ ] 布局：三栏（左侧过滤器 + 中间列表 + 右侧详情）

#### Task 1.5：记忆卡片组件（1 天）
- [ ] 创建 `desktop/renderer/components/MemoryCard.tsx`
- [ ] 显示内容：
  - 类型标签（emoji + 颜色）
  - 时间戳
  - 质量指示器（可视化 5 维评分）
  - 内容预览（截断长文本）
  - 操作按钮（👍 👎 ⏰ 编辑 删除）
  - 展开/收起详情
- [ ] 状态标记：
  - 隐藏状态（灰色）
  - 冲突标记（⚠️）
  - 高质量标记（⭐）

#### Task 1.6：记忆编辑器（1.5 天）
- [ ] 创建 `desktop/renderer/components/MemoryEditor.tsx`
- [ ] 编辑功能：
  - 内容编辑（textarea）
  - 质量滑块（准确性、可信度）
  - 标签编辑（tags input）
  - 来源追溯显示（只读）
- [ ] 保存/取消按钮
- [ ] 对话框模式（modal）或侧边栏模式

#### Task 1.7：质量反馈集成（0.5 天）
- [ ] 实现 👍 👎 ⏰ 按钮逻辑
  - 👍 → accuracy +0.1, confidence +0.1
  - 👎 → accuracy -0.3, confidence -0.3, needsReview=true
  - ⏰ → accuracy=0.3, obsolete=true
- [ ] 低于阈值自动隐藏（accuracy < 0.3）
- [ ] Toast 提示反馈成功

### Week 3：集成与优化

#### Task 1.8：路由集成（0.5 天）
- [ ] 在主界面添加"记忆管理"入口（侧边栏）
- [ ] 路由配置（如果使用 react-router）
- [ ] 导航菜单更新

#### Task 1.9：导出/导入功能（1 天）
- [ ] 导出：
  - 选择文件保存位置（electron dialog）
  - 导出为 JSON（包含所有字段）
  - 压缩选项（只导出高质量记忆）
- [ ] 导入：
  - 选择 JSON 文件
  - 验证格式
  - 去重逻辑（基于内容相似度）
  - 批量导入进度提示

#### Task 1.10：性能优化（1 天）
- [ ] 虚拟滚动（大量记忆时）
- [ ] 搜索防抖（300ms）
- [ ] 分页加载
- [ ] 缓存搜索结果

#### Task 1.11：测试与 Bug 修复（1 天）
- [ ] 手动测试所有功能
- [ ] 边界情况测试（空记忆、大量记忆、特殊字符）
- [ ] Bug 修复

---

## 主线 2：错误记忆系统 Phase 1（2-3 周）

### 目标
能够检测、记录、存储错误，并在界面上查看

### Week 1：错误检测与存储

#### Task 2.1：ErrorEvent 数据模型（0.5 天）
- [ ] 创建 `src/learning/types.ts`
  ```typescript
  export interface ErrorEvent {
    id: string;
    timestamp: number;
    category: 'code_bug' | 'wrong_command' | 'misunderstanding' | 'tool_misuse' | 'logic_error';
    error: {
      description: string;
      symptom: string;
      impact: 'critical' | 'major' | 'minor';
      detectedBy: 'user_feedback' | 'tool_error' | 'self_check';
    };
    context: {
      task: string;
      userInput: string;
      assistantAction: string;
      files: string[];
      toolsUsed: string[];
      cwd: string;
      projectType?: string;
    };
    verification: {
      fixed: boolean;
      verified: boolean;
      recurrenceCount: number;
    };
    embedding?: number[];
  }
  ```

#### Task 2.2：错误存储（1 天）
- [ ] 创建 `src/learning/ErrorMemoryStore.ts`
- [ ] SQLite 表设计：
  ```sql
  CREATE TABLE error_memories (
    id TEXT PRIMARY KEY,
    timestamp INTEGER,
    category TEXT,
    error JSON,
    context JSON,
    root_cause JSON,
    lesson JSON,
    prevention_rule JSON,
    verification JSON,
    embedding BLOB,
    created_at INTEGER,
    updated_at INTEGER
  );

  CREATE VIRTUAL TABLE error_vec USING vec0(
    id TEXT PRIMARY KEY,
    embedding FLOAT[384]
  );
  ```
- [ ] CRUD 操作
- [ ] 向量检索（查找相似错误）

#### Task 2.3：ErrorDetector（2 天）
- [ ] 创建 `src/learning/ErrorDetector.ts`
- [ ] 检测维度：
  1. **工具执行错误**
     - 监听所有工具调用结果
     - status === 'error' → 记录 ErrorEvent
  2. **用户负面反馈**
     - 用户评分 < 3 → 记录错误
     - 用户明确说"错了" → 记录错误
  3. **自检（静态分析）**
     - 检查生成的代码（常见 bug 模式）
     - ESLint 规则检查（如果可用）
  4. **用户纠正**
     - 用户说"不是...应该是..." → 记录为误解错误
- [ ] 自动创建 ErrorEvent 对象
- [ ] 调用 embedding 服务生成向量

#### Task 2.4：集成到 AgentLoop（1 天）
- [ ] 修改 `src/core/agent/AgentLoop.ts`
- [ ] 在 `executeToolCall()` 中集成 ErrorDetector
  ```typescript
  async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
    const result = await this.tool.execute(toolCall.input);

    // 检测错误
    if (!result.success) {
      const errorEvent = await this.errorDetector.createErrorFromToolFailure(
        toolCall,
        result,
        this.getContext()
      );

      await this.errorMemoryStore.save(errorEvent);
    }

    return result;
  }
  ```
- [ ] 在 `run()` 结束时检测用户反馈

#### Task 2.5：IPC Bridge（0.5 天）
- [ ] 创建 `desktop/main/error-memory-bridge.ts`
- [ ] IPC handlers：
  - `error:search` - 搜索错误
  - `error:get` - 获取错误详情
  - `error:mark-fixed` - 标记为已修复
  - `error:delete` - 删除错误

### Week 2：错误界面

#### Task 2.6：错误记忆浏览器（2 天）
- [ ] 创建 `desktop/renderer/views/ErrorMemoryBrowser.tsx`
- [ ] 功能：
  - 统计面板（总错误数、已修复、未修复、复发错误）
  - 错误列表（按时间排序）
  - 过滤器（类型、影响程度、验证状态）
  - 搜索（语义搜索相似错误）

#### Task 2.7：错误卡片组件（1 天）
- [ ] 创建 `desktop/renderer/components/ErrorCard.tsx`
- [ ] 显示内容：
  - 类型标签 + emoji
  - 错误描述
  - 影响程度标记（🔴 critical / 🟠 major / 🟡 minor）
  - 时间戳
  - 验证状态标记（✅ 已修复 / ❌ 未修复 / ⚠️ 复发）
  - 上下文摘要（任务、工具）
- [ ] 操作按钮：
  - 查看详情
  - 标记为已修复
  - 删除

#### Task 2.8：错误详情视图（1.5 天）
- [ ] 创建 `desktop/renderer/views/ErrorDetail.tsx`
- [ ] 显示完整信息：
  - 基本信息（类型、描述、症状、影响、发现方式、时间）
  - 上下文（任务、用户输入、我的行为、使用的工具、文件、工作目录）
  - 验证状态（已修复、已验证、复发次数）
- [ ] 操作：
  - 标记为已修复
  - 删除
  - 查看原始对话（如果有 sessionId）

### Week 3：测试与集成

#### Task 2.9：端到端测试（1 天）
- [ ] 测试场景 1：工具执行失败
  - 故意调用不存在的文件 → 应记录错误
  - 检查错误库是否保存
  - 检查 UI 是否显示
- [ ] 测试场景 2：用户负面反馈
  - 模拟用户评分低 → 应记录错误
- [ ] 测试场景 3：代码 bug 检测
  - 生成包含 console.log 的代码 → 应检测并记录

#### Task 2.10：文档与示例（1 天）
- [ ] 编写使用文档
- [ ] 截图示例
- [ ] 演示视频（可选）

#### Task 2.11：Bug 修复与优化（1 天）
- [ ] 修复测试中发现的问题
- [ ] 性能优化
- [ ] 错误处理完善

---

## 里程碑（Milestones）

### Milestone 1：记忆管理界面可用（Week 3）
- ✅ 用户能查看所有记忆
- ✅ 用户能搜索记忆（语义搜索）
- ✅ 用户能编辑/删除记忆
- ✅ 用户能反馈记忆质量（👍👎）
- ✅ 用户能导出/导入记忆

**验收标准**：
- 创建 10 条测试记忆 → 能在界面中看到
- 搜索关键词 → 能找到相关记忆
- 编辑记忆内容 → 保存成功
- 点 👎 → 质量分数下降，记忆变灰

### Milestone 2：错误记忆系统基础可用（Week 6）
- ✅ 工具执行失败自动记录
- ✅ 用户负面反馈自动记录
- ✅ 错误存储到数据库
- ✅ 错误列表界面可查看
- ✅ 错误详情界面可查看

**验收标准**：
- 故意制造一个工具错误 → 错误库中出现记录
- 查看错误列表 → 能看到刚才的错误
- 点击错误 → 能看到完整上下文
- 标记为已修复 → 状态更新

---

## 技术栈总结

### 后端
- **SQLite** - 主数据库
- **sqlite-vec** - 向量索引
- **@xenova/transformers** - Embedding 服务（已有）
- **TypeScript** - 类型安全

### 前端
- **React 18** - UI 框架
- **TailwindCSS** - 样式
- **Lucide React** - 图标
- **Zustand** - 状态管理（已有）

### 通信
- **Electron IPC** - 主进程 ↔ 渲染进程

---

## 依赖关系

```
记忆管理界面
  ↓ 依赖
MemoryStore（统一存储）
  ↓ 依赖
VectorStore + sqlite-vec（已有）

错误记忆系统
  ↓ 依赖
ErrorMemoryStore（错误存储）
  ↓ 依赖
MemoryStore（统一接口）
  ↓ 依赖
VectorStore + sqlite-vec（已有）

所以可以并行开发，共享 VectorStore 基础设施
```

---

## 风险与缓解

### 风险 1：向量检索性能
- **风险**：大量记忆时，向量检索可能变慢
- **缓解**：
  - 使用 sqlite-vec 的 IVF 索引
  - 分页加载
  - 缓存常用查询

### 风险 2：数据库迁移
- **风险**：数据模型变更时，已有数据需要迁移
- **缓解**：
  - 版本控制（数据库 schema version）
  - 编写迁移脚本
  - 备份机制

### 风险 3：UI 性能
- **风险**：大量记忆渲染卡顿
- **缓解**：
  - 虚拟滚动（react-window）
  - 懒加载详情
  - 分页

---

## 开发顺序建议

### Week 1
- Day 1-2: Task 1.1（记忆存储）
- Day 3: Task 1.2（IPC Bridge）
- Day 4: Task 2.1 + 2.2（错误数据模型 + 存储）
- Day 5: Task 2.3（ErrorDetector 第一版）

### Week 2
- Day 1-2: Task 1.4（记忆浏览器）
- Day 3: Task 1.5（记忆卡片）
- Day 4: Task 2.6（错误浏览器）
- Day 5: Task 2.7（错误卡片）

### Week 3
- Day 1-2: Task 1.6（记忆编辑器）
- Day 3: Task 2.8（错误详情）
- Day 4: Task 2.4（集成到 AgentLoop）
- Day 5: Task 1.11 + 2.9（测试）

### Week 4（缓冲周）
- 完成遗留任务
- Bug 修复
- 优化性能
- 文档编写

---

## 成功指标

### 定量指标
- [ ] 记忆存储：能存储 1000+ 条记忆
- [ ] 搜索性能：<100ms 返回结果
- [ ] 向量检索准确率：Top 10 中至少 8 条相关
- [ ] 错误检测率：>90% 的工具失败被记录
- [ ] UI 响应时间：<200ms 交互反馈

### 定性指标
- [ ] 用户能轻松找到历史记忆
- [ ] 用户能理解记忆的来源和质量
- [ ] 错误列表帮助用户了解 AI 的"成长历程"
- [ ] 界面直观，无需文档即可使用

---

**准备好了吗？我现在开始 Task 1.1（记忆存储）和 Task 2.1（错误数据模型），可以吗？**
