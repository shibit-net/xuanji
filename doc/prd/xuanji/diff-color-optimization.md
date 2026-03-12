# Edit 工具 Diff 颜色优化实现总结

## 问题

用户反馈：Edit 工具的 diff 输出需要用颜色区分旧行和新行。

- 旧行（删除的）→ 红色
- 新行（新增的）→ 绿色

## 根本原因

在 `CollapsibleToolResult` 的展开模式中，使用了固定的 `color='white'` 属性：

```typescript
{expandedResultLines.map((line, i) => (
  <Text key={i} color={isError ? 'red' : 'white'}>{line}</Text>
))}
```

这会**覆盖掉** `DiffRenderer` 生成的 ANSI 颜色码：
- `\x1b[31m` = 红色（删除的行）
- `\x1b[32m` = 绿色（新增的行）

## 解决方案

### 修改文件

`src/adapters/cli/CollapsibleToolResult.tsx` L332

### 改动前

```typescript
{expandedResultLines.map((line, i) => (
  <Text key={i} color={isError ? 'red' : 'white'}>{line}</Text>
))}
```

### 改动后

```typescript
{expandedResultLines.map((line, i) => (
  // 不指定 color，保留 ANSI 颜色码（DiffRenderer 输出的绿色/红色）
  // 仅在错误时使用 red 覆盖
  <Text key={i} color={isError ? 'red' : undefined}>{line}</Text>
))}
```

### 关键点

- **不指定 color**：`color={undefined}` 让 Ink Text 组件使用默认渲染（会自动解析 ANSI 颜色码）
- **错误时覆盖**：`isError` 时仍使用 `red`，确保错误消息清晰
- **保留 ANSI**：DiffRenderer 输出的 ANSI 颜色码（`\x1b[31m` / `\x1b[32m`）得以保留

## ANSI 颜色码

DiffRenderer 已经正确生成了 ANSI 颜色码（`src/core/utils/DiffRenderer.ts` L42）：

```typescript
const color = change.added ? '\x1b[32m' : change.removed ? '\x1b[31m' : '';
const reset = change.added || change.removed ? '\x1b[0m' : '';
```

- `\x1b[31m` = 红色（删除的行，`-` 前缀）
- `\x1b[32m` = 绿色（新增的行，`+` 前缀）
- `\x1b[0m` = 重置颜色

## 效果对比

### 改动前 ❌

```
变更预览: test.js
统计: +2 -1
────────────────────────────────────────────────────────────────────────────────
  旧行   新行 │ 差异
     1      1 │   function hello() {
     2        │ -   console.log('Hello World');     (白色)
            2 │ +   console.log('Hello Xuanji');    (白色)
            3 │ +   console.log('Welcome!');        (白色)
     3      4 │     return true;
```

### 改动后 ✅

```
变更预览: test.js
统计: +2 -1
────────────────────────────────────────────────────────────────────────────────
  旧行   新行 │ 差异
     1      1 │   function hello() {
     2        │ -   console.log('Hello World');     (红色)
            2 │ +   console.log('Hello Xuanji');    (绿色)
            3 │ +   console.log('Welcome!');        (绿色)
     3      4 │     return true;
```

## 折叠模式

折叠模式已经正确处理了颜色（无需修改）：

```typescript
const lineType = getDiffLineType(line);
const plain = stripAnsi(line);
const color = lineType === 'added' ? 'green' : lineType === 'removed' ? 'red' : 'gray';
return (
  <Text key={i} color={color}>{plain}</Text>
);
```

- 去除 ANSI 颜色（`stripAnsi`）
- 手动应用 Ink color 属性（`green` / `red` / `gray`）
- ✅ 正确显示颜色

## 为什么展开模式使用 ANSI，折叠模式使用 Ink color？

### 展开模式

- 直接显示 DiffRenderer 的原始输出
- 包含行号、diff 前缀、完整内容
- 保留 ANSI 颜色码最简单高效
- Ink 原生支持 ANSI 颜色码渲染

### 折叠模式

- 只显示 diff 行（去掉行号、头部）
- 需要自定义截断逻辑（`MAX_COLLAPSED_DIFF_LINES`）
- `stripAnsi` 去除颜色后更容易处理
- 手动应用 Ink color 更可控

## 向后兼容

- ✅ 不影响正常工具结果显示
- ✅ 不影响错误消息（仍显示红色）
- ✅ 不影响折叠模式（已正确显示颜色）
- ✅ 仅优化展开模式的 diff 颜色

## 测试验证

### 类型检查

```bash
npm run typecheck  # ✅ 通过
```

### 手动测试

```bash
npm run dev

# 测试 Edit 工具
> 创建一个测试文件
> 使用 Edit 工具修改
> 展开工具结果
> 验证颜色：删除行红色，新增行绿色
```

### 预期结果

- ✅ 删除的行显示为红色（`-` 前缀）
- ✅ 新增的行显示为绿色（`+` 前缀）
- ✅ 不变的行显示为默认颜色
- ✅ 行号显示正确
- ✅ 折叠模式颜色不变（已正确）

## 受益的工具

所有使用 `DiffRenderer` 的工具都会显示正确的颜色：

- ✅ **EditTool** — 文件编辑
- ✅ **MultiEditTool** — 批量编辑
- ✅ **WriteTool** — 文件写入（覆盖时显示 diff）
- ✅ **NotebookEditTool** — Jupyter Notebook 编辑

## Ink Text 组件的颜色优先级

Ink 的 `<Text>` 组件颜色优先级：

1. **手动指定的 color 属性**（最高优先级）
   ```typescript
   <Text color="red">{text}</Text>  // 强制红色
   ```

2. **ANSI 颜色码**（次优先级）
   ```typescript
   <Text>{"\x1b[32mGreen\x1b[0m"}</Text>  // 绿色
   ```

3. **默认颜色**（最低优先级）
   ```typescript
   <Text>{text}</Text>  // 终端默认颜色（通常是白色或黑色）
   ```

我们的修改利用了这个优先级：
- 不指定 `color` 属性 → ANSI 颜色码生效
- `isError` 时指定 `color='red'` → 覆盖 ANSI，强制红色

## 统计

- **修改文件**：1 个（`CollapsibleToolResult.tsx`）
- **修改行数**：4 行
- **新增注释**：2 行
- **删除代码**：0 行

## 后续优化（可选）

### P1（建议）

1. **配置化颜色**：允许用户自定义 diff 颜色
   ```json
   {
     "diff": {
       "addedColor": "green",
       "removedColor": "red",
       "unchangedColor": "default"
     }
   }
   ```

2. **高亮语法**：在 diff 中支持代码语法高亮
   - 结合 diff 颜色和语法高亮
   - 使用 `highlight.js` 或类似库

### P2（未来）

1. **主题支持**：根据终端主题自动调整颜色
   - 检测终端背景色（深色/浅色）
   - 自动调整颜色对比度

2. **无障碍模式**：为色盲用户提供替代方案
   - 使用符号代替颜色（`[+]` / `[-]`）
   - 使用图案代替颜色（斜线/点）

## 总结

通过一行简单的修改（`color={undefined}`），修复了 Edit 工具展开模式下 diff 颜色不显示的问题。

现在：
- ✅ 删除的行（旧行）显示为**红色**
- ✅ 新增的行（新行）显示为**绿色**
- ✅ 不变的行显示为默认颜色
- ✅ 折叠模式和展开模式都正确显示颜色

用户现在可以清楚地看到 diff 变更的颜色区分了！🎉
