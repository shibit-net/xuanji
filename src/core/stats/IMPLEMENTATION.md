# Quick Stats Command - Implementation Summary

## ✅ Completed Implementation

### Core Modules Created

1. **Type Definitions** (`src/types/stats.ts`)
   - `DailyStats`, `ToolUsage`, `UsageRecord` interfaces
   - `ITokenStatsCollector`, `IStatsStorage` abstractions

2. **Pricing Configuration** (`src/core/stats/PricingConfig.ts`)
   - Provider pricing table (Anthropic, OpenAI, OpenRouter)
   - `calculateCost()` function for cost estimation

3. **Storage Layer** (`src/core/stats/StatsStorage.ts`)
   - JSON file-based storage: `~/.xuanji/stats/YYYY-MM.json`
   - Methods: `saveRecord()`, `getDailyRecords()`, `getRangeRecords()`
   - Automatic monthly file organization

4. **Stats Collector** (`src/core/stats/TokenStatsCollector.ts`)
   - Core business logic for aggregating usage data
   - Methods: `recordUsage()`, `getDailyStats()`, `getTopTools()`, `getRangeStats()`
   - Automatic tool usage tracking and ranking

5. **Module Exports** (`src/core/stats/index.ts`)
   - Centralized exports
   - Global singleton: `globalStatsCollector`

6. **CLI Display Component** (`src/adapters/cli/components/StatsDisplay.tsx`)
   - Ink React component for formatted terminal output
   - Shows: total tokens, cost, top 3 tools, daily breakdown
   - Visual bar charts for tool usage

7. **CLI Command Handler** (`src/adapters/cli/commands/stats.ts`)
   - Command options: `--today`, `--week`, `--month`, `--json`
   - Default: today's stats

8. **Unit Tests** (`src/core/stats/__tests__/TokenStatsCollector.test.ts`)
   - Mock storage implementation
   - Test coverage: recording, aggregation, cost calculation, tool ranking

---

## 🔌 Integration Points (Manual Steps Required)

### 1. Provider Integration

**File to modify**: `src/core/agent/Agent.ts`

Add token usage recording in the stream processing loop:

```typescript
import { globalStatsCollector } from '../stats/index.js';

// In Agent.run() method, when processing stream events:
for await (const event of stream) {
  if (event.type === 'usage' && event.usage) {
    await globalStatsCollector.recordUsage({
      provider: this.getProviderName(),
      model: this.config.model,
      inputTokens: event.usage.input,
      outputTokens: event.usage.output,
      toolName: this.currentTool?.name,
    });
  }
  // ... other event handling
}
```

**Reference**: See `src/core/stats/ProviderIntegration.example.ts`

---

### 2. CLI Command Registration

**File to modify**: `src/adapters/cli/index.ts`

Register the stats command in the CLI router:

```typescript
import { statsCommand } from './commands/stats.js';

// Add to command registry
const commands = {
  // ... existing commands
  stats: statsCommand,
};
```

**Reference**: See `src/adapters/cli/commands/stats.integration.example.ts`

---

## 📋 Usage Examples

```bash
# Show today's stats (default)
xuanji stats

# Show last 7 days
xuanji stats --week

# Show last 30 days
xuanji stats --month

# JSON output
xuanji stats --json
```

---

## 🧪 Testing

Run unit tests:

```bash
npm test src/core/stats/__tests__/TokenStatsCollector.test.ts
```

---

## 📁 File Structure

```
src/
├── types/
│   └── stats.ts                          # Type definitions
├── core/
│   └── stats/
│       ├── PricingConfig.ts              # Provider pricing
│       ├── StatsStorage.ts               # Persistent storage
│       ├── TokenStatsCollector.ts        # Core logic
│       ├── index.ts                      # Module exports
│       ├── ProviderIntegration.example.ts # Integration guide
│       └── __tests__/
│           └── TokenStatsCollector.test.ts
└── adapters/
    └── cli/
        ├── commands/
        │   ├── stats.ts                  # Command handler
        │   └── stats.integration.example.ts
        └── components/
            └── StatsDisplay.tsx          # Display component
```

---

## 🎯 Next Steps

1. **Integrate into Agent loop** (see ProviderIntegration.example.ts)
2. **Register CLI command** (see stats.integration.example.ts)
3. **Run tests** to verify implementation
4. **Test end-to-end** with real LLM calls
5. **Update documentation** (README.md, CHANGELOG.md)

---

## 🔒 Security & Privacy

- No sensitive data stored (only token counts and model names)
- Stats files stored in user home directory: `~/.xuanji/stats/`
- File permissions: user-only read/write (default Node.js behavior)

---

## 🚀 Future Enhancements (Out of Scope)

- Export to CSV/JSON
- Budget alerts
- Web dashboard
- Per-project tracking
- Cost trend analysis

---

## 📝 Notes

- **Storage format**: Monthly JSON files for efficient querying
- **Cost accuracy**: Based on public pricing, may not reflect discounts
- **Performance**: Optimized for daily/weekly queries, monthly aggregation
- **Compatibility**: Works with all providers (Anthropic, OpenAI, OpenRouter)
