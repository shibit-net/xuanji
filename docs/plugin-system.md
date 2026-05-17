# Xuanji MCP & Skill 安装机制

---

## 1. 搜索外部来源

xuanji 需要知道去哪里找可安装的 MCP server 和 Skill。这部分由一个外部搜索接口提供，xuanji 内部不实现具体搜索逻辑。

### 1.1 外部搜索接口（待接入）

```typescript
/**
 * 外部搜索接口 — 由调用方实现
 *
 * 搜索可安装的 MCP server 和 Skill。
 * 实现方可以是：
 * - 自建 registry 服务
 * - GitHub API 封装
 * - npm registry 搜索
 * - MCP 市场聚合（Smithery、mcp.so 等）
 */
export interface PluginSearchService {
  /**
   * 搜索 MCP server
   * @param query 用户描述（如 "PostgreSQL 数据库管理"）
   * @returns 候选列表，按 confidence 降序排列
   */
  searchMcp(query: string): Promise<McpCandidate[]>;

  /**
   * 搜索 Skill
   * @param query 用户描述（如 "代码审查"）
   * @returns 候选列表
   */
  searchSkill(query: string): Promise<SkillCandidate[]>;

  /**
   * 获取 MCP server 的详细安装信息
   */
  getMcpDetail(id: string): Promise<McpDetail | null>;

  /**
   * 获取 Skill 的详细安装信息
   */
  getSkillDetail(id: string): Promise<SkillDetail | null>;
}

// ─── 类型定义 ─────────────────────────────────────

export interface McpCandidate {
  id: string;                // 唯一标识
  name: string;              // 显示名称
  description: string;       // 描述
  source: string;            // 来源标记（'npm' | 'github' | 'smithery' | ...）
  installType: 'npx' | 'smithery' | 'docker' | 'binary';
  installCommand: string;    // 安装命令或路径
  confidence: number;        // 0-1，匹配度
  tags?: string[];
}

export interface McpDetail extends McpCandidate {
  serverConfig: {
    transport: 'stdio' | 'http' | 'sse';
    command: string;
    args: string[];
    env?: Record<string, string>;
    url?: string;
  };
  tools: Array<{ name: string; description: string }>;
  readme?: string;
}

export interface SkillCandidate {
  id: string;
  name: string;
  description: string;
  source: string;
  downloadUrl: string;       // YAML 文件下载地址
  confidence: number;
  version: string;
  tags?: string[];
}

export interface SkillDetail extends SkillCandidate {
  content: string;           // Skill 的完整 YAML 内容
  readme?: string;
}
```

---

## 2. InstallTool 完整实现

```typescript
export class InstallTool extends BaseTool {
  readonly name = 'install';
  readonly description = [
    '安装新能力到 xuanji',
    '',
    '安装 MCP server → 获得新的工具（如查数据库、调地图、读写文件）',
    '安装 skill → 获得新的技能（如代码审查、项目脚手架、工作流）',
    '',
    'xuanji 会自动搜索可安装的 MCP server 和 Skill',
    '',
    '示例：',
    '- install("PostgreSQL 数据库") → 搜索并安装 MCP server',
    '- install("帮我写一个代码审查 skill") → 自动生成 skill',
  ].join('\n');

  readonly input_schema = {
    type: 'object',
    properties: {
      goal: { type: 'string', description: '想安装的能力描述' },
      source: {
        type: 'string',
        enum: ['auto', 'github', 'npm', 'smithery', 'local'],
        description: '搜索来源（默认 auto 全部搜索）',
        default: 'auto',
      },
      type: {
        type: 'string',
        enum: ['auto', 'mcp', 'skill'],
        description: '安装类型（默认 auto 自动识别）',
        default: 'auto',
      },
    },
    required: ['goal'],
  };

  constructor(
    private searchService: PluginSearchService,
    private mcpManager: MCPManager,
    private skillRegistry: SkillRegistry,
    private learnTool: LearnTool,
    private configManager: ConfigManager,
  ) { super(); }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const goal = input.goal as string;
    const sourceType = (input.source as string) || 'auto';
    const installType = (input.type as string) || 'auto';

    // ── 阶段 1：搜索候选 ──
    await this.emitProgress(`正在搜索「${goal}」…`);

    const candidates = installType !== 'skill'
      ? await this.searchService.searchMcp(goal)
      : [];
    const skillCandidates = installType !== 'mcp'
      ? await this.searchService.searchSkill(goal)
      : [];

    // ── 阶段 2：选择最优候选 ──
    const bestMcp = candidates[0];
    const bestSkill = skillCandidates[0];

    // 优先选 confidence 高的
    if (bestMcp && (!bestSkill || bestMcp.confidence >= bestSkill.confidence)) {
      return await this.installMcp(bestMcp);
    }

    if (bestSkill) {
      return await this.installSkill(bestSkill);
    }

    // ── 阶段 3：没有现成的 → 走 learn 流程 ──
    await this.emitProgress('没有找到现成的，xuanji 正在自己学习…');
    const learnResult = await this.learnTool.execute({
      goal,
      depth: 'moderate',
    });

    return learnResult;
  }

  // ── 安装 MCP Server ──

  private async installMcp(candidate: McpCandidate): Promise<ToolResult> {
    const serverName = this.generateServerName(candidate.name);

    await this.emitProgress(`正在安装 MCP server: ${candidate.name}…`);

    // 1. 构建 MCP server 配置
    const serverConfig = this.buildServerConfig(candidate, serverName);

    // 2. 写入 mcp.json
    await this.addServerToConfig(serverConfig);

    // 3. 注册到 MCPManager（即时生效）
    await this.mcpManager.addServer(serverConfig);

    // 4. 等待 MCPClient 连接并发现 tools
    await this.emitProgress('正在连接并发现工具…');
    await this.delay(2000);

    // 5. 获取已注册的工具列表
    const tools = await this.mcpManager.listServerTools(serverName);

    // 6. 生成安装报告
    const toolList = tools.map(t => `  - ${t.name}: ${t.description}`).join('\n');

    return this.success([
      `## ✅ 已安装: ${candidate.name}`,
      '',
      `来源: ${candidate.source}`,
      `安装命令: ${candidate.installCommand}`,
      '',
      `已注册 ${tools.length} 个工具:`,
      toolList,
      '',
      '需要配置 API key 吗？部分 MCP server 需要环境变量。',
      '配置方式：将环境变量添加到 ~/.xuanji/users/{userId}/mcp.json 的 env 字段。',
    ].join('\n'), {
      installed: {
        type: 'mcp',
        name: candidate.name,
        serverName,
        toolCount: tools.length,
        configPath: `${this.configManager.getUserConfigDir()}/mcp.json`,
      },
    });
  }

  /**
   * 写入 mcp.json 并热加载
   */
  private async addServerToConfig(config: MCPServerConfig): Promise<void> {
    const mcpPath = path.join(this.configManager.getUserConfigDir(), 'mcp.json');

    // 读取现有配置
    let mcpConfig: MCPConfig = { servers: [] };
    try {
      mcpConfig = JSON.parse(await readFile(mcpPath));
    } catch { /* 文件可能不存在 */ }

    // 检查是否已存在同名 server
    mcpConfig.servers = mcpConfig.servers.filter(s => s.name !== config.name);

    // 追加新 server
    mcpConfig.servers.push(config);

    // 写入
    await writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2));
  }

  /**
   * 根据候选生成 MCPServerConfig
   */
  private buildServerConfig(candidate: McpCandidate, serverName: string): MCPServerConfig {
    if (candidate.installType === 'npx') {
      // npx 模式：@xxx/mcp-server
      const [cmd, ...args] = candidate.installCommand.split(' ');
      return {
        name: serverName,
        transport: 'stdio',
        command: cmd,
        args: args,
        env: {},  // 用户自行配置
      };
    }

    if (candidate.installType === 'smithery') {
      // Smithery 提供安装命令
      return {
        name: serverName,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', candidate.name],
        env: {},
      };
    }

    // GitHub repo：通过 npx 或直接 clone
    if (candidate.source === 'github') {
      return {
        name: serverName,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', candidate.name],
        env: {},
      };
    }

    throw new Error(`不支持的安装类型: ${candidate.installType}`);
  }

  // ── 安装 Skill ──

  private async searchSkills(query: string, sourceType: string): Promise<SkillCandidate[]> {
    // Skill 来源：
    // 1. GitHub awesome-skills 列表
    // 2. 社区分享的 YAML
    // 3. web 搜索 "xuanji skill" / "ai agent skill"
    // 当前版本优先用 learn 生成
    return [];
  }

  private async installSkill(candidate: SkillCandidate): Promise<ToolResult> {
    // TODO: Skill 安装实现
    return this.success(`Skill 安装功能开发中…`);
  }
}
```

---

## 3. 持久化配置

### 3.1 mcp.json 的最终结构

```json
{
  "servers": [
    {
      "name": "postgres-db",
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-postgres"],
      "env": {
        "POSTGRES_HOST": "localhost",
        "POSTGRES_DB": "mydb"
      }
    },
    {
      "name": "amap-maps",
      "command": "node",
      "args": ["${XUANJI_DATA}/mcps/amap-mcp/server.js"],
      "transport": "http",
      "httpUrl": "http://localhost:9877/mcp",
      "env": {
        "AMAP_API_KEY": "${AMAP_API_KEY}"
      }
    }
  ]
}
```

### 3.2 用户安装插件的目录结构

```
~/.xuanji/users/{userId}/
├── mcp.json                       ← 主配置（所有 MCP server 列表）
├── mcps/                          ← 生成的 MCP server 源码
│   └── amap-mcp/
│       └── server.js
├── skills/
│   ├── installed/                 ← 从社区安装的 skill（YAML）
│   │   └── review-pr.yaml
│   └── learned/                   ← xuanji 自学的 skill
│       └── springboot-project.yaml
└── registry/                      ← 搜索索引缓存
    ├── mcp-index.json
    └── skill-index.json
```

### 3.3 热加载机制

MCPManager 的 `addServer()` 应该支持运行时添加：

```typescript
// MCPManager 新增方法
async addServer(config: MCPServerConfig): Promise<void> {
  if (this.clients.has(config.name)) {
    log.warn(`Server ${config.name} already exists, skipping`);
    return;
  }

  // 新建并启动 client（复用 _doInitialize 中的创建逻辑）
  const client = this.createClient(config);
  this.clients.set(config.name, client);

  // 通知外部
  this.onToolsChanged?.(config.name);
}
```

启动时 `MCPManager.initialize()` 从 `mcp.json` 加载全部，运行时通过 `addServer()` 新增的不需要重启。

---

## 4. InstallTool 在 xuanji 配置文件中的声明

```yaml
# ~/.xuanji/users/{userId}/agents/xuanji.yaml 或 tools 列表
tools:
  # ... 现有工具 ...
  - name: install
    required: false
    description: 安装 MCP 服务或技能到 xuanji
```

  Agent 看到这个 tool 后，当用户说"装一个 PostgreSQL 工具"时自动调用。

---

## 5. 学习生成的 Skill 怎么处理

外部安装的 skill 和 learn 生成的 skill，生命周期不同但最终去向一样。

### 5.1 两种入口

```
入口 A: install("代码审查 skill")
  → 搜索 → 找到现成的 review-pr.yaml
  → 复制到 skills/installed/
  → SkillLoader 加载 → SkillRegistry.register()

入口 B: learn("SpringBoot 项目脚手架")
  → 搜索 → 没找到现成
  → LLM 搜索 + 提取 + 生成 skill 定义
  → 立即 SkillRegistry.register()    ← 即时可用
  → 异步写入 skills/learned/xxx.yaml ← 持久化
```

### 5.2 LearnTool 的 Skill 持久化

```typescript
// LearnTool 中生成 skill 后
async createSkillFromLearning(plan, merged): Promise<void> {
  const skill = await this.buildSkill(plan, merged);

  // 1. 立即注册（当前进程立即可用）
  this.skillRegistry.register(skill);

  // 2. 异步持久化（重启后可恢复）
  const filePath = path.join(
    this.userSkillsDir, 'learned', `${skill.id}.yaml`
  );
  const yaml = stringifyYAML({
    id: skill.id,
    name: skill.name,
    version: '1.0.0',
    description: skill.description,
    category: skill.category,
    tags: skill.tags,
    content: skill.content,
    parameters: skill.parameters,
    requiredTools: skill.requiredTools,
    source: 'learn_tool',
    learnedAt: new Date().toISOString(),
  });
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, yaml);

  // 3. 记录到记忆库
  await this.memoryManager.storeFact({
    title: `Skill: ${skill.name}`,
    content: `自动学习生成的技能，已注册到 SkillRegistry。skill_id: ${skill.id}`,
    source: 'learn_tool',
    scene_tag: '开发',
  });
}
```

### 5.3 启动时加载

```typescript
// SkillLoader 初始化时
async load(options: SkillLoadOptions): Promise<void> {
  // 1. 加载内置 skill（不变）
  if (loadBuiltin) await this.loadBuiltinSkills();

  // 2. 加载用户自定义 skill（不变）
  if (loadCustom) await this.loadCustomSkills(customPath);

  // 3. 加载已安装的社区 skill ← 新增
  await this.loadSkillsFromDirectory(
    path.join(customPath, 'installed')
  );

  // 4. 加载学习的 skill ← 新增
  await this.loadSkillsFromDirectory(
    path.join(customPath, 'learned')
  );
}
```

### 5.4 用户对 learn 生成的 Skill 不满意怎么办

用户使用一次后纠正，Agent 自动更新 skill：

```typescript
// 用户纠正时
if (correction.topic.includes(skill.id)) {
  // 1. 更新 SkillRegistry 中的内容
  skillRegistry.update(skill.id, { content: updatedContent });

  // 2. 更新磁盘上的文件
  const filePath = path.join(userSkillsDir, 'learned', `${skill.id}.yaml`);
  const yaml = parseYAML(await readFile(filePath));
  yaml.content = updatedContent;
  yaml.version = '1.0.1';
  yaml.updatedAt = new Date().toISOString();
  await writeFile(filePath, stringifyYAML(yaml));

  // 3. 记录版本变更
  await memoryManager.storeFact({
    title: `Skill 已更新: ${skill.name}`,
    content: `用户纠错后自动更新，版本 ${yaml.version}`,
    source: 'user_correction',
  });
}
```

### 5.5 用户不想用这个 skill 了

```typescript
// uninstall tool（或 agent 调用 disable）
async disableSkill(skillId: string): Promise<void> {
  // 1. 从 SkillRegistry 卸载
  this.skillRegistry.unregister(skillId);

  // 2. 从磁盘移动（不是删除，保留恢复可能）
  const src = path.join(userSkillsDir, 'learned', `${skillId}.yaml`);
  const dst = path.join(userSkillsDir, 'disabled', `${skillId}.yaml`);
  await mkdir(path.dirname(dst), { recursive: true });
  await rename(src, dst);

  // 3. 记录
  await memoryManager.storeFact({
    title: `Skill 已禁用: ${skillId}`,
    content: `用户禁用了该技能，文件已移至 disabled/ 目录`,
    source: 'user_action',
  });
}
```
