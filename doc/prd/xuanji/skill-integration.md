# Skill 系统整合方案

## 设计目标

将**静态 Skill**（配置文件）和**动态 Skill**（学习得到）无缝整合，让 Xuanji 既能使用预定义的技能，又能不断学习新技能。

---

## 架构设计

### 统一的 Skill Registry

```
┌─────────────────────────────────────────────────────────┐
│             UnifiedSkillRegistry                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────┐      ┌──────────────────┐       │
│  │  Static Skills   │      │  Learned Skills  │       │
│  │ (配置文件)        │      │ (学习得到)        │       │
│  ├──────────────────┤      ├──────────────────┤       │
│  │ • 预定义         │      │ • 从经验提取      │       │
│  │ • 手动编写       │      │ • LLM 生成        │       │
│  │ • 版本控制       │      │ • 动态演化        │       │
│  │ • 可编辑         │      │ • 自适应          │       │
│  └──────────────────┘      └──────────────────┘       │
│           ↓                         ↓                  │
│  ┌─────────────────────────────────────────────────┐  │
│  │         Skill Matcher（技能匹配器）             │  │
│  │  - 语义匹配（向量检索）                         │  │
│  │  - 规则匹配（关键词、上下文）                   │  │
│  │  - 优先级：learned > static（动态优先）         │  │
│  └─────────────────────────────────────────────────┘  │
│           ↓                                            │
│  ┌─────────────────────────────────────────────────┐  │
│  │         Skill Executor（技能执行器）            │  │
│  │  - 应用技能到当前任务                           │  │
│  │  - 跟踪执行结果                                 │  │
│  │  - 更新成功率                                   │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

---

## 数据流

### 1. 加载 Skill

```typescript
// 启动时
async function loadAllSkills() {
  // [1] 加载静态 skill（从配置文件）
  const staticSkills = await skillRegistry.loadFromFiles([
    '~/.xuanji/skills/',
    '.xuanji/skills/',
  ]);

  // [2] 加载动态 skill（从数据库）
  const learnedSkills = await skillStore.getAll({
    type: 'skill',
    minConfidence: 0.6,  // 置信度阈值
  });

  // [3] 合并（动态 skill 优先级更高）
  const allSkills = mergeSkills(staticSkills, learnedSkills);

  return allSkills;
}
```

### 2. 匹配 Skill

```typescript
// 用户输入时
async function matchSkills(userInput: string, context: Context) {
  const allSkills = await loadAllSkills();

  // [1] 语义匹配（向量检索）
  const semanticMatches = await vectorSearch(userInput, allSkills);

  // [2] 规则匹配（关键词、工具、领域）
  const ruleMatches = ruleBasedMatch(userInput, context, allSkills);

  // [3] 综合评分（learned skill 加权系数更高）
  const scored = allSkills.map(skill => ({
    skill,
    score: calculateScore(skill, semanticMatches, ruleMatches),
  }));

  // [4] 返回 Top 3
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(s => s.skill);
}

function calculateScore(skill, semanticMatches, ruleMatches) {
  let score = 0;

  // 语义相似度
  const semantic = semanticMatches.find(m => m.id === skill.id);
  if (semantic) score += semantic.similarity * 0.5;

  // 规则匹配
  if (ruleMatches.includes(skill.id)) score += 0.3;

  // 成功率
  score += skill.metrics.successRate * 0.2;

  // 动态 skill 加权（优先使用学习到的）
  if (skill.source === 'learned') score *= 1.2;

  return score;
}
```

### 3. 应用 Skill

```typescript
// 执行时
async function applySkill(skill: Skill) {
  // [1] 注入到 system prompt
  const skillPrompt = `
## 推荐技能: ${skill.name}

${skill.description || ''}

### 执行步骤:
${skill.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

### 工具:
${skill.tools.join(', ')}

### 成功率:
${(skill.metrics.successRate * 100).toFixed(0)}% (已使用 ${skill.metrics.usageCount} 次)

${skill.source === 'learned' ? '💡 这是从经验中学到的技能' : ''}
`;

  return skillPrompt;
}
```

### 4. 更新 Skill

```typescript
// 执行后
async function updateSkill(skill: Skill, result: ExecutionResult) {
  // 更新指标
  skill.metrics.usageCount++;
  skill.metrics.lastUsed = Date.now();

  const success = result.success ? 1 : 0;
  const alpha = 0.3; // 学习率

  skill.metrics.successRate =
    skill.metrics.successRate * (1 - alpha) + success * alpha;

  // 如果是静态 skill，改进后生成新的动态 skill
  if (skill.source === 'static' && needsImprovement(skill, result)) {
    const improved = await improveSkill(skill, result);
    await skillStore.save({
      ...improved,
      source: 'hybrid', // 标记为混合（源自静态但已改进）
      configPath: skill.configPath,
    });
  }

  // 如果是动态 skill，直接更新
  if (skill.source === 'learned' || skill.source === 'hybrid') {
    await skillStore.update(skill.id, skill);
  }

  // 如果动态 skill 表现非常好，导出为配置文件
  if (
    skill.source === 'learned' &&
    skill.metrics.successRate > 0.9 &&
    skill.metrics.usageCount > 10
  ) {
    await exportSkillToConfig(skill);
  }
}
```

---

## 双向转换

### 学习到的 Skill → 配置文件

```typescript
async function exportSkillToConfig(skill: Skill) {
  const config = {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    type: 'agent',
    category: 'learned',

    triggers: skill.triggers.keywords,

    systemPrompt: `
你是一个专注于"${skill.name}"的助手。

## 背景
${skill.description}

## 执行步骤
${skill.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## 推荐工具
${skill.tools.join(', ')}

## 注意事项
${skill.lesson?.whatToAvoid || '无'}
`,

    tools: skill.tools.map(name => ({ name, required: false })),

    metadata: {
      source: 'learned',
      learnedFrom: skill.learnedFrom,
      successRate: skill.metrics.successRate,
      usageCount: skill.metrics.usageCount,
      exportedAt: new Date().toISOString(),
    },
  };

  // 保存到 ~/.xuanji/skills/learned/
  await fs.writeFile(
    path.join(homedir(), '.xuanji', 'skills', 'learned', `${skill.id}.json5`),
    JSON5.stringify(config, null, 2)
  );

  console.log(`[SkillExport] Exported skill "${skill.name}" to config file`);
}
```

### 配置文件 Skill → 学习系统改进

```typescript
async function improveStaticSkill(
  staticSkill: Skill,
  failureResult: ExecutionResult
) {
  // 使用 LLM 分析为什么失败
  const analysis = await analyzeFail(staticSkill, failureResult);

  // 生成改进后的步骤
  const improvedSteps = await generateImprovedSteps(
    staticSkill.steps,
    analysis
  );

  // 创建新的动态 skill（hybrid）
  const hybrid: Skill = {
    ...staticSkill,
    id: `${staticSkill.id}-v${Date.now()}`,
    source: 'hybrid',
    steps: improvedSteps,
    version: staticSkill.version + 1,
    learnedFrom: [failureResult.experienceId],
    refinedCount: 1,
  };

  await skillStore.save(hybrid);

  console.log(
    `[SkillRefine] Created hybrid skill "${hybrid.name}" v${hybrid.version}`
  );

  return hybrid;
}
```

---

## 优先级策略

### Skill 选择优先级（从高到低）

1. **Hybrid Skill**（混合）- 基于静态但已优化 - 成功率高，可信度高
2. **Learned Skill**（学习得到）- 高成功率（>0.8）且多次验证（>5次）
3. **Static Skill**（静态）- 预定义的，可靠但可能不是最优
4. **Learned Skill**（低成功率）- 新学到的，需要验证

### 冲突解决

如果同一任务匹配到多个 skill：

```typescript
function resolveConflict(skills: Skill[]): Skill {
  // [1] 按优先级排序
  const sorted = skills.sort((a, b) => {
    const scoreA = getSkillPriority(a);
    const scoreB = getSkillPriority(b);
    return scoreB - scoreA;
  });

  return sorted[0];
}

function getSkillPriority(skill: Skill): number {
  let priority = 0;

  // 来源优先级
  if (skill.source === 'hybrid') priority += 100;
  else if (skill.source === 'learned') priority += 80;
  else if (skill.source === 'static') priority += 60;

  // 成功率加权
  priority += skill.metrics.successRate * 50;

  // 使用次数加权（log scale）
  priority += Math.log10(skill.metrics.usageCount + 1) * 10;

  return priority;
}
```

---

## 实施步骤

### Phase 1: 基础整合（2-3天）

- [ ] 创建 `src/learning/UnifiedSkillRegistry.ts`
- [ ] 实现 loadFromFiles()（加载静态 skill）
- [ ] 实现 loadFromDatabase()（加载动态 skill）
- [ ] 实现 mergeSkills()（合并两种 skill）

### Phase 2: 匹配与应用（2-3天）

- [ ] 创建 `src/learning/SkillMatcher.ts`
- [ ] 语义匹配（向量检索）
- [ ] 规则匹配（关键词、工具）
- [ ] 综合评分与排序

### Phase 3: 动态改进（2-3天）

- [ ] 创建 `src/learning/SkillRefiner.ts`
- [ ] 失败分析（LLM）
- [ ] 步骤优化
- [ ] 版本管理

### Phase 4: 双向转换（1-2天）

- [ ] exportSkillToConfig()（导出为配置文件）
- [ ] improveStaticSkill()（改进静态 skill）
- [ ] 自动触发机制

---

## 示例场景

### 场景 1: 使用静态 Skill

```
用户: "帮我调试这个 React 组件"

系统:
  [1] 匹配到静态 skill: "debug-react-component"
  [2] 应用步骤:
      - 检查 console 错误
      - 检查 props 传递
      - 检查 state 更新
  [3] 执行成功

结果: 静态 skill 成功率 +1
```

### 场景 2: 静态 Skill 失败，学习改进

```
用户: "帮我调试这个 React 组件"

系统:
  [1] 匹配到静态 skill: "debug-react-component"
  [2] 执行步骤，但失败（没检查 Hook 规则）
  [3] LLM 分析：缺少 "检查 Hook 调用顺序" 步骤
  [4] 生成改进版本（hybrid skill）:
      - 检查 console 错误
      - 检查 props 传递
      - 检查 state 更新
      - ✨ 检查 Hook 调用顺序（新增）
  [5] 保存为 hybrid skill

结果: 下次优先使用改进版本
```

### 场景 3: 学习到新 Skill

```
用户: "帮我优化这段代码的性能"

系统:
  [1] 无匹配的 skill
  [2] 执行任务（使用通用方法）
  [3] 成功（用户满意度 5/5）
  [4] 提取经验:
      - 发现使用了 useMemo + useCallback
      - 效果很好
  [5] 生成新 skill: "react-performance-optimization"
      - 步骤: 识别重渲染 → useMemo → useCallback
      - 保存到数据库

结果: 新学到一个技能
```

### 场景 4: 学到的 Skill 表现优异，导出

```
系统定期检查:
  [1] "react-performance-optimization" skill:
      - 成功率: 92%
      - 使用次数: 15 次
      - 所有条件满足
  [2] 导出为配置文件:
      ~/.xuanji/skills/learned/react-performance-optimization.json5
  [3] 成为"准官方" skill，可分享给其他用户

结果: 从经验中学到的技能固化为可复用资产
```

---

## 总结

### 核心优势

1. **最大化复用** - 静态 skill 提供基础，动态 skill 提供优化
2. **持续进化** - 每次失败都是学习机会
3. **知识积累** - 成功经验固化为 skill，永久保存
4. **开放生态** - 学到的 skill 可导出、分享

### 与现有系统的关系

```
SkillRegistry（现有）
  ↓ 扩展
UnifiedSkillRegistry（新）
  ↓ 整合
静态 Skill + 动态 Skill
  ↓ 共同服务
AgentLoop（应用 skill）
  ↓ 反馈
LessonStore（记录经验）
  ↓ 提取
新的 Skill（学习循环）
```

这样，Xuanji 就拥有了一个**自我进化的技能系统**，既能使用人工定义的最佳实践，又能不断从实践中学习新技能！
