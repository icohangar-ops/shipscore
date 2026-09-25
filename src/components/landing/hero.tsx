import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScoreDial, CategoryBar } from '@/components/landing/score-widgets';
import { ArrowRight, Github, RadioTower, Star } from 'lucide-react';

export const GITHUB_URL = 'https://github.com/Cubiczan/shipscore';

const categories = [
  { name: 'Design', score: 74 },
  { name: 'Ship', score: 52 },
  { name: 'Run', score: 68 },
  { name: 'Secure', score: 38 },
  { name: 'Test', score: 29 },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/85 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6" aria-label="Main navigation">
        <a href="#" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-400/15 ring-1 ring-amber-400/30">
            <RadioTower className="h-5 w-5 text-amber-400" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-zinc-50">
            Ship<span className="text-amber-400">Score</span>
          </span>
        </a>
        <div className="hidden items-center gap-7 text-sm text-zinc-400 md:flex">
          <a href="#how" className="transition hover:text-amber-300">How it works</a>
          <a href="#categories" className="transition hover:text-amber-300">Categories</a>
          <a href="#action" className="transition hover:text-amber-300">GitHub Action</a>
          <a href="#try" className="transition hover:text-amber-300">Try live</a>
          <a href="#scoreboard" className="transition hover:text-amber-300">Scoreboard</a>
          <a href="#demo" className="transition hover:text-amber-300">Live demo</a>
        </div>
        <Button asChild className="bg-amber-400 text-zinc-950 hover:bg-amber-300">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            <Github className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Star on GitHub</span>
            <span className="sm:hidden">GitHub</span>
          </a>
        </Button>
      </nav>
    </header>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* lighthouse beam glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[60rem] -translate-x-1/2 rounded-full bg-amber-400/10 blur-3xl"
      />
      <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
        <div className="grid items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <Badge variant="outline" className="mb-6 gap-2 border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
              WeAreDevelopers Hackathon · San José · Sept 18–25, 2026
            </Badge>
            <h1 className="text-4xl font-bold leading-[1.08] tracking-tight text-zinc-50 sm:text-5xl lg:text-6xl">
              Lighthouse for the{' '}
              <span className="text-amber-400">AI era</span>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
              ShipScore audits any repository that ships AI features — scores it 0–100 across{' '}
              <span className="text-zinc-200">Design, Ship, Run, Secure, Test</span> — and opens
              real fix PRs before you merge. Because your last PR had a prompt in it.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button size="lg" className="gap-2 bg-amber-400 text-zinc-950 hover:bg-amber-300">
                Get your ShipScore
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="gap-2 border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-900 hover:text-amber-300"
                asChild
              >
                <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                  <Star className="h-4 w-4" aria-hidden="true" />
                  Open source · MIT
                </a>
              </Button>
            </div>
            <p className="mt-5 text-sm text-zinc-500">
              Free during the hackathon · GitHub Action included · works on any repo, any framework
            </p>
          </div>

          {/* Score preview card */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/40 sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-500">acme/ai-checkout</p>
                <p className="text-xs text-zinc-600">scanned 2 min ago · main @ 3f9c1e2</p>
              </div>
              <Badge variant="outline" className="border-red-400/30 bg-red-400/10 text-red-300">
                3 fix PRs ready
              </Badge>
            </div>
            <div className="flex flex-col items-center gap-8 sm:flex-row">
              <ScoreDial score={61} />
              <div className="w-full flex-1 space-y-4">
                {categories.map((c) => (
                  <CategoryBar key={c.name} name={c.name} score={c.score} />
                ))}
              </div>
            </div>
            <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 font-mono text-xs leading-relaxed text-zinc-400">
              <span className="text-red-400">▲ critical</span> tool call in{' '}
              <span className="text-zinc-200">agent/executor.ts:42</span> accepts untrusted
              user string → prompt injection surface
              <br />
              <span className="text-red-400">▲ critical</span> LLM path{' '}
              <span className="text-zinc-200">lib/summarize.ts</span> has no eval coverage
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
