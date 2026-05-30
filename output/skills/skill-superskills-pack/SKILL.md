---
id: "skill-superskills-pack"
name: SuperSkills - Curated Skills Pack
version: "1.0.0"
description: "精选技能合集：TDD、调试、安全、规格工作流、知识库等，基于gstack扩展的企业级技能包"
category: prompt
tags: ["curated", "tdd", "security", "enterprise"]
author: "Ariadoss"
repositoryUrl: "https://github.com/ariadoss/superskills"
parameters:
    transport: "stdio"
    configTemplate: "{\"transport\": \"stdio\", \"command\": \"npx\", \"args\": [\"-y\", \"superskills\"]}"
---

```
   ____                       ____  __   _ ____
  / ___| _   _ _ __   ___ _ _/ ___|| | _(_) | |___
  \___ \| | | | '_ \ / _ \ '__\___ \| |/ / | | / __|
   ___) | |_| | |_) |  __/ |  ___) |   <| | | \__ \
  |____/ \__,_| .__/ \___|_| |____/|_|\_\_|_|_|___/
              |_|
```

Five autonomous skills for AI-native product development.

Two ways to use SuperSkills:

1. **Existing project.** Copy one or more skills into any codebase. They work immediately as Claude Code slash commands. No scaffold, no dependencies, no lock-in.
2. **New project.** Describe a business problem. SuperSkills generates a full Next.js + Supabase project with the five skills already configured.

## What AI-native means

Every component in a value chain evolves from custom-built to commodity. Databases took two decades. Data processing is getting there now. Building an AI-native product means understanding this movement and acting on three consequences:

1. **What to automate.** Components that reached commodity (data storage, text extraction, basic analysis) get automated. No competitive advantage in doing them manually.
2. **Where to differentiate.** The edge moves to what sits above commodity in the chain: connecting data sources nobody was combining, interpreting patterns in context, delivering findings to the person who can act on them before the window closes.
3. **What to create.** Commodity processing opens opportunities that didn't exist before. A B2B distributor can now predict supplier delays from lead time trends and reroute orders automatically. That product wasn't viable when the analysis alone cost three analyst-weeks.

Every skill checks code against four layers:

| Layer | What it does |
|-------|-------------|
| **E**nrichment | Connect and normalize data from scattered sources (email, ERP, APIs, portals) |
| **I**nference | Detect patterns, predict outcomes, flag anomalies |
| **I**nterpretation | Decide what matters and how to frame it for the human |
| **D**elivery | Push insights where people are, triggered by the right conditions |

This is **EIID**. Discovery maps your business problem to these four layers. Every skill checks your code against this mapping.

```
  describe problem ──> discovery ──> tools ──> scaffold ──> working project
       you              EIID        auto       auto         Next.js + Supabase
                       analysis    selected   generated     + 5 autonomous skills
```

## Prerequisites

**For standalone skills:** just Claude Code. Nothing else to install.

**For the CLI (new project generation):**
- Node.js 20 or later. Check with `node --version`.
- Authentication (one of):
  - **Claude CLI** with an active subscription (Max or Pro). Detected automatically. No API key needed.
  - **Anthropic API key**: [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys). Free tier available.

## Install

```bash
npm install -g superskills
```

Or install from source:

```bash
git clone https://github.com/Play-New/SuperSkills.git
cd SuperSkills && npm install && npm run build && npm link
```

If you only need the standalone skills (no CLI), skip the install. Just clone and copy the skill folders into your project (see below).

## Add skills to an existing project

Each skill works standalone on any codebase. No CLI install, no scaffold, no API key.

```bash
# Clone once
git clone https://github.com/Play-New/SuperSkills.git

# Copy the skills you need into your project
cp -r SuperSkills/skills/trust/.claude/ your-project/.claude/
cp -r SuperSkills/skills/design/.claude/ your-project/.claude/
```

The `.claude/` folders merge. Open the project in Claude Code and run:

```
/trust-audit      OWASP Top 10 + GDPR scan on your existing code
/design-review    Audit shadcn usage, a11y, tokens, responsive
```

That's it. The skills read your code, check it against their rules, and append findings to CLAUDE.md.

### Add autonomous hooks (optional)

Without hooks, you run skills manually via slash commands. With hooks, trust checks every file write automatically and tests run before every stop.

```bash
cp SuperSkills/skills/settings.json your-project/.claude/settings.json
```

If you already have a `.claude/settings.json`, merge the hooks manually instead of overwriting.

This adds: security gate on every Write/Edit, security gate on Bash commands, test verification + full audit (trust, strategy, design) before stopping.

### Available skills

| Skill | What It Checks | Commands |
|-------|---------------|----------|
| **strategy** | EIID alignment, scope creep, opportunity suggestions | `/strategy-start`, `-init`, `-review` |
| **design** | shadcnblocks/shadcn usage, WCAG 2.1 AA, design tokens | `/design-init`, `-review` |
| **trust** | OWASP Top 10, GDPR, hardcoded secrets, injection, auth | `/trust-init`, `-audit` |
| **testing** | vitest + Playwright, test pass/fail, coverage gaps | `/testing-init`, `-verify` |
| **efficiency** | Bundle size, Core Web Vitals, N+1 queries, API costs | `/efficiency-init`, `-review` |

All skills include best practices for Supabase, Vercel, Inngest, and Next.js. Each skill folder has a README with details.

### As plugins (Claude Code or Cowork)

Skills are also available as Claude Code plugins with namespaced commands (`/strategy:start` instead of `/strategy-start`).

```bash
# Load locally
claude --plugin-dir SuperSkills/plugins/strategy

# Or zip for Cowork
cd plugins && zip -r strategy.zip strategy/
# Drag into Cowork's Plugins tab
```

## Generate a new project

For new projects, the CLI runs the full pipeline: describe the problem, analyze it through EIID, pick tools, generate everything.

```bash
superskills
```

It asks about your business problem step by step. If you have Claude CLI installed with an active subscription, it uses that automatically. Otherwise it checks for an API key, and if neither is found, it offers an interactive menu.

Optional one-time setup (configures authentication and Claude Code integration):

```bash
superskills init
```

### From Claude Code

No Anthropic API key needed. Claude Code does the EIID analysis itself. SuperSkills only handles scaffolding.

```bash
superskills init    # one-time: saves API key + writes instructions to ~/.claude/CLAUDE.md
```

Then open Claude Code and describe the business problem. Claude Code will create a `discovery.json` and call `superskills scaffold --json --discovery discovery.json --output ./`.

### After scaffold

Scaffold prints exact next steps:

```bash
cd your-project
npm install
cp .env.example .env.local
# Fill in the keys (scaffold tells you where to get each one)
npx supabase start     # needs Docker
npm run dev
```

Then open in Claude Code and run the init skills:

```
/strategy-start     Defines the project, maps EIID, writes CLAUDE.md
/strategy-init      Validates the EIID mapping, sets priorities
/design-init        Asks for brand, configures shadcnblocks + shadcn + tokens
/trust-init         Sets up auth, RLS policies, CORS
/efficiency-init    Sets performance budgets
/testing-init       Configures vitest + Playwright, writes first smoke test
```

These run once. After that, hooks handle ongoing checks automatically.

## Keep skills in sync

As a project evolves (new dependencies, new delivery channels, framework changes), the skill configuration can drift. `evolve` detects this.

```bash
superskills evolve
```

It scans `package.json`, compares against the installed skill configuration, and proposes updates:

- **Skill implications**: "Stripe detected. Trust skill should check PCI-DSS patterns."
- **Negative constraints**: "Use Drizzle, NOT Prisma." Written to CLAUDE.md so Claude never suggests the wrong alternative.
- **MCP data connectors**: "Supabase MCP available for direct database queries." These are data connectors, not skill replacements.

The report can be appended to CLAUDE.md (`--apply`) or output as JSON (`--json`).

## Developer handoff

When a project moves from one developer to another, `handoff` generates a complete status document.

```bash
superskills handoff
```

Writes `HANDOFF.md` with: tech stack, build/test status, EIID mapping, accumulated skill findings from CLAUDE.md, technology constraints, and dependency overview. Everything a new developer needs to understand the project state without reading the full codebase.

Options: `--no-build` and `--no-test` to skip running those checks. `--json` for machine-readable output.

## EIID in practice

Same distributor, layer by layer.

**Enrichment.** Orders arrive as PDF, Excel, and plain text. The ERP uses SKU codes that don't match the supplier portal. Enrichment normalizes everything into one schema and links the IDs.

**Inference.** One supplier's lead time went from 5 days to 8 over six weeks. DACH orders dropped 12% month-over-month. A pricing anomaly shows the same SKU costing 15% more through one channel. None of these are visible in a single source.

**Interpretation.** The lead time increase matters: that supplier handles 30% of high-margin orders. The DACH drop matches last year's seasonal pattern. The pricing anomaly affects $40K/month. Supplier risk first, pricing second, DACH deprioritized.

**Delivery.** Procurement manager gets a Slack message Tuesday morning with the supplier risk and a suggested reallocation. CFO gets a weekly email on the pricing anomaly. Regional manager gets nothing about DACH because it's seasonal noise.

## What Gets Generated

Given a business problem, scaffold produces a Next.js project with:

- **CLAUDE.md** containing the strategic brief and EIID mapping
- **Five subagents** in `.claude/agents/` that run specialized checks
- **Eleven slash commands** in `.claude/skills/` (one entry point, five for initial setup, five for ongoing review)
- **Claude Code hooks** in `.claude/settings.json` that trigger security and test checks automatically
- **A first-run script** that detects when the project is opened for the first time and suggests what to do
- **Next.js + Supabase + Inngest** application structure with delivery integrations
- **Playwright and vitest** configured for E2E and unit testing

## How Skills Run

Skills are checklists with teeth. They check code, report findings to CLAUDE.md, and two of them block: **trust** blocks on security violations (credentials in code, injection, XSS, auth bypass, PII exposure), **testing** blocks when tests fail.

**Automatically via hooks** (configured in `.claude/settings.json`):

Fast gates during work, full audit at the end. Zero overhead while building. One comprehensive report before stopping.

| When | What Happens |
|------|-------------|
| Session starts | Detects first run (missing node_modules, .env.local). Suggests init skills. |
| Before a shell command runs | Fast gate on dangerous commands (credentials, rm -rf, injection). |
| After a file is written or edited | Fast gate on obvious security issues (hardcoded secrets, injection). |
| Before stopping | Two agents run. First: test verification (blocks if tests fail). Second: trust deep scan, strategy alignment, design rules. Both write findings to CLAUDE.md. |

**On demand via slash commands:**

```
/strategy-start     Define project, map EIID, write CLAUDE.md (entry point)
/strategy-review    EIID alignment + proactive opportunity scan
/design-review      Audit shadcnblocks/shadcn usage, hard rules, a11y, tokens
/trust-audit        OWASP Top 10 + GDPR checklist
/efficiency-review  Bundle size, CWV, N+1 queries, cost report
/testing-verify     Run full test suite, report failures
```

## Tool Stack

SuperSkills picks tools based on the delivery channels and data sources in your EIID mapping. All tools are GDPR-verified.

### Core (always included)

| Tool | What It Does |
|------|-------------|
| **Supabase** | Database, auth, storage, pgvector for embeddings |
| **Vercel** | Hosting, edge functions |
| **Inngest** | Durable workflows, cron jobs, retry logic |
| **Claude** | LLM for analysis and inference |
| **OpenAI** | Embeddings |

### Delivery (based on channels)

| Tool | When Selected |
|------|--------------|
| **Brevo** | Email, SMS, or WhatsApp delivery |
| **Telegram** | Telegram delivery |
| **Slack** | Slack delivery |
| **Discord** | Discord delivery |
| **Baileys** | WhatsApp in development (unofficial, ban risk) |

### Enrichment (based on data sources)

| Tool | When Selected |
|------|--------------|
| **Apify** | Web scraping at scale (proxy management, rate limiting) |
| **Supermemory** | Knowledge base connectors (Google Drive, Notion, OneDrive) |
| **Playwright** | Browser-based scraping for dev and sites you control |

### Testing (always included)

| Tool | What It Does |
|------|-------------|
| **Playwright** | E2E browser tests, accessibility audits, visual regression |

Playwright has two roles: testing (primary) and browser-based scraping (secondary). For production scraping at scale, Apify handles proxy rotation and cloud execution.

If you want to review or change the auto-selected tools before scaffolding:

```bash
superskills tools
```

Print the full catalog:

```bash
superskills tools --catalog
```

## Pipeline Mode

For automation and CI, pass JSON files instead of answering prompts:

```bash
superskills discovery --json --input brief.json --output discovery.json
superskills scaffold --json --discovery discovery.json --output ./my-project
```

If you need to override tools in pipeline mode:

```bash
superskills tools --json --input discovery.json --output tools.json
superskills scaffold --json --discovery discovery.json --tools tools.json --output ./my-project
```

### Input Format

The discovery command accepts a JSON brief:

```json
{
  "projectName": "order-automation",
  "context": {
    "forWhom": "client",
    "companyName": "Acme Corp",
    "businessDescription": "B2B hardware distribution, 200 employees",
    "industry": "manufacturing"
  },
  "problem": "4 hours per day spent on manual order processing from email to ERP",
  "desiredOutcome": "Automated order intake with anomaly detection",
  "currentProcess": ["Check email for orders", "Copy data to Excel", "Enter into ERP"],
  "availableData": ["Gmail", "ERP API", "Supplier portal"]
}
```

Print the full JSON Schema with `superskills discovery --schema`.

## Development

### Setup

```bash
git clone https://github.com/Play-New/SuperSkills.git
cd SuperSkills
npm install
```

### Commands

```bash
npm test              # 166 tests across 10 files
npm run type-check    # TypeScript strict mode
npm run dev           # Run CLI in development mode
npm run build         # Compile to dist/
npm run lint          # ESLint
```

### Environment

| Variable | Required | Default |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | No (if Claude CLI available) | Detected via Claude CLI, env, or interactive prompt |
| `SUPERSKILLS_MODEL` | No | `claude-opus-4-6` |

### Tests

166 tests across ten files:

| File | Count | What It Tests |
|------|-------|--------------|
| `analyze.test.ts` | 16 | LLM call mocking, JSON validation, markdown stripping |
| `auth.test.ts` | 13 | Three-tier auth cascade, LLM dispatch, caching |
| `catalog.test.ts` | 24 | Channel mapping, tool selection, category handling |
| `claude-cli.test.ts` | 11 | CLI detection, auth check, execution (child_process mocked) |
| `discovery-core.test.ts` | 10 | Validation pipeline, error transformation |
| `evolve.test.ts` | 21 | Project scanning, skill implications, negative constraints, MCP suggestions |
| `handoff.test.ts` | 18 | Project info collection, HANDOFF.md rendering, skill finding extraction |
| `model-tiers.test.ts` | 7 | Model tier defaults, env override, stable aliases |
| `scaffold.test.ts` | 26 | File generation, hooks, agents, skills, design tokens, Playwright, E2E |
| `schema.test.ts` | 20 | Zod validation edge cases, defaults, JSON Schema output |

## Conceptual References

Three ideas shaped the design.

**Value mapping** (Simon Wardley). Wardley Maps position each component on an evolution axis from genesis to commodity. Discovery uses this to assess which parts of a business process are ready for automation and which still need human judgment. A component at commodity stage (e.g., data storage) gets automated. One at genesis (e.g., a novel scoring model) gets flagged for human oversight.

**Value movement in the AI era** (Sangeet Paul Choudary, *Reshuffle*). Choudary documents how AI commoditizes processing and pushes value toward orchestration and delivery. When any company can run the same model on the same data, the differentiator becomes what happens after the analysis: which findings reach which person, through which channel, triggered by which conditions. EIID ends with Delivery as a distinct layer because that is where the value concentrates.

**Intelligence where the user is** (Peter Steinberger). Steinberger's work on OpenClaw and CLI-first development shows that tools integrated into existing workflows get adopted, while tools that require context-switching get ignored. SuperSkills generates Claude Code hooks and slash commands that run inside the editor. The developer never leaves the terminal.

## License

MIT