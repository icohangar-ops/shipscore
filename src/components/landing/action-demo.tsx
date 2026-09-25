import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/copy-button';
import { Github, QrCode, RadioTower, WifiOff } from 'lucide-react';
import { GITHUB_URL } from './hero';

const workflowYaml = `name: ShipScore
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

      # ShipScore posts the score as a PR comment,
      # labels findings by severity, and opens fix PRs.`;

const demoTimeline = [
  { t: '0:00', body: 'Paste a real open-source AI repo on stage' },
  { t: '0:15', body: 'Scanner maps prompts, tool permissions, and eval gaps — live' },
  { t: '1:00', body: 'The score reveals with its five-category breakdown' },
  { t: '1:20', body: 'The agent opens a real fix PR on GitHub' },
  { t: '1:45', body: 'Audience repos submitted via QR join the live scoreboard' },
];

export function ActionSection() {
  return (
    <section id="action" className="scroll-mt-20" aria-labelledby="action-heading">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-amber-400">CI-native</p>
            <h2 id="action-heading" className="mt-3 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
              One block of YAML. Every push re-scored.
            </h2>
            <p className="mt-4 leading-relaxed text-zinc-400">
              ShipScore ships as a GitHub Action from day one — the scanner itself is the
              hackathon's first commit, dogfooded on this very repository. Add it to any workflow,
              set a threshold, and let the agent do the rest: comments on the PR, labels findings
              by severity, and opens fix PRs with guardrails and evals attached.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-zinc-300">
              <li className="flex gap-3"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />Score comment on every pull request, with category breakdown</li>
              <li className="flex gap-3"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />Required-check mode: merges blocked below your threshold</li>
              <li className="flex gap-3"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />Fix PRs are minimal and isolated — review them like any other change</li>
            </ul>
          </div>
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/40">
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/70 px-4 py-2.5">
              <span className="font-mono text-xs text-zinc-500">.github/workflows/shipscore.yml</span>
              <CopyButton text={workflowYaml} />
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-xs leading-relaxed text-zinc-300">
              <code>{workflowYaml}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

export function DemoSection() {
  return (
    <section id="demo" className="scroll-mt-20 border-y border-zinc-800/80 bg-zinc-900/40" aria-labelledby="demo-heading">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Badge variant="outline" className="mb-4 gap-2 border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-300">
              On-site showcase · Sept 23–25 · San José
            </Badge>
            <h2 id="demo-heading" className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
              A two-minute demo, rehearsed to the second.
            </h2>
            <p className="mt-4 leading-relaxed text-zinc-400">
              The stage flow is designed for the congress floor: real repo, live scan, real PR —
              then the room joins in. Every attendee can submit their own repo by QR code and watch
              it scored on the big screen.
            </p>
            <div className="mt-6 flex flex-wrap gap-4">
              <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-sm text-zinc-300">
                <QrCode className="h-5 w-5 text-amber-400" aria-hidden="true" />
                QR submissions from the audience
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-3 text-sm text-zinc-300">
                <WifiOff className="h-5 w-5 text-amber-400" aria-hidden="true" />
                Wifi-proof: pre-scanned fallback repos cached
              </div>
            </div>
          </div>
          <ol className="relative space-y-0 border-l border-zinc-800 pl-0" aria-label="Demo timeline">
            {demoTimeline.map((step, i) => (
              <li key={step.t} className="relative flex gap-5 pb-7 last:pb-0">
                <span className="absolute -left-[7px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-amber-400 bg-zinc-950" aria-hidden="true" />
                <span className="ml-4 w-12 shrink-0 pt-0.5 font-mono text-sm font-semibold text-amber-400">{step.t}</span>
                <span className="text-sm leading-relaxed text-zinc-300">{step.body}</span>
                {i === demoTimeline.length - 1 && (
                  <span className="sr-only">End of demo</span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 py-10 sm:px-6 md:flex-row">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/15 ring-1 ring-amber-400/30">
            <RadioTower className="h-4 w-4 text-amber-400" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-zinc-200">
              Ship<span className="text-amber-400">Score</span>
            </p>
            <p className="text-xs text-zinc-500">Lighthouse for the AI era · MIT licensed</p>
          </div>
        </div>
        <p className="text-center text-xs leading-relaxed text-zinc-500">
          Team Dash · Built for the{' '}
          <a
            href="https://lablab.ai/ai-hackathons/wearedevelopers-hackathon"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 underline-offset-2 hover:text-amber-300 hover:underline"
          >
            WeAreDevelopers Hackathon
          </a>{' '}
          · Online build Sept 18–24 · On-site Sept 23–25, San José
        </p>
        <Button asChild variant="outline" size="sm" className="gap-2 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-900 hover:text-amber-300">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <Github className="h-4 w-4" aria-hidden="true" />
            Source
          </a>
        </Button>
      </div>
    </footer>
  );
}
