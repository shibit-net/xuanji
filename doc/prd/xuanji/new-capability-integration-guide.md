# 新增能力的意图识别集成指南

## 问题场景

当 Xuanji 新增 System Prompt / Skill / Agent 时，如何让向量意图识别准确定位到新能力？

---

## 集成流程

### 第 1 步：定义意图类型

```typescript
// src/core/intent/intent-definitions.json

{
  "intents": [
    // ... 现有意图

    // 新增：股票分析意图
    {
      "type": "finance.stock-analysis",
      "domain": "finance",
      "name": "股票分析",
      "description": "用户想要分析股票或查看股市行情",

      // 核心：提供 5-10 个高质量训练样本
      "examples": [
        "分析一下茅台的股票",
        "腾讯股价怎么样",
        "看看苹果公司最近走势",
        "帮我分析特斯拉",
        "查询最近的股市行情",
        "这只股票值得买吗",
        "评估一下阿里巴巴",
        "股市今天涨了吗"
      ]
    }
  ]
}
```

**训练样本质量要求**：

1. **多样性**：覆盖不同表达方式
   - ✅ "分析茅台" / "看看茅台" / "评估茅台" / "茅台怎么样"
   - ❌ "分析茅台" / "分析贵州茅台" / "分析茅台股票" (太相似)

2. **代表性**：贴近真实用户输入
   - ✅ "这只股票怎么样" (口语化)
   - ❌ "执行股票技术分析功能" (过于正式)

3. **区分度**：与现有意图有明显差异
   ```typescript
   // 避免与现有意图重叠
   "finance.expense-record": ["记录支出 50 元", "午餐花了 30"]
   "finance.stock-analysis": ["分析茅台股票", "股价怎么样"]
   // ↑ 两者语义差异明显
   ```

---

### 第 2 步：配置 Skill 映射

```typescript
// src/core/intent/CapabilityAssembler.ts

private intentTypeToSkillId(intentType: string): string | null {
  const mapping: Record<string, string> = {
    // ... 现有映射

    // 新增映射
    'finance.stock-analysis': 'stock-analyzer',
    //        ↑                         ↑
    //    意图类型                  Skill ID
  };

  return mapping[intentType] || null;
}
```

---

### 第 3 步：系统自动更新向量

**启动时自动检测**：

```typescript
// VectorIntentMatcher.init() 流程：

// 1. 检查是否需要重建
private needsRebuild(): boolean {
  const defFilePath = path.join(__dirname, 'intent-definitions.json');
  const defMtime = fs.statSync(defFilePath).mtimeMs;

  try {
    const cacheMtime = fs.statSync(this.vectorCachePath).mtimeMs;
    return defMtime > cacheMtime;  // 定义文件更新了？
  } catch {
    return true;  // 缓存不存在
  }
}

// 2. 重建向量（仅重建新增/修改的意图）
if (this.needsRebuild()) {
  console.log('⏳ 检测到意图配置变更，正在更新向量库...');

  // 加载新的意图定义
  const intentDefs = await this.loadIntentDefinitions();

  // 为每个意图生成向量
  for (const intentDef of intentDefs) {
    await this.buildIntentVector(intentDef);
  }

  // 保存到缓存
  await this.saveCachedVectors();

  console.log(`✓ 向量库已更新（${this.intentVectors.size} 个意图）`);
}
```

**运行时动态添加**：

```typescript
// src/core/intent/IntentRegistry.ts

export class IntentRegistry {
  /**
   * 运行时动态添加意图（无需重启）
   */
  async addIntent(intentDef: IntentDefinition): Promise<void> {
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

// 使用示例
await intentRegistry.addIntent({
  type: 'health.workout-log',
  domain: 'health',
  name: '记录运动',
  examples: [
    '记录今天跑步 5 公里',
    '今天健身 1 小时',
    '运动打卡'
  ]
});
```

---

## 识别准确性保证

### 1. 相似度阈值调整

```typescript
// VectorIntentMatcher.match() 参数

await vectorMatcher.match(userInput, {
  threshold: 0.7,  // 相似度阈值（0-1）
  topK: 3          // 返回前 K 个候选
});

// 阈值选择：
// 0.6 - 宽松，召回率高，但可能误判
// 0.7 - 平衡，推荐默认值
// 0.8 - 严格，准确率高，但可能漏判
```

**调优策略**：

| 场景 | 阈值建议 | 原因 |
|------|---------|------|
| 新增意图（初期） | 0.6 | 提高召回率，观察效果 |
| 稳定运行 | 0.7 | 平衡准确率和召回率 |
| 关键领域（金融） | 0.8 | 降低误判风险 |

### 2. 意图测试工具

```bash
# CLI 命令
xuanji intent test "分析一下茅台股票"

# 输出：
# ✓ 识别为: finance.stock-analysis (置信度: 0.88)
#   - 领域: finance
#   - 最接近样本: "分析一下茅台的股票"
#
# 其他候选:
#   - general.question (0.45)
#   - finance.expense-record (0.23)
```

**测试流程**：

```typescript
// src/core/intent/IntentTester.ts

export class IntentTester {
  async testIntent(userInput: string): Promise<void> {
    // 1. 执行匹配
    const results = await this.vectorMatcher.match(userInput, {
      threshold: 0.6,  // 降低阈值，查看所有候选
      topK: 5
    });

    // 2. 输出详细结果
    console.log(`\n用户输入: "${userInput}"\n`);

    if (results.length === 0) {
      console.log('❌ 未识别到任何意图（所有相似度 < 0.6）');
      return;
    }

    console.log(`✓ 识别为: ${results[0].type} (置信度: ${results[0].confidence})`);
    console.log(`  - 领域: ${results[0].domain}`);

    // 找到最接近的样本
    const closestExample = await this.findClosestExample(
      userInput,
      results[0].type
    );
    console.log(`  - 最接近样本: "${closestExample}"`);

    // 其他候选
    if (results.length > 1) {
      console.log('\n其他候选:');
      for (let i = 1; i < results.length; i++) {
        console.log(`  - ${results[i].type} (${results[i].confidence})`);
      }
    }
  }
}
```

### 3. 样本质量分析

```bash
# 分析意图样本的区分度
xuanji intent analyze finance.stock-analysis

# 输出：
# 意图: finance.stock-analysis
# 样本数: 8
# 平均内部相似度: 0.82  ← 样本之间的相似度（应该较高）
# 与其他意图最小距离: 0.35  ← 与最近意图的距离（应该足够大）
#   最近意图: finance.expense-record (0.35)
#
# 建议:
# ✓ 样本多样性良好（内部相似度适中）
# ⚠️ 与 finance.expense-record 距离较近，建议增加区分样本
```

---

## 常见问题和解决方案

### 问题 1: 新意图无法被识别

**现象**：
```bash
用户输入: "分析一下茅台股票"
识别结果: general.question (0.65)
期望结果: finance.stock-analysis
```

**原因**：训练样本不足或不够多样

**解决方案**：
```json
// 增加更多样化的训练样本
{
  "type": "finance.stock-analysis",
  "examples": [
    // 原有样本
    "分析一下茅台的股票",
    "腾讯股价怎么样",

    // 新增：不同动词
    "看看苹果公司最近走势",
    "查询阿里巴巴股价",
    "帮我评估特斯拉",

    // 新增：不同表达
    "这只股票值得买吗",
    "股市今天涨了吗",
    "最近大盘怎么样"
  ]
}
```

### 问题 2: 与现有意图冲突

**现象**：
```bash
用户输入: "记录买股票花了 1000 元"
识别结果: finance.stock-analysis (0.75)
期望结果: finance.expense-record
```

**原因**：样本重叠，语义边界不清

**解决方案**：
```typescript
// 明确区分两个意图的样本

// finance.stock-analysis（分析和查询）
"examples": [
  "分析茅台股票",
  "查询股价",
  "股市行情"
  // ✅ 强调"分析"、"查询"、"行情"
]

// finance.expense-record（记录支出）
"examples": [
  "记录支出 50 元",
  "花了 100 买午餐",
  "今天消费 200"
  // ✅ 强调"记录"、"花费"、"消费"
]

// 调整阈值，优先精确匹配
await vectorMatcher.match(userInput, {
  threshold: 0.75  // 提高阈值
});
```

### 问题 3: 识别速度慢

**现象**：
```bash
首次启动: 2-3s (正常)
后续启动: 2-3s (异常，应该 10ms)
```

**原因**：缓存未生效

**解决方案**：
```typescript
// 检查缓存路径权限
const cachePath = '~/.xuanji/cache/intent-vectors.json';

// 确保目录存在
await fs.mkdir(path.dirname(cachePath), { recursive: true });

// 检查缓存是否生效
if (fs.existsSync(cachePath)) {
  const stats = fs.statSync(cachePath);
  console.log(`缓存大小: ${stats.size} bytes`);
  console.log(`缓存时间: ${stats.mtime}`);
}
```

---

## 最佳实践

### 1. 新增意图前的检查清单

- [ ] 确认意图是否真的需要（是否可以复用现有意图）
- [ ] 准备 5-10 个高质量训练样本
- [ ] 检查与现有意图的区分度
- [ ] 配置 IntentType → SkillId 映射
- [ ] 编写测试用例验证识别率

### 2. 训练样本编写规范

```typescript
// ✅ 好的样本
"examples": [
  "分析茅台股票",           // 简洁、口语化
  "看看苹果公司走势",       // 不同动词
  "这只股票怎么样",         // 自然表达
  "股市今天涨了吗",         // 场景化
  "查询最近行情"            // 领域术语
]

// ❌ 不好的样本
"examples": [
  "执行股票技术分析功能模块",  // 过于正式
  "分析贵州茅台股份有限公司",  // 过于详细
  "请帮我分析一下股票",        // 废话太多
  "分析",                      // 过于简单
  "stock analysis"             // 语言不一致（除非多语言）
]
```

### 3. 迭代优化流程

```
1. 新增意图（初始样本 5 个）
   ↓
2. 测试常见输入（xuanji intent test）
   ↓
3. 观察识别效果
   ├── 准确率 < 80% → 增加样本
   ├── 与其他意图冲突 → 调整样本区分度
   └── 准确率 > 90% → 稳定运行
   ↓
4. 收集真实用户输入
   ↓
5. 定期分析识别日志
   ↓
6. 持续优化样本（每月一次）
```

---

## CLI 命令参考

```bash
# 查看所有意图
xuanji intent list

# 查看意图详情
xuanji intent show finance.stock-analysis

# 测试意图识别
xuanji intent test "分析茅台股票"

# 分析意图质量
xuanji intent analyze finance.stock-analysis

# 添加新意图
xuanji intent add health.workout-log \
  --domain=health \
  --examples="记录跑步 5 公里" "今天健身 1 小时" \
  --name="记录运动"

# 添加样本到现有意图
xuanji intent add-example finance.stock-analysis "大盘今天怎么样"

# 重建向量缓存
xuanji intent rebuild

# 查看识别统计
xuanji intent stats
# Output:
# 意图识别统计（最近 7 天）:
# - finance.stock-analysis: 45 次（95% 准确）
# - coding.git-commit: 23 次（100% 准确）
# - general.question: 67 次（78% 准确）← 需要优化
```

---

## 总结

### 核心要点

1. **用户只需提供样本**：5-10 个高质量训练样本
2. **系统自动生成向量**：启动时检测变更并重建
3. **准确性靠样本质量**：多样性、代表性、区分度
4. **持续迭代优化**：测试工具 + 真实数据 + 定期调整

### 集成流程

```
新增 Skill/Agent
    ↓
定义意图类型（intent-definitions.json）
    ↓
提供训练样本（5-10 个）
    ↓
配置 IntentType → SkillId 映射
    ↓
启动系统（自动生成向量）
    ↓
测试验证（xuanji intent test）
    ↓
观察效果 → 迭代优化
```

### 成功标准

- ✅ 目标意图识别率 > 90%
- ✅ 与其他意图区分度 > 0.3
- ✅ 平均相似度 0.75 - 0.95
- ✅ 首次启动 < 2s，后续 < 10ms

**记住**：向量匹配是语义理解，不是关键词匹配。好的训练样本是成功的关键！
