# OpenClaw Skill 兼容性设计

## OpenClaw Skill 格式

根据官方文档（[OpenClaw Skills](https://docs.openclaw.ai/tools/skills), [ClawHub Skill Format](https://github.com/openclaw/clawhub/blob/main/docs/skill-format.md)），OpenClaw Skill 的结构如下：

### 目录结构

```
my-skill/
├── skill.md           # 必需：YAML frontmatter + Markdown 指令
├── run.sh             # 可选：可执行脚本
├── utils.py           # 可选：辅助脚本
└── config.json        # 可选：配置文件
```

### skill.md 格式

```markdown
---
name: todoist-cli
description: "Manage Todoist tasks, projects, and labels from the command line."
version: 1.2.0
metadata:
  openclaw:
    requires:
      env:
        - TODOIST_API_KEY
      bins:
        - curl
      anyBins:
        - jq
        - fx
    primaryEnv: TODOIST_API_KEY
    emoji: "✅"
    homepage: https://github.com/example/todoist-cli
    user-invocable: true
    disable-model-invocation: false
---

# Todoist CLI Skill

Use this skill to manage Todoist tasks.

## When to use

- User asks to "add a task to Todoist"
- User wants to list tasks
- User needs to create a project

## How to use

Call the todoist CLI:

```bash
curl -X POST "https://api.todoist.com/rest/v2/tasks" \
  -H "Authorization: Bearer $TODOIST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "Task name"}'
```

## Important notes

- Always check if TODOIST_API_KEY is set
- Use proper error handling
```

### 关键字段说明

| 字段 | 必需 | 说明 |
|------|------|------|
| `name` | ✅ | Skill 名称 |
| `description` | ✅ | 简短描述 |
| `version` | ✅ | 语义版本 |
| `metadata.openclaw.requires.env` | ❌ | 必需的环境变量 |
| `metadata.openclaw.requires.bins` | ❌ | 必需的 CLI 工具（全部） |
| `metadata.openclaw.requires.anyBins` | ❌ | 必需的 CLI 工具（至少一个） |
| `metadata.openclaw.primaryEnv` | ❌ | 主要凭证环境变量 |
| `metadata.openclaw.user-invocable` | ❌ | 是否作为斜杠命令（默认 true） |
| `metadata.openclaw.disable-model-invocation` | ❌ | 是否排除在 LLM prompt 外（默认 false） |

## 兼容方案

### 核心思路

**OpenClaw Skill → Xuanji Skill 适配器**

```
OpenClaw Skill (skill.md + scripts)
         ↓ OpenClawSkillLoader
Xuanji Skill (统一接口)
```

### 1. OpenClawSkillLoader

```typescript
// src/core/skills/loaders/OpenClawSkillLoader.ts

import type { Skill, SkillContext, SkillResult } from '@/core/skills/types';
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * OpenClaw Skill 元数据
 */
interface OpenClawSkillMeta {
  name: string;
  description: string;
  version: string;
  metadata?: {
    openclaw?: {
      requires?: {
        env?: string[];
        bins?: string[];
        anyBins?: string[];
      };
      primaryEnv?: string;
      emoji?: string;
      homepage?: string;
      'user-invocable'?: boolean;
      'disable-model-invocation'?: boolean;
    };
  };
}

/**
 * 解析后的 skill.md
 */
interface ParsedSkillMd {
  meta: OpenClawSkillMeta;
  content: string; // Markdown 正文
}

/**
 * OpenClaw Skill 加载器
 */
export class OpenClawSkillLoader {
  private log = logger.child({ module: 'OpenClawSkillLoader' });

  /**
   * 从目录加载 OpenClaw Skill
   * @param skillDir Skill 目录路径
   * @returns Xuanji Skill
   */
  async load(skillDir: string): Promise<Skill | null> {
    try {
      // 1. 检查 skill.md 是否存在
      const skillMdPath = path.join(skillDir, 'skill.md');
      const skillMdExists = await this.fileExists(skillMdPath);

      if (!skillMdExists) {
        this.log.warn(`${skillDir} 中未找到 skill.md`);
        return null;
      }

      // 2. 解析 skill.md
      const parsed = await this.parseSkillMd(skillMdPath);

      // 3. 检查依赖
      const depsCheck = await this.checkDependencies(parsed.meta);
      if (!depsCheck.satisfied) {
        this.log.warn(`Skill ${parsed.meta.name} 依赖不满足: ${depsCheck.missing.join(', ')}`);
        return null;
      }

      // 4. 检查是否有可执行脚本
      const executablePath = await this.findExecutable(skillDir);

      // 5. 判断 Skill 模式
      const mode = this.determineMode(parsed, executablePath);

      // 6. 转换为 Xuanji Skill
      return this.convertToXuanjiSkill(parsed, executablePath, mode, skillDir);
    } catch (err) {
      this.log.error(`加载 OpenClaw Skill 失败: ${skillDir}`, err);
      return null;
    }
  }

  /**
   * 批量加载目录下的所有 OpenClaw Skills
   * @param baseDir 基础目录（如 ~/.xuanji/skills/openclaw）
   * @returns Skill 数组
   */
  async loadAll(baseDir: string): Promise<Skill[]> {
    const skills: Skill[] = [];

    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = path.join(baseDir, entry.name);
        const skill = await this.load(skillDir);

        if (skill) {
          skills.push(skill);
        }
      }
    } catch (err) {
      this.log.error(`批量加载失败: ${baseDir}`, err);
    }

    return skills;
  }

  /**
   * 解析 skill.md
   */
  private async parseSkillMd(filePath: string): Promise<ParsedSkillMd> {
    const content = await fs.readFile(filePath, 'utf-8');

    // 提取 YAML frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!match) {
      throw new Error('skill.md 格式错误：缺少 YAML frontmatter');
    }

    const [, yamlStr, markdownContent] = match;
    const meta = yaml.parse(yamlStr) as OpenClawSkillMeta;

    // 验证必需字段
    if (!meta.name || !meta.description || !meta.version) {
      throw new Error('skill.md 缺少必需字段: name, description, version');
    }

    return { meta, content: markdownContent.trim() };
  }

  /**
   * 检查依赖是否满足
   */
  private async checkDependencies(meta: OpenClawSkillMeta): Promise<{
    satisfied: boolean;
    missing: string[];
  }> {
    const missing: string[] = [];
    const requires = meta.metadata?.openclaw?.requires;

    if (!requires) {
      return { satisfied: true, missing: [] };
    }

    // 检查环境变量
    if (requires.env) {
      for (const envVar of requires.env) {
        if (!process.env[envVar]) {
          missing.push(`env:${envVar}`);
        }
      }
    }

    // 检查二进制（全部必需）
    if (requires.bins) {
      for (const bin of requires.bins) {
        const exists = await this.binExists(bin);
        if (!exists) {
          missing.push(`bin:${bin}`);
        }
      }
    }

    // 检查二进制（至少一个）
    if (requires.anyBins && requires.anyBins.length > 0) {
      const anyExists = await Promise.all(requires.anyBins.map((b) => this.binExists(b)));
      if (!anyExists.some((e) => e)) {
        missing.push(`anyBin:${requires.anyBins.join('|')}`);
      }
    }

    return {
      satisfied: missing.length === 0,
      missing,
    };
  }

  /**
   * 查找可执行脚本
   */
  private async findExecutable(skillDir: string): Promise<string | null> {
    const candidates = ['run.sh', 'run.py', 'run.js', 'run.ts', 'execute.sh', 'execute'];

    for (const candidate of candidates) {
      const filePath = path.join(skillDir, candidate);
      if (await this.fileExists(filePath)) {
        // 检查是否可执行
        try {
          await fs.access(filePath, fs.constants.X_OK);
          return filePath;
        } catch {
          // 不可执行，跳过
        }
      }
    }

    return null;
  }

  /**
   * 判断 Skill 模式
   */
  private determineMode(
    parsed: ParsedSkillMd,
    executablePath: string | null
  ): 'prompt' | 'action' | 'hybrid' {
    const hasInstructions = parsed.content.length > 0;
    const hasExecutable = executablePath !== null;
    const disableModelInvocation = parsed.meta.metadata?.openclaw?.['disable-model-invocation'];

    if (disableModelInvocation) {
      // 明确排除在 LLM prompt 外，只能是 Action
      return 'action';
    }

    if (hasExecutable && hasInstructions) {
      return 'hybrid'; // 既有指令又有脚本
    }

    if (hasExecutable) {
      return 'action'; // 只有脚本
    }

    return 'prompt'; // 只有指令
  }

  /**
   * 转换为 Xuanji Skill
   */
  private convertToXuanjiSkill(
    parsed: ParsedSkillMd,
    executablePath: string | null,
    mode: 'prompt' | 'action' | 'hybrid',
    skillDir: string
  ): Skill {
    const { meta, content } = parsed;
    const userInvocable = meta.metadata?.openclaw?.['user-invocable'] ?? true;

    return {
      id: `openclaw-${meta.name}`,
      name: meta.name,
      description: meta.description,
      version: meta.version,
      tags: ['openclaw', mode],
      author: 'OpenClaw Community',

      config: {
        source: 'custom',
        priority: 5,
        requiredTools: [],
      },

      // 如果 user-invocable=true，注册斜杠命令
      slashCommand: userInvocable ? `/${meta.name}` : undefined,

      // 统一的 execute 方法
      execute: async (context: SkillContext): Promise<SkillResult> => {
        switch (mode) {
          case 'prompt':
            return this.executePromptMode(content, context);

          case 'action':
            return this.executeActionMode(executablePath!, context, meta);

          case 'hybrid':
            return this.executeHybridMode(content, executablePath!, context, meta);

          default:
            return { type: 'action', success: false, error: '未知模式' };
        }
      },
    };
  }

  /**
   * 执行 Prompt 模式
   */
  private async executePromptMode(
    content: string,
    context: SkillContext
  ): Promise<SkillResult> {
    return {
      type: 'prompt',
      success: true,
      output: content,
      needsLLM: true,
    };
  }

  /**
   * 执行 Action 模式
   */
  private async executeActionMode(
    executablePath: string,
    context: SkillContext,
    meta: OpenClawSkillMeta
  ): Promise<SkillResult> {
    try {
      // 准备环境变量
      const env = { ...process.env };

      // 传递用户输入作为参数
      const args = [context.userInput];

      // 执行脚本
      const { stdout, stderr } = await execFileAsync(executablePath, args, {
        cwd: context.cwd,
        env,
        timeout: 60000, // 60s 超时
      });

      return {
        type: 'action',
        success: true,
        output: stdout || stderr,
        needsLLM: false,
        metadata: { executablePath },
      };
    } catch (err: any) {
      return {
        type: 'action',
        success: false,
        error: `执行失败: ${err.message}\n${err.stderr || ''}`,
        needsLLM: false,
      };
    }
  }

  /**
   * 执行 Hybrid 模式
   */
  private async executeHybridMode(
    content: string,
    executablePath: string,
    context: SkillContext,
    meta: OpenClawSkillMeta
  ): Promise<SkillResult> {
    try {
      // 1. 先执行脚本获取数据
      const env = { ...process.env };
      const args = [context.userInput];

      const { stdout, stderr } = await execFileAsync(executablePath, args, {
        cwd: context.cwd,
        env,
        timeout: 60000,
      });

      // 2. 将脚本输出和 Markdown 指令组合
      const combinedOutput = `${content}\n\n## 执行结果\n\n\`\`\`\n${stdout || stderr}\n\`\`\``;

      return {
        type: 'hybrid',
        success: true,
        output: combinedOutput,
        needsLLM: true,
        metadata: { executablePath, scriptOutput: stdout },
      };
    } catch (err: any) {
      // 脚本执行失败，降级为 Prompt 模式
      return {
        type: 'prompt',
        success: true,
        output: `${content}\n\n> ⚠️ 脚本执行失败: ${err.message}`,
        needsLLM: true,
      };
    }
  }

  // ========== 工具方法 ==========

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async binExists(bin: string): Promise<boolean> {
    try {
      await execFileAsync('which', [bin], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}
```

### 2. SkillRegistry 集成

```typescript
// src/core/skills/registry.ts

import { OpenClawSkillLoader } from './loaders/OpenClawSkillLoader';

export class SkillRegistry {
  private openclawLoader = new OpenClawSkillLoader();

  /**
   * 加载 OpenClaw Skills
   */
  async loadOpenClawSkills(): Promise<void> {
    // 三级加载优先级（和 OpenClaw 一致）
    const paths = [
      path.join(process.cwd(), 'skills'),           // 1. 项目级（最高优先级）
      path.join(os.homedir(), '.xuanji/skills'),    // 2. 用户级
      path.join(__dirname, '../skills/openclaw'),   // 3. 内置级（最低）
    ];

    let totalLoaded = 0;

    for (const basePath of paths) {
      const skills = await this.openclawLoader.loadAll(basePath);

      for (const skill of skills) {
        // 如果同名 Skill 已存在，跳过（优先级低的不覆盖优先级高的）
        if (this.skills.has(skill.id)) {
          this.log.debug(`Skill ${skill.id} 已存在，跳过`);
          continue;
        }

        this.register(skill);
        totalLoaded++;
      }
    }

    this.log.info(`从 OpenClaw 加载了 ${totalLoaded} 个 Skill`);
  }

  /**
   * 初始化时调用
   */
  async init(): Promise<void> {
    // 加载内置 Skill
    await this.loadBuiltinSkills();

    // 加载 OpenClaw Skill
    await this.loadOpenClawSkills();

    // 从经验教训加载 Skill
    if (this.lessonStore) {
      await this.loadSkillsFromLessons(this.lessonStore);
    }
  }
}
```

### 3. 斜杠命令支持

```typescript
// src/core/chat/ChatSession.ts

async handleUserCommand(input: string): Promise<boolean> {
  if (!input.startsWith('/')) return false;

  const [cmd, ...args] = input.slice(1).split(/\s+/);

  // 检查是否是 Skill 斜杠命令
  const skill = this.skillRegistry.findBySlashCommand(`/${cmd}`);

  if (skill) {
    this.log.info(`执行 Skill 斜杠命令: /${cmd}`);

    const context: SkillContext = {
      userInput: args.join(' '),
      cwd: process.cwd(),
      tools: this.toolRegistry,
      messageHistory: this.agentLoop.getMessageHistory(),
    };

    const result = await skill.execute(context);

    // 根据结果类型处理
    if (result.type === 'prompt' || result.type === 'hybrid') {
      // 将输出添加到上下文，继续调用 LLM
      await this.agentLoop.run(result.output!);
    } else if (result.type === 'action') {
      // 直接显示结果
      this.emit('text', result.output || '');
    }

    return true;
  }

  // 继续处理其他内置命令...
  return false;
}
```

## 使用示例

### 1. 安装 OpenClaw Skill

```bash
# 创建 OpenClaw Skill 目录
mkdir -p ~/.xuanji/skills/todoist-cli

# 创建 skill.md
cat > ~/.xuanji/skills/todoist-cli/skill.md << 'EOF'
---
name: todoist-cli
description: "Manage Todoist tasks from the command line."
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - TODOIST_API_KEY
      bins:
        - curl
    primaryEnv: TODOIST_API_KEY
    user-invocable: true
---

# Todoist CLI

Use this skill to manage Todoist tasks.

## Commands

- Add task: `curl -X POST ...`
- List tasks: `curl -X GET ...`
EOF

# 创建可执行脚本
cat > ~/.xuanji/skills/todoist-cli/run.sh << 'EOF'
#!/bin/bash
# 添加任务到 Todoist

TASK_CONTENT="$1"

curl -X POST "https://api.todoist.com/rest/v2/tasks" \
  -H "Authorization: Bearer $TODOIST_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"content\": \"$TASK_CONTENT\"}"
EOF

chmod +x ~/.xuanji/skills/todoist-cli/run.sh
```

### 2. 使用 Skill

```bash
# 方式 1: 斜杠命令（直接执行）
/todoist-cli "买牛奶"

# 方式 2: 自然语言（LLM 调用）
> 帮我添加一个 Todoist 任务：买牛奶

# Xuanji 会：
# 1. 识别意图
# 2. 加载 todoist-cli Skill
# 3. 执行脚本
# 4. 返回结果
```

### 3. 从 ClawHub 下载 Skill

```bash
# 下载社区 Skill
xuanji skill install https://clawhub.com/skills/database-query

# 查看已安装的 OpenClaw Skills
xuanji skill list --source=openclaw

# 更新 Skill
xuanji skill update todoist-cli
```

## 兼容性矩阵

| OpenClaw 特性 | Xuanji 支持 | 实现方式 |
|---------------|-------------|----------|
| skill.md YAML frontmatter | ✅ 完全兼容 | yaml 库解析 |
| Markdown 指令 | ✅ 完全兼容 | Prompt Mode |
| 可执行脚本 | ✅ 完全兼容 | Action/Hybrid Mode |
| 环境变量依赖 | ✅ 完全兼容 | 启动前检查 |
| 二进制依赖 | ✅ 完全兼容 | which 检查 |
| 斜杠命令 | ✅ 完全兼容 | user-invocable 字段 |
| 排除 LLM prompt | ✅ 完全兼容 | disable-model-invocation |
| 三级加载优先级 | ✅ 完全兼容 | 项目 > 用户 > 内置 |
| ClawHub 生态 | 🔄 部分兼容 | 需手动下载 |

## 优势

### 1. 生态互通

- ✅ 可以直接使用 ClawHub 上的 2,857+ Skills
- ✅ 无需修改 OpenClaw Skill，开箱即用
- ✅ 支持社区最佳实践

### 2. 统一体验

- ✅ OpenClaw Skill 和 Xuanji Skill 使用同一个接口
- ✅ 用户无需区分来源，统一调用
- ✅ 统一的管理和监控

### 3. 灵活扩展

- ✅ 支持纯 Prompt 的 OpenClaw Skill
- ✅ 支持纯 Action 的可执行脚本
- ✅ 支持 Hybrid 混合模式

## 实施计划

### Phase 1: OpenClawSkillLoader（2天）

- [ ] 实现 YAML frontmatter 解析
- [ ] 实现依赖检查（env, bins, anyBins）
- [ ] 实现可执行脚本查找
- [ ] 实现三种模式判断
- [ ] 单元测试

### Phase 2: SkillRegistry 集成（1天）

- [ ] 实现 loadOpenClawSkills()
- [ ] 实现三级优先级加载
- [ ] 实现同名 Skill 覆盖逻辑
- [ ] 集成测试

### Phase 3: 斜杠命令支持（0.5天）

- [ ] ChatSession.handleUserCommand() 支持 Skill 斜杠命令
- [ ] 根据 user-invocable 字段注册命令
- [ ] 端到端测试

### Phase 4: Skill 管理命令（1天）

- [ ] `/skill install <url>` - 从 URL 安装
- [ ] `/skill list` - 列出所有 Skill
- [ ] `/skill update <name>` - 更新 Skill
- [ ] `/skill remove <name>` - 删除 Skill

### Phase 5: 文档和示例（0.5天）

- [ ] OpenClaw Skill 兼容性文档
- [ ] 从 ClawHub 安装 Skill 教程
- [ ] 创建 2-3 个示例 Skill

**总计：5天**

## 总结

### 核心优势

1. ✅ **完全兼容 OpenClaw**：无需修改，直接加载
2. ✅ **统一接口**：OpenClaw Skill 和 Xuanji Skill 都是 `Skill` 接口
3. ✅ **生态共享**：ClawHub 2,857+ Skills 可用
4. ✅ **零学习成本**：OpenClaw 用户无缝迁移

### 技术亮点

- **智能模式判断**：根据文件内容自动选择 Prompt/Action/Hybrid
- **依赖检查**：启动前验证环境变量和二进制
- **三级优先级**：项目 > 用户 > 内置，和 OpenClaw 一致
- **斜杠命令**：支持 user-invocable 字段

---

**参考资料**：
- [OpenClaw Skills Documentation](https://docs.openclaw.ai/tools/skills)
- [ClawHub Skill Format](https://github.com/openclaw/clawhub/blob/main/docs/skill-format.md)
- [OpenClaw Custom Skill Creation Guide](https://zenvanriel.com/ai-engineer-blog/openclaw-custom-skill-creation-guide/)
- [What are OpenClaw Skills?](https://www.digitalocean.com/resources/articles/what-are-openclaw-skills)

**设计完成时间**：2026-03-15
**设计者**：Claude（Anthropic）+ 用户协作
**项目**：Shibit Xuanji 璇玑
