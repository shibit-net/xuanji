# 场景分类器模型配置

Xuanji 内置了两个本地小模型用于智能场景和 Agent 分类：

## 可用模型

### 1. Qwen2.5-1.5B-Instruct（默认）

**特点**：
- 模型大小：1.5B 参数（~3GB 内存）
- 推理速度：~20ms
- 分类准确率：90%+
- 中文优化：阿里开源，中文理解能力强

**适用场景**：
- 需要快速响应
- 内存资源有限
- 日常编程任务分类

### 2. ChatGLM3-6B

**特点**：
- 模型大小：6B 参数（~12GB 内存）
- 推理速度：~50ms
- 分类准确率：95%+
- 中文优化：清华开源，理解能力更强

**适用场景**：
- 需要更高准确率
- 内存资源充足
- 复杂任务分类

## 配置方法

### 方式 1：通过配置文件

编辑 `.xuanji/users/{userId}/config.json`：

```json
{
  "jarvis": {
    "classifierModel": "qwen2.5-1.5b-instruct"
  }
}
```

可选值：
- `"qwen2.5-1.5b-instruct"` - Qwen2.5-1.5B（默认）
- `"chatglm3-6b"` - ChatGLM3-6B

### 方式 2：通过 Agent 配置

编辑 `.xuanji/users/{userId}/agents/scene-classifier.json5`：

```json5
{
  provider: {
    adapter: "local",
    model: "chatglm3-6b"  // 修改这里
  }
}
```

## 首次运行

首次运行时，模型会自动从 Hugging Face 下载到本地：

```
~/.xuanji/models/
├── Xenova/
│   ├── Qwen2.5-1.5B-Instruct/
│   └── chatglm3-6b/
```

**下载大小**：
- Qwen2.5-1.5B：~3GB
- ChatGLM3-6B：~12GB

**注意**：首次下载需要网络连接，请确保网络畅通。

## 性能对比

| 模型 | 参数量 | 内存占用 | 推理速度 | 准确率 | 推荐场景 |
|------|--------|----------|----------|--------|----------|
| Qwen2.5-1.5B | 1.5B | ~3GB | ~20ms | 90%+ | 日常使用（推荐） |
| ChatGLM3-6B | 6B | ~12GB | ~50ms | 95%+ | 高精度需求 |

## 运行时切换

可以在运行时动态切换模型（需要重启会话）：

```typescript
// 通过 API 切换
await modelClassifier.switchModel('chatglm3-6b');
```

## 故障排查

### 模型加载失败

1. 检查网络连接（首次下载）
2. 检查磁盘空间（至少 15GB 可用）
3. 检查内存（至少 4GB 可用）

### 推理速度慢

1. 确认使用了量化模型（默认启用）
2. 考虑切换到更小的模型（Qwen2.5-1.5B）
3. 检查 CPU 负载

### 分类不准确

1. 考虑切换到更大的模型（ChatGLM3-6B）
2. 检查用户输入是否清晰
3. 查看日志中的置信度分数

## 技术细节

- 使用 transformers.js 在 Node.js 中运行 ONNX 模型
- 自动量化以减少内存占用和提升速度
- 模型缓存在 `~/.xuanji/models/` 目录
- 支持懒加载，首次使用时才加载模型
