# Edit 工具行号功能实现总结

## 问题

Edit 工具在展示 diff 时没有显示行号，用户难以快速定位代码在文件中的具体位置。

## 解决方案

在 `DiffRenderer` 中添加行号支持，格式参考 unified diff，显示两列行号（旧文件行号 + 新文件行号）。

## 实现细节

### 1. 行号跟踪逻辑

在渲染 diff 时维护两个行号计数器：
- `oldLineNum`：旧文件的行号
- `newLineNum`：新文件的行号

对于不同类型的变更：
- **删除的行** (`removed = true`)：显示旧行号，新行号空白；只增加旧行号计数
- **新增的行** (`added = true`)：旧行号空白，显示新行号；只增加新行号计数
- **不变的行** (`added = false, removed = false`)：同时显示旧行号和新行号；两个计数器都增加

### 2. 格式设计

```
  旧行   新行 │ 差异
     1      1 │   import React from 'react';
     2        │ - import { Box } from 'ink';
            2 │ + import { Box, Text } from 'ink';
     3      3 │
```

- 每列行号宽度：6 个字符（右对齐）
- 分隔符：`│`
- 差异前缀：`+`（新增，绿色）、`-`（删除，红色）、` `（不变）

### 3. API 变更

```typescript
// DiffRenderer.renderLines
static renderLines(
  oldStr: string,
  newStr: string,
  showLineNumbers: boolean = true  // 新增参数，默认显示行号
): string

// DiffRenderer.renderPreview
static renderPreview(
  oldStr: string,
  newStr: string,
  filePath: string,
  showLineNumbers: boolean = true  // 新增参数，默认显示行号
): string
```

### 4. 输出示例

#### 有行号版本（默认）

```
变更预览: src/App.tsx
统计: +6 -4
────────────────────────────────────────────────────────────────────────────────
  旧行   新行 │ 差异
     1      1 │   import React from 'react';
     2        │ - import { Box } from 'ink';
            2 │ + import { Box, Text } from 'ink';
     3      3 │
     4      4 │   export function App() {
     5        │ -   const name = 'World';
            5 │ +   const greeting = 'Hello';
            6 │ +   const name = 'Xuanji';
     6      7 │     return (
```

#### 无行号版本

```
变更预览: src/App.tsx
统计: +6 -4
────────────────────────────────────────────────────────────
  import React from 'react';
- import { Box } from 'ink';
+ import { Box, Text } from 'ink';

  export function App() {
-   const name = 'World';
+   const greeting = 'Hello';
+   const name = 'Xuanji';
    return (
```

## 代码改动

### `src/core/utils/DiffRenderer.ts`

1. **renderLines 方法**：
   - 新增 `showLineNumbers` 参数（默认 `true`）
   - 添加行号跟踪逻辑（`oldLineNum` 和 `newLineNum`）
   - 为每行添加行号前缀（格式：`旧行号 新行号 │`）

2. **renderPreview 方法**：
   - 新增 `showLineNumbers` 参数（默认 `true`）
   - 添加行号跟踪逻辑
   - 在头部添加列标题（`旧行   新行 │ 差异`）
   - 调整分隔线宽度（有行号时 80 字符，无行号时 60 字符）

### 向后兼容

所有现有调用 `DiffRenderer.renderLines()` 和 `DiffRenderer.renderPreview()` 的地方无需修改，因为新参数有默认值 `true`。如果需要禁用行号，可传入 `false`。

## 验证

### 测试

```bash
npm test test/unit/tools/EditTool.test.ts
# ✓ 所有测试通过（12 个测试）
```

### 类型检查

```bash
npm run typecheck
# ✓ 类型检查通过
```

### 手动测试

创建测试脚本验证输出格式：
```bash
npx tsx test-diff-line-numbers.ts
# ✓ 行号正确显示，格式美观
```

## 用户体验改进

1. **快速定位**：用户可以直接看到变更发生在文件的第几行
2. **上下文清晰**：同时显示旧行号和新行号，方便理解变更前后的对应关系
3. **对齐美观**：行号右对齐，宽度固定，视觉整洁
4. **兼容性好**：保留无行号模式，用户可以选择

## 后续优化（可选）

1. **配置化**：在 `~/.xuanji/config.json` 中添加 `diff.showLineNumbers` 配置项
2. **智能截断**：大 diff 截断时保持行号连续性（显示跳过的行号范围）
3. **行号颜色**：为行号添加淡灰色，进一步区分内容
4. **交互模式**：在 CollapsibleToolResult 中支持按行展开/折叠

## 相关工具

所有使用 `DiffRenderer` 的工具都会自动获得行号支持：
- ✅ `EditTool` — 文件编辑
- ✅ `MultiEditTool` — 批量编辑
- ✅ `WriteTool` — 文件写入（当文件已存在时显示 diff）
- ✅ `NotebookEditTool` — Jupyter Notebook 编辑

## 测试覆盖

- ✅ 单行变更
- ✅ 多行变更
- ✅ 仅删除
- ✅ 仅新增
- ✅ 混合变更（删除 + 新增 + 不变）
- ✅ 大 diff 截断（超过 100 行）
- ✅ 空文件 diff
- ✅ 无变更 diff

## 文档

- 用户文档：更新 Edit 工具的输出格式说明
- API 文档：更新 `DiffRenderer` 的 JSDoc 注释
- 项目记忆：添加到 `MEMORY.md`
