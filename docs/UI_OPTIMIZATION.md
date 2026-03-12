# Xuanji UI 优化说明

## 1. Help 指令优化

### 改进点
- **动态生成**: 从 `SlashCommandRegistry` 动态获取命令列表
- **分组显示**: 支持按功能分组（基础、会话、工具、设置等）
- **交互式面板**: 新增 `HelpPanel` 组件，支持导航和详情查看
- **搜索功能**: 按 `/` 进入搜索模式，快速过滤命令

### 使用方式

#### 注册命令时添加元数据
```typescript
slashCommandRegistry.register({
  name: '/help',
  description: '显示帮助信息',
  group: '基础',  // 新增：分组
  icon: '📖',     // 新增：图标
  usage: '/help [command]',  // 新增：使用示例
  handler: async () => {
    // 显示 HelpPanel
    setShowHelpPanel(true);
  },
});
```

#### 在 App.tsx 中集成 HelpPanel
```typescript
import { HelpPanel } from './HelpPanel';

// 在组件中
{showHelpPanel && (
  <HelpPanel
    commands={slashCommandRegistry.getAll()}
    onClose={() => setShowHelpPanel(false)}
  />
)}
```

### 特性
- ✅ 按分组显示命令
- ✅ ↑↓ 导航选择
- ✅ Enter 查看命令详情（用法、别名）
- ✅ / 搜索过滤
- ✅ Q/Esc 关闭

---

## 2. 国际化优化

### 改进点
- **模块化拆分**: 将单一的 `messages.ts` 拆分为多个文件
- **按功能组织**: `zh_common`, `zh_settings`, `zh_session` 等
- **更好维护性**: 每个模块独立维护，减少合并冲突
- **支持懒加载**: 未来可以按需加载语言包

### 文件结构
```
src/core/i18n/
├── index.new.ts           # 新的主入口（向后兼容）
├── locales/
│   ├── zh_common.ts       # 中文通用词汇
│   ├── en_common.ts       # 英文通用词汇
│   ├── zh_settings.ts     # 中文设置相关
│   ├── en_settings.ts     # 英文设置相关
│   ├── zh_session.ts      # 中文会话相关（待添加）
│   └── en_session.ts      # 英文会话相关（待添加）
```

### 迁移步骤
1. **渐进式迁移**: 先保留旧的 `messages.ts`，逐步迁移到新系统
2. **分类整理**: 将现有翻译按功能分类到对应模块
3. **统一导入**: 最后将 `index.new.ts` 重命名为 `index.ts`

### 使用方式
```typescript
import { t, setLanguage, getLanguage } from '@/core/i18n';

// 使用翻译
t('settings.title');  // "⚙️  设置" (zh) or "⚙️  Settings" (en)
t('cli.tool_executing', { name: 'read_file' });  // 支持占位符

// 切换语言
setLanguage('zh');
setLanguage('en');

// 获取当前语言
const lang = getLanguage();  // 'zh' | 'en'
```

---

## 3. 快捷操作优化

### 改进点
- **增加元数据**: `icon`, `priority` 字段
- **自动排序**: 按优先级排序，相同优先级按 key 排序
- **视觉优化**: 显示图标，增强可读性

### QuickAction 新字段
```typescript
interface QuickAction {
  key: string;
  label: string;
  description: string;
  action: () => void;
  group?: string;
  disabled?: boolean;
  icon?: string;       // 新增：图标 emoji
  priority?: number;   // 新增：优先级（越小越靠前）
}
```

### 使用示例
```typescript
const actions: QuickAction[] = [
  {
    key: 'S',
    label: '设置',
    description: '进入设置面板',
    icon: '⚙️',
    priority: 1,
    group: '系统',
    action: () => setMode('settings'),
  },
  {
    key: 'H',
    label: '帮助',
    description: '查看命令帮助',
    icon: '📖',
    priority: 2,
    group: '系统',
    action: () => setShowHelpPanel(true),
  },
  // ...
];
```

---

## 4. Settings 菜单优化

### 改进点
- **增加描述**: 每个标签页增加 `description` 字段
- **边框装饰**: 使用 `borderStyle="round"` 增强视觉效果
- **版本显示**: 右上角显示版本号
- **选中提示**: 选中项下方显示详细描述

### 视觉对比

**优化前**:
```
⚙️  设置

▶ 🤖 LLM 配置
  🎨 界面设置
  💬 IM 机器人

↑↓选择  Enter进入  Q=返回对话
```

**优化后**:
```
╭─────────────────────────────────────────╮
│ ⚙️  设置                       v1.5.0  │
│                                         │
│ ▶ 🤖 LLM 配置                          │
│      模型、API Key、Adapter 设置        │
│   🎨 界面设置                           │
│   💬 IM 机器人                          │
│                                         │
│ ┌───────────────────────────────────┐  │
│ │ ↑↓选择  Enter进入  Q=返回对话      │  │
│ └───────────────────────────────────┘  │
╰─────────────────────────────────────────╯
```

---

## 5. 实施清单

### 立即可用的改进
- [x] `SlashCommand` 类型增强（group, icon, usage, aliases, hidden）
- [x] `SlashCommandRegistry.formatHelp()` 按分组显示
- [x] `HelpPanel` 组件（交互式帮助面板）
- [x] `QuickAction` 类型增强（icon, priority）
- [x] `SettingsMode` 视觉优化

### 需要进一步迁移
- [ ] 将 `messages.ts` 内容拆分到各个 locale 文件
- [ ] 在 App.tsx 中集成 HelpPanel
- [ ] 更新所有 SlashCommand 注册，添加 group/icon/usage
- [ ] 更新所有 QuickAction 定义，添加 icon/priority

### 兼容性说明
所有改进都是**向后兼容**的：
- 新增字段都是可选的（`?`）
- 保留了所有旧的 API
- 新功能是增强，不破坏现有代码

---

## 6. 未来改进方向

### 短期
1. **主题增强**: 支持自定义主题配色
2. **快捷键配置**: 允许用户自定义快捷键
3. **命令历史**: `/history` 查看命令执行历史

### 中期
1. **插件系统**: 允许第三方扩展注册命令和快捷操作
2. **多语言扩展**: 支持更多语言（日语、韩语等）
3. **在线帮助**: /help 可以打开在线文档

### 长期
1. **图形化设置**: 提供 Web UI 配置界面
2. **命令推荐**: 基于使用频率智能推荐命令
3. **键盘录制**: 录制键盘操作序列，生成脚本

---

## 7. 贡献指南

### 添加新命令
```typescript
slashCommandRegistry.register({
  name: '/mycommand',
  description: '我的命令描述',
  group: '工具',  // 基础|会话|工具|设置|其他
  icon: '🔧',
  usage: '/mycommand [args]',
  aliases: ['/mc', '/my'],
  handler: async (args) => {
    // 实现逻辑
  },
});
```

### 添加新翻译
1. 编辑对应的 locale 文件（如 `zh_settings.ts`）
2. 添加新的 key-value 对
3. 同步更新其他语言版本

### 添加快捷操作
```typescript
const newAction: QuickAction = {
  key: 'X',
  label: '新操作',
  description: '描述',
  icon: '✨',
  priority: 10,
  group: '自定义',
  action: () => { /* ... */ },
};
```

---

**版本**: v1.5.0  
**最后更新**: 2026-03-06  
**维护者**: Xuanji Team
