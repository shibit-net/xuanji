# ModelClassifier 自动下载功能使用指南

## 概述

ModelClassifier 现在支持自动下载本地模型，首次使用时会自动从 HuggingFace 镜像下载 GGUF 格式的量化模型。

## 功能特性

### 1. 自动下载
- 首次使用时自动触发下载
- 使用全局 DownloadManager，支持代理、进度追踪
- 下载过程不阻塞主流程（降级到 fallback）
- 下载完成后自动加载到内存

### 2. GUI 下载队列
- 右下角显示下载队列（可展开/收起）
- 实时显示下载进度、速度、文件大小
- 支持取消下载、清除已完成任务
- 活跃任务数量徽章提示

### 3. 代理支持
自动检测以下环境变量：
- `HTTPS_PROXY`
- `HTTP_PROXY`
- `https_proxy`
- `http_proxy`

## 使用方法

### 基础使用

```typescript
import { ModelClassifier } from '@/core/agent/dispatch/ModelClassifier';

// 创建分类器
const classifier = new ModelClassifier({
  modelType: 'qwen2.5-0.5b-q4', // 或 'qwen2.5-1.5b-q4'
});

// 初始化（如果模型未下载，会自动触发下载）
await classifier.init();

// 检查是否可用
if (classifier.isAvailable()) {
  // 模型已就绪，可以使用
  const result = await classifier.classify('帮我写一个 React 组件');
  console.log(result); // { agent: 'coder', scene: 'write_code', confidence: 0.95 }
} else {
  // 模型正在下载或加载失败，使用 fallback
  console.log('使用 fallback 分类逻辑');
}
```

### 监听下载进度

```typescript
import { DownloadManager } from '@/core/download/DownloadManager';

const downloadManager = DownloadManager.getInstance();

// 监听下载事件
downloadManager.on('task-created', (task) => {
  console.log(`下载任务创建: ${task.name}`);
});

downloadManager.on('task-progress', (task) => {
  console.log(`下载进度: ${task.progress.percent.toFixed(1)}%`);
});

downloadManager.on('task-completed', (task) => {
  console.log(`下载完成: ${task.name}`);
});

downloadManager.on('task-failed', (task) => {
  console.error(`下载失败: ${task.error}`);
});
```

### 切换模型

```typescript
// 切换到更大的模型
await classifier.switchModel('qwen2.5-1.5b-q4');

// 如果新模型未下载，会自动触发下载
```

### 手动预下载

```typescript
import { LocalModelLoader } from '@/core/agent/dispatch/LocalModelLoader';

const loader = new LocalModelLoader({
  modelId: 'hf:Qwen/Qwen2.5-0.5B-Instruct-GGUF:qwen2.5-0.5b-instruct-q4_k_m.gguf',
});

// 检查是否已下载
if (!loader.isDownloaded()) {
  console.log('开始下载模型...');
  await loader.predownload();
  console.log('下载完成！');
}

// 加载到内存
await loader.load();
```

## 配置

### 环境变量

```bash
# HuggingFace 镜像端点（默认: https://hf-mirror.com）
export HF_ENDPOINT=https://hf-mirror.com

# HTTP/HTTPS 代理
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
```

### 模型存储位置

模型文件默认存储在：
```
~/.xuanji/models/
```

### 支持的模型

| 模型 ID | 模型名称 | 文件大小 | 说明 |
|---------|---------|---------|------|
| `qwen2.5-0.5b-q4` | Qwen2.5-0.5B-Instruct (Q4_K_M) | ~469 MB | 推荐，速度快 |
| `qwen2.5-1.5b-q4` | Qwen2.5-1.5B-Instruct (Q4_K_M) | ~1.1 GB | 更准确，速度较慢 |

## 工作流程

```
用户首次使用 ModelClassifier
    ↓
检查模型是否已下载
    ↓
    ├─ 已下载 → 直接加载到内存 → 可用
    │
    └─ 未下载 → 启动后台下载 → 暂时不可用（使用 fallback）
                    ↓
              下载完成 → 自动加载到内存 → 可用
```

## GUI 下载队列

### 位置
- 固定在窗口右下角
- 默认收起，显示 "▶ 下载队列"
- 点击展开，显示所有下载任务

### 功能
- **进度条**：实时显示下载进度
- **速度显示**：显示当前下载速度（MB/s）
- **文件大小**：显示已下载/总大小
- **取消下载**：点击"取消"按钮停止下载
- **清除已完成**：批量清除已完成/失败的任务

### 状态指示
- 🟢 **下载中**：绿色进度条 + 速度显示
- ✓ **已完成**：绿色文字 "✓ 下载完成"
- ✗ **失败**：红色文字 "✗ 失败: 错误信息"
- **已取消**：灰色文字 "已取消"

## 测试

运行测试脚本：

```bash
tsx test-model-download.ts
```

测试内容：
1. 创建 ModelClassifier
2. 检查模型是否已下载
3. 如果未下载，监听下载进度
4. 下载完成后测试分类功能

## 故障排查

### 下载失败

**问题**：下载失败，提示网络错误

**解决方案**：
1. 检查网络连接
2. 配置代理：`export HTTPS_PROXY=http://127.0.0.1:7890`
3. 尝试更换 HF 镜像：`export HF_ENDPOINT=https://hf-mirror.com`

### 模型加载失败

**问题**：下载完成但加载失败

**解决方案**：
1. 检查磁盘空间是否充足
2. 删除损坏的模型文件：`rm ~/.xuanji/models/*.gguf`
3. 重新下载

### GUI 不显示下载队列

**问题**：下载队列组件不显示

**解决方案**：
1. 确认 `DownloadQueue` 组件已添加到 `MainLayout`
2. 检查浏览器控制台是否有错误
3. 确认 IPC 通信正常：`window.electron.downloadGetTasks()`

## API 参考

### ModelClassifier

```typescript
class ModelClassifier {
  constructor(config?: ModelClassifierConfig);
  async init(): Promise<void>;
  async classify(userInput: string): Promise<ClassificationResult | null>;
  isAvailable(): boolean;
  getCurrentModel(): string;
  getSystemPrompt(): string;
  async switchModel(modelType: ClassifierModelType): Promise<void>;
  async dispose(): Promise<void>;
}
```

### LocalModelLoader

```typescript
class LocalModelLoader {
  constructor(config: ModelConfig);
  async predownload(): Promise<void>;
  isDownloaded(): boolean;
  getDownloadTaskId(): string | null;
  async load(): Promise<void>;
  async generate(prompt: string, options?: GenerateOptions): Promise<string>;
  isLoaded(): boolean;
  async unload(): Promise<void>;
}
```

### DownloadManager

```typescript
class DownloadManager extends EventEmitter {
  static getInstance(): DownloadManager;
  async download(options: DownloadOptions): Promise<string>;
  cancel(taskId: string): void;
  getTask(taskId: string): DownloadTask | undefined;
  getAllTasks(): DownloadTask[];
  getTasksByCategory(category: string): DownloadTask[];
  clearFinished(): void;
  setMaxConcurrent(max: number): void;
}
```

## 最佳实践

1. **首次启动时预下载**：在应用启动时调用 `classifier.init()`，让模型在后台下载
2. **检查可用性**：使用前调用 `classifier.isAvailable()` 检查模型是否就绪
3. **优雅降级**：模型不可用时使用 fallback 逻辑（如基于规则的分类）
4. **监听下载事件**：在 GUI 中显示下载进度，提升用户体验
5. **合理选择模型**：根据性能需求选择合适的模型大小

## 未来改进

- [ ] 支持断点续传
- [ ] 支持多个 HF 镜像自动切换
- [ ] 模型版本管理和自动更新
- [ ] 下载队列持久化（重启后恢复）
- [ ] 更多量化格式支持（Q2_K, Q8_0 等）
