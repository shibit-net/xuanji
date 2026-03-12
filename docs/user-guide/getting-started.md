# 快速开始指南

> 最后更新：2026-03-10

本指南将帮助你在 **5 分钟内**完成 Xuanji 的安装和第一次对话。

---

## 前置条件

- **Node.js**：>= 20.0.0（推荐使用 [nvm](https://github.com/nvm-sh/nvm) 管理版本）
- **npm**：>= 9.0.0
- **Anthropic API Key**：从 [Anthropic Console](https://console.anthropic.com/) 获取

---

## 第一步：安装 Xuanji

### 方式一：NPM 全局安装（推荐）

```bash
npm install -g xuanji
```

### 方式二：源码编译安装

```bash
git clone https://github.com/shibit/xuanji.git
cd xuanji
npm install
npm run build
npm link
```

安装完成后，运行以下命令验证：

```bash
xuanji --version
# 输出：0.9.0
```

---

## 第二步：配置 API Key

Xuanji 默认使用 **Anthropic Claude** 模型，你需要配置 API Key。

### 临时配置（环境变量）

```bash
export ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```

### 永久配置（配置文件）

创建全局配置文件 `~/.xuanji/config.json`：

```json
{
  "version": "1.0",
  "config": {
    "provider": {
      "adapter": "anthropic",
      "apiKey": "sk-ant-api03-xxxxx",
      "model": "[CC]claude-sonnet-4-5-20250929"
    }
  }
}
```

**提示**：配置文件优先级为 `环境变量 > 项目配置 > 全局配置 > 默认值`。

详见 [配置参考](./configuration.md)。

---

## 第三步：启动 Xuanji

在终端中运行：

```bash
xuanji
```

你会看到以下欢迎界面：

```
┌─────────────────────────────────────────────┐
│                                             │
│        Shibit Xuanji · 璇玑 v0.9.0          │
│                                             │
│        🤖 开源 AI 助手                       │
│                                             │
└─────────────────────────────────────────────┘

模型：claude-sonnet-4-5-20250929
项目：/Users/you/project
技能：xuanji-assistant, code-assistant, life-secretary...

💡 输入 /help 查看可用命令

You >
```

---

## 第四步：第一次对话

尝试以下示例对话：

### 示例 1：读取文件并总结

```
You > 读取 package.json 并总结这个项目

Assistant > 我将读取 package.json 文件...

[使用工具 read_file]
路径：/Users/you/project/package.json

这是一个名为 "xuanji" 的项目，版本 0.9.0...
```

### 示例 2：创建文件

```
You > 创建一个 hello.md 文件，内容是 "Hello, Xuanji!"

Assistant > 我将创建文件...

[使用工具 write_file]
路径：/Users/you/project/hello.md
内容：Hello, Xuanji!

✅ 文件创建成功
```

### 示例 3：执行命令

```
You > 查看当前 git 分支

Assistant > 我将执行 git 命令...

[使用工具 bash]
命令：git branch --show-current

master
```

---

## 第五步：基础命令

Xuanji 提供以下常用命令（以 `/` 开头）：

| 命令 | 功能 | 示例 |
|------|------|------|
| `/help` | 显示帮助信息 | `/help` |
| `/clear` | 清空当前对话 | `/clear` |
| `/exit` | 退出 Xuanji | `/exit` |
| `/save` | 保存当前会话 | `/save my-session` |
| `/sessions` | 查看所有会话 | `/sessions` |
| `/config` | 查看/修改配置 | `/config get provider.model` |

更多命令详见 [会话管理](./session-management.md)。

---

## 下一步

恭喜！你已经完成了 Xuanji 的基础使用。接下来你可以：

1. **深入了解配置**：阅读 [配置参考](./configuration.md)
2. **学习所有工具**：阅读 [工具参考](./tools-reference.md)
3. **探索 Skills**：阅读 [Skills 使用指南](./skills-guide.md)
4. **使用记忆系统**：阅读 [记忆系统](./memory-system.md)
5. **集成 MCP 工具**：阅读 [MCP 集成指南](./mcp-integration.md)

---

## 故障排查

### 问题 1：`npm install -g` 权限错误

**解决方案**：使用 `sudo` 或配置 npm 全局目录

```bash
# 方式 1：使用 sudo
sudo npm install -g xuanji

# 方式 2：配置 npm 全局目录（推荐）
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
npm install -g xuanji
```

### 问题 2：API Key 无效

**错误信息**：`AuthenticationError: Invalid API Key`

**解决方案**：
1. 检查 API Key 是否正确（以 `sk-ant-` 开头）
2. 确认环境变量或配置文件已正确设置
3. 访问 [Anthropic Console](https://console.anthropic.com/) 重新生成

### 问题 3：Node.js 版本过低

**错误信息**：`Error: The engine "node" is incompatible`

**解决方案**：升级 Node.js 到 20.0.0 以上

```bash
# 使用 nvm 安装
nvm install 20
nvm use 20
```

更多问题详见 [故障排查](./troubleshooting.md)。

---

## 获取帮助

- **问题反馈**：[GitHub Issues](https://github.com/shibit/xuanji/issues)
- **讨论区**：[GitHub Discussions](https://github.com/shibit/xuanji/discussions)
- **Email**：dev@shibit.net

---

[← 返回文档首页](./README.md) | [下一步：安装指南 →](./installation.md)
