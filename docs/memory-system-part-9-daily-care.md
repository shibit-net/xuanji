# Xuanji 主动关怀系统 · 自然提醒设计

> 版本: 1.0 | 日期: 2026-05-16
> 前置: 记忆系统完整方案（含叙事记忆 EpisodicMemory）

---

## 1. 核心原则

### 1.1 不像提醒，像朋友关心

```
❌ "提醒：今天是你的恋爱纪念日"
→ 冷冰冰，像闹钟

✅ "记得今天是你和女朋友的纪念日，去年去的是三里屯那家日料店，今年需要我帮你安排吗？"
→ 自然地提起，带着回忆的温度
```

### 1.2 不主动打扰，只在交互时自然提及

- 不 push 通知、不弹窗、不侵占用户注意力
- 只在用户主动发起对话、或者系统刚好在 idle 状态时提及
- 类似于见面时说"诶对了，今天是不是你那个日子"

### 1.3 频率控制：同一件事不反复提

- 每个值得关注的事件（纪念日、生日、重要日期）一天只提一次
- 不需要用户说"我知道了"，系统自己记住"今天已经提过了"
- 这个"已提醒"状态存在哪里——memory 的 events 表加一个 `reminded_at` 字段就行

---

## 2. 触发时机

### 2.1 三种触发方式

| 触发方式 | 时机 | 举例 |
|---------|------|------|
| **用户主动对话** | 用户发消息时，Agent 在回复中自然附带 | "今天天气不错……对了，今天是你和女朋友的纪念日吧" |
| **任务完成后** | Agent 执行完一个任务，回复末尾自然提及 | "项目脚手架已创建。另外提醒一下，今天是纪念日哦" |
| **系统空闲检测** | AgentLoop idle 时，StateTracker.state=idle，系统主动发起一段简短的交互 | "嘿，好久没聊了。今天有什么特别的安排吗？" |

### 2.2 优先级：只在交互中提及，不主动 push

最自然的方式是**在用户主动对话时，Agent 在回复中附带相关提醒**。这不需要任何额外机制——AgentLoop 收到用户消息，buildContext 时自然会加载当天的事件，回答时自然带出来。

```
用户: "今天忙死了"

Agent 回复:
  "辛苦了。对了，今天是你和女朋友的纪念日，
   去年去的是三里屯那家日料店。要是太忙没空安排，
   需要我帮你订个位或者挑个礼物吗？"
```

React 实现中用户发消息时自然触发，无需新增独立的定时器逻辑。

---

## 3. 实现方式

### 3.1 CareManager 类：buildDailyCare

`buildDailyCare()` 和 `formatDailyCare()` 归属到独立的 `CareManager` 类，不直接放在 MemoryManager 中。MemoryManager 持有 CareManager 实例，通过它调用。

```typescript
class CareManager {
  constructor(
    private db: Database,
    private episodicMemory?: EpisodicMemory,
  ) {}

  /**
   * 检查当天是否有值得关注的事件（纪念日、生日等）
   * 返回一段自然语言的友善提醒，如果没有则返回 null
   */
  async buildDailyCare(): Promise<string | null> {
    const todayMD = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    // 查 events 表，按月-日匹配当天的重要事件
    const events = this.db.prepare(`
      SELECT e.content, e.entity_ids, e.importance,
             group_concat(ent.name, ', ') AS entity_names
      FROM events e
      LEFT JOIN entities ent ON ',' || e.entity_ids || ',' LIKE '%,' || ent.id || ',%'
      WHERE strftime('%m-%d', e.time / 1000, 'unixepoch') = ?
        AND e.importance >= 4
        AND (e.reminded_at IS NULL OR e.reminded_at < ?)
      GROUP BY e.id
      ORDER BY e.importance DESC
      LIMIT 1
    `).get(todayMD, Date.now() - 86400000) as any;

    if (!events) return null;

    // 标记已提醒
    this.db.prepare(`UPDATE events SET reminded_at = ? WHERE id = ?`)
      .run(Date.now(), events.id);

    // 查叙事记忆，让提醒有情节
    const episode = await this.episodicMemory?.findByEvent(events.id, 1);

    return this.formatDailyCare(events, episode?.[0]);
  }

  private formatDailyCare(event: any, episode?: any): string {
    if (episode) {
      return `[顺便一提] 记得去年的今天，${episode.title}。时间过得真快。`;
    }
    return `[顺便一提] 去年的今天，${event.content}。`;
  }

  /**
   * 感知时间流逝，生成时间感知标记
   * 归属于 CareManager 而非 MemoryManager
   */
  buildTimeAwareness(lastActiveAt: number): string | null {
    const now = Date.now();
    const elapsedMs = now - lastActiveAt;
    const elapsedMinutes = Math.floor(elapsedMs / 60000);
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    const elapsedDays = Math.floor(elapsedHours / 24);

    if (elapsedMinutes < 30) return null;
    if (elapsedMinutes < 120) return `[时间感知：距离上次对话 ${elapsedMinutes} 分钟]`;
    if (elapsedHours < 24) return `[时间感知：距离上次对话 ${elapsedHours} 小时]`;
    if (elapsedDays < 7) return elapsedDays === 1
      ? `[时间感知：距离上次对话 1 天]`
      : `[时间感知：距离上次对话 ${elapsedDays} 天]`;
    if (elapsedDays < 30) return `[时间感知：距离上次对话 ${Math.floor(elapsedDays / 7)} 周]`;
    return `[时间感知：距离上次对话 ${Math.floor(elapsedDays / 30)} 个月]`;
  }
}
```

### 3.2 频率控制

```sql
-- events 表新增字段
ALTER TABLE events ADD COLUMN reminded_at INTEGER;  -- 上次提醒时间戳
-- 为 anniversary 查询优化
CREATE INDEX idx_events_md ON events(strftime('%m-%d', time / 1000, 'unixepoch'));
```

每次提及后记录 `reminded_at`，今天的已提醒事件不会再提。第二天重置。

### 3.3 时间感知：感知距离上次对话多久了

用户隔了很久才回来，Agent 应该能感知到时间流逝并调整语气。

**数据来源**：当前 session 的 `SessionMetadata.updatedAt`（已有），跟 `Date.now()` 的差值就是间隔。

**注入逻辑**：`buildContext()` 中通过 CareManager 实例调用 `buildTimeAwareness()`（方法定义见 §3.1），计算间隔后注入到 system prompt 的 suffix。

```typescript
// buildContext() 中
const timeAwareness = this.buildTimeAwareness(sessionUpdatedAt);
if (timeAwareness) {
  // 注入到 system prompt 的 suffix，不走记忆块
  // 这样 Agent 在思考时能看到，但不会显示给用户
  contextManager.setSystemPromptSuffix(timeAwareness, 'time-awareness');
}
```

**效果**：

```
用户隔了 5 分钟回来发消息:
  "帮我查一下"

  Agent 回复:
  "好的，查什么？"  ← 语气正常

用户隔了 3 天回来:
  "项目A的数据库迁移做了吗"

  Agent 回复（看到 [时间感知：3 天]）:
  "上次聊到项目A的数据库迁移，你正在评估用 Flyway 还是 Liquibase。
   这 3 天有新的想法吗？"  ← 自然地接上

用户隔了 1 个月回来:
  "好久不见"

  Agent 回复（看到 [时间感知：1 个月]）:
  "确实好久不见！上次你在做项目A的用户注册接口，
   用的是 RSA 加密。这一个月有什么新进展吗？"  
   ← 语气更热情，带回顾
```

**Agent 自己决定语气**。`[时间感知]` 标记只告诉它"过了多久"，怎么调整语气是 Agent 自己的事。不同模型、不同用户场景下自然会有不同的表达。

#### 数据流

```
SessionManager.getCurrentSession().updatedAt
  → buildContext() → buildTimeAwareness(updatedAt)
  → 注入到 system prompt 作为 [时间感知]
  → Agent 在回复中自然体现

不需要额外的记忆表。updatedAt 本来就有。
```

#### l0-base-memory-guide.yaml 补充

```yaml
  ## 时间感知

  当 system prompt 中出现 [时间感知] 标记时：
  - 超过 1 天：回复时先回顾上次的上下文再继续
  - 超过 1 周：先问候，再回顾，再继续
  - 超过 1 个月：先问候，回顾关键决策和结论，询问这段时间的进展
  
  语气自然，不要刻意提"我注意到已经过去X天了"。
  直接说"上次你说……"、"有一阵没聊了，上次的项目……"就好。
```

在 `l0-base-memory-guide.yaml` 中新增：

```yaml
## 自然关怀

当你在回复用户时，如果发现当天是某个重要事件的日子，可以在回复末尾自然地提及。
不需要专门"提醒"用户，就像朋友聊天时顺便说一句。

举例：
- 去年今天你完成了项目A上线 → "记得去年的今天项目A刚上线"
- 今天是你和女朋友的纪念日 → "今天是你和女朋友的纪念日吧"
- 今天是某个朋友的生日 → "今天是张三生日？需要帮他订个蛋糕吗"

规则：
- 只在用户主动找你时提，不主动 push
- 一天内同一件事只提一次
- 语气要自然，不要像系统通知
- 如果不确定，宁可不提
```

---

## 4. 完整数据流

```
时间: 5月20日 早上
用户: "今天有什么安排？"

  → AgentLoop.run("今天有什么安排")
  → buildContext()
    → 3a. 查 events: 去年5月20日 第一次约会 (importance=5)
    → 3b. 查 episodes: "去年520约会" 叙事记忆
    → 3c. 标记 reminded_at = now
    → 3d. 注入 prompt:
      L0 记忆块
      场景记忆
      [顺便一提] 记得去年的今天你去了三里屯的日料店，还送了鲜花和项链

  → Agent 回复:
    "今天没有固定的日程安排。
     不过记得去年的今天是你和女朋友的纪念日，
     你们去了三里屯那家日料店。
     今年需要我帮你安排吗？订位、挑礼物我都能帮忙。"

用户: "好的，帮我订那家日料店，再挑个礼物"

  → Agent 调 memory_search → 查日料店名字
  → 调 browser 订位
  → 调 web_search 挑礼物（根据 facts: 喜欢实用的、LV）
  → 回复
```

---

## 5. 文件改动

| 文件 | 改动 |
|------|------|
| `src/core/memory/CareManager.ts` | **新增**：`buildDailyCare()` + `formatDailyCare()` + `buildTimeAwareness()` |
| `src/core/memory/MemoryManager.ts` | 持有 CareManager 实例，buildContext() 中通过它调用 buildDailyCare() 和 buildTimeAwareness() |
| `src/core/scheduler/Scheduler.ts` | **新增**：定时任务调度 + 空闲检测 + 补执行 |
| `src/core/scheduler/types.ts` | **新增**：CronJob 类型定义 |
| `src/core/events/events.ts` | 新增 MEMORY_STORED / MEMORY_SEARCHED / MEMORY_EXTRACTED / MEMORY_MAINTENANCE / MEMORY_LEARNING_PROGRESS / MEMORY_DELIVER_MESSAGE 事件；events 表迁移 v5 加 reminded_at 列 + idx_events_md 索引；新增 scheduler_log 表 |
| `src/core/templates/prompts/l0-base-memory-guide.yaml` | 补充"时间感知"和"自然关怀"引导 |

## 6. 定时任务系统

用户安排的定时任务和系统自发空闲检测，统一由一个轻量的定时任务模块管理。

### 6.1 两种定时任务

| 类型 | 触发条件 | 举例 | 谁设置的 |
|------|---------|------|---------|
| **固定 cron** | 固定时间（每天8点） | "每天早上8点学一个新知识并汇报" | 用户 |
| **空闲检测** | 距离上次对话超过 N 天 | "3天没找我了，发个消息问一下" | 系统自动 |

### 6.2 统一任务调度器

Scheduler 整合固定 cron 调度、空闲检测和跨平台补执行机制。§6.7 的补执行逻辑合并至此。

```typescript
// src/core/scheduler/types.ts
export interface CronJob {
  id: string;
  userId: string;
  type: 'daily' | 'weekly' | 'once';
  hour?: number;         // daily/weekly 用
  minute?: number;       // daily/weekly 用
  dayOfWeek?: number;    // weekly 用 0-6
  scheduledAt?: number;  // once 用的绝对时间
  action: 'learn' | 'custom';
  params?: Record<string, any>;
  prompt?: string;       // custom 动作的引导 prompt
  enabled?: boolean;
  executed?: boolean;    // once 任务是否已执行
}

// src/core/scheduler/Scheduler.ts
class Scheduler {
  private jobs: CronJob[] = [];
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private checkTimer: NodeJS.Timeout | null = null;
  private baseDir: string;

  constructor(
    private db: Database,
    private sessionManager: SessionManager,
    private cheapLLM: ILLMProvider,
    private learnTool: LearnTool,
    private eventBus: EventBus,
    private activeUsers: Set<string> = new Set(),
    baseDir?: string,
  ) {
    this.baseDir = baseDir ?? path.join(homedir(), '.xuanji', 'scheduler');
  }

  // ─── 持久化路径 ─────────────────────────────
  private get JOBS_PATH(): string { return path.join(this.baseDir, 'jobs.json'); }
  private get CHECK_PATH(): string { return path.join(this.baseDir, 'last-check.txt'); }

  /**
   * 启动调度器。应用启动时调用一次。
   *
   * 步骤：
   * 1. 加载持久化的任务列表
   * 2. 补执行：从上次检查到现在之间到期的任务（跨平台不掉任务）
   * 3. 调度未来的未到期任务
   * 4. 启动空闲检测（每 30 分钟检查一次）
   * 5. 每分钟持久化当前时间（用于下次启动的补执行判断）
   */
  async start(): Promise<void> {
    this.jobs = this.loadJobs();

    await this.catchUpMissedJobs();           // 补执行

    for (const job of this.jobs) {
      if (job.enabled !== false) {
        this.scheduleJob(job);               // 调度未来
      }
    }

    this.checkTimer = setInterval(() => this.checkIdle(), 30 * 60 * 1000);  // 空闲检测
    setInterval(() => this.saveLastCheck(), 60_000);                        // 持久化时间戳
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    if (this.checkTimer) clearInterval(this.checkTimer);
  }

  /**
   * 注册一个新任务，持久化并调度
   */
  async addCron(job: CronJob): Promise<void> {
    this.jobs.push(job);
    this.saveJobs();
    this.scheduleJob(job);
  }

  /**
   * 补执行：从上次检查到现在，所有应该执行但没执行的任务
   *
   * 例如 lastCheck=8:30, now=9:05
   *   → daily-finance 设定在 9:00
   *   → 9:00 在 [8:30, 9:05] 区间内 → 立即执行
   */
  private async catchUpMissedJobs(): Promise<void> {
    const now = Date.now();
    const since = this.loadLastCheck() || now - 24 * 60 * 60 * 1000;

    for (const job of this.jobs) {
      if (job.enabled === false) continue;

      const missed = this.getMissedRuns(job, since, now);
      for (const runTime of missed) {
        await this.executeJob(job, runTime);
      }
    }
  }

  /**
   * 计算一个 job 在时间区间内应该触发的所有时间点
   */
  private getMissedRuns(job: CronJob, since: number, now: number): number[] {
    const runs: number[] = [];

    if (job.type === 'daily') {
      // 检查每天的 job.hour:job.minute 是否在 [since, now] 区间内
      const sinceDate = new Date(since);
      const nowDate = new Date(now);
      for (let d = new Date(sinceDate); d <= nowDate; d.setDate(d.getDate() + 1)) {
        const target = new Date(d);
        target.setHours(job.hour ?? 0, job.minute ?? 0, 0, 0);
        if (target.getTime() >= since && target.getTime() <= now) {
          if (!this.hasExecuted(job.id, target.getTime())) {
            runs.push(target.getTime());
          }
        }
      }
    }

    if (job.type === 'once' && job.scheduledAt) {
      if (job.scheduledAt >= since && job.scheduledAt <= now && !job.executed) {
        runs.push(job.scheduledAt);
      }
    }

    return runs;
  }

  /**
   * 调度未来的一次执行
   */
  private scheduleJob(job: CronJob): void {
    const delay = this.calculateDelay(job);
    if (delay < 0) return;

    const timer = setTimeout(async () => {
      await this.executeJob(job, Date.now());
      if (job.type !== 'once') {
        this.scheduleJob(job);           // 重复任务，调度下一次
      }
      this.timers.delete(job.id);
    }, delay);

    this.timers.set(job.id, timer);
  }

  private calculateDelay(job: CronJob): number {
    const now = Date.now();
    if (job.type === 'daily') {
      const next = new Date();
      next.setHours(job.hour ?? 0, job.minute ?? 0, 0, 0);
      if (next.getTime() <= now) next.setDate(next.getDate() + 1);
      return next.getTime() - now;
    }
    if (job.type === 'once' && job.scheduledAt) {
      return Math.max(0, job.scheduledAt - now);
    }
    return 24 * 60 * 60 * 1000;
  }

  /**
   * 执行任务，记录执行日志（防重复）
   */
  private async executeJob(job: CronJob, runTime: number): Promise<void> {
    log.info(`Executing job ${job.id} scheduled for ${new Date(runTime).toISOString()}`);

    // 记录执行日志
    this.db.prepare(`
      INSERT INTO scheduler_log (job_id, scheduled_at, executed_at) VALUES (?, ?, ?)
    `).run(job.id, runTime, Date.now());

    // 执行动作
    switch (job.action) {
      case 'learn':
        const result = await learnTool.execute({ goal: job.params?.topic || '主流技术动态', depth: 'moderate' });
        await this.deliverToUser(job.userId, result.content);
        break;
      case 'custom':
        await this.deliverToUser(job.userId, `⏰ ${job.prompt || '提醒'}`);
        break;
    }
  }

  private hasExecuted(jobId: string, scheduledAt: number): boolean {
    return !!this.db.prepare(`
      SELECT 1 FROM scheduler_log WHERE job_id = ? AND scheduled_at = ? LIMIT 1
    `).get(jobId, scheduledAt);
  }

  // ─── 空闲检测 ─────────────────────────────

  private async checkIdle(): Promise<void> {
    const now = Date.now();
    for (const user of this.activeUsers) {
      const lastActive = this.getLastActiveTime(user.id);
      if (!lastActive) continue;
      const idleDays = Math.floor((now - lastActive) / 86400000);
      const lastReachOut = this.getLastReachOut(user.id);
      if (idleDays >= 3 && (!lastReachOut || (now - lastReachOut) >= 7 * 86400000)) {
        await this.sendIdleGreeting(user, idleDays);
        this.recordReachOut(user.id, now);
      }
    }
  }

  // ─── 消息推送 ─────────────────────────────

  private async deliverToUser(userId: string, text: string): Promise<void> {
    this.eventBus.emitSync('deliver:message', { userId, text, source: 'scheduler' });
  }

  // ─── 持久化 ───────────────────────────────

  private loadJobs(): CronJob[] {
    try { return JSON.parse(fs.readFileSync(this.JOBS_PATH, 'utf-8')); }
    catch { return []; }
  }

  private saveJobs(): void {
    fs.mkdirSync(path.dirname(this.JOBS_PATH), { recursive: true });
    fs.writeFileSync(this.JOBS_PATH, JSON.stringify(this.jobs, null, 2));
  }

  private saveLastCheck(): void {
    fs.writeFileSync(this.CHECK_PATH, String(Date.now()));
  }

  private loadLastCheck(): number {
    try { return parseInt(fs.readFileSync(this.CHECK_PATH, 'utf-8'), 10); }
    catch { return 0; }
  }

  // ─── 空闲问候 ───────────────────────────────

  private async sendIdleGreeting(user: UserProfile, idleDays: number): Promise<void> {
    const greeting = await this.generateGreeting(user, idleDays);
    await this.deliverToUser(user.id, greeting);
  }

  private async generateGreeting(user: UserProfile, idleDays: number): Promise<string> {
    const recentEvents = this.db.prepare(`
      SELECT content FROM events
      WHERE scene_tag LIKE '%,工作,%'
      ORDER BY time DESC LIMIT 3
    `).all() as { content: string }[];
    const context = recentEvents.map(e => e.content).join('\n');

    const response = await this.cheapLLM.stream([{
      role: 'system',
      content: `生成一条简短的问候消息，发给 ${idleDays} 天没联系的用户。
规则：
- 语气像朋友，不要像系统通知
- 自然地提起上次的事（如果有上下文）
- 简短，不超过 3 句话
- 不要道歉，不要说"抱歉打扰"
- 纯文本，不用markdown格式`,
    }, {
      role: 'user',
      content: idleDays >= 7
        ? `上次联系是 ${idleDays} 天前了。最近怎么样？`
        : `最近忙什么呢？${context ? '上次聊到：' + context.slice(0, 200) : ''}`,
    }]);
    return response;
  }

  private getLastActiveTime(userId: string): number | null {
    return this.sessionManager?.getLastActiveTime(userId) ?? null;
  }

  private getLastReachOut(userId: string): number | null {
    const row = this.db.prepare(`
      SELECT time FROM events
      WHERE content LIKE '%[系统问候]%' AND entity_ids LIKE ?
      ORDER BY time DESC LIMIT 1
    `).get(`%${userId}%`) as { time: number } | undefined;
    return row?.time ?? null;
  }

  private recordReachOut(userId: string, time: number): void {
    this.db.prepare(`
      INSERT INTO events (id, time, entity_ids, content, importance, scene_tag, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(generateId(), time, userId, '[系统问候] 空闲一段时间后的主动问候', 2, '生活', time);
  }
}

```

### 6.3 效果

```
场景 1：用户安排了定时学习

用户: "每天早上8点学一个新知识并汇报给我"

  → Scheduler.addCron({ userId, type: 'daily', hour: 8, action: 'learn', params: { topic: '新技术' } })
  → 持久化
  → 每天 8:00 执行 learn → 推送结果给用户

场景 2：用户 5 天没使用了

  → checkIdle(): idleDays=5, lastReachOut=null
  → 查记忆：上次在开发项目A的用户认证模块
  → 生成问候： "嘿，好久没聊了。上次项目A的认证方案最后用了 RSA？
     最近有新进展吗？"
  → 通过 Telegram/Discord/CLI 推送
  → 记录空闲问候时间
  
场景 3：用户又过了 7 天还没回来

  → checkIdle(): idleDays=12, lastReachOut=5天前
  → 7天冷却期未到，跳过
  → 第 14 天：idleDays=14, lastReachOut=7天前
  → 再发一条
```

### 6.4 空闲检测的频率控制

| 空闲天数 | 是否问候 | 冷却期 |
|---------|---------|--------|
| 1-2 天 | ❌ 不打扰 | — |
| 3-6 天 | ✅ 发一条 | 之后 7 天内不再发 |
| 7-13 天 | ❌ 冷却中 | — |
| 14+ 天 | ✅ 再发一条 | 之后 7 天冷却 |

不会变成骚扰。一个月最多 4 条问候。

### 6.5 文件改动

| 文件 | 改动 |
|------|------|
| `src/core/scheduler/Scheduler.ts` | **新增**：定时任务调度 + 空闲检测 |
| `src/core/scheduler/types.ts` | **新增**：CronJob 类型定义 |
| `src/core/events/EventBus.ts` | **新增** `deliver:message` 事件的类型定义 |
| 各 platform bridge | 监听 `deliver:message` 事件并发消息 |

### 6.7 纪念日提醒不走补执行

纪念日提醒跟定时任务本质不同：

| | 定时任务（金融资讯） | 纪念日提醒 |
|---|---|---|
| 触发条件 | 固定的时钟时间 | 今天是什么日子 |
| 周期 | 每日/每周/单次 | 每年同一天 |
| 数据来源 | scheduler 任务定义 | events 表中的历史事件（按 `月-日` 匹配） |
| 补执行逻辑 | 在 `[lastCheck, now]` 区间内补跑 | **不能补跑**——补了就是过期提醒 |

**纪念日提醒不应该注册为 Scheduler 的 cron 任务。它应该由 `buildDailyCare()` 处理。**

```
定时任务（Scheduler）:
  用户: "每天早上9点推送金融资讯"
  → Scheduler.addCron({ hour: 9, action: 'custom', prompt: '金融资讯' })
  → 持久化 → 每天9点执行 → 补执行也按9点算

纪念日（buildDailyCare）:
  不需要注册。buildContext() 时自动查 events 表，
  按月-日匹配今天是不是某个历史事件的周年。
  匹配到了就注入 prompt，Agent 自然提及。

  补执行思考:
    用户5月21日开机 → buildDailyCare() 查 "今天是不是周年"
    → 5月21日不是5月20日 → 不匹配
    → 不会发"昨天的纪念日"的过期提醒
    → 正确
    
    如果用户5月20日当天开机 → buildDailyCare() 匹配 → 自然提及
```

**两种机制各管各的，不混淆：**

```
Scheduler（定时任务）
  ├─ "每天早上9点金融资讯" → 补执行用 catchUpMissedJobs
  ├─ "每天8点学新知识" → 补执行用 catchUpMissedJobs
  └─ "周三下午3点提醒打电话" → 一次性任务

buildDailyCare（当日感知）
  ├─ 纪念日 → 按月-日匹配 → 自然提及
  ├─ 生日 → 按月-日匹配 → 自然提及
  └─ 去年今天完成的重要事件 → 按月-日匹配 → 自然提及
```

`buildDailyCare()` 本身不需要补执行——它不是定时触发的，是每次 `buildContext()` 时执行的。用户开机后的第一条消息，`buildContext()` 就会触发当天的纪念日检查。即便当天没发消息，第二天 `buildContext()` 也不会发前一天的过期提醒。`
