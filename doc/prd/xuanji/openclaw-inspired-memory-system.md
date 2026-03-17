# OpenClaw 启发的记忆系统架构升级

## 设计日期
2026-03-16

## 参考资料
- [OpenClaw Memory Documentation](https://docs.openclaw.ai/concepts/memory)
- [OpenClaw Hybrid Memory System Deep Dive](https://levelup.gitconnected.com/beyond-the-chat-how-openclaws-hybrid-memory-system-gives-ai-a-real-brain-11a622901106)
- [memsearch: OpenClaw's Open-Source Memory System](https://milvus.io/blog/we-extracted-openclaws-memory-system-and-opensourced-it-memsearch.md)
- [Local-First RAG with SQLite](https://www.pingcap.com/blog/local-first-rag-using-sqlite-ai-agent-memory-openclaw/)

---

## 核心设计理念对比

### OpenClaw 记忆系统特点

| 维度 | OpenClaw 设计 | 核心优势 |
|------|--------------|---------|
| **存储格式** | Markdown 文件（文件优先） | 人类可读、可编辑、透明 |
| **文件组织** | `~/clawd/memory/YYYY-MM-DD.md` | 日志式、时间线清晰 |
| **索引后端** | SQLite + sqlite-vec + FTS5 | 单文件、无服务器、可移植 |
| **混合搜索** | 向量 70% + BM25 30% | 语义 + 关键词平衡 |
| **记忆刷新** | 上下文接近压缩时自动触发 | 防止记忆丢失 |
| **版本控制** | Git 友好（Markdown） | 记忆演化可追溯 |
| **真相来源** | 文件系统（File as Source of Truth） | Agent 只保留磁盘内容 |

### Xuanji 当前架构

| 维度 | Xuanji 设计 | 限制 |
|------|------------|------|
| **存储格式** | JSONL（不透明） | 人类难以直接编辑 |
| **文件组织** | `~/.xuanji/memory.jsonl` | 单一文件，无分类 |
| **索引后端** | SQLite + sqlite-vec | ✓ 与 OpenClaw 一致 |
| **混合搜索** | 向量 50% + 关键词 20% + 时效 20% + 频次 10% | 向量权重偏低 |
| **记忆刷新** | Agent 主动调用 memory_store | 依赖 Prompt 引导 |
| **版本控制** | 不支持（二进制 JSONL） | 无法追溯演化 |
| **真相来源** | 数据库 + 文件 | 双重真相，可能不一致 |

---

## 设计目标

### 保留 Xuanji 优势
1. **Agent 主动记忆**：通过 System Prompt 引导，而非固定规则
2. **工具驱动**：显式调用 memory_store，用户可见
3. **遗忘曲线**：时效性评分，旧记忆自动衰减
4. **访问频次**：高频记忆权重提升

### 融合 OpenClaw 优势
1. **Markdown 文件优先**：透明、可编辑、Git 友好
2. **70/30 混合搜索**：提升向量搜索权重
3. **自动记忆刷新**：上下文压缩前主动归档
4. **文件分类组织**：日志/知识库/偏好分离
5. **FTS5 全文搜索**：替代简单关键词匹配

---

## 新架构设计

### 1. 文件组织结构

```
~/.xuanji/
├── memory/
│   ├── daily/                      # 日常对话日志（OpenClaw 风格）
│   │   ├── 2026-03-16.md
│   │   ├── 2026-03-15.md
│   │   └── ...
│   ├── knowledge/                  # 长期知识库（用户偏好、项目知识）
│   │   ├── user-preferences.md     # 用户偏好（工具、语言、风格）
│   │   ├── project-xuanji.md       # 项目知识（架构、约定、决策）
│   │   └── skills-learned.md       # 学到的技能和模式
│   ├── tasks/                      # 待办和计划
│   │   ├── active.md               # 进行中的任务
│   │   └── completed-2026-03.md    # 已完成任务（按月归档）
│   └── index.sqlite                # 向量和全文索引
└── .gitignore                      # 排除 index.sqlite
```

**设计说明**：
- **daily/**: 类似 OpenClaw 的日志式记录，按日期分文件
- **knowledge/**: 长期知识，人类可手动编辑和整理
- **tasks/**: 任务管理（可选，与 TodoTool 集成）
- **index.sqlite**: 仅作为索引，文件是真相来源

### 2. Markdown 格式规范

#### daily/2026-03-16.md

```markdown
# 2026-03-16 对话日志

## 09:30 - 记忆系统架构升级

**用户需求**：
参考 OpenClaw 的记忆系统，设计更优秀的技术方案。

**关键决策**：
- 采用 Markdown 文件优先的存储策略
- 调整混合搜索权重为 70/30（向量/BM25）
- 增加自动记忆刷新机制

**相关工具调用**：
- memory_store: 记录架构设计决策
- read_file: 分析现有 SessionManager 实现

**元数据**：
- Tags: #architecture #memory-system #openclaw
- Importance: high
- Project: xuanji

---

## 14:00 - 修复 GUI 布局问题

**问题**：
输入框被对话内容遮挡。

**解决方案**：
使用 flex-direction: column-reverse 实现输入框固定在底部。

**元数据**：
- Tags: #gui #bug-fix #electron
- Importance: medium
- Project: xuanji

---
```

#### knowledge/user-preferences.md

```markdown
# 用户偏好

## 语言
- 始终使用中文回复
- 技术术语保留英文原文

## 工具选择
- 包管理器：Bun（优先于 npm）
- 编辑器：VS Code
- Shell: zsh

## 编程风格
- TypeScript 严格模式
- 函数式编程优先
- 优先使用接口抽象

**元数据**：
- Created: 2026-02-15
- Updated: 2026-03-16
- Importance: high
- Type: user-preference
```

#### knowledge/project-xuanji.md

```markdown
# Xuanji 项目知识

## 核心架构

### 工具传递策略
- **动态加载**（2026-03-03）：根据激活 Skill 过滤工具
- **Schema 简化**：工具描述精简到核心句子
- **Token 优化**：编程场景节省 36% tokens

### 记忆系统演化
- **Phase 1**（2026-02-27）：向量检索 + 遗忘曲线
- **Phase 2**（2026-03-16）：Agent 主动记忆 + Markdown 文件优先

## 技术栈
- 运行时: Node.js 20+ / tsx
- UI 框架: Ink 5 (React 18 终端渲染)
- LLM SDK: @anthropic-ai/sdk (主), openai (次)

**元数据**：
- Created: 2026-02-15
- Updated: 2026-03-16
- Importance: high
- Type: project-knowledge
```

### 3. SQLite Schema 设计

```sql
-- 向量索引表
CREATE VIRTUAL TABLE memory_vectors USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[384],  -- all-MiniLM-L6-v2 (384 维)
  file_path TEXT,
  section_id TEXT,       -- Markdown 文件中的章节锚点
  created_at INTEGER,
  updated_at INTEGER
);

-- 全文搜索表（FTS5）
CREATE VIRTUAL TABLE memory_fts USING fts5(
  id UNINDEXED,
  content,
  tags,
  file_path UNINDEXED,
  section_id UNINDEXED,
  tokenize='porter unicode61'
);

-- 元数据表
CREATE TABLE memory_metadata (
  id TEXT PRIMARY KEY,
  file_path TEXT NOT NULL,
  section_id TEXT,
  title TEXT,
  tags TEXT,             -- JSON array
  importance TEXT,       -- high/medium/low
  memory_type TEXT,      -- daily-log/knowledge/task/preference
  created_at INTEGER,
  updated_at INTEGER,
  last_accessed INTEGER,
  access_count INTEGER DEFAULT 0,
  -- 遗忘曲线字段
  decay_factor REAL DEFAULT 1.0
);

-- 索引
CREATE INDEX idx_file_path ON memory_metadata(file_path);
CREATE INDEX idx_memory_type ON memory_metadata(memory_type);
CREATE INDEX idx_importance ON memory_metadata(importance);
CREATE INDEX idx_created_at ON memory_metadata(created_at);
```

### 4. 混合检索算法（OpenClaw 风格）

```typescript
export class OpenClawStyleRetriever {
  /**
   * OpenClaw 风格混合检索
   *
   * 权重分配：
   * - 向量相似度：70%
   * - BM25 文本匹配：30%
   * - 遗忘曲线：乘数因子（0.5^(days/halfLife)）
   * - 访问频次：乘数因子（log(accessCount + 1)）
   */
  async retrieve(
    query: string,
    options: {
      maxResults?: number;
      minScore?: number;
      memoryTypes?: string[];
      importance?: string[];
    }
  ): Promise<MemoryEntry[]> {
    const { maxResults = 10, minScore = 0.3 } = options;

    // 1. 向量检索（Top-K）
    const embedding = await this.embeddingService.embed(query);
    const vectorResults = await this.vectorStore.search(embedding, {
      limit: maxResults * 3, // 过采样
    });

    // 2. BM25 全文搜索（Top-K）
    const ftsResults = await this.db.all(`
      SELECT
        id,
        bm25(memory_fts) AS bm25_score
      FROM memory_fts
      WHERE memory_fts MATCH ?
      ORDER BY bm25_score DESC
      LIMIT ?
    `, [query, maxResults * 3]);

    // 3. 归一化 BM25 分数（0-1）
    const maxBm25 = Math.max(...ftsResults.map(r => Math.abs(r.bm25_score)));
    const normalizedFts = ftsResults.map(r => ({
      id: r.id,
      score: Math.abs(r.bm25_score) / maxBm25,
    }));

    // 4. 合并结果（70/30 权重）
    const scoreMap = new Map<string, number>();
    const vectorWeight = 0.7;
    const textWeight = 0.3;

    for (const result of vectorResults) {
      scoreMap.set(result.id, vectorWeight * result.score);
    }

    for (const result of normalizedFts) {
      const current = scoreMap.get(result.id) || 0;
      scoreMap.set(result.id, current + textWeight * result.score);
    }

    // 5. 应用遗忘曲线和访问频次
    const now = Date.now();
    const halfLife = 30 * 24 * 60 * 60 * 1000; // 30 天
    const metadata = await this.loadMetadata(Array.from(scoreMap.keys()));

    for (const [id, baseScore] of scoreMap.entries()) {
      const meta = metadata.get(id);
      if (!meta) continue;

      // 遗忘曲线
      const ageMs = now - meta.created_at;
      const ageDays = ageMs / (24 * 60 * 60 * 1000);
      const recencyFactor = Math.pow(0.5, ageDays / 30);

      // 访问频次（对数增长，避免过度放大）
      const frequencyFactor = 1 + Math.log(meta.access_count + 1) * 0.1;

      // 重要性权重
      const importanceWeight = meta.importance === 'high' ? 1.2 :
                               meta.importance === 'low' ? 0.8 : 1.0;

      // 综合得分
      const finalScore = baseScore * recencyFactor * frequencyFactor * importanceWeight;
      scoreMap.set(id, finalScore);
    }

    // 6. 排序和过滤
    const ranked = Array.from(scoreMap.entries())
      .map(([id, score]) => ({ id, score }))
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    // 7. 加载完整记忆条目
    return this.loadEntries(ranked.map(r => r.id));
  }
}
```

### 5. 自动记忆刷新机制（OpenClaw 启发）

```typescript
export class AutoMemoryFlush {
  /**
   * 上下文接近限制时，自动触发记忆刷新
   *
   * 触发条件：
   * - 当前 tokens > maxTokens * 0.75
   * - 距离上次刷新 > 30 分钟
   * - 有未归档的重要内容
   */
  async checkAndFlush(
    messageHistory: Message[],
    currentTokens: number,
    maxTokens: number
  ): Promise<void> {
    const threshold = maxTokens * 0.75;

    if (currentTokens < threshold) {
      return; // 未达到阈值
    }

    const lastFlushTime = this.getLastFlushTime();
    const timeSinceFlush = Date.now() - lastFlushTime;

    if (timeSinceFlush < 30 * 60 * 1000) {
      return; // 距离上次刷新不足 30 分钟
    }

    // 触发静默 Agent 转换，提示记忆归档
    const flushPrompt = `
## 上下文即将压缩

当前对话长度接近上限（${currentTokens}/${maxTokens} tokens）。

请回顾本次对话中的重要内容，使用 \`memory_store\` 工具将关键信息归档到长期记忆：

1. **用户偏好**：新发现的用户习惯、工具选择、语言风格
2. **项目知识**：架构决策、技术栈选择、关键约定
3. **任务进展**：已完成的任务、待办事项、重要发现
4. **学习点**：解决的问题、新掌握的技能、重要模式

归档后，这些记忆将持久保存，即使会话历史被压缩也不会丢失。
    `.trim();

    await this.agentLoop.appendSystemMessage(flushPrompt);
    this.setLastFlushTime(Date.now());
  }
}
```

### 6. Markdown 文件解析和索引

```typescript
export class MarkdownMemoryIndexer {
  /**
   * 解析 Markdown 文件并建立索引
   *
   * 支持特性：
   * - 按 ## 标题分节（每节一个记忆条目）
   * - 元数据提取（## 元数据 或 YAML Front Matter）
   * - 标签提取（#tag 形式）
   * - 重要性推断（标题中的 emoji 或元数据）
   */
  async indexMarkdownFile(filePath: string): Promise<void> {
    const content = await fs.readFile(filePath, 'utf-8');
    const sections = this.splitBySections(content);

    for (const section of sections) {
      const id = this.generateSectionId(filePath, section.heading);
      const metadata = this.extractMetadata(section.content);
      const tags = this.extractTags(section.content);

      // 生成向量
      const embedding = await this.embeddingService.embed(
        `${section.heading}\n${section.content}`
      );

      // 存储到 SQLite
      await this.vectorStore.add({
        id,
        embedding,
        file_path: filePath,
        section_id: section.anchor,
      });

      await this.db.run(`
        INSERT INTO memory_fts (id, content, tags, file_path, section_id)
        VALUES (?, ?, ?, ?, ?)
      `, [id, section.content, tags.join(' '), filePath, section.anchor]);

      await this.db.run(`
        INSERT OR REPLACE INTO memory_metadata
        (id, file_path, section_id, title, tags, importance, memory_type, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        id,
        filePath,
        section.anchor,
        section.heading,
        JSON.stringify(tags),
        metadata.importance || 'medium',
        this.inferMemoryType(filePath),
        metadata.created || Date.now(),
        Date.now(),
      ]);
    }
  }

  /**
   * 按 ## 标题分节
   */
  private splitBySections(content: string): Array<{
    heading: string;
    content: string;
    anchor: string;
  }> {
    const lines = content.split('\n');
    const sections: Array<{ heading: string; content: string; anchor: string }> = [];
    let currentSection: { heading: string; content: string[] } | null = null;

    for (const line of lines) {
      if (line.startsWith('## ')) {
        if (currentSection) {
          sections.push({
            heading: currentSection.heading,
            content: currentSection.content.join('\n'),
            anchor: this.slugify(currentSection.heading),
          });
        }
        currentSection = {
          heading: line.slice(3).trim(),
          content: [],
        };
      } else if (currentSection) {
        currentSection.content.push(line);
      }
    }

    if (currentSection) {
      sections.push({
        heading: currentSection.heading,
        content: currentSection.content.join('\n'),
        anchor: this.slugify(currentSection.heading),
      });
    }

    return sections;
  }

  /**
   * 提取元数据（支持两种格式）
   *
   * 格式 1: YAML Front Matter
   * ---
   * tags: [architecture, memory]
   * importance: high
   * ---
   *
   * 格式 2: 文本块
   * **元数据**：
   * - Tags: #architecture #memory
   * - Importance: high
   */
  private extractMetadata(content: string): {
    tags?: string[];
    importance?: string;
    created?: number;
  } {
    // YAML Front Matter
    const yamlMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (yamlMatch) {
      // 简单解析（生产环境建议用 yaml 库）
      const yaml = yamlMatch[1];
      const tags = yaml.match(/tags:\s*\[(.*?)\]/)?.[1]?.split(',').map(t => t.trim());
      const importance = yaml.match(/importance:\s*(\w+)/)?.[1];
      return { tags, importance };
    }

    // 文本块
    const metaMatch = content.match(/\*\*元数据\*\*：?\n([\s\S]*?)(?=\n\n|\n#|$)/);
    if (metaMatch) {
      const meta = metaMatch[1];
      const tags = Array.from(meta.matchAll(/#([\w-]+)/g)).map(m => m[1]);
      const importance = meta.match(/Importance:\s*(\w+)/i)?.[1]?.toLowerCase();
      return { tags, importance };
    }

    return {};
  }

  /**
   * 提取标签（#tag 形式）
   */
  private extractTags(content: string): string[] {
    const matches = content.matchAll(/#([\w-]+)/g);
    return Array.from(matches).map(m => m[1]);
  }

  /**
   * 根据文件路径推断记忆类型
   */
  private inferMemoryType(filePath: string): string {
    if (filePath.includes('/daily/')) return 'daily-log';
    if (filePath.includes('/knowledge/')) return 'knowledge';
    if (filePath.includes('/tasks/')) return 'task';
    return 'unknown';
  }
}
```

---

## 迁移路径

### Phase 1: 双轨并行（向后兼容）

1. **新增 Markdown 存储**：
   - memory_store 工具同时写入 JSONL 和 Markdown
   - 检索时优先从 Markdown 索引查询，降级到 JSONL
   - 用户可选择启用新系统（配置项）

2. **索引构建**：
   - 启动时扫描 `~/.xuanji/memory/` 下所有 Markdown 文件
   - 增量更新索引（检测文件 mtime）

3. **工具扩展**：
   - memory_store 增加 `format` 参数（默认 'markdown'）
   - memory_edit 工具：允许编辑 Markdown 文件后重建索引

### Phase 2: 历史数据迁移

```typescript
export class MemoryMigrator {
  /**
   * 将 JSONL 记忆迁移到 Markdown
   */
  async migrateToMarkdown(): Promise<void> {
    const jsonlPath = path.join(os.homedir(), '.xuanji', 'memory.jsonl');
    const markdownDir = path.join(os.homedir(), '.xuanji', 'memory');

    const entries = await this.loadJSONL(jsonlPath);

    // 按日期分组
    const byDate = this.groupByDate(entries);

    for (const [date, entries] of byDate) {
      const filePath = path.join(markdownDir, 'daily', `${date}.md`);
      const markdown = this.entriesToMarkdown(entries, date);
      await fs.writeFile(filePath, markdown, 'utf-8');
    }

    // 提取长期知识（用户偏好、项目知识）
    const preferences = entries.filter(e =>
      e.type === 'user-preference' ||
      e.keywords.some(k => k.includes('preference'))
    );
    if (preferences.length > 0) {
      const prefPath = path.join(markdownDir, 'knowledge', 'user-preferences.md');
      await fs.writeFile(prefPath, this.knowledgeToMarkdown(preferences, 'User Preferences'));
    }

    // 重建索引
    await this.indexer.rebuildIndex();
  }

  private entriesToMarkdown(entries: MemoryEntry[], date: string): string {
    const sections = entries.map(entry => {
      const time = new Date(entry.createdAt).toTimeString().slice(0, 5);
      const tags = entry.keywords.map(k => `#${k}`).join(' ');

      return `
## ${time} - ${entry.content.split('\n')[0].slice(0, 50)}

${entry.content}

**元数据**：
- Tags: ${tags}
- Importance: ${entry.metadata?.importance || 'medium'}
- Source: ${entry.source}
      `.trim();
    });

    return `# ${date} 对话日志\n\n${sections.join('\n\n---\n\n')}`;
  }
}
```

### Phase 3: 完全切换

1. **移除 JSONL 支持**：
   - 删除 MemoryStore（JSONL）实现
   - 仅保留 MarkdownMemoryStore

2. **文档和示例**：
   - 更新用户文档，展示 Markdown 编辑示例
   - 提供 Git 版本控制最佳实践

---

## 优势总结

### 对比 OpenClaw

| 特性 | OpenClaw | Xuanji 新架构 | 说明 |
|------|----------|--------------|------|
| Markdown 文件 | ✓ | ✓ | 透明、可编辑 |
| SQLite + FTS5 | ✓ | ✓ | 本地优先 |
| 70/30 混合搜索 | ✓ | ✓ | 最优权重 |
| 自动记忆刷新 | ✓ | ✓ | 防止丢失 |
| 遗忘曲线 | ✗ | ✓ | **xuanji 独有** |
| 访问频次加权 | ✗ | ✓ | **xuanji 独有** |
| Agent 主动记忆 | ✗ | ✓ | **xuanji 独有** |
| 工具驱动 | ✗ | ✓ | **xuanji 独有** |

### 对比 Xuanji 当前

| 维度 | 当前架构 | 新架构 | 改进 |
|------|---------|--------|------|
| 透明度 | JSONL（不可读） | Markdown（可编辑） | ✓✓✓ |
| 向量权重 | 50% | 70% | ✓ |
| 文本检索 | 简单关键词 | FTS5 BM25 | ✓✓ |
| 记忆刷新 | 手动 | 自动 | ✓✓ |
| 版本控制 | 不支持 | Git 友好 | ✓✓✓ |
| 文件组织 | 单一文件 | 分类管理 | ✓✓ |

---

## 实施优先级

### P0（核心功能）
- [ ] MarkdownMemoryStore 实现
- [ ] FTS5 全文搜索
- [ ] 70/30 混合检索算法
- [ ] Markdown 文件解析和索引

### P1（关键体验）
- [ ] 自动记忆刷新机制
- [ ] 双轨并行（JSONL + Markdown）
- [ ] 历史数据迁移工具
- [ ] memory_edit 工具

### P2（增强功能）
- [ ] Git 版本控制集成
- [ ] Web UI 记忆浏览器
- [ ] 记忆统计和可视化
- [ ] 智能记忆合并（去重）

---

## 配置示例

```typescript
// ~/.xuanji/config.json
{
  "memory": {
    "backend": "markdown",  // 'markdown' | 'jsonl' | 'hybrid'
    "markdownDir": "~/.xuanji/memory",
    "autoFlush": {
      "enabled": true,
      "threshold": 0.75,     // 75% 上下文时触发
      "minInterval": 1800,   // 30 分钟最小间隔
    },
    "hybridSearch": {
      "vectorWeight": 0.7,
      "bm25Weight": 0.3,
    },
    "forgettingCurve": {
      "enabled": true,
      "halfLifeDays": 30,
    },
    "indexing": {
      "autoRebuild": true,   // 启动时自动重建索引
      "watchFiles": true,    // 监听文件变化
    },
    "git": {
      "autoCommit": false,   // 是否自动提交记忆变更
      "commitMessage": "chore(memory): auto-update",
    }
  }
}
```

---

## 下一步

1. **创建原型**：实现 MarkdownMemoryStore 和 OpenClawStyleRetriever
2. **性能测试**：对比 JSONL 和 Markdown + SQLite 的检索速度
3. **用户测试**：邀请用户手动编辑 Markdown 记忆，收集反馈
4. **文档编写**：记忆文件格式规范、最佳实践、迁移指南
