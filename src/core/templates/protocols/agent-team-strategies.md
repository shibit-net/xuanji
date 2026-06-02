# Agent Team Strategy Guide

This is a short reference for choosing `agent_team` strategies. Load detailed examples only when needed.

## parallel

Use when subtasks are independent.

Best for:
- different modules/directories
- multiple review lenses on the same change
- collecting facts in parallel

Avoid when later work depends on earlier results.

## sequential

Use when each step needs the previous step's output.

Best for:
- discover → analyze → report
- reproduce → diagnose → fix plan
- requirement → product plan → implementation outline

Keep member count small because total time is cumulative.

## pipeline

Use when output from one stage becomes structured input for the next stage.

Best for:
- data extraction → normalization → report
- document conversion → validation → summary
- code scan → issue grouping → remediation plan

Define output format for each stage.

## hierarchical

Use when a lead/architect must split work and integrate results.

Best for:
- cross-module implementation planning
- large refactors
- architecture decisions with bounded worker tasks

The lead should own scope control and synthesis.

## debate

Use when two or more viable approaches need evidence-based comparison.

Best for:
- architecture tradeoffs
- migration strategy
- security vs usability decisions
- performance vs simplicity decisions

Limit debate rounds and require evidence, not opinions.

## General Rules

- Prefer fewer members with sharper scopes.
- Give each member self-contained context.
- Avoid repeated file reads by assigning distinct focus areas.
- Require concise outputs unless the task explicitly needs detail.
- If team overhead exceeds value, use direct execution or `task` instead.
