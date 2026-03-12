# API Key 显式验证 - 变更说明

## 问题背景

用户报告：配置中显示"未设置 API Key"，但 xuanji 仍能正常工作。

### 根本原因

1. **Anthropic SDK 的默认行为**
   - `new Anthropic({ apiKey: undefined })` 时，SDK 自动回退到 `process.env.ANTHROPIC_API_KEY`
   - SDK 构造函数签名：`@param {string | null | undefined} [opts.apiKey=process.env['ANTHROPIC_API_KEY'] ?? null]`

2. **xuanji 的配置加载**
   - 项目配置（`.xuanji/config.json`）：只设置 `model`，无 `apiKey`
   - 全局配置（`~/.xuanji/config.json`）：`provider: {}`，也是空的
   - 环境变量检查：仅检查 `XUANJI_API_KEY`，未找到
   - 最终传给 SDK：`apiKey: undefined`

3. **意外的向后兼容**
   - 用户 shell 配置文件（`~/.zshrc`）设置了 `ANTHROPIC_API_KEY`
   - SDK 自动使用该环境变量，导致 xuanji 能正常工作
   - 用户误以为 xuanji 没有正确检查配置

## 解决方案

### 代码变更

**修改文件**：
- `src/core/providers/AnthropicProvider.ts`
- `src/core/providers/OpenAIProvider.ts`

**变更内容**：在 `getClient()` 方法中添加显式检查

```typescript
private getClient(config: ProviderConfig): Anthropic {
  // 显式检查 API Key，不依赖 SDK 的环境变量回退
  if (!config.apiKey || config.apiKey.trim() === '') {
    throw new Error(
      '未配置 API Key。请通过以下方式之一设置：\n' +
      '1. 环境变量: export XUANJI_API_KEY="your-key"\n' +
      '2. 全局配置: 编辑 ~/.xuanji/config.json\n' +
      '3. 项目配置: 编辑 .xuanji/config.json',
    );
  }

  return new Anthropic({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    timeout: config.timeout ?? 600_000,
  });
}
```

### 测试覆盖

**新增测试文件**：`test/unit/providers/APIKeyValidation.test.ts`

测试用例：
- ✅ API Key 为空字符串时抛出异常
- ✅ API Key 为 undefined 时抛出异常
- ✅ 错误信息包含配置方式说明
- ✅ 错误信息明确指出使用 `XUANJI_API_KEY`
- ✅ AnthropicProvider 和 OpenAIProvider 均覆盖

## 行为变更

### Before（修改前）
```bash
# 用户配置
~/.xuanji/config.json: { "provider": {} }
.xuanji/config.json: { "provider": { "model": "claude-sonnet-4" } }

# Shell 环境
export ANTHROPIC_API_KEY="sk-xxx"

# 结果：能正常工作（依赖 SDK 回退）
```

### After（修改后）
```bash
# 相同配置
~/.xuanji/config.json: { "provider": {} }
.xuanji/config.json: { "provider": { "model": "claude-sonnet-4" } }

# Shell 环境
export ANTHROPIC_API_KEY="sk-xxx"  # ❌ 不再有效

# 结果：抛出异常
Error: 未配置 API Key。请通过以下方式之一设置：
1. 环境变量: export XUANJI_API_KEY="your-key"
2. 全局配置: 编辑 ~/.xuanji/config.json
3. 项目配置: 编辑 .xuanji/config.json
```

### 用户迁移指南

**方案 1：使用 xuanji 专用环境变量（推荐）**
```bash
# ~/.zshrc 或 ~/.bashrc
export XUANJI_API_KEY="sk-xxx"  # 替换原来的 ANTHROPIC_API_KEY
```

**方案 2：在配置文件中设置**
```json
// ~/.xuanji/config.json
{
  "version": "1.0",
  "config": {
    "provider": {
      "apiKey": "sk-xxx"
    }
  }
}
```

**方案 3：项目级配置（不推荐，避免提交到 Git）**
```json
// .xuanji/config.json
{
  "provider": {
    "apiKey": "sk-xxx"
  }
}
```

## Breaking Changes

⚠️ **Breaking Change**: 不再自动使用 `ANTHROPIC_API_KEY` 环境变量

**影响范围**：
- 使用 Anthropic Claude 的用户
- 依赖 `ANTHROPIC_API_KEY` 环境变量的用户
- 配置文件中未设置 `apiKey` 的用户

**缓解措施**：
- 错误信息清晰指出配置方式
- 用户只需修改环境变量名称即可

## 设计原则

1. **显式优于隐式** — 不依赖第三方 SDK 的默认行为
2. **清晰的错误信息** — 告诉用户如何解决问题
3. **一致的环境变量命名** — 统一使用 `XUANJI_*` 前缀
4. **防止配置混淆** — 避免用户误以为配置已生效

## 相关 Issue

- 用户报告：配置显示未设置 API Key 但能正常使用
- 原因：Anthropic SDK 自动回退到 `ANTHROPIC_API_KEY`
- 解决：显式检查并抛出友好错误信息

## 测试验证

```bash
# 运行测试
npm test -- test/unit/providers/APIKeyValidation.test.ts

# 结果
✓ test/unit/providers/APIKeyValidation.test.ts (6 tests) 5ms
  ✓ Provider API Key Validation
    ✓ AnthropicProvider
      ✓ 应在 API Key 为空时抛出异常
      ✓ 应在 API Key 为 undefined 时抛出异常
      ✓ 错误信息应包含配置方式说明
    ✓ OpenAIProvider
      ✓ 应在 API Key 为空时抛出异常
      ✓ 应在 API Key 为 undefined 时抛出异常
      ✓ 错误信息应包含配置方式说明
```

## 总结

通过显式验证 API Key，xuanji 现在能：
- ✅ 清晰地告知用户配置缺失
- ✅ 提供具体的解决方案
- ✅ 避免依赖第三方 SDK 的隐式行为
- ✅ 统一环境变量命名规范
- ✅ 防止配置混淆和误解

---

**版本**: v0.9.1-dev  
**日期**: 2025-01-XX  
**作者**: AI Assistant (Xuanji)
