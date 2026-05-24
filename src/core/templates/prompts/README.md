# Prompt Component Template

This directory contains built-in prompt component templates.

## Directory Structure

```
src/core/templates/prompts/     # Built-in templates (git tracked)
└── README.md                   # This file

.xuanji/users/{userId}/prompts/ # User-defined components (not git tracked)
├── custom-coding-example.json5 # Example: custom coding scene
└── custom-rules-example.json5  # Example: custom rules
```

## User-Defined Components

Users can create their own prompt components in the `.xuanji/users/{userId}/prompts/` directory.

### File Format

Supports JSON5, YAML, and JSON formats. JSON5 is recommended (supports comments).

### Configuration Example

```json5
{
  // Unique identifier (required)
  id: 'my-custom-coding',
  
  // Human-readable name (required)
  name: 'My Custom Coding Guide',
  
  // Layer (required): L0 | L1 | L2 | L3
  layer: 'L1',
  
  // Applicable scenes (required for L1 components)
  scenes: ['coding'],
  
  // Priority (required): higher number = higher priority
  // Recommended range: L0: 90-100, L1: 70-80, L2: 80-90, L3: 60-70
  priority: 75,
  
  // Estimated token count (required)
  estimatedTokens: 500,
  
  // Whether enabled (optional, default true)
  enabled: true,
  
  // Scene matching configuration (optional for L1 components)
  match: {
    // Keyword regex (string format) — plain natural language keywords separated by spaces
    keywords: 'programming code development bug testing',
    // Scene description (for embedding matching and list_scenes display)
    description: 'Custom coding scene guide, including code conventions and tool preferences'
  },
  
  // Required tools list (optional)
  requiredTools: ['read_file', 'write_file', 'edit_file'],
  
  // Extended Thinking configuration (optional)
  thinking: {
    type: 'adaptive',  // 'enabled' | 'adaptive'
    effort: 'medium',  // 'low' | 'medium' | 'high'
    budgetTokens: 2000
  },
  
  // Prompt content (required, Markdown format)
  content: `# My Custom Coding Guide

## Code Conventions

- Use 4-space indentation
- Use camelCase for function names
- Use PascalCase for class names
- Use UPPER_SNAKE_CASE for constants

## Tool Preferences

- Prefer pnpm over npm
- Use Vitest as the testing framework
- Use Prettier for code formatting

## Custom Rules

- Back up configuration files before modifying
- Ask the user before executing dangerous operations
- Run tests before committing code
`
}
```

### Layer Description

- **L0 Core Layer**: Always loaded, contains core identity and safety boundaries
- **L1 Capability Layer**: Loaded in standard/complex mode, selected based on scene (coding/life etc.)
- **L2 Behavior Layer**: Only loaded in complex mode, contains planning, loop control, etc.
- **L3 Context Layer**: Dynamically loaded, only when a project is detected. Includes:
  - Project type and structure (automatically detected via ProjectScanner)
  - Project rule files (loaded by priority):
    - `XUANJI.md` — Rule file in project root (can be committed to git, shared by team)
    - `.xuanji/rules.md` — Private project rules (not committed to git)
    - `~/.xuanji/rules.md` — Global user rules
  - Code structure index (Top N files and exported symbols)
  - Dependency analysis (package.json, pom.xml, etc.)

### Complexity and Scene Configuration

Default complexity and scene can be set in the Agent configuration file:

```yaml
# .xuanji/users/{userId}/agents/xuanji.yaml
prompt:
  # Default scene (auto-analyzed if not set)
  defaultScene: "coding"
  # Default complexity ('standard' if not set)
  # - simple: L0 + L3 only (~600 tokens)
  # - standard: L0 + L1 + L3 (~1,400 tokens)
  # - complex: L0 + L1 + L2 + L3 (~2,400 tokens)
  defaultComplexity: "standard"
```

**Notes**:
- `defaultScene`: Skips scene analysis, directly uses the specified scene. Suitable for dedicated agents (e.g., coding-only agents)
- `defaultComplexity`: Controls prompt verbosity. Simple is fine for Q&A, complex for task planning
- These can be overridden at runtime (e.g., specifying scene/complexity when calling the API)

### Priority Rules

Within the same layer, higher-priority components are rendered first.

- To override built-in components, set a higher priority
- To supplement built-in components, set a lower priority

### Scene Matching

L1 components need to define `scenes` and `match` configuration:

- `scenes`: List of scene names (e.g., `['coding']`)
- `match.keywords`: Natural language keywords separated by spaces (for LLM scene classification prompt injection and vector embedding matching)
- `match.description`: Scene description (for embedding/semantic matching and list_scenes display)

### Hot Reload

After modifying configuration files, they will be automatically reloaded without restarting xuanji.

## Common Use Cases

### 1. Custom Coding Standards

```json5
{
  id: 'my-coding-style',
  name: 'My Coding Style',
  layer: 'L1',
  scenes: ['coding'],
  priority: 76,  // Slightly higher than built-in l1-coding (75)
  estimatedTokens: 300,
  content: `# My Coding Style

- Use TypeScript strict mode
- All functions must have JSDoc comments
- No use of any type
- Prefer functional programming
`
}
```

### 2. Adding a New Scene

```json5
{
  id: 'research-assistant',
  name: 'Research Assistant',
  layer: 'L1',
  scenes: ['research'],
  priority: 70,
  estimatedTokens: 600,
  match: {
    keywords: 'research survey analysis report paper',
    description: 'Academic research, market survey, data analysis, report writing'
  },
  content: `# Research Assistant

## Research Workflow
1. Define research question
2. Search for relevant sources
3. Analyze and synthesize
4. Present findings with citations
`
}
```

### 3. Custom L2 Rules

```json5
{
  id: 'my-safety-rules',
  name: 'My Safety Rules',
  layer: 'L2',
  priority: 85,
  estimatedTokens: 200,
  content: `# My Safety Rules

- Before deleting files, always create a backup first
- Before modifying the database, always create a snapshot first
- Before executing rm -rf, always double-confirm
`
}
```

### 4. Disabling Built-in Components

If you want to completely replace a built-in component, you can create a component with the same ID and set a higher priority, or extend the built-in component.

Note: Built-in components cannot be directly disabled, but they can be overridden by custom components with higher priority.

## Debugging

View loaded components:

```bash
# View logs
tail -f .xuanji/users/{userId}/logs/xuanji-*.log | grep PromptComponentRegistry
```

The logs will show:
- Which user-defined components were loaded
- Component IDs, names, and layers
- Whether there were any loading errors

## Best Practices

1. **Keep it simple**: Each component focuses on one topic
2. **Use appropriate layers**: Choose layers based on usage frequency
3. **Be explicit about priorities**: Avoid conflicts between components
4. **Use comments**: JSON5 supports comments, make full use of them
5. **Version control**: Important custom components can be backed up to Git
6. **Test and verify**: Test the effect after modification to ensure it meets expectations

## Troubleshooting

### Component Not Loading

1. Check that the file format is correct (JSON5/YAML/JSON)
2. Check that all required fields are complete
3. Check if `enabled` is set to `false`
4. Check the error messages in the log

### Component Not Taking Effect

1. Check if `layer` and `scenes` match the current scene
2. Check if `priority` is high enough
3. Check if `content` is empty
4. Use `DEBUG_FULL_REQUEST=1` to view the final system prompt

### Hot Reload Not Working

1. Make sure the file was saved successfully
2. Check file permissions
3. Restart xuanji
