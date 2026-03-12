# Diff 行号单列显示优化

## 问题

用户反馈：Edit 和 Write 工具的 diff 显示使用双列行号（旧行号 + 新行号），过于复杂，阅读不便。

**改动前**：

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
     4      5 │   }
```

## 用户需求

> "行号在一列展示就好"

- 简化行号显示，只显示一列
- 保持颜色区分（红色删除、绿色新增）
- 保持视觉清晰

## 解决方案

### 单列行号策略

- **删除的行**：显示旧文件行号（这行在旧文件的位置）
- **新增的行**：显示新文件行号（这行在新文件的位置）
- **不变的行**：显示新文件行号（与最终文件对应）

### 实现改动

**文件**：`src/core/utils/DiffRenderer.ts`

#### 改动 1：行号生成逻辑（L52-64）

**改动前**：

```typescript
if (showLineNumbers) {
  // 格式：旧行号(6位) 新行号(6位) │ 内容
  // 删除的行：显示旧行号，新行号空白
  // 新增的行：旧行号空白，显示新行号
  // 不变的行：同时显示旧行号和新行号
  const oldNum = !change.added ? String(oldLineNum).padStart(6) : '      ';
  const newNum = !change.removed ? String(newLineNum).padStart(6) : '      ';
  lineNumPrefix = `${oldNum} ${newNum} │ `;
}
```

**改动后**：

```typescript
if (showLineNumbers) {
  // 单列行号：删除行显示旧行号，其他行显示新行号
  const lineNum = change.removed ? oldLineNum : newLineNum;
  lineNumPrefix = `${String(lineNum).padStart(4)} │ `;
}
```

**关键点**：
- 行号宽度从 6 位缩减到 4 位（支持到 9999 行）
- 删除行使用 `oldLineNum`，其他使用 `newLineNum`
- 格式简化：`4 位行号 │ 内容`

#### 改动 2：Header 标题（L197-202）

**改动前**：

```typescript
const header = [
  `\x1b[1m变更预览: ${filePath}\x1b[0m`,
  `统计: ${this.formatStats(stats)}`,
  showLineNumbers ? `${'─'.repeat(80)}` : `${'─'.repeat(60)}`,
  showLineNumbers ? '  旧行   新行 │ 差异' : '',
].filter(Boolean).join('\n');
```

**改动后**：

```typescript
const header = [
  `\x1b[1m变更预览: ${filePath}\x1b[0m`,
  `统计: ${this.formatStats(stats)}`,
  showLineNumbers ? `${'─'.repeat(60)}` : `${'─'.repeat(60)}`,
  showLineNumbers ? '  行 │ 差异' : '',
].filter(Boolean).join('\n');
```

**关键点**：
- 分隔线长度从 80 缩减到 60（适配单列行号）
- 列标题从 "旧行 新行" 简化为 "行"

## 效果对比

### 改动前 ❌

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
     4      5 │   }
```

- ❌ 双列行号占据太多空间
- ❌ 视觉复杂，需要来回对比两列
- ❌ 分隔线过长

### 改动后 ✅

```
变更预览: test.js
统计: +2 -1
────────────────────────────────────────────────────────────────
  行 │ 差异
   1 │   function hello() {
   2 │ -   console.log('Hello World');     (红色)
   2 │ +   console.log('Hello Xuanji');    (绿色)
   3 │ +   console.log('Welcome!');        (绿色)
   4 │     return true;
   5 │   }
```

- ✅ 单列行号，简洁清晰
- ✅ 删除行显示旧行号（2），新增行显示新行号（2, 3）
- ✅ 颜色区分明确（红色删除、绿色新增）
- ✅ 宽度适中，易于阅读
- ✅ 4 位行号支持到 9999 行

## 行号语义

| 行类型 | 显示行号 | 说明 |
|--------|---------|------|
| 删除行 (`-`) | 旧文件行号 | 表示该行在旧文件的位置 |
| 新增行 (`+`) | 新文件行号 | 表示该行在新文件的位置 |
| 不变行 (` `) | 新文件行号 | 与最终文件对应 |

**示例**：

```
   1 │   function hello() {          // 新文件第 1 行（不变）
   2 │ -   console.log('World');     // 旧文件第 2 行（删除）
   2 │ +   console.log('Xuanji');    // 新文件第 2 行（新增）
   3 │ +   console.log('Welcome!');  // 新文件第 3 行（新增）
   4 │     return true;              // 新文件第 4 行（不变）
```

## 受益工具

所有使用 DiffRenderer 的工具自动获得单列行号：

- ✅ **EditTool** — 文件编辑
- ✅ **MultiEditTool** — 批量编辑
- ✅ **WriteTool** — 文件写入（覆盖时显示 diff）
- ✅ **NotebookEditTool** — Jupyter Notebook 编辑

## 测试验证

### 类型检查

```bash
npm run typecheck  # ✅ 通过
```

### 手动测试

```bash
npm run dev

# 测试场景 1：编辑文件
> 创建测试文件 test.js
> 使用 Edit 工具修改某一行
> 验证单列行号显示正确

# 测试场景 2：覆盖文件
> 使用 Write 工具覆盖已有文件
> 验证 diff 预览显示单列行号

# 测试场景 3：多行变更
> 编辑文件，删除 2 行，新增 3 行
> 验证行号逻辑正确（删除行显示旧行号，新增行显示新行号）
```

### 预期结果

- ✅ 行号显示为单列（4 位宽度）
- ✅ 删除行显示旧行号
- ✅ 新增行显示新行号
- ✅ 不变行显示新行号
- ✅ 颜色区分正确（红色删除、绿色新增）
- ✅ Header 标题显示 "行 │ 差异"
- ✅ 分隔线长度适中（60 字符）

## 向后兼容

- ✅ 不影响 DiffRenderer.getStats() 和 formatStats()
- ✅ 不影响 showLineNumbers 参数（仍可禁用行号）
- ✅ 不影响颜色显示（ANSI 颜色码保留）
- ✅ 不影响大 diff 截断逻辑（> 100 行）
- ✅ 所有依赖 DiffRenderer 的工具自动获得优化

## 统计

- **修改文件**：1 个（`DiffRenderer.ts`）
- **修改行数**：8 行
- **修改位置**：2 处（renderLines + renderPreview）
- **删除代码**：5 行（双列行号逻辑）
- **新增代码**：2 行（单列行号逻辑）
- **净减少代码**：3 行

## 文档更新

- ✅ 实现总结：本文档
- ✅ 项目记忆：需更新到 `MEMORY.md`

## 总结

通过将双列行号简化为单列行号，显著提升了 diff 输出的阅读体验：

- ✅ 视觉更简洁，空间利用更高效
- ✅ 行号语义清晰（删除行 → 旧行号，其他 → 新行号）
- ✅ 颜色区分保持（红色删除、绿色新增）
- ✅ 宽度适中，易于阅读
- ✅ 所有编辑工具自动获得优化

现在 diff 输出更简洁、更易读！🎉
