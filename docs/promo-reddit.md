# Reddit r/opensource Post

**Title**: Xuanji — An open-source multi-agent AI butler that builds a knowledge graph of everything you tell it

**Link**: https://github.com/shibit-net/xuanji

---

Most AI assistants have the same three problems:

**1. They remember sentences, not relationships.**
You say "Morgan hates spicy food" and "Pepper liked that Italian place." Later you ask "book a dinner for my family." Most assistants search their vector DB and find those sentences — but they don't know Morgan is your daughter, Pepper is your wife, or that the Italian place is connected to Pepper. They store documents. Not knowledge.

**2. They're solo workers.**
"Pull test data, compare three alloy options, run simulation, generate report." OpenClaw spawns one sub-agent that does everything sequentially. Hermes Agent runs agents in parallel but has no debate mechanism — when two agents disagree, you're the referee.

**3. They don't learn from corrections.**
You correct them once. They change their answer. Next time, same mistake. No feedback loop writes the correction back to memory.

Xuanji takes a different approach:

- **Knowledge Graph Memory**: Every piece of information is decomposed into entities, relations, and events. Morgan is an entity with attributes (dislikes spicy, loves cheeseburgers) and relations (is Tony's daughter). Not a vector search — a traversable graph.

- **5 Collaboration Strategies**: Sequential pipeline, parallel analysis, hierarchical delegation, expert debate, and data pipeline. No suitable agent? Xuanji creates one on the spot.

- **Correction → Permanent Fix**: You correct something once → the graph updates → it never repeats the mistake.

- **L0-L2 Layered Prompt**: Base security rules always loaded. Scene-specific rules loaded on demand (1-3 at a time). Coordination rules only for complex tasks. No garbage context filling the LLM's attention window.

- **MCP + Skills loaded on demand**: Browser automation? Load Playwright MCP. Desktop control? Load computer-use MCP. Tools aren't preloaded into the system prompt.

- **100% Local Data**: Conversations, memory graph, API keys — all encrypted, all local, zero telemetry.

**Stack**: TypeScript + Electron + React + SQLite + Cytoscape graph visualization. AGPL-3.0 licensed.

**Honest caveat**: This is not Jarvis yet. Model reasoning has ceilings. Multi-agent coordination can be unstable in edge cases. Graph accuracy degrades with data volume. But we ship every week.

Stars, issues, and PRs welcome: https://github.com/shibit-net/xuanji
