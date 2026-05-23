# Agent Team Execution Protocol

> This protocol is the operating specification that the main agent **must follow** when calling the agent_team tool

---

## 🚦 Pre-execution Mandatory Checklist

Before calling `agent_team`, the main agent **must** complete the following checks:

### 1. Task Suitability Check (MANDATORY)

```
[ ] Task can be decomposed into 3+ independent sub-tasks
[ ] Each sub-task has clear input/output boundaries
[ ] Dependencies between sub-tasks are clear
[ ] Estimated completion time for a single agent exceeds 5 minutes
```

**If any item is ❌, use the `task` tool instead of `agent_team`**

### 2. Strategy Selection (MANDATORY)

**Pre-qualification check**: At least 2 conditions must be met to use agent_team:
- [ ] Task involves ≥3 files/modules
- [ ] Requires multi-person collaboration (different expertise perspectives)
- [ ] Has clear dependency/data chains
- [ ] Has known decision disagreements requiring debate to unify
- [ ] Single agent execution estimated > 15min

If threshold not met → Use `task` tool or execute directly.

Select strategy based on task characteristics (P1 optimized decision tree):

```
IF known decision disagreements / technical selection disputes
  → strategy: "debate"  🗣️ Thorough argumentation (with Judge pre-read optimization)

ELSE IF architecture design needed before division of work
  → strategy: "hierarchical"  🏗️ Architect plans + Workers execute

ELSE IF data needs multi-stage transformation (collect → analyze → report)
  → strategy: "pipeline"  🔄 ETL data flow

ELSE IF sub-tasks have clear sequential dependencies
  → strategy: "sequential"  🔗 Stage serialization

ELSE
  → strategy: "parallel"  ⚡ Default, fastest
```

**Detailed strategy documentation**: See `.xuanji/protocols/agent-team-strategies.md`

### 3. Member Configuration Check (MANDATORY)

Each member must satisfy:

```
[ ] id: Unique identifier (lowercase letters + underscores)
[ ] role: Use the correct agent ID (explore/plan/coder/doc-writer/test-writer)
[ ] task: 🎯 Specific WHAT — the actual work the member should complete (becomes the user message)
    [ ] Clear task description (what to analyze, what to produce)
    [ ] Specific checkpoints/deliverables (3-5 key points)
    [ ] Output format requirements (Markdown/JSON/max X words)
[ ] system_prompt: 🔧 The HOW of the role — guidance injected into system prompt (not job description)
    [ ] Focus area (security/performance/code quality/architecture)
    [ ] Methodology/constraints
    [ ] Perspective/stance
[ ] timeout: Set reasonable timeout (60000-180000ms)
```

**🎯 `task` vs `system_prompt` — Key Difference:**
- `task` = what to do (user message) — "Review src/auth/login.ts for SQL injection vulnerabilities"
- `system_prompt` = how to behave (system prompt) — "Focus on OWASP Top 10: injection, authentication, data exposure"

### 4. Performance Optimization Check (MANDATORY)

```
[ ] Avoid duplicate work: different members should not analyze the same files
[ ] Use fast tools: prefer grep/glob/list_directory
[ ] Limit scope: explicitly specify directories/files to analyze
[ ] Limit output: require output no more than 300-500 words
[ ] Reasonable timeout:
    - Individual member: 60-180 seconds
    - Team total: 300-600 seconds
```

---

## 📋 Detailed Usage Guide for Five Strategies

### Strategy 1: parallel (Parallel Execution) ⭐ Most Used

#### Applicable Scenarios
- ✅ Sub-tasks are completely independent with no dependencies
- ✅ Need fast completion (total time = slowest agent)
- ✅ Analyzing different modules/directories
- ✅ Inspecting the same project from multiple angles

#### Inapplicable Scenarios
- ❌ Subsequent tasks require results from previous ones
- ❌ Need to share intermediate state
- ❌ Tasks have sequential dependencies

#### Execution Characteristics
- **Total time**: max(all member times) ≈ slowest member
- **Resource usage**: High (multiple agents running simultaneously)
- **Result consolidation**: Needs manual consolidation (use single task)

#### Configuration Essentials
```typescript
{
  strategy: "parallel",
  timeout: 300000,  // Team total timeout = slowest member's timeout
  members: [
    {
      id: "member1",
      timeout: 180000,  // Each member can have different timeouts
      task: "Clear independent task — what to output, format requirements",
      system_prompt: "Role/behavior guidance — what to focus on, how to analyze"
    },
    {
      id: "member2",
      timeout: 120000,
      task: "Another completely independent specific task",
      system_prompt: "Behavior guidance from a different perspective"
    }
  ]
}
```

#### Standard Template: Code Analysis

```typescript
{
  team_name: "code-analysis-parallel",
  goal: "Parallel analysis of project architecture, security, and quality",
  strategy: "parallel",
  timeout: 300000,  // 5 minutes
  members: [
    {
      id: "structure",
      role: "explore",
      priority: 1,
      timeout: 120000,
      task: "Quickly collect project structure: list src/ directory tree, count files and core modules, output in JSON format",
      system_prompt: "Use list_directory and glob for quick scanning. Limit to 2 minutes, collect only without analysis."
    },
    {
      id: "security",
      role: "coder",
      priority: 1,
      timeout: 180000,
      task: "Check for security issues: search for exec()/spawn() calls, review BashTool.ts parameter handling, output Top 3 security risks",
      system_prompt: "Focus on command injection, parameter injection, privilege escalation. Use grep for quick location. Limit to 3 minutes."
    },
    {
      id: "quality",
      role: "coder",
      priority: 1,
      timeout: 180000,
      task: "Check code quality: search for any type usage, review AgentLoop.ts complexity, output Top 3 quality issues",
      system_prompt: "Focus on type safety, function complexity, code smells. Limit to 3 minutes."
    },
    {
      id: "architecture",
      role: "plan",
      priority: 1,
      timeout: 180000,
      task: "Analyze architecture design: review core module type definitions, check dependency structure, output architecture pros and cons (no more than 300 words)",
      system_prompt: "Focus on module coupling, interface design, dependency management. Limit to 3 minutes."
    }
  ]
}

// Phase 2: Consolidation (using a single task)
task({
  description: "Based on the analysis from the above 4 experts, generate a final report...",
  subagent_type: "plan",
  timeout: 120000
})
```

### Template 2: Technical Selection (Debate Mode + Judge Pre-read Optimization)

**P1 Optimization**: Judge pre-reads key files before debate, outputs a fact summary. Proponents and opponents reference the summary instead of re-reading files, saving ~46% Tokens.

```typescript
{
  team_name: "tech-decision-debate",
  goal: "Evaluate technical solution A vs B",
  strategy: "debate",
  timeout: 1800000,  // 30 minutes
  max_rounds: 3,     // Don't exceed 3, otherwise Token explosion
  members: [
    {
      id: "advocate_a",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `You support Solution A.
Constraints:
1. First round: output complete arguments (with code reference line numbers)
2. Subsequent rounds: only respond to opponent's arguments + add new evidence
3. Do not re-read already read files; reference line numbers from Judge's summary`
    },
    {
      id: "advocate_b",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `You support Solution B.
Constraints:
1. First round: output complete arguments (with code reference line numbers)
2. Subsequent rounds: only respond to opponent's arguments + add new evidence
3. Do not re-read already read files; reference line numbers from Judge's summary`
    },
    {
      id: "judge",
      role: "plan",
      priority: 2,
      timeout: 120000,
      system_prompt: `[debate_role:judge]
You execute the pre-read phase before the debate begins.

Pre-read phase (only you):
1. Read all relevant key source code files
2. Output a "fact summary" containing: key function line numbers, branch conditions, boundary values
3. Share the summary with both proponents and opponents

Debate phase:
4. Both sides reference code from the summary instead of re-reading files
5. Only re-read specific lines when there is a factual dispute`
    }
  ]
}
```

```typescript
{
  team_name: "tech-decision-debate",
  goal: "Evaluate technical solution A vs B",
  strategy: "debate",
  timeout: 480000,  // 8 minutes
  members: [
    {
      id: "advocate_a",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `You support Solution A (${Solution A description}):
1. List 3 core advantages
2. Analyze applicable scenarios
3. Assess implementation cost
Output no more than 400 words.`
    },
    {
      id: "advocate_b",
      role: "plan",
      priority: 1,
      timeout: 180000,
      system_prompt: `You support Solution B (${Solution B description}):
1. List 3 core advantages
2. Analyze applicable scenarios
3. Assess implementation cost
Output no more than 400 words.`
    },
    {
      id: "judge",
      role: "plan",
      priority: 2,
      timeout: 120000,
      system_prompt: `Based on both sides' arguments, make a final evaluation:
1. Compare the pros and cons of both solutions
2. Provide a recommended solution and reasons
3. List implementation suggestions
Output no more than 500 words.`
    }
  ]
}
```

### Template 3: Modular Analysis (Parallel Mode)

```typescript
{
  team_name: "module-analysis-parallel",
  goal: "Analyze code quality of different modules",
  strategy: "parallel",
  timeout: 300000,
  members: [
    {
      id: "core_module",
      role: "coder",
      priority: 1,
      timeout: 180000,
      system_prompt: `Only analyze the src/core/ directory:
1. Check type safety (use of any)
2. Check error handling (try-catch)
3. Output Top 3 issues (no more than 300 words)`
    },
    {
      id: "adapter_module",
      role: "coder",
      priority: 1,
      timeout: 180000,
      system_prompt: `Only analyze the src/adapters/ directory:
1. Check UI component maintainability
2. Check event handling completeness
3. Output Top 3 issues (no more than 300 words)`
    },
    {
      id: "infra_module",
      role: "coder",
      priority: 1,
      timeout: 180000,
      system_prompt: `Only analyze src/memory/, src/permission/, src/mcp/:
1. Check data persistence security
2. Check permission control completeness
3. Output Top 3 issues (no more than 300 words)`
    }
  ]
}
```

---

## ⚠️ Common Mistakes and How to Avoid Them

### Mistake 1: Task Scope Too Large Leading to Timeout

❌ **Wrong Example**:
```typescript
// ❌ No task field — members don't know what specifically to do
task: "Analyze the entire project's code quality"  // Too vague, no specific scope
```

✅ **Correct Example**:
```typescript
system_prompt: `Only analyze 3 files in src/core/agent/ directory:
- AgentLoop.ts
- SubAgentLoop.ts
- SubAgentFactory.ts
Check type safety and error handling, output no more than 300 words.`
```

### Mistake 2: Using Wrong Agent ID

❌ **Wrong Example**:
```typescript
role: "subagent_planner"  // This is an internal identifier, not an agent ID
```

✅ **Correct Example**:
```typescript
role: "plan"  // Use list_agents to see available agent IDs
```

### Mistake 3: Duplicate Work Between Members

❌ **Wrong Example**:
```typescript
members: [
  { id: "analyzer1", task: "Analyze project architecture" },        // ❌ Missing system_prompt
  { id: "analyzer2", system_prompt: "Analyze project design" }      // ❌ Missing task, will re-read files
]
```

✅ **Correct Example**:
```typescript
members: [
  { id: "structure", task: "Only analyze directory structure and module division", system_prompt: "Focus on module and directory organization" },
  { id: "dependency", task: "Only analyze package.json dependency relationships", system_prompt: "Focus on dependency versions and conflicts" }
]
```

### Mistake 4: Sequential Strategy Causing Timeout

❌ **Wrong Example**:
```typescript
strategy: "sequential",  // 4 tasks executed sequentially = 12 minutes
members: [
  { timeout: 180000 },  // 3 minutes
  { timeout: 180000 },  // 3 minutes
  { timeout: 180000 },  // 3 minutes
  { timeout: 180000 }   // 3 minutes
]
```

✅ **Correct Example**:
```typescript
strategy: "parallel",  // 4 tasks executed in parallel = 3 minutes
members: [
  { timeout: 180000 },
  { timeout: 180000 },
  { timeout: 180000 },
  { timeout: 180000 }
]
```

---

## 🔄 Execution Flow (Main Agent Must Follow)

### Step 1: Task Assessment
```
1. Analyze user request
2. Determine if agent_team is suitable (refer to checklist)
3. If not suitable, use task tool
```

### Step 2: Strategy Selection
```
1. Select strategy based on task characteristics (parallel/sequential/pipeline/debate)
2. Prefer parallel (fastest)
```

### Step 3: Task Decomposition
```
1. Decompose the task into 3-5 independent sub-tasks
2. Ensure each sub-task has clear boundaries
3. Avoid duplicate work between sub-tasks
```

### Step 4: Member Configuration
```
1. Select appropriate agent for each sub-task (explore/plan/coder)
2. Write clear task (what to do specifically) and system_prompt (how to behave)
3. Set reasonable timeout
```

### Step 5: Execution and Monitoring
```
1. Call agent_team
2. If timeout, analyze the cause:
   - Task scope too large? → Narrow scope
   - Wrong strategy? → Switch to parallel
   - Agent stuck? → Reduce that agent's task complexity
3. If failed, degrade to single task
```

### Step 6: Result Consolidation
```
1. If using parallel strategy, results need manual consolidation
2. Use a single task(subagent_type: "plan") to generate the final report
```

---

## 📊 Performance Benchmarks (P2 Optimization)

| Scenario | Recommended Strategy | Member Count | Recommended Timeout | Success Rate |
|----------|---------------------|-------------|-------------------|-------------|
| Code Analysis | parallel | 3-4 | 1,200,000ms | 95% |
| Technical Selection | debate | 3 | 1,800,000ms | 90% |
| Module Analysis | parallel | 3-5 | 1,200,000ms | 95% |
| Architecture + Implementation | hierarchical | 3-4 | 1,500,000ms | 85% |
| CI Pipeline | sequential | 3-4 | 600,000ms | 90% |
| Data Dashboard | pipeline | 2-3 | 600,000ms | 90% |

**Timeout formula**: `timeout = baseTimeout × complexityFactor` (see `agent-team-strategies.md` for details)

**If actual time exceeds 2x the expected time, immediately abort and degrade to a single agent.**

---

## 🚨 Failure Handling Protocol

### Timeout Handling
```
IF agent_team times out
  1. Analyze the cause of timeout (task too large/wrong strategy/agent stuck)
  2. Try to optimize configuration (narrow scope/switch to parallel/reduce members)
  3. If it times out again, degrade to a single task
```

### Partial Failure Handling
```
IF some member fails but others succeed
  1. Collect successful results
  2. Supplement the failed part with a single task
  3. Consolidate all results
```

### Complete Failure Handling
```
IF agent_team completely fails
  1. Immediately degrade to a single task
  2. Use a plan agent to complete the entire task
  3. Record the failure reason in memory
```

---

## ✅ Pre-execution Self-Check (Main Agent Inner Monologue)

Before calling agent_team, the main agent should ask itself:

```
1. Does this task really need multiple agents?
   → Can a single agent complete it within 5 minutes?

2. Can I clearly decompose it into 3+ independent sub-tasks?
   → Are the boundaries of each sub-task clear?

3. Is the strategy I chose reasonable?
   → Is parallel feasible?

4. Is each member's task specific and non-overlapping? Does the system_prompt describe the correct behavioral guidance?
   → Does it include scope, checkpoints, output format, time limits?

5. Is the timeout I set reasonable?
   → Individual member 2-3 minutes, team total 5-10 minutes?

6. Do I have a fallback plan?
   → If it times out, will I degrade to a single task?
```

**If the answer to any question is "uncertain", re-evaluate or use a single agent.**

---

## 📝 Execution Log Template

When the main agent calls agent_team, it should output the following information:

```
🎯 Task: ${user_request}

📋 Assessment Results:
- Suitable for agent_team: ✅/❌
- Selected strategy: ${strategy}
- Member count: ${members.length}
- Estimated time: ${estimated_time}

👥 Member Configuration:
1. ${member1.id} (${member1.role}): ${member1.task_summary}
2. ${member2.id} (${member2.role}): ${member2.task_summary}
...

⏱️ Starting execution...
```

---

## 🎓 Learning and Improvement

After each use of agent_team, the main agent should:

1. **Record execution results**
   - Success/failure
   - Actual time vs expected time
   - Issues encountered

2. **Store in memory**
   ```typescript
   memory_store({
     type: "tool_pattern",
     content: "Used agent_team for code analysis, parallel strategy, 4 members, took 3.5 minutes, success",
     keywords: ["agent_team", "parallel", "code_analysis"]
   })
   ```

3. **Optimize future execution**
   - If a configuration succeeds multiple times, form a standard template
   - If a configuration fails multiple times, avoid using it again

---

## 🔒 Mandatory Rules (Cannot Be Violated)

1. **Prohibited to use wrong agent IDs**
   - Only use: explore, plan, coder, doc-writer, test-writer
   - Must call list_agents to confirm before use

2. **Prohibited to have unbounded task scope**
   - Must explicitly specify directories/files to analyze
   - Must limit output length (no more than 500 words)

3. **Prohibited to have excessively long timeouts**
   - Individual member: automatically calculated by system (based on strategy + complexity), no manual setting needed
   - Debate team total max 60 minutes (30min base × 2.0 round factor)
   - Hierarchical team total max 30 minutes

4. **Prohibited to have duplicate work**
   - Different members should not analyze the same files
   - Use grep/glob for quick location, avoid reading files one by one

5. **Must have a degradation plan**
   - If agent_team fails, must degrade to a single task
   - Do not make the user wait more than 10 minutes

---

## 📚 Reference Resources

- Available agent list: Call `list_agents()`
- Detailed usage guide: `.xuanji/agent-team-guide.md`
- Project rules: `.xuanji/rules.md`
