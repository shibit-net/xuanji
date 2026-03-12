# DailyUsage 统计实现总结

## 概述

实现了按天/模型聚合的使用统计功能,方便用户查看历史使用情况和费用趋势。

## 实现文件

### 核心模块

1. **`src/core/telemetry/DailyUsageStats.ts`** — 聚合引擎
   - 从 `UsageStatsRecorder` 的 JSONL 日志读取原始数据
   - 按日期+模型分组聚合统计
   - 增量聚合（避免重复处理）
   - JSON 格式缓存聚合结果到 `~/.xuanji/stats/daily.json`
   - 支持自定义存储路径（用于测试隔离）

2. **`src/adapters/cli/StatsFormatter.ts`** — 格式化工具
   - `formatDailyStats()` — 按天统计格式化
   - `formatCostTrend()` — 费用趋势（ASCII 柱状图）
   - `formatTopTools()` — 工具排行（Top N）
   - `formatModelSummary()` — 按模型汇总

3. **`src/adapters/cli/StatsCommands.ts`** — CLI 命令（未使用，直接集成到 App.tsx）
   - 原计划作为独立命令模块
   - 实际直接集成到 App.tsx 的 SlashCommand 注册

### CLI 集成

4. **`src/adapters/cli/App.tsx`** — 注册 `/stats` 命令
   - 导入 `DailyUsageStats`, `PricingResolver`, 格式化函数
   - 注册 `/stats` 命令（位于 `/cost` 之后）
   - 支持子命令：today/week/month/model/tools/update/YYYY-MM-DD

5. **`src/core/telemetry/index.ts`** — 导出新模块
   - 导出 `DailyUsageStats`, `DailyUsageRecord`, `DailyUsageFilter`

### 测试

6. **`test/unit/telemetry/DailyUsageStats.test.ts`** — 单元测试
   - 19 个测试用例，全部通过
   - 覆盖聚合、查询、工具排行、费用趋势、增量聚合等场景

## 数据结构

### 原始数据源

从 `UsageStatsRecorder` 读取 JSONL 日志：
- 文件：`~/.xuanji/logs/usage.jsonl`
- 格式：每行一个 JSON 对象

```typescript
interface UsageRecord {
  timestamp: string;
  sessionId?: string;
  model: string;
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  durationMs: number;
  iterations?: number;
  toolCalls?: ToolCallStats[];
}
```

### 聚合数据结构

```typescript
interface DailyUsageRecord {
  date: string;                  // YYYY-MM-DD
  model: string;
  totalCalls: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;             // USD
  tools: Record<string, number>; // { tool_name: count }
  avgIterations: number;
  totalDurationMs: number;
}
```

### 存储格式

聚合结果保存为 JSON 文件：
- 文件：`~/.xuanji/stats/daily.json`
- 格式：
```json
{
  "version": "1.0",
  "records": [
    {
      "date": "2026-03-09",
      "model": "claude-sonnet-4",
      "totalCalls": 42,
      "totalTokens": 125340,
      "inputTokens": 85230,
      "outputTokens": 35110,
      "cachedTokens": 5000,
      "totalCost": 0.52,
      "tools": {
        "read_file": 18,
        "edit_file": 12,
        "bash": 8
      },
      "avgIterations": 3,
      "totalDurationMs": 210000
    }
  ],
  "lastUpdate": "2026-03-09T10:30:00.000Z"
}
```

## 核心接口

### DailyUsageStats 类

```typescript
class DailyUsageStats {
  constructor(
    pricingResolver?: PricingResolver,
    usageRecorder?: UsageStatsRecorder,
    dailyFilePath?: string,  // 自定义存储路径（可选）
  );

  // 聚合原始数据
  aggregate(startDate?: Date, endDate?: Date): Promise<DailyUsageRecord[]>;

  // 增量聚合并保存
  aggregateAndSave(): Promise<void>;

  // 查询接口
  getDaily(date: string): Promise<DailyUsageRecord[]>;
  getRange(startDate: string, endDate: string): Promise<DailyUsageRecord[]>;
  getByModel(model: string): Promise<DailyUsageRecord[]>;
  query(filter: DailyUsageFilter): Promise<DailyUsageRecord[]>;

  // 分析接口
  getTopTools(limit: number): Promise<{ name: string; count: number }[]>;
  getCostTrend(days: number): Promise<{ date: string; cost: number }[]>;

  // 管理接口
  clear(): Promise<void>;
}
```

### 查询过滤器

```typescript
interface DailyUsageFilter {
  model?: string;
  startDate?: string;  // YYYY-MM-DD
  endDate?: string;    // YYYY-MM-DD
  limit?: number;
}
```

## CLI 命令

### `/stats` 命令

```bash
/stats                # 查看今日统计
/stats today          # 查看今日统计
/stats week           # 查看最近 7 天趋势
/stats month          # 查看最近 30 天趋势
/stats model          # 查看模型使用汇总（最近 30 天）
/stats tools          # 查看最常用工具 Top 10
/stats update         # 重新聚合统计数据
/stats 2026-03-09     # 查看指定日期统计
```

### 输出示例

#### `/stats today`

```
📊 使用统计

日期: 2026-03-09
模型: claude-sonnet-4
调用: 42 次
Token: 125,340
  - 输入: 85,230
  - 输出: 35,110
  - 缓存读: 5,000
费用: $0.52
平均迭代: 3 轮
工具使用:
  - read_file: 18 次
  - edit_file: 12 次
  - bash: 8 次
```

#### `/stats week`

```
📈 最近 7 天费用趋势

2026-03-03  $0.32  ████████░░░░░░░░░░░░
2026-03-04  $0.45  ████████████░░░░░░░░
2026-03-05  $0.28  ███████░░░░░░░░░░░░░
2026-03-06  $0.52  ████████████████░░░░
2026-03-07  $0.61  ████████████████████
2026-03-08  $0.38  ██████████░░░░░░░░░░
2026-03-09  $0.42  ███████████░░░░░░░░░

总计: $2.98
平均: $0.43
```

#### `/stats tools`

```
🔧 最常用工具 (Top 10)

1. read_file             127 次  ████████████████████
2. edit_file              89 次  ██████████████░░░░░░
3. bash                   56 次  █████████░░░░░░░░░░░
4. write_file             42 次  ███████░░░░░░░░░░░░░
5. grep                   38 次  ██████░░░░░░░░░░░░░░
```

#### `/stats model`

```
📋 模型使用汇总

模型: claude-sonnet-4
  调用: 342 次
  Token: 1,253,400
  费用: $5.20

模型: claude-haiku-4.5
  调用: 156 次
  Token: 456,780
  费用: $0.82

模型: gpt-4o
  调用: 45 次
  Token: 123,450
  费用: $0.45

总计:
  调用: 543 次
  Token: 1,833,630
  费用: $6.47
```

## 实现要点

### 1. 聚合逻辑

从 JSONL 读取数据并按日期+模型分组：

```typescript
async function aggregate(): Promise<DailyUsageRecord[]> {
  const logs = await readUsageLogs();
  const grouped = new Map<string, DailyUsageRecord>();

  for (const log of logs) {
    const date = new Date(log.timestamp).toISOString().split('T')[0]!;
    const key = `${date}:${log.model}`;

    // 聚合统计...
  }

  return Array.from(grouped.values());
}
```

### 2. 增量聚合

只处理新增的记录（避免重复聚合）：

```typescript
async function aggregateAndSave(): Promise<void> {
  const existing = await loadAggregated();

  // 找到最后聚合的日期
  let lastUpdateTime: Date | undefined;
  const reprocessDates = new Set<string>();

  if (existing.records.length > 0) {
    const lastDate = existing.records[0]!.date;
    lastUpdateTime = new Date(`${lastDate}T00:00:00Z`);
    lastUpdateTime.setDate(lastUpdateTime.getDate() - 1); // 往前一天重新聚合
    reprocessDates.add(lastDate); // 最后一天需要重新处理
  }

  // 聚合新增的记录（包括最后一天）
  const newRecords = await this.aggregate(lastUpdateTime);

  // 移除需要重新处理的日期
  const filteredExisting = existing.records.filter(
    r => !reprocessDates.has(r.date)
  );

  // 合并已有数据（不累加,直接替换重新处理的日期）
  const merged = this.mergeRecords(filteredExisting, newRecords);

  await saveAggregated(merged);
}
```

**关键点**：
- 最后一天的数据可能不完整（当天仍在进行中）
- 重新聚合时，先移除最后一天的旧数据，再添加新聚合的数据
- 避免累加导致重复计算

### 3. 费用计算

使用 `PricingResolver` 三级降级定价：

```typescript
const costTracker = new CostTracker(record.model, this.pricingResolver);
const cost = costTracker.calculateCost({
  input: record.input,
  output: record.output,
  cacheRead: record.cacheRead,
  cacheWrite: record.cacheWrite,
});
```

### 4. 费用趋势补齐

填充缺失日期（费用为 0）：

```typescript
async getCostTrend(days: number): Promise<{ date: string; cost: number }[]> {
  const records = await getRange(startStr, endStr);

  // 按日期聚合费用
  const dailyCosts = new Map<string, number>();
  for (const record of records) {
    const cost = dailyCosts.get(record.date) || 0;
    dailyCosts.set(record.date, cost + record.totalCost);
  }

  // 填充缺失日期
  const result: { date: string; cost: number }[] = [];
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0]!;
    result.push({ date: dateStr, cost: dailyCosts.get(dateStr) || 0 });
  }

  return result;
}
```

## 测试覆盖

### 基础聚合（6 个测试）

- ✅ 按日期+模型聚合
- ✅ 跨多天聚合
- ✅ 聚合工具调用
- ✅ 处理缓存 token
- ✅ 日期范围过滤
- ✅ 排序（日期降序，模型升序）

### 查询接口（4 个测试）

- ✅ 按日期查询
- ✅ 按日期范围查询
- ✅ 按模型查询
- ✅ 多维度过滤

### 工具排行（2 个测试）

- ✅ Top N 工具
- ✅ 跨日期聚合工具计数

### 费用趋势（2 个测试）

- ✅ 最近 N 天趋势
- ✅ 填充缺失日期

### 增量聚合（2 个测试）

- ✅ 合并相同日期的记录（不重复累加）
- ✅ 保留已有数据，添加新日期

### 边界情况（3 个测试）

- ✅ 空数据处理
- ✅ 清空聚合数据

## 性能优化

### 1. 缓存聚合结果

聚合结果保存到 JSON 文件，避免每次查询都重新聚合。

### 2. 增量聚合

只处理新增的记录，减少重复计算。

### 3. 内存索引（未实现）

未来可实现内存索引加速查询（按日期、模型）。

## 未来扩展

### 1. 更多维度统计

- 按小时/周/月聚合
- 按用户聚合（多用户支持）
- 按项目聚合（项目级统计）

### 2. 可视化

- 图表展示（使用终端图表库）
- 费用预测（基于历史趋势）
- 异常检测（费用突增告警）

### 3. 导出功能

- 导出 CSV/Excel
- 导出 PDF 报表
- 邮件定时报告

### 4. 定时任务

在每天 00:00 自动聚合：

```typescript
// 在 ChatSession.init() 中注册
const midnightMs = getMidnightMs();
setTimeout(async () => {
  await DailyUsageStats.aggregateAndSave();
}, midnightMs);
```

## 完成标准

- ✅ DailyUsageStats 类实现完整
- ✅ 聚合逻辑正确（按日期+模型分组）
- ✅ 查询接口完善（日期/范围/模型/工具/趋势）
- ✅ 增量聚合工作正常（不重复累加）
- ✅ 集成到 CLI 命令（/stats）
- ✅ 单元测试通过（19 个测试）
- ✅ TypeScript 类型完整
- ✅ 格式化输出友好

## 总结

成功实现了按天/模型聚合的使用统计功能，包括：

1. **核心功能**：
   - 从 JSONL 日志聚合数据
   - 按日期+模型分组统计
   - 增量聚合避免重复处理
   - JSON 格式缓存结果

2. **查询能力**：
   - 按日期/范围/模型查询
   - 工具排行（Top N）
   - 费用趋势（补齐缺失日期）
   - 模型使用汇总

3. **CLI 集成**：
   - `/stats` 命令及 8 个子命令
   - 友好的格式化输出
   - ASCII 柱状图展示趋势

4. **测试覆盖**：
   - 19 个单元测试全部通过
   - 覆盖聚合、查询、排行、趋势等场景
   - 测试隔离（自定义存储路径）

5. **类型安全**：
   - TypeScript 类型完整
   - 无类型错误

用户现在可以方便地查看历史使用情况和费用趋势，更好地了解和控制 LLM 使用成本。
