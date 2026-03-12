# Light Model 配置 - 视觉对比

## Settings UI 对比

### 优化前（缺少 lightModel）
```
╭─────────────────────────────────────╮
│ 🤖 LLM 配置                         │
│                                     │
│ ▶ 1. 模型:     claude-sonnet-4-5   │
│   2. API Key:  sk-ant-api03-****   │
│   3. Adapter:  anthropic            │
│   4. Base URL: https://...          │
│                                     │
│ ↑↓选择 Enter编辑 1/2/3/4快速编辑   │
╰─────────────────────────────────────╯
```

### 优化后（支持 lightModel）✨
```
╭─────────────────────────────────────╮
│ 🤖 LLM 配置                         │
│                                     │
│ ▶ 1. 模型:     claude-sonnet-4-5   │
│   2. 轻量模型: claude-haiku-4-5    │  ⬅️ 新增
│   3. API Key:  sk-ant-api03-****   │
│   4. Adapter:  anthropic            │
│   5. Base URL: https://...          │
│                                     │
│ ↑↓选择 Enter编辑 1/2/3/4/5快速编辑 │  ⬅️ 更新
╰─────────────────────────────────────╯
```

---

## 编辑界面对比

### 优化前
```
╭─────────────────────────────────────╮
│ 🤖 LLM 配置                         │
│                                     │
│   1. 模型:     claude-sonnet-4-5█  │
│   2. API Key:  sk-ant-api03-****   │
│   3. Adapter:  anthropic            │
│   4. Base URL: https://...          │
│                                     │
│ 输入新值 → Enter 保存 | Esc 取消    │
╰─────────────────────────────────────╯
```

### 优化后
```
╭─────────────────────────────────────╮
│ 🤖 LLM 配置                         │
│                                     │
│   1. 模型:     claude-sonnet-4-5   │
│   2. 轻量模型: claude-haiku-4-5█   │  ⬅️ 正在编辑
│   3. API Key:  sk-ant-api03-****   │
│   4. Adapter:  anthropic            │
│   5. Base URL: https://...          │
│                                     │
│ 输入新值 → Enter 保存 | Esc 取消    │
╰─────────────────────────────────────╯
```

---

## 配置文件对比

### 优化前
```json
{
  "provider": {
    "model": "[CC]claude-sonnet-4-5-20250929",
    "adapter": "anthropic",
    "maxTokens": 64000
  }
}
```

### 优化后
```json
{
  "provider": {
    "model": "[CC]claude-sonnet-4-5-20250929",
    "lightModel": "[CC]claude-haiku-4-5-20251001",  ⬅️ 新增
    "adapter": "anthropic",
    "maxTokens": 64000
  }
}
```

---

## 环境变量对比

### 优化前
```bash
# .env
XUANJI_MODEL=[CC]claude-sonnet-4-5-20250929
XUANJI_API_KEY=sk-ant-api03-...
XUANJI_BASE_URL=https://api.anthropic.com
```

### 优化后
```bash
# .env
XUANJI_MODEL=[CC]claude-sonnet-4-5-20250929
XUANJI_LIGHT_MODEL=[CC]claude-haiku-4-5-20251001  ⬅️ 新增
XUANJI_API_KEY=sk-ant-api03-...
XUANJI_BASE_URL=https://api.anthropic.com
```

---

## /doctor 命令输出对比

### 优化前
```
📡 模型配置
  模型:     claude-sonnet-4-5-20250929
  轻量模型: 未配置                        ⬅️ 不显示或显示 "未配置"
  服务地址: https://api.anthropic.com
  适配器:   anthropic
  API Key:  sk-ant-api03-****
```

### 优化后
```
📡 模型配置
  模型:     claude-sonnet-4-5-20250929
  轻量模型: claude-haiku-4-5-20251001    ⬅️ 显示配置的轻量模型
  服务地址: https://api.anthropic.com
  适配器:   anthropic
  API Key:  sk-ant-api03-****
```

---

## 成本对比图

### 场景: 10K 输入 + 2K 输出

#### 优化前（全部用主模型）
```
┌─────────────────────────────────────────┐
│ 📊 成本分析                              │
├─────────────────────────────────────────┤
│ 主模型 (Sonnet): 100% 使用              │
│   输入: 10,000 tokens × $3/1M = $0.030 │
│   输出:  2,000 tokens × $15/1M = $0.030│
│                                         │
│ 总成本: $0.060                          │
└─────────────────────────────────────────┘
```

#### 优化后（20% 用轻量模型）
```
┌─────────────────────────────────────────┐
│ 📊 成本分析                              │
├─────────────────────────────────────────┤
│ 主模型 (Sonnet): 80% 使用               │
│   输入:  8,000 tokens × $3/1M = $0.024 │
│   输出:  1,600 tokens × $15/1M = $0.024│
│                                         │
│ 轻量模型 (Haiku): 20% 使用   ⬅️ 新增   │
│   输入:  2,000 tokens × $1/1M = $0.002 │
│   输出:    400 tokens × $5/1M = $0.002 │
│                                         │
│ 总成本: $0.052                          │
│ 节省:   $0.008 (13%)          ⬅️ 节省  │
└─────────────────────────────────────────┘
```

---

## 工作流程对比

### 优化前（单一模型）
```
┌─────────────────────────────────────┐
│ 用户输入                             │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ Agent 循环                           │
│ 模型: claude-sonnet-4-5             │
│ ✅ 核心推理                          │
│ ❌ 上下文压缩                        │  ⬅️ 也用主模型（昂贵）
│ ❌ 子代理任务                        │  ⬅️ 也用主模型（昂贵）
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ 工具调用                             │
│ 模型: claude-sonnet-4-5             │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ 输出结果                             │
│ 成本: $0.060                        │
└─────────────────────────────────────┘
```

### 优化后（双模型）
```
┌─────────────────────────────────────┐
│ 用户输入                             │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ Agent 循环                           │
│ 主模型: claude-sonnet-4-5           │  ⬅️ 核心任务
│ ✅ 核心推理                          │
│                                     │
│ 轻量模型: claude-haiku-4-5          │  ⬅️ 简单任务
│ ✅ 上下文压缩                        │
│ ✅ 子代理任务                        │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ 工具调用                             │
│ 主模型: claude-sonnet-4-5           │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ 输出结果                             │
│ 成本: $0.052 (节省 13%)             │  ⬅️ 成本降低
└─────────────────────────────────────┘
```

---

## 快捷键对比

### 优化前
```
Settings → LLM 配置

快捷键:
  1 - 模型
  2 - API Key
  3 - Adapter
  4 - Base URL
```

### 优化后
```
Settings → LLM 配置

快捷键:
  1 - 模型
  2 - 轻量模型      ⬅️ 新增
  3 - API Key
  4 - Adapter
  5 - Base URL
```

---

## 文档对比

### 优化前
```
docs/
├── README.md
├── CHANGELOG.md
└── ...
```

### 优化后
```
docs/
├── README.md
├── CHANGELOG.md
├── LIGHT_MODEL_GUIDE.md              ⬅️ 新增（341 行，完整指南）
├── LIGHT_MODEL_QUICK_START.md        ⬅️ 新增（105 行，快速上手）
├── LIGHT_MODEL_IMPLEMENTATION.md     ⬅️ 新增（358 行，实现总结）
└── ...
```

---

## 国际化对比

### 优化前（中文）
```typescript
'llm.field_model': '模型',
'llm.field_apikey': 'API Key',
'llm.field_adapter': 'Adapter',
'llm.field_baseurl': 'Base URL',
'llm.hint': '↑↓选择 Enter编辑 1/2/3/4快速编辑 Q=返回',
```

### 优化后（中文）
```typescript
'llm.field_model': '模型',
'llm.field_light_model': '轻量模型',        ⬅️ 新增
'llm.field_apikey': 'API Key',
'llm.field_adapter': 'Adapter',
'llm.field_baseurl': 'Base URL',
'llm.hint': '↑↓选择 Enter编辑 1/2/3/4/5快速编辑 Q=返回',  ⬅️ 更新
```

### 优化前（英文）
```typescript
'llm.field_model': 'Model',
'llm.field_apikey': 'API Key',
'llm.field_adapter': 'Adapter',
'llm.field_baseurl': 'Base URL',
'llm.hint': '↑↓ Select Enter Edit 1/2/3/4 Quick edit Q=Back',
```

### 优化后（英文）
```typescript
'llm.field_model': 'Model',
'llm.field_light_model': 'Light Model',    ⬅️ 新增
'llm.field_apikey': 'API Key',
'llm.field_adapter': 'Adapter',
'llm.field_baseurl': 'Base URL',
'llm.hint': '↑↓ Select Enter Edit 1/2/3/4/5 Quick edit Q=Back',  ⬅️ 更新
```

---

## 配置流程对比

### 优化前（4 步）
```
1. 启动 Xuanji
   npm run dev

2. 进入设置
   /settings

3. 选择 LLM 配置
   按 Enter

4. 配置主模型
   按 1 → 输入模型 → Enter
```

### 优化后（5 步）
```
1. 启动 Xuanji
   npm run dev

2. 进入设置
   /settings

3. 选择 LLM 配置
   按 Enter

4. 配置主模型
   按 1 → 输入模型 → Enter

5. 配置轻量模型              ⬅️ 新增步骤
   按 2 → 输入轻量模型 → Enter
```

---

## 总结

| 方面 | 优化前 | 优化后 | 改进 |
|------|--------|--------|------|
| **配置项数量** | 4 | 5 | +1 ✅ |
| **环境变量** | 无 | `XUANJI_LIGHT_MODEL` | +1 ✅ |
| **快捷键** | 1-4 | 1-5 | 更新 ✅ |
| **成本** | $0.060 | $0.052 | -13% ✅ |
| **文档** | 0 | 3 篇 | +3 ✅ |
| **国际化** | 4 key | 5 key | +1 ✅ |

---

**关键改进**:
- ✅ **配置更灵活** — 支持独立轻量模型
- ✅ **成本更优化** — 节省 13-67% 成本
- ✅ **文档更完善** — 3 篇详细指南
- ✅ **操作更简单** — UI 一键配置

---

**版本**: v1.5.0  
**日期**: 2026-03-06  
**文档**: `docs/LIGHT_MODEL_GUIDE.md`
