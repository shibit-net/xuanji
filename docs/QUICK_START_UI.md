# 快速开始 - UI 优化使用指南

## 🚀 立即可用的功能

所有优化都已实现并**向后兼容**，可以立即使用部分功能，也可以渐进式迁移。

---

## 1. ✅ 使用增强的命令系统

### 步骤 1: 更新命令注册

找到注册 slash 命令的地方（通常在 `App.tsx` 或初始化代码中），更新命令定义：

```typescript
// 旧方式（仍然有效）
slashCommandRegistry.register({
  name: '/help',
  description: '显示帮助信息',
  handler: async () => {
    console.log(slashCommandRegistry.formatHelp());
  },
});

// 新方式（推荐）
slashCommandRegistry.register({
  name: '/help',
  description: '显示帮助信息',
  group: '基础',              // 新增：分组
  icon: '📖',                 // 新增：图标
  usage: '/help [command]',   // 新增：用法说明
  handler: async () => {
    console.log(slashCommandRegistry.formatHelp()); // 自动按分组显示
  },
});
```

### 步骤 2: 使用新的帮助格式

```typescript
// 自动按分组显示，包含图标和用法
const helpText = slashCommandRegistry.formatHelp();
console.log(helpText);

// 或者使用简洁版（旧格式，兼容性）
const simpleHelp = slashCommandRegistry.formatHelpSimple();
```

**立即生效**！无需其他修改。

---

## 2. ✅ 集成 HelpPanel（交互式帮助）

### 步骤 1: 导入 HelpPanel

在 `App.tsx` 中添加：

```typescript
import { HelpPanel } from './HelpPanel';
```

### 步骤 2: 添加状态管理

```typescript
const [showHelpPanel, setShowHelpPanel] = useState(false);
```

### 步骤 3: 更新 /help 命令

```typescript
slashCommandRegistry.register({
  name: '/help',
  description: '显示交互式命令帮助',
  group: '基础',
  icon: '📖',
  handler: async () => {
    setShowHelpPanel(true); // 显示交互式面板
  },
});
```

### 步骤 4: 在 UI 中渲染

```typescript
return (
  <Box flexDirection="column">
    {/* 现有 UI */}
    
    {/* 新增：HelpPanel */}
    {showHelpPanel && (
      <HelpPanel
        commands={slashCommandRegistry.getAll()}
        onClose={() => setShowHelpPanel(false)}
      />
    )}
  </Box>
);
```

**功能**:
- ↑↓ 导航命令列表
- Enter 查看命令详情
- / 搜索过滤
- Q/Esc 关闭

---

## 3. ✅ 使用模块化国际化（可选）

### 选项 A: 立即切换（推荐）

```bash
# 备份旧文件
mv src/core/i18n/index.ts src/core/i18n/index.old.ts

# 启用新文件
mv src/core/i18n/index.new.ts src/core/i18n/index.ts
```

### 选项 B: 渐进式迁移

保留旧的 `index.ts`，逐步将 `messages.ts` 内容迁移到各个 locale 文件：

1. **会话相关** → `zh_session.ts` + `en_session.ts`
2. **工具相关** → `zh_tools.ts` + `en_tools.ts`
3. **其他模块** → 按需创建

完成后再切换到新的 `index.ts`。

**API 完全兼容**：
```typescript
// 现有代码无需修改
import { t, setLanguage, getLanguage } from '@/core/i18n';

t('settings.title');  // 正常工作
setLanguage('zh');    // 正常工作
```

---

## 4. ✅ 优化快捷操作

### 步骤 1: 更新 QuickAction 定义

找到快捷操作定义的地方，添加图标和优先级：

```typescript
const actions: QuickAction[] = [
  {
    key: 'H',
    label: '帮助',
    description: '查看命令帮助',
    icon: '📖',       // 新增
    priority: 1,      // 新增（越小越靠前）
    group: '系统',
    action: () => setShowHelpPanel(true),
  },
  {
    key: 'S',
    label: '设置',
    description: '进入设置面板',
    icon: '⚙️',
    priority: 2,
    group: '系统',
    action: () => setMode('settings'),
  },
  // ...更多操作
];
```

**立即生效**！QuickActions 组件会自动按优先级排序并显示图标。

---

## 5. ✅ Settings 菜单优化

### 已自动生效

`SettingsMode` 组件已经优化，无需修改代码。新增了：
- ✅ 圆角边框
- ✅ 版本号显示
- ✅ 选中项描述
- ✅ 操作提示框

如果需要添加标签页描述，更新 `messages.ts` 或对应的 locale 文件：

```typescript
// src/core/i18n/locales/zh_settings.ts
'settings.tab.llm_desc': '模型、API Key、Adapter 设置',
'settings.tab.ui_desc': '主题、语言、显示选项',
'settings.tab.bots_desc': '钉钉、飞书、企微机器人管理',
```

---

## 6. 📋 完整迁移清单

### 立即可用（零成本）
- [x] `SlashCommand` 增强字段
- [x] `QuickAction` 增强字段
- [x] `SettingsMode` 视觉优化
- [x] `formatHelp()` 按分组显示

### 需要集成（低成本）
- [ ] 集成 `HelpPanel` 到 App.tsx
- [ ] 更新所有 SlashCommand 注册（添加 group/icon/usage）
- [ ] 更新所有 QuickAction 定义（添加 icon/priority）

### 可选优化（中成本）
- [ ] 切换到模块化国际化系统
- [ ] 将 `messages.ts` 内容拆分到各个 locale 文件
- [ ] 添加命令别名支持

---

## 7. 🧪 测试验证

### 测试 1: 命令帮助分组显示

```bash
npm run dev
# 输入 /help
# 应该看到按分组显示的命令列表
```

### 测试 2: HelpPanel 交互

```bash
# 集成 HelpPanel 后
npm run dev
# 输入 /help
# 应该看到交互式面板
# 按 ↑↓ 导航，Enter 查看详情，/ 搜索
```

### 测试 3: Settings 视觉优化

```bash
npm run dev
# 输入 /settings
# 应该看到带边框和版本号的设置界面
```

### 测试 4: 快捷操作

```bash
npm run dev
# 按 ? 打开快捷操作
# 应该看到带图标的操作列表
```

---

## 8. 🐛 故障排查

### 问题 1: TypeScript 类型错误

**症状**: 编译时报错 `Property 'group' does not exist`

**解决**:
```bash
# 确保使用了最新的类型定义
npm run build
```

### 问题 2: HelpPanel 导入错误

**症状**: `Cannot find module './HelpPanel'`

**解决**:
```typescript
// 检查导入路径
import { HelpPanel } from './HelpPanel';  // 相对路径
import { HelpPanel } from '@/adapters/cli/HelpPanel';  // 绝对路径
```

### 问题 3: 国际化 key 未找到

**症状**: 显示原始 key 而不是翻译

**解决**:
```typescript
// 检查 key 是否在对应的 locale 文件中
// 检查是否正确合并了所有模块
```

---

## 9. 📚 更多资源

- **详细文档**: `docs/UI_OPTIMIZATION.md`
- **对比展示**: `docs/UI_OPTIMIZATION_COMPARISON.md`
- **总结报告**: `docs/UI_OPTIMIZATION_SUMMARY.md`
- **变更日志**: `CHANGELOG.md`

---

## 10. 💡 最佳实践

### ✅ DO
- 使用分组组织命令（基础、会话、工具、设置）
- 为命令添加图标（提升视觉识别）
- 提供使用示例（usage 字段）
- 设置快捷操作优先级（常用的在前）

### ❌ DON'T
- 不要为内部命令添加 group（使用 hidden: true）
- 不要过度使用图标（保持简洁）
- 不要忘记同步更新英文翻译

---

**版本**: v1.5.0  
**日期**: 2026-03-06  
**支持**: GitHub Issues / Xuanji Team
