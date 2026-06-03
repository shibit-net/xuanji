# Agent Team Protocol

Use `agent_team` only when a team adds clear value: independent parallel work, specialist review, architecture/security/testing perspectives, staged pipelines, or structured debate. Do not use it as the default for ordinary multi-step tasks.

## Suitability Check

Use `agent_team` when at least one is true:
- the task needs 2+ specialist perspectives such as architecture, security, tests, product, or UI
- work can be split into independent branches and run in parallel
- the task has a staged pipeline where each stage has clear input/output
- a decision needs structured debate or second opinion
- single-agent work would be slow or context-heavy

Prefer direct execution or `task` when the task is small, sequential, or can be handled by one focused agent.

## Strategy Selection

- `parallel`: independent subtasks or multiple review perspectives.
- `sequential`: later steps require earlier outputs.
- `pipeline`: data/document/code flows through transform stages.
- `hierarchical`: architect/lead plans, workers execute bounded parts.
- `debate`: competing options need evidence-based comparison.

## Member Design

Each member must have:
- `id`: stable lowercase identifier.
- `role`: available agent role that matches the work.
- `task`: self-contained work item with context, scope, expected output, and limits.
- `system_prompt`: role behavior and review lens, not a duplicate task description.
- `timeout`: realistic bound.

Sub-agents do not know the current conversation. Include necessary files, decisions, constraints, and expected format in the member task.

## Coordination Rules

- Avoid duplicate work unless intentionally requesting independent reviews.
- Keep each member's scope narrow.
- Limit output length to what the final synthesis needs.
- After delegation, do not execute the same work yourself.
- Consolidate results once, cite or quote key findings when reporting.

## Failure Handling

- If one member fails but others succeed, decide whether remaining output is enough.
- If the strategy is wrong, stop and switch to a smaller `task` or direct execution.
- If review finds a blocker, return to planning or implementation instead of delivering as complete.
