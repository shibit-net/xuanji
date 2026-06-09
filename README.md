<h1 align="center">璇玑 (Xuanji) — Agentic OS</h1>

<p align="center">
  <a href="https://shibit.net">🌐 官网：shibit.net</a>
  &nbsp;|&nbsp;
  <a href="https://shibit.net/docs/xuanji">📖 技术文档</a>
</p>

<p align="center">
  <strong>不是一个聊天机器人，而是一个住在你电脑里、越用越懂你的 AI 管家</strong>
</p>

<p align="center">
  <a href="https://github.com/shibit-net/xuanji"><img src="https://img.shields.io/badge/License-AGPL--3.0%20with%20Commons%20Clause-blue.svg?style=for-the-badge" alt="License"></a>
  <a href="https://github.com/shibit-net/xuanji"><img src="https://img.shields.io/badge/Node.js-20+-green?style=for-the-badge" alt="Node.js"></a>
</p>

<p align="center">
  <strong>中文版本</strong> | <a href="./README_EN.md">English Version</a>
</p>

---

## 什么是璇玑？

看过《钢铁侠》的人都会记得贾维斯。Tony Stark 早上醒来，贾维斯已经在汇报天气、日程和战甲状态。Tony 说「帮我把 Mark 42 的推进系统优化一下」，贾维斯开始干活——不是只写代码，而是调取历史测试数据、对比不同合金的耐热曲线、跑 CFD 模拟、出对比报告。Tony 说「算了，换个方案」，它立刻切换方向，而且**以后也不会再提那个被否决的方案**。

Tony 从来不需要向贾维斯解释「我说的是上周那种合金」。不需要把文件从一个工具搬到另一个工具。不需要每次对话都重新介绍自己。

**贾维斯有三个东西，任何 AI 助手要做到它那样，缺一不可：**

- **它认识你。** 不是「存下了你说过的话」，而是真的知道你是谁：你的偏好、你的习惯、你身边的人和他们的关系。
- **它不只是回答，它能做事。** 一个任务不管涉及多少种工具、多少道工序，它从头到尾自己串下来。你不用在中间当搬运工。
- **它会学。** 你说它做错了，它改。而且下次不会再犯。越用越准。

这，就是璇玑想成为的样子。

但如果把现在的 AI 助手放进贾维斯的位置，会发生什么？

### 场景一：记不住关系的 AI

Tony 说：「帮我订个餐厅，Morgan 不喜欢吃辣，她爱吃芝士汉堡。」

如果底层是 OpenClaw——它会记下这句话，存进 MEMORY.md。下次 Tony 说「帮我订餐厅」，它能搜到。但 Tony 再说「对了，Pepper 上次说那家意大利餐厅的千层面不错，也加进去」，它就蒙了。三条信息分开存着，**之间没有线连着**。它不知道 Morgan 是女儿、Pepper 是妻子、那家餐厅 Pepper 去过。

如果底层是 Hermes Agent——类似。memory manager 把信息交给 mem0 或 supermemory，但做的也是**存信息**，不知道「Morgan 不吃辣」是实体「Morgan」的「饮食约束」属性。

**如果底层是璇玑——** 它会建三个实体，连接七条关系：「Morgan —偏好→ 芝士汉堡」「Pepper —偏好→ 千层面」「Pepper —去过→ 那家餐厅」「Morgan —是→ Tony 的女儿」「Pepper —是→ Tony 的妻子」……下次 Tony 说「帮我家订个餐厅」，璇玑沿着关系网走：家庭成员 → 各自偏好和约束 → 综合推荐。

> **关键差别**：别人存的是文档——能找到你写过的句子。璇玑建的是图谱——知道句子里的每个东西和其他东西是什么关系。

### 场景二：只会单打独斗的 AI

Tony 说：「帮我把 Mark 42 的推进系统优化一下，需要调取之前的测试数据、对比三种合金方案、跑个模拟、出个报告。」

如果底层是 OpenClaw——它可以派生一个子 Agent，但只能**一条链路走到底**。一个人调数据的时候，没人同时在分析材料、准备模拟。

如果底层是 Hermes Agent——它可以并行启动几个子 Agent，但任务有先后依赖（必须先对比出最优合金才能模拟）时，并行就变成了「散开干，干完拼」。而且没有辩论机制——两个 Agent 意见不同，Tony 得自己判断。

**如果底层是璇玑——** 选 `pipeline` 策略：数据 Agent → 材料 Agent → 模拟 Agent → 报告 Agent。四个 Agent 串起来，上一个输出自动变成下一个输入。方案难分高下时切 `debate` 策略：两个材料专家各自辩护。没有合适的预置 Agent？**当场创建一个。**

> **关键差别**：OpenClaw 一个人干活，Hermes 几个人各自干活。璇玑是一支有分工、有配合、可以当场扩编的团队。

### 场景三：不会学的 AI

Tony 说：「上次用的是金钛合金方案吧？效果不行，换铬合金方案。」

如果底层是 OpenClaw——它有 REM dreaming，自动分析对话模式来**猜**什么重要。猜对的时候有用，猜错的时候 Tony 还得再纠正。而且它这次改口，**但没把纠正写回记忆**。

如果底层是 Hermes Agent——没有用户驱动的记忆修正通道。这次回答对了，下次同样场景可能又回到旧的认知。

**如果底层是璇玑——** 「金钛合金方案不行」→ 反馈循环触发 → 「Mark 42 —推进材料— 金钛合金」被标记为「否决」→ 关联原因。下次 Tony 说「Mark 43 也用类似的推进方案」，璇玑自动避开金钛合金。Tony 不需要再说一遍。

> **关键差别**：OpenClaw 会猜（可能猜错），Hermes 会忘（下次又犯）。璇玑被纠正一次，永久修正。

### 还有一个：Prompt 的问题

不管记忆多好、团队多强，LLM 的注意力有上限。OpenClaw 和 Hermes 把所有工具定义、Skills 列表一次性灌进 system prompt——就像让 Tony 修战甲时在面前摊一百本无关的工程手册。

璇玑把 prompt 拆成三层：L0（身份和安全，始终在线）、L1（10+ 场景规则，只加载正在用的 1-3 个）、L2（协作规则，只在需要时出现）。Tony 修战甲时只有工程和材料规则，做医疗分析时只切换医疗场景。**不需要的东西不出现在脑子里。**

---

**璇玑想成为什么？一句话：高粘性的 AI 管家。**

**同在。** 桌面客户端常驻、飞书群里随叫随到。你有事找它，它就在那里。**共生。** 你跟它交流越多，它越知道你——工作方式、偏好、人脉。从工具到伙伴。**共鸣。** 它不只是执行指令，而是理解你为什么要做这件事，主动补上你没说但需要的部分。

---

## 📸 界面预览

### 知识图谱
展示记忆系统可视化界面

![知识图谱](./screenshots/memory-topology.png)

### 多智能体协作
展示智能体团队协作辩论

![多智能体辩论](./screenshots/agent-team-debate.png)

### 智能体库
智能体库和工作区管理

![智能体库](./screenshots/agent-team-library.png)

### 短剧生成
剧本+定妆照+视频全流程

![短剧生成](./screenshots/video-generation.png)

---

## 为什么选择璇玑？

| 特性 | 璇玑 | OpenClaw | Hermes |
|------|------|----------|--------|
| 多智能体协作 | ✅ 5 种策略（串行/并行/层级/辩论/流水线）| ⚠️ 子 Agent 生成（单一模式） | ⚠️ 并行+看板（缺辩论/层级） |
| 记忆系统 | ✅ 实体-关系-事件知识图谱 | ⚠️ 向量搜索（无知识图谱） | ✅ 热/温/冷三层记忆 |
| 记忆可视化 | ✅ Cytoscape 拓扑图 | ❌ 无 | ❌ 无 |
| 记忆反馈修正 | ✅ 用户纠正→更新图谱→永久生效 | ⚠️ REM dreaming（自动推断） | ❌ 无用户驱动修正 |
| 分层提示词 | ✅ L0-L2 三层按场景动态加载 | ⚠️ 上下文文件拼接 | ⚠️ 组件拼接 |
| 桌面应用 | ✅ Electron + React Flow + 知识图谱 | ✅ Web 控制 UI | ⚠️ TUI 终端界面 |
| 当场建 Agent | ✅ 无预置时自动创建 | ❌ | ❌ |
| MCP + Skills 生态 | ✅ 天工坊市场 + 按需加载 | ✅ ClawHub | ✅ agentskills.io |
| 消息平台集成 | ✅ 飞书/钉钉/企微 | ✅ WhatsApp/Telegram/Discord/Slack/Signal/飞书 | ✅ Telegram/Discord/Slack/WhatsApp/Signal/飞书 |

---

## 核心特性

### 🧠 知识图谱记忆 — 信息有线连着

不是把对话存成文档然后搜索关键词。璇玑将每条信息拆成**实体、关系和事件**，织成一张可推理的网。

- **实体-关系-事件模型**：Morgan 不只是「Tony 的女儿」这句话，而是一个实体，连着偏好、约束、关系
- **反馈循环**：你纠正一次，图谱永久更新，下次自动修正
- **Cytoscape 拓扑图**：在桌面端直观看到你的知识网络

**更多详情**：[记忆驱动学习系统文档](./docs/memory-system.md)

### 🚀 多智能体协作 — 一支真正的团队

5 种策略，10 个 Agent，不是一个人干活，也不是几个人各自干活。

| 策略 | 做什么的 |
|------|---------|
| **串行** | 一个接一个，前人的输出是后人的输入 |
| **并行** | 几个人同时分析不同角度 |
| **层级** | Leader 分配任务，下面分头执行，最后汇总 |
| **辩论** | 各抒己见，争论达成共识 |
| **流水线** | 数据像工厂流水线一步步被处理 |

没有合适的预置 Agent？璇玑会**当场创建一个专用的**。

**更多详情**：[多智能体协作系统文档](./docs/multi-agent-system.md)

### 📚 L0-L2 动态 Prompt — 不带整本字典去考试

- **L0 基础层**：身份、安全、基础工作流（始终加载）
- **L1 场景层**：10+ 专业场景（write_code/debug/review 等），**意图分析后只加载 1-3 个**
- **L2 协调层**：多 Agent 协作规则，**仅复杂任务时加载**

写代码时只注入代码场景规则，做辩论时只注入辩论场景规则。无关上下文越少，LLM 越专注。

**更多详情**：[分层提示词系统文档](./docs/layered-prompt-system.md)

### 🔌 MCP + Skills 生态 — 用到才加载

Skills 和 MCP 不预加载到 prompt。先查询有哪些可用，用到时才调用。

需要浏览器 → 加载 Playwright MCP。需要操控桌面 → 加载 computer-use MCP。天工坊市场一键安装更多。

**更多详情**：[MCP 生态系统文档](./docs/mcp-ecosystem.md)

### 🎨 Electron 桌面应用 — 可视化一切

- **React Flow 协作流程图**：实时看到 Agent 团队的协作过程
- **Cytoscape 知识图谱**：直观展示记忆和关系
- **React + TailwindCSS + shadcn/ui**：现代化界面

### 🔒 隐私与安全 — 数据完全在本地

- **数据本地存储**：所有对话、记忆、配置存储在本地，不上传任何服务器
- **API Key 加密**：LLM API Key 加密存储在本地
- **双层安全架构**：LLM 主动审计 + 硬编码安全守卫
- **无遥测**：默认不收集任何使用数据

---

## 璇玑能做什么

| 场景 | 具体能做 |
|------|---------|
| **知识分析与决策** | 读长篇文档、对比技术方案、分析报告，给出有论据的判断 |
| **跨会话记忆管家** | 记住偏好、重要日期、人际关系，信息存得住也连得上 |
| **自动化工作流** | 一句话需求 → 自动拆成多 Agent 流水线 → 完整交付 |
| **多媒体创作** | 剧本 → 定妆照 → 短剧视频，同一条对话全流程 |
| **社交媒体运营** | 浏览器自动登录、撰写内容、配图发布 |
| **群聊协作** | 飞书 Bot 加入群聊，理解上下文、指代消解 |
| **桌面自动化** | computer-use MCP 操控电脑桌面，操作任何没有 API 的软件 |

---

## 诚实地说，还有很多不足

贾维斯是电影里的终极形态。璇玑才刚刚起步。

模型推理能力还有天花板，复杂任务偶尔走偏。多 Agent 协作在极端场景还不够稳定。记忆图谱准确度会随数据量衰减。桌面客户端体验也有打磨空间。

但我们在持续迭代。每周都有新版本。欢迎来 GitHub 看看、提 issue、参与讨论。

---

## 下载

🌐 **https://shibit.net/download**

---

## 快速开始

### 环境要求

- **Node.js** >= 20.0.0
- **npm** >= 9.0.0
- **Git** (可选，用于工作区隔离)

### 安装

```bash
git clone https://github.com/shibit-net/xuanji.git
cd xuanji
npm install
```

### 配置

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."

# 或使用自定义端点
export XUANJI_BASE_URL="https://your-api-endpoint.com"
export XUANJI_MODEL="claude-sonnet-4-6"
```

### 运行

```bash
npm run dev:gui          # 桌面应用（推荐）
npm run build:gui:mac    # 构建 macOS
npm run build:gui:win    # 构建 Windows
npm run dev              # 命令行开发模式
```

---

## 内置智能体

| 智能体 | 角色 | 说明 |
|--------|------|------|
| **xuanji** | 主智能体 | 唯一面向用户的智能体，40+ 工具 |
| **scene-classifier** | 分类器 | 意图分析，将用户输入分类为场景+复杂度 |
| **memory-manager** | 记忆管理 | 分析对话，提取并维护长期记忆 |
| **context-compressor** | 压缩器 | 将长对话历史压缩为结构化摘要 |
| **software-engineer** | 工程师 | 代码编写与调试 |
| **product-manager** | 产品经理 | 需求分析与产品规划 |
| **ui-designer** | 设计师 | UI/UX 设计 |

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **语言** | TypeScript 5.7+ (ESM, ES2022) |
| **运行时** | Node.js 20+ |
| **LLM SDK** | @anthropic-ai/sdk, openai, node-llama-cpp |
| **数据库** | better-sqlite3 |
| **桌面** | Electron 40+, React 18, TailwindCSS, shadcn/ui |
| **可视化** | React Flow, Cytoscape |
| **代码分析** | tree-sitter (TS/Python/Java) |

---

## 相关文档

- **同类品对比分析**：[docs/xuanji-vs-openclaw-vs-hermes-agent.md](./docs/xuanji-vs-openclaw-vs-hermes-agent.md)
- **多智能体协作系统**：[docs/multi-agent-system.md](./docs/multi-agent-system.md)
- **记忆驱动学习系统**：[docs/memory-system.md](./docs/memory-system.md)
- **分层提示词系统**：[docs/layered-prompt-system.md](./docs/layered-prompt-system.md)
- **MCP 生态系统**：[docs/mcp-ecosystem.md](./docs/mcp-ecosystem.md)
- **应用场景**：[docs/use-cases.md](./docs/use-cases.md)

---

## 联系方式

- **邮箱**：shibit_office@shibit.net
- **企业微信**：https://work.weixin.qq.com/ca/cawcde6fa830e97aad
- **GitHub**：https://github.com/shibit-net/xuanji

---

## 许可证

GNU Affero General Public License v3.0 with Commons Clause — 详见 [LICENSE](LICENSE)
