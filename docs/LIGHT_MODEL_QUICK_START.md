# Light Model 配置 - 快速上手

## ✨ 新功能：独立配置轻量模型

Xuanji 现在支持为**低复杂度任务**配置独立的轻量模型，实现成本优化！

### 💰 成本节省

| 场景 | 主模型 | 轻量模型 | 节省 |
|------|--------|---------|------|
| 上下文压缩 | Sonnet ($3/$15) | Haiku ($1/$5) | ~67% |
| 子代理任务 | GPT-4o ($5/$15) | GPT-4o-mini ($0.15/$0.60) | ~96% |
| 记忆提取 | Sonnet | Haiku | ~67% |

---

## 🚀 快速配置（3 种方式）

### 1️⃣ 环境变量（推荐）

在 `.env` 中添加：

```bash
XUANJI_MODEL=[CC]claude-sonnet-4-5-20250929
XUANJI_LIGHT_MODEL=[CC]claude-haiku-4-5-20251001
```

### 2️⃣ Settings UI（交互式）

```bash
npm run dev
/settings
选择 "LLM 配置"
按 2 编辑 "轻量模型"
输入: claude-haiku-4-5-20251001
按 Enter 保存
```

### 3️⃣ 配置文件

编辑 `.xuanji/config.json`：

```json
{
  "provider": {
    "model": "[CC]claude-sonnet-4-5-20250929",
    "lightModel": "[CC]claude-haiku-4-5-20251001"
  }
}
```

---

## 📖 详细文档

完整配置指南: [`docs/LIGHT_MODEL_GUIDE.md`](./LIGHT_MODEL_GUIDE.md)

包含：
- ✅ 使用场景详解
- ✅ 成本分析示例
- ✅ 推荐配置（OpenAI/Anthropic/Azure）
- ✅ 工作原理说明
- ✅ 常见问题解答

---

## 🎯 推荐配置

### OpenAI
```bash
XUANJI_MODEL=gpt-4o
XUANJI_LIGHT_MODEL=gpt-4o-mini
```

### Anthropic Claude
```bash
XUANJI_MODEL=[CC]claude-sonnet-4-5-20250929
XUANJI_LIGHT_MODEL=[CC]claude-haiku-4-5-20251001
```

### Azure OpenAI
```bash
XUANJI_MODEL=gpt-4
XUANJI_LIGHT_MODEL=gpt-3.5-turbo
```

---

## ❓ 常见问题

### 不配置会怎样？
自动使用主模型，功能完全正常，只是成本稍高。

### 会影响质量吗？
不会。核心推理仍使用主模型，轻量模型仅用于简单任务。

### 如何验证配置？
运行 `/doctor` 命令查看模型配置。

---

**版本**: v1.5.0  
**更新**: 2026-03-06  
**文档**: [完整指南](./LIGHT_MODEL_GUIDE.md)
