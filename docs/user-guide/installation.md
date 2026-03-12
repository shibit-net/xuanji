# 安装指南

> 最后更新：2026-03-10

本指南将详细介绍 Xuanji 的各种安装方式、环境要求、API Key 配置和常见问题。

---

## 环境要求

### 必需条件

- **Node.js**：>= 20.0.0
- **npm**：>= 9.0.0
- **操作系统**：macOS、Linux、Windows（WSL）

### 推荐配置

- **终端**：支持 ANSI 颜色和 Unicode（推荐 iTerm2、Terminal.app、Windows Terminal）
- **字体**：支持 Emoji 和图标（推荐 Nerd Font）

---

## 安装方式

### 方式一：NPM 全局安装（推荐）

适用于大多数用户，安装最简单。

```bash
npm install -g xuanji
```

验证安装：

```bash
xuanji --version
# 输出：0.9.0

which xuanji
# 输出：/usr/local/bin/xuanji（或 ~/.npm-global/bin/xuanji）
```

### 方式二：源码编译安装

适用于开发者或需要自定义的用户。

```bash
# 1. 克隆仓库
git clone https://github.com/shibit/xuanji.git
cd xuanji

# 2. 安装依赖
npm install

# 3. 构建
npm run build

# 4. 链接到全局
npm link
```

验证安装：

```bash
xuanji --version
# 输出：0.9.0
```

### 方式三：本地开发模式

适用于开发者调试。

```bash
# 1. 克隆仓库
git clone https://github.com/shibit/xuanji.git
cd xuanji

# 2. 安装依赖
npm install

# 3. 开发模式启动（不需要构建）
npm run dev
```

---

## API Key 配置

Xuanji 支持多种 LLM Provider，每种需要不同的 API Key。

### Anthropic Claude（默认）

从 [Anthropic Console](https://console.anthropic.com/) 获取 API Key（以 `sk-ant-` 开头）。

#### 环境变量方式（临时）

```bash
export ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
xuanji
```

#### 配置文件方式（永久）

创建 `~/.xuanji/config.json`：

```json
{
  "version": "1.0",
  "config": {
    "provider": {
      "adapter": "anthropic",
      "apiKey": "sk-ant-api03-xxxxx",
      "model": "[CC]claude-sonnet-4-5-20250929",
      "baseURL": "https://api.anthropic.com"
    }
  }
}
```

### OpenAI GPT（可选）

从 [OpenAI Platform](https://platform.openai.com/api-keys) 获取 API Key（以 `sk-` 开头）。

#### 环境变量方式

```bash
export OPENAI_API_KEY=sk-xxxxx
export XUANJI_PROVIDER_ADAPTER=openai
xuanji
```

#### 配置文件方式

修改 `~/.xuanji/config.json`：

```json
{
  "version": "1.0",
  "config": {
    "provider": {
      "adapter": "openai",
      "apiKey": "sk-xxxxx",
      "model": "gpt-4o",
      "baseURL": "https://api.openai.com/v1"
    }
  }
}
```

### 其他 Provider（如 Ollama、Azure）

详见 [配置参考](./configuration.md#provider-配置)。

---

## 可选配置

### Web 搜索 API Key（可选）

Xuanji 支持 Web 搜索功能，需要配置以下任一搜索引擎的 API Key：

#### Tavily（推荐）

```bash
export TAVILY_API_KEY=tvly-xxxxx
```

或在配置文件中：

```json
{
  "config": {
    "webSearch": {
      "providers": [
        {
          "name": "tavily",
          "enabled": true,
          "priority": 1,
          "apiKey": "tvly-xxxxx"
        }
      ]
    }
  }
}
```

#### Serper

```bash
export SERPER_API_KEY=xxxxx
```

#### Brave Search

```bash
export BRAVE_SEARCH_API_KEY=xxxxx
```

### MCP Server（可选）

如果需要使用 MCP（Model Context Protocol）集成外部工具，详见 [MCP 集成指南](./mcp-integration.md)。

---

## 配置文件位置

Xuanji 支持两级配置：

1. **全局配置**：`~/.xuanji/config.json`（影响所有项目）
2. **项目配置**：`.xuanji/config.json`（仅影响当前项目）

优先级：`环境变量 > 项目配置 > 全局配置 > 默认值`

详见 [配置参考](./configuration.md)。

---

## 故障排查

### 问题 1：`npm install -g` 权限错误

**错误信息**：

```
npm ERR! code EACCES
npm ERR! syscall mkdir
npm ERR! path /usr/local/lib/node_modules/xuanji
```

**解决方案 1**：使用 `sudo`（不推荐）

```bash
sudo npm install -g xuanji
```

**解决方案 2**：配置 npm 全局目录（推荐）

```bash
# 创建全局目录
mkdir -p ~/.npm-global

# 配置 npm
npm config set prefix ~/.npm-global

# 添加到 PATH
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc  # 或 ~/.zshrc
source ~/.bashrc  # 或 source ~/.zshrc

# 安装
npm install -g xuanji
```

### 问题 2：Node.js 版本过低

**错误信息**：

```
error xuanji@0.9.0: The engine "node" is incompatible with this module.
Expected version ">=20.0.0". Got "18.0.0"
```

**解决方案**：升级 Node.js

```bash
# 使用 nvm（推荐）
nvm install 20
nvm use 20
nvm alias default 20

# 或直接下载安装
# https://nodejs.org/
```

### 问题 3：网络问题（国内用户）

**错误信息**：

```
npm ERR! network timeout
```

**解决方案**：配置 npm 镜像

```bash
# 使用淘宝镜像
npm config set registry https://registry.npmmirror.com

# 或使用 cnpm
npm install -g cnpm --registry=https://registry.npmmirror.com
cnpm install -g xuanji
```

### 问题 4：TypeScript 编译错误（源码安装）

**错误信息**：

```
TS2307: Cannot find module '@/core/types'
```

**解决方案**：确保安装了所有依赖

```bash
# 删除 node_modules 和 lockfile
rm -rf node_modules package-lock.json

# 重新安装
npm install

# 构建
npm run build
```

### 问题 5：API Key 无效

**错误信息**：

```
AuthenticationError: Invalid API Key
```

**解决方案**：

1. 确认 API Key 格式正确：
   - Anthropic：以 `sk-ant-` 开头
   - OpenAI：以 `sk-` 开头
2. 检查环境变量或配置文件是否正确设置
3. 重新生成 API Key：
   - Anthropic：https://console.anthropic.com/
   - OpenAI：https://platform.openai.com/api-keys

### 问题 6：终端显示乱码

**解决方案**：

1. 确保终端支持 UTF-8 编码
2. 安装支持 Emoji 的字体（如 Nerd Font）
3. 设置环境变量：

```bash
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
```

---

## 验证安装

运行以下命令验证 Xuanji 是否安装成功：

```bash
# 1. 检查版本
xuanji --version
# 预期输出：0.9.0

# 2. 检查帮助
xuanji --help
# 预期输出：显示命令行参数

# 3. 启动（需要 API Key）
export ANTHROPIC_API_KEY=sk-ant-xxxxx
xuanji
# 预期输出：显示欢迎界面
```

---

## 卸载

```bash
# NPM 全局安装
npm uninstall -g xuanji

# 源码安装
cd xuanji
npm unlink

# 删除配置和数据（可选）
rm -rf ~/.xuanji
```

---

## 下一步

- [快速开始指南](./getting-started.md) — 5 分钟快速上手
- [配置参考](./configuration.md) — 详细的配置项说明
- [工具参考](./tools-reference.md) — 所有内置工具的使用说明

---

## 获取帮助

- **问题反馈**：[GitHub Issues](https://github.com/shibit/xuanji/issues)
- **讨论区**：[GitHub Discussions](https://github.com/shibit/xuanji/discussions)
- **Email**：dev@shibit.net

---

[← 返回文档首页](./README.md) | [下一步：配置参考 →](./configuration.md)
