# 意图向量库初始化和管理

## 核心概念

**你不需要手动设置向量**，只需要：
1. **定义意图类型**（是什么意图）
2. **提供训练样本**（这个意图的典型表达）
3. **系统自动生成向量**（启动时自动完成）

---

## 初始化流程

### 第 1 步：定义意图配置文件

```typescript
// src/core/intent/intent-definitions.json

{
  "intents": [
    {
      "type": "schedule.reminder",
      "domain": "life",
      "name": "设置提醒",
      "description": "用户想要设置提醒、闹钟、日程",

      // 训练样本（5-10 个典型表达）
      "examples": [
        "提醒我明天 9 点开会",
        "明天早上 8 点叫我起床",
        "设置一个闹钟",
        "提醒我下午 3 点给客户打电话",
        "别忘了提醒我交报告",
        "帮我记住明天要买牛奶",
        "周五 10 点提醒我"
      ]
    },

    {
      "type": "coding.git-commit",
      "domain": "coding",
      "name": "提交代码",
      "description": "用户想要提交代码到 Git",

      "examples": [
        "提交今天的代码",
        "提交这些修改",
        "git commit",
        "把代码提交到仓库",
        "创建一个 commit",
        "保存并提交代码",
        "提交我的更改"
      ]
    },

    {
      "type": "coding.review-pr",
      "domain": "coding",
      "name": "代码审查",
      "description": "用户想要审查代码或 PR",

      "examples": [
        "审查这个 PR",
        "review pull request",
        "帮我看看这段代码",
        "检查代码质量",
        "代码评审",
        "review 一下这个 PR"
      ]
    },

    {
      "type": "finance.expense-record",
      "domain": "finance",
      "name": "记录支出",
      "description": "用户想要记录花费或支出",

      "examples": [
        "记录支出 50 元",
        "午餐花了 30 块",
        "记账：买书 100",
        "今天消费 200",
        "记录一笔花费",
        "花了 50",
        "买东西花了 100"
      ]
    },

    {
      "type": "finance.stock-query",
      "domain": "finance",
      "name": "查询股票",
      "description": "用户想要查询股票信息或分析",

      "examples": [
        "查询茅台股票",
        "腾讯股价多少",
        "看看苹果的股票",
        "分析一下特斯拉",
        "查看最近的股市行情",
        "这只股票怎么样"
      ]
    },

    {
      "type": "learning.flashcard",
      "domain": "learning",
      "name": "创建学习卡片",
      "description": "用户想要创建学习卡片或知识点",

      "examples": [
        "创建一个学习卡片",
        "记住这个知识点",
        "做成 flashcard",
        "添加到我的学习卡片",
        "记录这个概念"
      ]
    },

    {
      "type": "general.question",
      "domain": "general",
      "name": "一般问题",
      "description": "用户的一般性问题",

      "examples": [
        "什么是 TypeScript",
        "如何学习编程",
        "解释一下这个概念",
        "帮我理解",
        "这是什么意思"
      ]
    }
  ]
}
```

### 第 2 步：系统启动时自动生成向量

```typescript
// src/core/intent/VectorIntentMatcher.ts

export class VectorIntentMatcher {
  private embedModel: any;
  private intentVectors = new Map<string, IntentVector>();
  private vectorCachePath: string;

  constructor() {
    this.vectorCachePath = path.join(
      os.homedir(),
      '.xuanji/cache/intent-vectors.json'
    );
  }

  /**
   * 初始化（首次启动或意图定义更新时）
   */
  async init() {
    // 1. 检查是否有缓存的向量
    const cached = await this.loadCachedVectors();

    if (cached && !this.needsRebuild()) {
      // 使用缓存，快速启动（10ms）
      this.intentVectors = cached;
      console.log(`✓ 从缓存加载 ${this.intentVectors.size} 个意图向量`);
      return;
    }

    // 2. 没有缓存或需要重建，加载模型
    console.log('⏳ 首次启动，正在构建意图向量库...');

    this.embedModel = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: true }
    );

    // 3. 加载意图定义
    const intentDefs = await this.loadIntentDefinitions();

    // 4. 为每个意图生成向量
    for (const intentDef of intentDefs) {
      await this.buildIntentVector(intentDef);
    }

    // 5. 保存到缓存
    await this.saveCachedVectors();

    console.log(`✓ 意图向量库构建完成（${this.intentVectors.size} 个意图）`);
  }

  /**
   * 为单个意图生成向量
   */
  private async buildIntentVector(intentDef: IntentDefinition) {
    console.log(`  构建向量: ${intentDef.name} (${intentDef.examples.length} 个样本)`);

    // 1. 为每个样本生成向量
    const exampleVectors: number[][] = [];

    for (const example of intentDef.examples) {
      const vector = await this.encode(example);
      exampleVectors.push(vector);
    }

    // 2. 计算质心向量（平均）
    const centroidVector = this.computeCentroid(exampleVectors);

    // 3. 保存
    this.intentVectors.set(intentDef.type, {
      type: intentDef.type,
      domain: intentDef.domain,
      vector: centroidVector,
      exampleVectors: exampleVectors,
      lastUpdated: Date.now(),
    });
  }

  /**
   * 加载缓存的向量
   */
  private async loadCachedVectors(): Promise<Map<string, IntentVector> | null> {
    try {
      const content = await fs.readFile(this.vectorCachePath, 'utf-8');
      const data = JSON.parse(content);

      const map = new Map<string, IntentVector>();
      for (const [key, value] of Object.entries(data.vectors)) {
        map.set(key, value as IntentVector);
      }

      return map;
    } catch {
      return null;
    }
  }

  /**
   * 保存向量到缓存
   */
  private async saveCachedVectors() {
    const data = {
      version: '1.0.0',
      generatedAt: Date.now(),
      vectors: Object.fromEntries(this.intentVectors),
    };

    await fs.mkdir(path.dirname(this.vectorCachePath), { recursive: true });
    await fs.writeFile(this.vectorCachePath, JSON.stringify(data, null, 2));
  }

  /**
   * 检查是否需要重建
   */
  private needsRebuild(): boolean {
    // 检查意图定义文件的修改时间
    const defFilePath = path.join(__dirname, 'intent-definitions.json');
    const defMtime = fs.statSync(defFilePath).mtimeMs;

    try {
      const cacheMtime = fs.statSync(this.vectorCachePath).mtimeMs;
      return defMtime > cacheMtime;  // 定义文件更新了
    } catch {
      return true;  // 缓存不存在
    }
  }
}
```

### 第 3 步：ChatSession 初始化时加载

```typescript
// src/core/chat/ChatSession.ts

export class ChatSession {
  private intentRouter: IntentRouter;

  async init() {
    console.log('🚀 初始化 Xuanji...');

    // 初始化意图路由器（包含向量匹配器）
    this.intentRouter = new IntentRouter();
    await this.intentRouter.init();  // 这里会加载/生成向量

    // ... 其他初始化
  }
}
```

---

## 启动流程时间线

### 首次启动（无缓存）

```
启动 Xuanji
    ↓
ChatSession.init()
    ↓
IntentRouter.init()
    ↓
VectorIntentMatcher.init()
    ↓
没有缓存 → 需要构建
    ↓
加载 Embedding 模型 (200-500ms)
    ↓
加载 intent-definitions.json
    ↓
为每个意图生成向量:
  - schedule.reminder (7 样本) → 生成质心向量 (70ms)
  - coding.git-commit (7 样本) → 生成质心向量 (70ms)
  - finance.expense-record (7 样本) → 生成质心向量 (70ms)
  - ... (更多意图)
    ↓
保存到缓存 (~/.xuanji/cache/intent-vectors.json)
    ↓
✓ 完成 (总计 1-2s)
```

### 后续启动（有缓存）

```
启动 Xuanji
    ↓
VectorIntentMatcher.init()
    ↓
检查缓存 → 存在且未过期
    ↓
从缓存加载向量 (10ms)
    ↓
✓ 完成（几乎瞬间）
```

---

## 如何添加新意图

### 方式 1: 修改配置文件（推荐）

```typescript
// 1. 编辑 intent-definitions.json
{
  "intents": [
    // ... 现有意图

    // 新增意图
    {
      "type": "health.workout-log",
      "domain": "health",
      "name": "记录运动",
      "description": "用户想要记录运动或健身",

      "examples": [
        "记录今天跑步 5 公里",
        "今天健身 1 小时",
        "运动打卡",
        "记录锻炼",
        "跑了 30 分钟",
        "做了 50 个俯卧撑"
      ]
    }
  ]
}

// 2. 重启 Xuanji
// 系统会自动检测到配置文件更新，重新生成向量
```

### 方式 2: 运行时动态添加

```typescript
// src/core/intent/IntentRegistry.ts

export class IntentRegistry {
  /**
   * 动态添加意图
   */
  async addIntent(intentDef: IntentDefinition) {
    // 1. 生成向量
    const vector = await this.vectorMatcher.buildIntentVector(intentDef);

    // 2. 注册到向量库
    this.vectorMatcher.registerIntent(intentDef.type, vector);

    // 3. 保存到配置文件
    await this.saveIntentDefinition(intentDef);

    // 4. 更新缓存
    await this.vectorMatcher.saveCachedVectors();

    console.log(`✓ 已添加意图: ${intentDef.name}`);
  }
}

// 使用
await intentRegistry.addIntent({
  type: 'travel.book-flight',
  domain: 'life',
  name: '预订机票',
  examples: [
    '订一张去北京的机票',
    '帮我预订机票',
    '查询航班',
    '买机票'
  ]
});
```

---

## 从经验教训自动学习新意图

### 概念

当 Xuanji 从经验教训中学到新的行为模式时，可以自动扩展意图库。

### 实现

```typescript
// src/learning/IntentLearner.ts

export class IntentLearner {
  /**
   * 从经验教训中学习新意图
   */
  async learnFromLesson(lesson: LessonEvent) {
    // 只从成功经验中学习
    if (lesson.type !== 'success') return;

    // 提取用户输入和成功的行为
    const userInput = lesson.context.userInput;
    const successfulAction = lesson.context.myAction;

    // 检查是否有现有意图能匹配（相似度 > 0.6）
    const existingIntent = await this.vectorMatcher.match(userInput, {
      threshold: 0.6
    });

    if (existingIntent.length > 0) {
      // 已有意图可以处理，增强样本
      await this.enhanceIntent(existingIntent[0].type, userInput);
    } else {
      // 没有合适的意图，建议创建新意图
      await this.suggestNewIntent(userInput, successfulAction, lesson);
    }
  }

  /**
   * 增强现有意图（添加新样本）
   */
  private async enhanceIntent(intentType: string, newExample: string) {
    const intentDef = await this.intentRegistry.get(intentType);

    // 添加新样本
    intentDef.examples.push(newExample);

    // 重新生成向量（包含新样本）
    await this.vectorMatcher.buildIntentVector(intentDef);

    console.log(`✓ 意图 ${intentType} 已增强，新增样本: ${newExample}`);
  }

  /**
   * 建议创建新意图
   */
  private async suggestNewIntent(
    userInput: string,
    action: string,
    lesson: LessonEvent
  ) {
    // 生成建议的意图配置
    const suggestion = {
      type: `auto.${this.generateIntentType(action)}`,
      domain: lesson.domain,
      name: `自动学习: ${action}`,
      examples: [userInput],
      confidence: lesson.verification.successCount / lesson.verification.applicationCount,
      learnedFrom: lesson.id,
    };

    // 发送通知给用户（可选）
    this.emit('new-intent-suggestion', suggestion);

    console.log(`💡 建议新增意图: ${suggestion.name}`);
  }

  /**
   * 生成意图类型名称
   */
  private generateIntentType(action: string): string {
    // 简化处理，实际可以用 LLM 生成更好的名称
    return action.toLowerCase().replace(/\s+/g, '-');
  }
}
```

### 使用示例

```typescript
// 用户成功使用了一个新模式
用户输入: "帮我查看最近的日志"
Xuanji: （执行成功，创建 LessonEvent）

// IntentLearner 自动分析
lessonId: lesson-123
type: success
context.userInput: "帮我查看最近的日志"
context.myAction: "查看日志文件"

// 检查现有意图
await vectorMatcher.match("帮我查看最近的日志")
// → 相似度最高: general.question (0.55) ← 低于阈值 0.6

// 建议创建新意图
建议: {
  type: "auto.view-logs",
  domain: "coding",
  examples: ["帮我查看最近的日志"],
  confidence: 1.0
}

// 用户确认后，自动添加
await intentRegistry.addIntent(建议);
```

---

## 管理命令

### CLI 命令

```bash
# 查看所有意图
xuanji intent list
# Output:
# - schedule.reminder (7 样本)
# - coding.git-commit (7 样本)
# - finance.expense-record (7 样本)
# ...

# 查看意图详情
xuanji intent show schedule.reminder
# Output:
# 类型: schedule.reminder
# 领域: life
# 样本数: 7
# 样本:
#   - 提醒我明天 9 点开会
#   - 明天早上 8 点叫我起床
#   ...

# 添加新意图
xuanji intent add health.workout-log \
  --domain=health \
  --examples="记录跑步 5 公里" "今天健身 1 小时" \
  --name="记录运动"

# 添加样本到现有意图
xuanji intent add-example schedule.reminder "周五提醒我开会"

# 重建向量缓存
xuanji intent rebuild

# 测试意图识别
xuanji intent test "明天别忘了叫我"
# Output:
# ✓ 识别为: schedule.reminder (置信度: 0.88)
```

### GUI 界面

**意图管理页面**（设置 → 意图管理）：

```
┌─────────────────────────────────────────────────┐
│ 意图管理                                  [+新增] │
├─────────────────────────────────────────────────┤
│                                                  │
│ 🏠 schedule.reminder                             │
│    设置提醒 · 7 个样本 · 置信度: 高              │
│    [查看] [编辑] [测试]                          │
│                                                  │
│ 🖥️ coding.git-commit                             │
│    提交代码 · 7 个样本 · 置信度: 高              │
│    [查看] [编辑] [测试]                          │
│                                                  │
│ 💰 finance.expense-record                        │
│    记录支出 · 7 个样本 · 置信度: 高              │
│    [查看] [编辑] [测试]                          │
│                                                  │
│ 💡 auto.view-logs (自动学习)                     │
│    查看日志 · 1 个样本 · 置信度: 中              │
│    [查看] [编辑] [删除]                          │
│                                                  │
└─────────────────────────────────────────────────┘
```

**测试界面**：

```
┌─────────────────────────────────────────────────┐
│ 意图识别测试                                     │
├─────────────────────────────────────────────────┤
│                                                  │
│ 输入测试文本:                                     │
│ ┌─────────────────────────────────────────────┐ │
│ │ 明天别忘了叫我起床                            │ │
│ └─────────────────────────────────────────────┘ │
│                                   [识别]         │
│                                                  │
│ 识别结果:                                        │
│ ✓ schedule.reminder (88% 置信度)                 │
│   - 领域: life                                   │
│   - 最接近样本: "明天早上 8 点叫我起床"           │
│                                                  │
│ 其他候选:                                        │
│   - general.question (12%)                       │
│                                                  │
└─────────────────────────────────────────────────┘
```

---

## 最佳实践

### 1. 样本数量

```typescript
// 每个意图提供 5-10 个样本
{
  "type": "schedule.reminder",
  "examples": [
    "提醒我...",   // 样本 1
    "设置闹钟...", // 样本 2
    "别忘了...",   // 样本 3
    "记得...",     // 样本 4
    "叫我...",     // 样本 5
    // 5-10 个足够，太多反而可能过拟合
  ]
}
```

### 2. 样本多样性

```typescript
// ✅ 好的样本（多样化）
"提醒我明天 9 点开会"
"明天早上 8 点叫我起床"
"别忘了提醒我交报告"
"周五 10 点提醒我"
"记得提醒我买牛奶"

// ❌ 不好的样本（太相似）
"提醒我明天 9 点开会"
"提醒我明天 10 点开会"
"提醒我明天 11 点开会"
"提醒我明天 12 点开会"
```

### 3. 意图粒度

```typescript
// ✅ 合适的粒度
schedule.reminder     // 所有提醒
schedule.event        // 所有事件安排

// ❌ 粒度太细（不推荐）
schedule.reminder.morning    // 早上提醒
schedule.reminder.afternoon  // 下午提醒
schedule.reminder.evening    // 晚上提醒
// 这些应该是同一个意图的不同参数
```

### 4. 定期更新

```typescript
// 每周/每月审查意图识别效果
xuanji intent stats

// Output:
// 意图识别统计（最近 7 天）:
// - schedule.reminder: 45 次（100% 准确）
// - coding.git-commit: 23 次（95% 准确）
// - general.question: 67 次（78% 准确）← 需要优化

// 根据统计优化样本
```

---

## 目录结构

```
~/.xuanji/
├── cache/
│   └── intent-vectors.json        # 缓存的向量（自动生成）
├── config/
│   └── intent-definitions.json    # 意图定义（你维护）
└── models/
    └── Xenova/
        └── all-MiniLM-L6-v2/      # Embedding 模型（自动下载）
            ├── onnx/
            │   └── model.onnx
            └── tokenizer.json
```

---

## 总结

### 你需要做的（简单）

1. ✅ **定义意图类型**：编辑 `intent-definitions.json`
2. ✅ **提供训练样本**：每个意图 5-10 个典型表达
3. ✅ **启动系统**：向量自动生成

### 系统自动做的（复杂）

1. ✅ 加载 Embedding 模型
2. ✅ 为每个样本生成向量
3. ✅ 计算质心向量
4. ✅ 保存到缓存
5. ✅ 运行时快速加载

### 启动性能

| 场景 | 耗时 | 说明 |
|------|------|------|
| 首次启动 | 1-2s | 生成向量 + 保存缓存 |
| 后续启动 | 10ms | 从缓存加载 |
| 更新意图 | 200-500ms | 只重建更新的意图 |

### 扩展性

- ✅ 随时添加新意图
- ✅ 从经验教训自动学习
- ✅ 用户可以自定义意图
- ✅ 支持多语言（同一个模型）

**总结**：你只需维护简单的配置文件（意图定义 + 样本），向量生成和管理全部自动化！
