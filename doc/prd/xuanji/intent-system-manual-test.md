# 意图识别系统 - 手动测试计划

## 测试目标

验证意图识别系统的核心功能：
1. ✅ IntentRouter 初始化和扫描
2. ✅ IntentAnalyzer Agent 调用（LLM 分类）
3. ✅ ContextCompressor Agent 调用（上下文压缩）
4. ✅ 降级策略验证
5. ✅ 自动学习功能

## 前置条件

1. **环境变量**：
   ```bash
   export XUANJI_API_KEY="your-claude-api-key"
   ```

2. **配置检查**：
   ```bash
   # 检查 Agent 配置文件是否存在
   ls -la src/core/agent/builtin/intent-analyzer.json5
   ls -la src/core/agent/builtin/context-compressor.json5
   ```

3. **构建**：
   ```bash
   npm run build
   ```

## 测试用例

### 1. 基础功能测试

#### 1.1 启动验证

```bash
npm run dev
```

**预期行为**：
- ✅ 应用正常启动
- ✅ 日志显示 AgentRegistry 初始化，加载 7 个 Agent（包括 intent-analyzer 和 context-compressor）
- ✅ IntentRouter 初始化成功

**验证日志**：
```
🤖 初始化 Agent Registry...
✅ Agent Registry 初始化完成，已加载 7 个 Agent
   Agent 列表: [ 'coder', 'context-compressor', 'explore', 'general-purpose', 'intent-analyzer', 'plan', 'xuanji' ]
```

#### 1.2 IntentAnalyzer Agent 测试

**测试场景**：用户输入需要意图识别的请求

**测试步骤**：
1. 启动 Xuanji
2. 输入：`帮我写一个 TypeScript 函数`

**预期行为**：
- ✅ 系统识别到编程意图
- ✅ 如果向量未命中，调用 IntentAnalyzer Agent
- ✅ 返回意图分类结果

**验证日志**：
```
⏳ LLM 意图分析中（使用 IntentAnalyzer Agent）...
✓ LLM 识别到 X 个意图
```

### 2. ContextCompressor Agent 测试

#### 2.1 长对话压缩测试

**测试场景**：模拟长对话触发上下文压缩

**测试步骤**：
1. 启动 Xuanji
2. 进行多轮对话（超过上下文窗口限制）

**预期行为**：
- ✅ 当上下文超过阈值时，自动触发压缩
- ✅ 调用 ContextCompressor Agent
- ✅ 生成对话摘要

**验证日志**：
```
⏳ 压缩上下文...
✓ 上下文压缩完成
```

### 3. 降级策略测试

#### 3.1 AgentRegistry 不可用

**测试场景**：AgentRegistry 为 null

**测试步骤**：
1. 修改代码临时设置 agentRegistry = null（或不传递）
2. 启动应用
3. 尝试意图识别

**预期行为**：
- ✅ 系统不应崩溃
- ✅ 意图识别降级到向量匹配或正则匹配
- ✅ 日志显示降级警告

**验证日志**：
```
⚠️  AgentRegistry 未初始化，意图分类已禁用
```

#### 3.2 IntentAnalyzer Agent 未启用

**测试场景**：禁用 IntentAnalyzer Agent

**测试步骤**：
1. 修改 `intent-analyzer.json5`，设置 `enabled: false`
2. 重启应用
3. 尝试意图识别

**预期行为**：
- ✅ LLM 分类被跳过
- ✅ 降级到向量匹配
- ✅ 日志显示降级警告

**验证日志**：
```
⚠️  IntentAnalyzer Agent (intent-analyzer) 未启用
```

#### 3.3 ContextCompressor Agent 未启用

**测试场景**：禁用 ContextCompressor Agent

**测试步骤**：
1. 修改 `context-compressor.json5`，设置 `enabled: false`
2. 重启应用
3. 触发上下文压缩

**预期行为**：
- ✅ 压缩功能降级到规则压缩
- ✅ 不调用 LLM
- ✅ 日志显示降级警告

### 4. 自动学习测试

#### 4.1 学习新意图

**测试场景**：首次使用某个 Skill

**测试步骤**：
1. 清空学习数据：`rm ~/.xuanji/learned-intents.json`
2. 启动应用
3. 输入：`帮我写代码`
4. 观察学习过程

**预期行为**：
- ✅ 第一次使用 LLM 分类
- ✅ 分类成功后自动学习
- ✅ 生成意图定义和向量
- ✅ 保存到 `~/.xuanji/learned-intents.json`

**验证**：
```bash
# 检查学习文件
cat ~/.xuanji/learned-intents.json | jq

# 检查向量缓存
cat ~/.xuanji/cache/intent-vectors.json | jq
```

#### 4.2 向量匹配命中

**测试场景**：再次使用相同意图

**测试步骤**：
1. 在 4.1 基础上
2. 输入类似的请求：`写一个 JavaScript 函数`

**预期行为**：
- ✅ 向量匹配命中（~30ms）
- ✅ 不调用 LLM
- ✅ 直接返回意图

**验证日志**：
```
✓ 向量匹配命中: skill.code-assistant (相似度: 0.85)
```

### 5. 性能测试

#### 5.1 向量匹配性能

**测试场景**：多次向量匹配

**测试步骤**：
1. 确保有学习数据
2. 输入多个相似请求
3. 观察响应时间

**预期行为**：
- ✅ 向量匹配耗时 < 50ms
- ✅ 远快于 LLM 分类（~1-2s）

#### 5.2 LLM 分类性能

**测试场景**：首次分类

**测试步骤**：
1. 清空学习数据
2. 输入新请求
3. 观察 LLM 响应时间

**预期行为**：
- ✅ 使用 Haiku 模型（快速、低成本）
- ✅ 响应时间 ~1-2s

## 测试检查清单

### 启动和初始化
- [ ] AgentRegistry 正确加载 intent-analyzer
- [ ] AgentRegistry 正确加载 context-compressor
- [ ] IntentRouter 初始化成功
- [ ] 学习数据正确加载

### 意图识别
- [ ] LLM 分类（IntentAnalyzer Agent）正常工作
- [ ] 向量匹配正常工作
- [ ] 降级策略正常工作（AgentRegistry 不可用）
- [ ] 降级策略正常工作（Agent 未启用）

### 上下文压缩
- [ ] ContextCompressor Agent 正常工作
- [ ] 压缩结果符合预期
- [ ] 降级到规则压缩正常工作

### 自动学习
- [ ] 从 LLM 分类结果学习
- [ ] 向量生成正常
- [ ] 学习数据持久化正常
- [ ] 向量缓存正常

### 性能
- [ ] 向量匹配性能 < 50ms
- [ ] LLM 分类使用 Haiku 模型
- [ ] 无明显性能退化

## 测试命令速查

```bash
# 清空学习数据
rm ~/.xuanji/learned-intents.json
rm ~/.xuanji/cache/intent-vectors.json

# 查看学习数据
cat ~/.xuanji/learned-intents.json | jq
cat ~/.xuanji/cache/intent-vectors.json | jq

# 查看日志（如果有日志文件）
tail -f ~/.xuanji/logs/app.log

# 运行集成测试
npm run test test/integration/intent-router.test.ts
```

## 问题排查

### 问题 1：Agent 加载失败

**症状**：
```
✗ 加载失败: .../intent-analyzer.json5 ...
```

**排查**：
1. 检查 JSON5 语法是否正确
2. 检查 `tools: []` 是否为数组
3. 检查 `metadata.internal: true` 是否设置

### 问题 2：意图识别失败

**症状**：
```
⚠️  AgentRegistry 未初始化，意图分类已禁用
```

**排查**：
1. 检查 AgentRegistry 是否传递到 IntentRouter
2. 检查 ChatSession 是否正确传递 agentRegistry

### 问题 3：上下文压缩失败

**症状**：
```
⚠️  ContextCompressor Agent 执行失败
```

**排查**：
1. 检查 API Key 是否配置
2. 检查网络连接
3. 查看详细错误日志

### 问题 4：向量匹配失败

**症状**：
```
fetch failed
ConnectTimeoutError
```

**排查**：
1. 检查网络连接（需要访问 Hugging Face）
2. 使用代理（如果在墙内）
3. 或禁用向量匹配：`enableVector: false`

## 测试报告模板

```markdown
## 意图识别系统手动测试报告

**测试日期**：2026-03-15
**测试人员**：
**测试环境**：

### 测试结果摘要
- 总测试项：X
- 通过：X
- 失败：X
- 跳过：X

### 详细结果
1. 启动和初始化：✅ / ❌
2. 意图识别：✅ / ❌
3. 上下文压缩：✅ / ❌
4. 降级策略：✅ / ❌
5. 自动学习：✅ / ❌
6. 性能：✅ / ❌

### 发现的问题
1. 问题描述
   - 复现步骤：
   - 预期行为：
   - 实际行为：
   - 截图/日志：

### 建议
...
```

---

**文档版本**：1.0.0
**创建时间**：2026-03-15
**状态**：待测试
