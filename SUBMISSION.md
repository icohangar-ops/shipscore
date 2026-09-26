# ShipScore — Hackathon Submission Kit

> **Event:** Dark Factory — WeAreDevelopers x BAND hackathon
> ([lablab.ai/ai-hackathons/wearedevelopers-hackathon](https://lablab.ai/ai-hackathons/wearedevelopers-hackathon))
> **Online build:** Sept 26 – Oct 5, 2026 · Registration opens Sept 26, 16:00 UTC
> **Team:** Dash

---

## 1. Key links (fill in on submission day)

| What | URL |
|---|---|
| Live demo (scoring app) | https://shipscore-gamma.vercel.app |
| Public GitHub repo | `<TO ADD — create repo, then push shipscore-repo>` |
| Demo video | `<TO RECORD — script in §3>` |
| Submission page | lablab.ai event page → "Submit project" |

---

## 2. Pre-filled submission form fields

### Project name
**ShipScore**

### Tagline (one-liner)
> Lighthouse for the AI era — ShipScore audits any repo shipping AI features, scores it 0–100 across Design, Ship, Run, Secure, Test, and opens the fix PRs.

### Short description (~100 words)
Everyone is shipping AI features; almost nobody is shipping them safely. Prompts live unreviewed in helper files, agents hold tool and MCP permissions no human ever approved, and LLM code paths ship with zero evals. ShipScore is an open-source agent that scans a repository, maps every AI touchpoint (11 detector families: prompt literals, injection surfaces, tool definitions, agent permissions, hardcoded secrets, model refs, eval harnesses, and more), and scores the repo 0–100 across five categories — Design, Ship, Run, Secure, Test — with a deterministic, versioned rubric. It then plans and opens real fix PRs: guardrail middleware, least-privilege workflows, eval harnesses, CI gates.

### Long description (~300 words) — talking points
- **The gap:** AI features broke the review pipeline. A prompt change can silently alter product behavior, yet it rides through the same PR flow as a CSS tweak — unreviewed, untested, unversioned.
- **The idea:** Port Lighthouse's trick to the AI era: a standardized, reproducible score anyone can put in CI. Five verbs from the congress program — design, ship, run, secure, test — become five scored categories with a public rubric.
- **How it works:** A deterministic scanner (ts-morph AST + text detectors — no LLM in the scoring loop, so the same input always yields the same score) builds a touchpoint map. A versioned scoring engine (severity deductions, capped kind penalties, structural gaps, capped credits, weakest-link aggregate) turns the map into a 0–100 score with per-category breakdown.
- **What makes it real:** It scans anything — local paths, the built-in vulnerable fixture (scores 51/F), or any public GitHub URL (git clone locally; codeload tarball fallback on serverless where git doesn't exist). ShipScore dogfoods itself: the repo ships a GitHub Action that scores every push, and the landing page's scoreboard is fed by the live API.
- **The fix loop:** For every finding class there's a deterministic fix rule. The agent produces full PR specs (secret-to-env, least-privilege workflow permissions, prompt-guard wrapping, eval-coverage advisories). Dry-run by default; opening real PRs requires an explicit triple gate.
- **Stack:** TypeScript end to end, Next.js 16, ts-morph, Prisma/SQLite, GitHub Actions, Vercel.

### Built with
TypeScript · Next.js 16 · ts-morph · Prisma + SQLite · GitHub Actions · Vercel

---

## 3. Demo video script (~3 min, screen recording)

**Shot list with timestamps**

| Time | On screen | Say |
|---|---|---|
| 0:00–0:20 | Landing page hero | "Everyone ships AI features now. Almost nobody ships them safely. This is ShipScore — Lighthouse for the AI era." |
| 0:20–0:50 | Scroll to Scanner Demo → click **"Scan the vulnerable demo repo"** | "Watch: the scanner maps every AI touchpoint — hardcoded secrets, unscoped agent permissions, prompts with zero guards — a deliberately broken repo scores 51 out of 100, Secure: 19." |
| 0:50–1:20 | Type a real repo URL (e.g. `openai/openai-quickstart-node`) → **Scan** | "Now a real repo. 21 files, 29 touchpoints, 82 out of 100. The findings are concrete: this line, this severity, this category." |
| 1:20–1:50 | Score breakdown + scoreboard section | "Five categories — Design, Ship, Run, Secure, Test — one weighted rubric, weakest-link aggregation. Same input, same score, every time: it's deterministic, so it belongs in CI." |
| 1:50–2:20 | Fix panel / `/api/fix` response (JSON with `plans`, PR spec) | "And it doesn't just grade — the fix agent drafts the PRs: move secrets to env, least-privilege workflow permissions, wrap prompts with guards. Human in the loop by default." |
| 2:20–2:40 | GitHub Action YAML in the repo + dogfood PR comment | "One block of YAML and every PR gets scored. ShipScore scans itself on every push — 86 out of 100, we're not done either." |
| 2:40–3:00 | Back to hero, logo + tagline | "ShipScore. Know your AI ships safe. Repo open-source, MIT." |

**Recording notes:** record at the live URL; keep a terminal with the two `curl` calls pre-typed as fallback; if wifi fails, use the offline demo button (the fixture is staged locally on the server too).

---

## 4. Live judge demo flow (5 min, if there's a live Q&A / showcase)

1. Open https://shipscore-gamma.vercel.app — 5-second pitch over the hero.
2. **Scan demo repo** button → walk the finding list top-down (secret → permissions → missing evals).
3. Paste `https://github.com/openai/openai-quickstart-node` → scan live → show per-category bars.
4. Show `/api/fix` result (the demo panel does it in-page) — emphasize **dry-run by default** and the triple gate for real PRs.
5. Open the scoreboard — point out ShipScore's own self-scan (86/B) next to the fixture (51/F): "we dogfood the gate we sell."
6. Close with the GitHub Action YAML — one block, CI-ready.

**Backup repos to paste** (small, reliable): `octocat/Hello-World` (100/A — no AI features found), `openai/openai-quickstart-node` (82/B).

---

## 5. Submission-day checklist

- [ ] **Register** on lablab.ai (registration opened Sept 26, 16:00 UTC) and join the event.
- [ ] **Create the public GitHub repo** (suggested: `<org>/shipscore`, MIT, description = tagline).
- [ ] **Push the prepared local repo** (it's committed and ready):
      ```bash
      cd /path/to/shipscore-repo
      git remote add origin git@github.com:<org>/shipscore.git
      git push -u origin main
      ```
- [ ] After the first push: enable the dogfood workflow (Actions tab → allow), confirm the self-scan PR comment posts.
- [ ] **Record the demo video** (script §3), upload (YouTube unlisted / Streamable), paste link.
- [ ] Submit on the event page with the fields from §2.
- [ ] Post the live demo URL + repo in the event Discord #project channel.
- [ ] Rotate the Vercel token used for deployment (it was shared in chat — treat as compromised).

---

## 6. Honest limitations (say these before judges find them)

- **Scoreboard persistence is per-instance on serverless** (SQLite volume per lambda). A scan followed by a scoreboard refresh on the same warm instance always shows the row; across cold instances the board starts empty. Drop-in fix: Turso/libSQL — deliberately deferred so v0 ships with zero external services.
- **Scanner coverage is TypeScript/JS-first** plus config/text detectors (mcp.json, workflows, .env patterns); Python AST analysis is on the roadmap.
- **Fix PRs are deterministic rules, not LLM-generated patches** — by design: reproducibility and reviewability beat cleverness for CI gates. Real-PR mode is triple-gated and off by default.
- **No auth on the demo API** — it's a read-only scoring service with capped clone dirs and size/time caps; fine for a hackathon demo, not for a multi-tenant deployment.

## 7. What's already proven (for the confidence section of the pitch)

- Self-scan: **86/B** (design 85, ship 100, run 100, secure 100, test 75)
- Vulnerable fixture: **51/F** (secure 19 — catches hardcoded critical secret, over-broad agent permissions, missing evals)
- Real-world repo: **openai/openai-quickstart-node → 82/B**, 29 touchpoints found
- Serverless GitHub scan verified end-to-end (tarball fallback, no git binary)
- All six endpoints live: `/api/scan` (GET/POST), `/api/scores`, `/api/fix`
