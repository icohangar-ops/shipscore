# ShipScore

**Lighthouse for the AI era.**

An open-source agent that audits any repository shipping AI features — scores it **0–100**
across **Design, Ship, Run, Secure, Test** — and opens real fix PRs: guardrail middleware,
eval harnesses, CI gates.

Built by **Team Dash** for **Dark Factory** — the official hackathon of WeAreDevelopers
World Congress North America, presented by BAND
([lablab.ai](https://lablab.ai/ai-hackathons/wearedevelopers-hackathon),
online build Sept 26 – Oct 5, 2026).

**Try it live:** [shipscore-gamma.vercel.app](https://shipscore-gamma.vercel.app)
— paste any public GitHub URL and watch it score.

## Why

Everyone is shipping AI features. Almost nobody is shipping them safely:

- Prompts are hardcoded in helper files — unreviewed, unversioned, owned by nobody.
- Agents get broad tool and MCP permissions no human ever reviewed.
- LLM code paths ship with **zero evals** — "tested" means a human shrugged at a demo.
- Prompt-injection surfaces never face an adversarial test before production traffic does.

The congress program says it out loud: the industry is still learning to *design, ship, run,
secure, and test* software in the AI era. **Those five verbs are the score.**

## The five categories

| Category | What it checks |
|---|---|
| 🧭 **Design** | Prompts, tools, and agent roles versioned, documented, and owned — model names not hardcoded |
| 🚀 **Ship** | AI changes ride the same pipeline as plain code — reviewed prompt diffs, gated model upgrades |
| 📈 **Run** | Production behavior observable — token budgets, retry/fallback paths, cost telemetry |
| 🛡️ **Secure** | Every tool call and external string hostile until proven safe — injection surfaces, least-privilege |
| 🧪 **Test** | Evals in CI, not vibes — golden sets, adversarial cases, regression gates |

## Usage — one block of YAML

```yaml
name: ShipScore
on: [pull_request, push]

jobs:
  score:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: team-dash/shipscore@v0
        with:
          threshold: 60   # block merge below this score
          categories: design,ship,run,secure,test
          fix-prs: true   # agent opens guardrail + eval PRs
```

ShipScore posts the score as a PR comment, labels findings by severity, and opens fix PRs.
This repo **dogfoods itself**: the [`shipscore-dogfood`](.github/workflows/shipscore-dogfood.yml)
workflow runs the action on every push.

## Status: v0.2 — fully working

Everything below is **shipped and live**:

- ✅ **Deterministic scanner** (`scanner@0.2.0`) — ts-morph AST + text detectors,
  **11 detector families**: AI-SDK imports, LLM call sites, prompt literals,
  injection surfaces, tool definitions, MCP configs, agent permissions,
  hardcoded secrets, model refs, eval harnesses, runtime guards
- ✅ **Scoring engine v1** (`rubric 1.0.0`) — weighted rubric, severity deductions,
  capped kind penalties, structural gaps + capped credits, weakest-link aggregate
  (`0.6·avg + 0.4·min`)
- ✅ **Scan any public GitHub repo** — shallow git clone locally, codeload tarball
  fallback on serverless (no git binary needed), zip-slip-guarded extraction
- ✅ **Live dashboard + scoreboard** — per-repo scores, trend, delta; SQLite
  persistence with lazy schema-ensure (works on read-only/ephemeral filesystems)
- ✅ **Fix agent** (`fix-agent@0.1.0`) — deterministic fix plans + full PR specs;
  dry-run by default, real PRs triple-gated (FIX_AGENT_ENABLED + GITHUB_TOKEN + apply)
- ✅ **GitHub Action** (`team-dash/shipscore@v0`) — PR scoring comments, threshold
  gates, fix-PR opt-in; **dogfoods itself** on every push
- ✅ Deployed on Vercel: [shipscore-gamma.vercel.app](https://shipscore-gamma.vercel.app)

Dogfood scores right now: **shipscore (self) 86/B** · deliberately vulnerable
test fixture **51/F** (secure: 19 — exactly the spread the scanner should catch).

## The two-minute stage demo

1. **0:00** — paste a real open-source AI repo on stage
2. **0:15** — scanner maps prompts, tool permissions, eval gaps — live
3. **1:00** — score reveals with five-category breakdown
4. **1:20** — the agent opens a real fix PR on GitHub
5. **1:45** — audience repos submitted via QR join the live scoreboard

Wifi-proof: three pre-scanned fallback repos are cached locally in case venue wifi dies.

## Stack

TypeScript end to end · Next.js 16 (landing + API) · ts-morph AST analysis ·
deterministic scoring engine (no LLM in the scoring loop — same input, same score,
every time) · GitHub API + Actions · Prisma/SQLite · Vercel

## Repository layout

```
├── src/
│   ├── app/            # Next.js 16 App Router (landing + dashboard)
│   │   └── api/        # /api/scan · /api/scores · /api/fix
│   ├── components/     # landing, scanner demo, scoreboard widgets
│   └── lib/
│       ├── scanner/    # ts-morph AST + text detectors, clone/tarball, discover
│       ├── scoring/    # versioned rubric + weakest-link engine
│       ├── agent/      # fix planner → PR spec → (gated) GitHub PR
│       └── runtime-paths.ts  # writable-root resolution (workspace ↔ /tmp)
├── action/             # ShipScore GitHub Action runtime
├── action.yml          # Action definition (threshold, categories, fix-prs)
├── tests/fixtures/     # deliberately vulnerable demo repo (scores 51/F)
└── .github/workflows/  # dogfood workflow — ShipScore scans ShipScore
```

## Run locally

```bash
bun install                      # or npm install
cp .env.example .env             # SQLite path (defaults are fine)
bun run db:push                  # create the SQLite schema
bun run dev                      # http://localhost:3000

# score this repo from the CLI
bun src/cli/shipscore-cli.ts .
```

## API

```bash
# engine metadata
curl https://shipscore-gamma.vercel.app/api/scan

# score the built-in vulnerable fixture
curl -X POST https://shipscore-gamma.vercel.app/api/scan \
  -H 'Content-Type: application/json' -d '{"target":"demo"}'

# score any public GitHub repo
curl -X POST https://shipscore-gamma.vercel.app/api/scan \
  -H 'Content-Type: application/json' \
  -d '{"repoUrl":"https://github.com/openai/openai-quickstart-node"}'

# leaderboard
curl https://shipscore-gamma.vercel.app/api/scores

# fix plan (dry-run PR spec — writes nothing)
curl -X POST https://shipscore-gamma.vercel.app/api/fix \
  -H 'Content-Type: application/json' -d '{"target":"demo"}'
```

> Serverless note: the demo scoreboard stores scores in a per-instance SQLite
> (volume-per-lambda). A scan followed by a scoreboard refresh on the same warm
> instance always shows the row; a hosted DB (Turso/libSQL) is the drop-in
> upgrade for cross-instance persistence.

## Deploy

See [DEPLOY.md](DEPLOY.md) for GitHub push + Vercel deployment in under 5 minutes.

## License

MIT — open source from commit one.
