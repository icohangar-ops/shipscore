import {
  Activity,
  Compass,
  FileWarning,
  FlaskConical,
  Gauge,
  GitPullRequest,
  KeyRound,
  Radar,
  Rocket,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';

const problems = [
  {
    icon: FileWarning,
    title: 'Prompts hardcoded',
    body: 'System prompts pasted into helper files — unreviewed, unversioned, owned by nobody.',
  },
  {
    icon: KeyRound,
    title: 'Tool permissions unreviewed',
    body: 'Agents get broad tool and MCP access with no least-privilege check. Ever.',
  },
  {
    icon: Gauge,
    title: 'Zero evals',
    body: "LLM code paths ship with no eval harness — 'tested' means a human shrugged at a demo.",
  },
  {
    icon: ShieldAlert,
    title: 'Injection untested',
    body: 'Prompt-injection surfaces never face an adversarial test before production traffic does.',
  },
];

const steps = [
  {
    n: '01',
    icon: Radar,
    name: 'Scan',
    body: 'AST parsing and a dependency graph map every AI touchpoint: prompts, tool definitions, MCP configs, model calls, eval harnesses.',
  },
  {
    n: '02',
    icon: Gauge,
    name: 'Score',
    body: 'Each touchpoint runs through 40+ heuristics and LLM review. You get a 0–100 score with a five-category breakdown.',
  },
  {
    n: '03',
    icon: GitPullRequest,
    name: 'Fix',
    body: 'The agent drafts the smallest change that raises the score — guardrail middleware, an eval harness, a CI gate — as a real pull request.',
  },
  {
    n: '04',
    icon: ShieldCheck,
    name: 'Gate',
    body: 'A GitHub Action re-scores every push. Below threshold → merge blocked. Your AI era becomes regression-proof.',
  },
];

const categoryCards = [
  {
    icon: Compass,
    name: 'Design',
    tagline: 'Prompts are code',
    body: 'Prompts, tools, and agent roles are versioned, documented, and owned — not pasted into a helper file.',
    checks: ['prompt sources tracked', 'system-prompt sprawl', 'model names hardcoded'],
  },
  {
    icon: Rocket,
    name: 'Ship',
    tagline: 'Merge with confidence',
    body: 'AI changes ride the same pipeline as plain code: reviewed diffs, gated upgrades, documented behavior changes.',
    checks: ['prompt diffs reviewed', 'model upgrades gated', 'behavior changelog'],
  },
  {
    icon: Activity,
    name: 'Run',
    tagline: 'Observable in prod',
    body: 'Production behavior is measurable: latency, token cost, drift, and fallback paths all instrumented.',
    checks: ['token budgets set', 'retry + fallback paths', 'cost telemetry'],
  },
  {
    icon: ShieldAlert,
    name: 'Secure',
    tagline: 'Hostile until proven safe',
    body: 'Every tool call and every external string is treated as an attack surface until proven otherwise.',
    checks: ['injection surfaces', 'tool least-privilege', 'secrets in prompts'],
  },
  {
    icon: FlaskConical,
    name: 'Test',
    tagline: 'Evals in CI, not vibes',
    body: 'LLM paths have evals that run on every pull request — golden sets, adversarial cases, regression gates.',
    checks: ['eval coverage', 'adversarial cases', 'regression gates'],
  },
];

export function Problem() {
  return (
    <section className="border-y border-zinc-800/80 bg-zinc-900/40" aria-labelledby="problem-heading">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">The gap</p>
        <h2 id="problem-heading" className="mt-3 max-w-2xl text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
          Everyone is shipping AI features. Almost nobody is shipping them safely.
        </h2>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {problems.map((p) => (
            <div
              key={p.title}
              className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-6 transition hover:border-amber-400/40"
            >
              <p.icon className="h-6 w-6 text-red-400" aria-hidden="true" />
              <h3 className="mt-4 font-semibold text-zinc-100">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20" aria-labelledby="how-heading">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">How it works</p>
        <h2 id="how-heading" className="mt-3 max-w-2xl text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
          Four steps between "we use AI" and "we ship AI responsibly".
        </h2>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="relative rounded-xl border border-zinc-800 bg-zinc-900/70 p-6 transition hover:border-amber-400/40">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-400/15 ring-1 ring-amber-400/30">
                  <s.icon className="h-5 w-5 text-amber-400" aria-hidden="true" />
                </span>
                <span className="font-mono text-2xl font-bold text-zinc-800">{s.n}</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-zinc-50">{s.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Categories() {
  return (
    <section id="categories" className="scroll-mt-20 border-y border-zinc-800/80 bg-zinc-900/40" aria-labelledby="categories-heading">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">The score</p>
        <h2 id="categories-heading" className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
          The congress program, turned into a metric.
        </h2>
        <p className="mt-4 max-w-2xl text-zinc-400">
          Design, ship, run, secure, test — the five verbs of building software in the AI era,
          each with concrete, weighted checks your repo either passes or fails.
        </p>
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {categoryCards.map((c) => (
            <article key={c.name} className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/70 p-6 transition hover:border-amber-400/40">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-400/15 ring-1 ring-amber-400/30">
                  <c.icon className="h-5 w-5 text-amber-400" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-semibold text-zinc-50">{c.name}</h3>
                  <p className="text-xs text-amber-300/90">{c.tagline}</p>
                </div>
              </div>
              <p className="mt-4 flex-1 text-sm leading-relaxed text-zinc-400">{c.body}</p>
              <ul className="mt-4 space-y-1.5">
                {c.checks.map((check) => (
                  <li key={check} className="flex items-center gap-2 font-mono text-xs text-zinc-500">
                    <span className="h-1 w-1 rounded-full bg-amber-400/70" aria-hidden="true" />
                    {check}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {/* CTA card fills the grid */}
          <div className="flex flex-col justify-center rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-400/15 to-transparent p-6">
            <p className="text-2xl font-bold text-zinc-50">What's your repo's score?</p>
            <p className="mt-2 text-sm text-zinc-400">
              Run the first public scan during the hackathon demo — or wire the GitHub Action into
              your CI and never wonder again.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
