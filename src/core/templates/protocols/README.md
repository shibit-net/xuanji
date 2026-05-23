# Xuanji Execution Protocols

This directory contains protocol specifications that the main agent **must follow** when performing specific operations.

## Protocol List

### 1. Agent Team Execution Protocol
**File**: `agent-team-protocol.md`

**Purpose**: Mandatory operating procedures when the main agent calls the `agent_team` tool

**Core Contents**:
- Pre-execution mandatory checklist (task suitability, strategy selection, member configuration)
- Standardized configuration templates (code analysis, technical selection, modular analysis)
- Common mistakes and how to avoid them
- Execution flow (6-step standard process)
- Performance benchmarks and degradation strategies

**When to Use**:
- User requests using agent_team
- Task can be decomposed into 3+ independent sub-tasks
- Multi-domain expert collaboration is needed

### 2. Agent Team Strategy Handbook
**File**: `agent-team-strategies.md`

**Purpose**: Detailed explanation of 5 execution strategies, their usage, and best practices

**Core Contents**:
- **parallel**: Fastest, suitable for independent tasks
- **debate**: Technical selection, solution comparison
- **pipeline**: Data processing, ETL workflows
- **sequential**: Tasks with dependencies
- **hierarchical**: Master-slave collaboration (use with caution)

**When to Use**:
- When you need to choose the right strategy
- When unsure which strategy is optimal
- When you need reference to standard templates

---

## How to Use Protocols

### Method 1: Integrated into System Prompt (Recommended)

Reference the protocol in the main agent's system prompt:

```
# Agent Team Usage Guidelines

Before calling the agent_team tool, you must follow the execution protocol in `.xuanji/protocols/agent-team-protocol.md`:

1. Complete the mandatory checklist
2. Choose the appropriate strategy (prefer parallel)
3. Use standardized templates for member configuration
4. Set reasonable timeout values
5. After execution, decide whether to consolidate based on results
```

### Method 2: Read at Runtime

The main agent reads the protocol file when needed:

```typescript
// Pseudo-code
if (user_requests_agent_team) {
  protocol = read_file(".xuanji/protocols/agent-team-protocol.md")
  follow_protocol(protocol)
  execute_agent_team()
}
```

### Method 3: Pre-processing Check

Automatic check before tool execution:

```typescript
// Pseudo-code
before_tool_execution("agent_team", (params) => {
  check_task_suitability(params.goal)
  validate_strategy(params.strategy)
  validate_members(params.members)
  estimate_timeout(params)
})
```

---

## Protocol Update Log

### 2024-01-XX
- Created `agent-team-protocol.md`
- Defined mandatory checklist
- Provided 3 standardized templates
- Added common mistakes and how to avoid them

---

## Contribution Guide

If you find issues in the protocol or need to add content:

1. Document the problems encountered during actual execution
2. Analyze the root cause (improper task decomposition? Unreasonable timeout settings?)
3. Update the protocol document
4. Record the change in the update log

---

## Related Documents

- **User Guide**: `.xuanji/agent-team-guide.md` - User-facing usage guide
- **Execution Protocol**: `.xuanji/protocols/agent-team-protocol.md` - Agent-facing execution specification
