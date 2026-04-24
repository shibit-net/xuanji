# 测试 ModelClassifier 自动下载功能

## 前提条件

确保模型文件不存在：
```bash
rm ~/.xuanji/models/*.gguf
ls ~/.xuanji/models/  # 应该为空
```

## 测试步骤

### 方法 1：GUI 测试（推荐）

1. 启动 GUI 应用：
```bash
npm run dev:gui
```

2. 在聊天界面发送任何消息（例如："帮我写代码"）

3. 观察：
   - **右下角**应该出现 "▶ 下载队列" 按钮
   - 点击展开，可以看到下载进度
   - 下载完成后，ModelClassifier 会自动加载模型

### 方法 2：CLI 测试

1. 启动 CLI：
```bash
npm run dev
```

2. 发送消息触发 ModelClassifier

3. 查看日志输出：
```
[ModelClassifier] Initializing ModelClassifier with qwen2.5-0.5b-q4...
[ModelClassifier] Model not found locally, starting background download...
[DownloadManager] Download task created: Model: qwen2.5-0.5b-instruct-q4_k_m.gguf
[DownloadManager] Total size: 468.54 MB
[DownloadManager] Download progress: 10.5% (49.20 MB)
...
[DownloadManager] Download complete: 468.54 MB
[ModelClassifier] Model download completed, loading to memory...
[ModelClassifier] ModelClassifier ready after download
```

## 预期行为

### 首次使用（模型未下载）
1. ModelClassifier 检测到模型不存在
2. 启动后台下载（不阻塞主流程）
3. 暂时使用 fallback 分类逻辑
4. 下载完成后自动加载模型
5. 后续请求使用本地模型分类

### 再次使用（模型已下载）
1. ModelClassifier 检测到模型已存在
2. 直接加载到内存
3. 立即可用，无需下载

## GUI 下载队列功能

### 位置
- 固定在窗口**右下角**
- 默认收起状态

### 展开后显示
- 下载任务列表
- 每个任务显示：
  - 文件名
  - 进度条
  - 下载速度（MB/s）
  - 已下载/总大小
  - 取消按钮（下载中时）

### 状态指示
- 🟢 **下载中**：绿色进度条 + 实时速度
- ✓ **已完成**：绿色文字
- ✗ **失败**：红色文字 + 错误信息
- **已取消**：灰色文字

## 故障排查

### 问题：没有看到下载队列

**检查 1**：确认模型文件不存在
```bash
ls ~/.xuanji/models/
# 应该为空或没有 qwen2.5-0.5b-instruct-q4_k_m.gguf
```

**检查 2**：查看浏览器控制台
- 打开开发者工具（F12）
- 查看 Console 是否有错误

**检查 3**：确认 IPC 通信正常
在浏览器控制台执行：
```javascript
await window.electron.downloadGetTasks()
// 应该返回 { success: true, tasks: [...] }
```

### 问题：下载失败

**检查网络**：
```bash
curl -I https://hf-mirror.com/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf
# 应该返回 HTTP/2 302 或 200
```

**配置代理**（如果需要）：
```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
```

### 问题：下载完成但模型加载失败

**检查磁盘空间**：
```bash
df -h ~/.xuanji/models/
```

**检查文件完整性**：
```bash
ls -lh ~/.xuanji/models/qwen2.5-0.5b-instruct-q4_k_m.gguf
# 应该约 469 MB
```

**重新下载**：
```bash
rm ~/.xuanji/models/*.gguf
# 然后重新启动应用
```

## 代码位置

- **下载管理器**：`src/core/download/DownloadManager.ts`
- **模型加载器**：`src/core/agent/dispatch/LocalModelLoader.ts`
- **模型分类器**：`src/core/agent/dispatch/ModelClassifier.ts`
- **GUI 组件**：`desktop/renderer/components/DownloadQueue.tsx`
- **IPC 接口**：`desktop/main/ipc/download.ts`

## 日志位置

- **CLI 日志**：终端输出
- **GUI 日志**：
  - 主进程：终端输出
  - 渲染进程：浏览器开发者工具 Console

## 环境变量

```bash
# HuggingFace 镜像（默认：https://hf-mirror.com）
export HF_ENDPOINT=https://hf-mirror.com

# HTTP/HTTPS 代理
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
```

## 成功标志

✅ 右下角出现 "▶ 下载队列"  
✅ 展开后看到下载任务和进度  
✅ 下载完成后显示 "✓ 下载完成"  
✅ 日志显示 "ModelClassifier ready after download"  
✅ 后续消息使用本地模型分类
