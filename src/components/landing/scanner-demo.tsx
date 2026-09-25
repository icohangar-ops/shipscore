'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScoreDial, CategoryBar } from '@/components/landing/score-widgets';
import { Loader2, ScanSearch, Timer, WifiOff, FileCode2, GitPullRequest, ShieldCheck, Sparkles, TriangleAlert } from 'lucide-react';
import type { ScanReport, Severity } from '@/lib/scanner/types';

interface FixPlanLite {
  id: string;
  rule: string;
  title: string;
  findingFile: string;
  findingLine: number;
  severity: string;
  summary: string;
  safe: boolean;
  advisory: boolean;
  edits: { path: string; kind: string; note: string }[];
}

interface FixAgentResponse {
  engine: string;
  dryRun: boolean;
  plans: FixPlanLite[];
  summary: { autoFixable: number; advisories: number; filesTouched: number };
  pr: { simulated: boolean; reason: string; title?: string } | null;
  notes: string[];
  error?: string;
}

interface ScanResponse extends ScanReport {
  truncated: boolean;
  totalTouchpoints: number;
  clone?: { cached: boolean; note: string };
  persisted?: { id: string; repoKey: string } | null;
}

type Phase = 'idle' | 'loading' | 'done' | 'error';
type FixPhase = 'idle' | 'loading' | 'done' | 'error';

const LOADING_STAGES = [
  'Resolving repository…',
  'Shallow cloning (depth 1)…',
  'Mapping AI touchpoints across the tree…',
  'Running AST detectors — prompts, tools, injection surfaces…',
  'Scoring Design · Ship · Run · Secure · Test…',
];

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: 'border-red-400/40 bg-red-400/10 text-red-300',
  high: 'border-orange-400/40 bg-orange-400/10 text-orange-300',
  medium: 'border-yellow-400/40 bg-yellow-400/10 text-yellow-200',
  low: 'border-zinc-600/60 bg-zinc-800/60 text-zinc-300',
  info: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
};

const SCROLLBAR =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-zinc-900 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700';

function fmtDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

export function ScannerDemo() {
  const [repoUrl, setRepoUrl] = useState('https://github.com/openai/openai-node');
  const [phase, setPhase] = useState<Phase>('idle');
  const [report, setReport] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [fixPhase, setFixPhase] = useState<FixPhase>('idle');
  const [fixResult, setFixResult] = useState<FixAgentResponse | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (phase !== 'loading') return;
    const t = setInterval(() => setStage((s) => Math.min(s + 1, LOADING_STAGES.length - 1)), 1600);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async (body: Record<string, unknown>) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const timeout = setTimeout(() => ac.abort(), 180_000);

    setPhase('loading');
    setError(null);
    setStage(0);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      const data = (await res.json()) as ScanResponse | { error: string };
      if (!res.ok || 'error' in data) {
        throw new Error('error' in data ? data.error : `scan failed (HTTP ${res.status})`);
      }
      setReport(data);
      setPhase('done');
      // reset the fix panel for the new report + wake the scoreboard
      setFixPhase('idle');
      setFixResult(null);
      setFixError(null);
      if (data.persisted) {
        window.dispatchEvent(new CustomEvent('shipscore:scan-persisted', { detail: data.persisted }));
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setError('Scan timed out after 180s — try a smaller repo.');
      } else {
        setError((e as Error).message);
      }
      setPhase('error');
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  const busy = phase === 'loading';

  const draftFix = useCallback(async (recordId: string) => {
    setFixPhase('loading');
    setFixError(null);
    try {
      const res = await fetch('/api/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId }),
      });
      const data = (await res.json()) as FixAgentResponse;
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `fix agent failed (HTTP ${res.status})`);
      }
      setFixResult(data);
      setFixPhase('done');
    } catch (e) {
      setFixError((e as Error).message);
      setFixPhase('error');
    }
  }, []);

  return (
    <section id="try" className="scroll-mt-20" aria-labelledby="try-heading">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr]">
          {/* left: controls */}
          <div>
            <Badge variant="outline" className="mb-4 gap-2 border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
              Running now · no signup
            </Badge>
            <h2 id="try-heading" className="mt-2 text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
              Try it on your repo. Right now.
            </h2>
            <p className="mt-4 leading-relaxed text-zinc-400">
              The scanner is live in this page. Paste any public GitHub repo and watch the AST
              detectors map every AI touchpoint — prompts, tool permissions, injection surfaces,
              eval gaps — then score it across the five categories. The results below are the
              real engine, not a mockup.
            </p>

            <form
              className="mt-8 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (repoUrl.trim()) void run({ repoUrl: repoUrl.trim() });
              }}
            >
              <label htmlFor="repo-url" className="sr-only">
                GitHub repository URL
              </label>
              <Input
                id="repo-url"
                type="url"
                inputMode="url"
                placeholder="https://github.com/owner/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                disabled={busy}
                className="border-zinc-700 bg-zinc-950 font-mono text-sm text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-amber-400/60"
              />
              <div className="flex flex-wrap gap-3">
                <Button
                  type="submit"
                  disabled={busy || !repoUrl.trim()}
                  className="gap-2 bg-amber-400 text-zinc-950 hover:bg-amber-300"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ScanSearch className="h-4 w-4" aria-hidden="true" />}
                  Scan GitHub repo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run({ target: 'self' })}
                  className="gap-2 border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-900 hover:text-amber-300"
                >
                  <FileCode2 className="h-4 w-4" aria-hidden="true" />
                  Score this repo (self-scan)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run({ target: 'demo' })}
                  className="gap-2 border-red-400/30 bg-transparent text-red-300 hover:bg-red-400/10 hover:text-red-200"
                >
                  <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                  Vulnerable demo repo
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-zinc-500">
                Shallow clone (depth 1), cached locally — cloned repos keep scanning even when the
                venue wifi dies. Only public github.com URLs in v0.
              </p>
            </form>

            <div aria-live="polite" className="sr-only">
              {busy ? 'Scan in progress' : phase === 'done' ? 'Scan complete' : error ?? ''}
            </div>
          </div>

          {/* right: results */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-6 shadow-2xl shadow-black/40 sm:p-8">
            {phase === 'idle' && (
              <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
                <ScanSearch className="h-10 w-10 text-zinc-700" aria-hidden="true" />
                <p className="mt-4 max-w-xs text-sm leading-relaxed text-zinc-500">
                  Hit <span className="text-zinc-300">Score this repo</span> to watch the engine
                  audit this very codebase in a few seconds — or paste a GitHub URL above.
                </p>
              </div>
            )}

            {phase === 'loading' && (
              <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
                <div className="relative">
                  <Loader2 className="h-10 w-10 animate-spin text-amber-400" aria-hidden="true" />
                </div>
                <p className="mt-5 font-mono text-sm text-amber-300">{LOADING_STAGES[stage]}</p>
                <p className="mt-2 text-xs text-zinc-600">
                  big repos take up to a minute · deterministic engine, no LLM in the loop
                </p>
              </div>
            )}

            {phase === 'error' && error && (
              <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
                <div className="w-full max-w-sm rounded-lg border border-red-400/30 bg-red-400/5 p-5">
                  <p className="text-sm font-semibold text-red-300">Scan failed</p>
                  <p className="mt-2 break-words text-sm leading-relaxed text-zinc-400">{error}</p>
                  <p className="mt-3 text-xs text-zinc-600">
                    check the URL is a public github.com repo and try again
                  </p>
                </div>
              </div>
            )}

            {phase === 'done' && report && (
              <div>
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm text-zinc-300">{report.repo}</p>
                    <p className="text-xs text-zinc-600">
                      {report.filesScanned} files · {report.totalLines.toLocaleString()} lines ·{' '}
                      {fmtDuration(report.durationMs)} · {report.engineVersion} · rubric {report.rubricVersion}
                    </p>
                  </div>
                  {report.clone && (
                    <Badge
                      variant="outline"
                      className={
                        report.clone.cached
                          ? 'gap-1 border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                          : 'gap-1 border-zinc-700 bg-zinc-800/60 text-zinc-300'
                      }
                    >
                      {report.clone.cached ? <WifiOff className="h-3 w-3" aria-hidden="true" /> : <Timer className="h-3 w-3" aria-hidden="true" />}
                      {report.clone.note}
                    </Badge>
                  )}
                </div>

                <div className="flex flex-col items-center gap-8 sm:flex-row">
                  <ScoreDial score={report.overallScore} size="lg" />
                  <div className="w-full flex-1 space-y-3.5">
                    {Object.entries(report.categoryScores).map(([name, score]) => (
                      <CategoryBar key={name} name={name} score={score} />
                    ))}
                  </div>
                </div>

                {report.notes.length > 0 && (
                  <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      why the score moves
                    </p>
                    <ul className="space-y-1 font-mono text-xs text-zinc-400">
                      {report.notes.map((n) => (
                        <li key={n}>· {n}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-6">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                      findings
                    </p>
                    <p className="text-xs tabular-nums text-zinc-600">
                      {report.totalTouchpoints} total
                      {report.truncated && ' (first 500 shown)'}
                    </p>
                  </div>
                  <ul className={`max-h-96 space-y-2 overflow-y-auto pr-1 ${SCROLLBAR}`}>
                    {report.touchpoints.map((t, i) => (
                      <li
                        key={`${t.file}:${t.line}:${t.kind}:${i}`}
                        className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${SEVERITY_STYLES[t.severity]}`}
                          >
                            {t.severity}
                          </span>
                          <span className="font-mono text-xs text-zinc-300">{t.kind}</span>
                          <span className="font-mono text-[11px] text-zinc-600">
                            {t.file}:{t.line}
                          </span>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{t.detail}</p>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* auto-fix panel — plan-only agent, PR opens only with credentials + explicit apply */}
                {report.persisted && (
                  <div className="mt-6 rounded-lg border border-amber-400/25 bg-amber-400/5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <GitPullRequest className="h-4 w-4 text-amber-300" aria-hidden="true" />
                        <p className="text-xs font-semibold uppercase tracking-wider text-amber-200">
                          auto-fix agent
                        </p>
                        <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          plan-only
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={fixPhase === 'loading'}
                        onClick={() => void draftFix(report.persisted!.id)}
                        className="gap-2 border-amber-400/40 bg-transparent text-amber-200 hover:bg-amber-400/10 hover:text-amber-100"
                      >
                        {fixPhase === 'loading' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Draft fix PR
                      </Button>
                    </div>

                    {fixPhase === 'idle' && (
                      <p className="mt-3 text-xs leading-relaxed text-zinc-500">
                        The fix agent turns this scan into deterministic, reviewable edits — secrets to
                        env vars, least-privilege workflow permissions, prompt-injection guards. No LLM
                        in the loop; a real PR only opens with GitHub credentials + explicit apply.
                      </p>
                    )}

                    {fixPhase === 'error' && fixError && (
                      <p className="mt-3 text-xs leading-relaxed text-red-300">fix agent: {fixError}</p>
                    )}

                    {fixPhase === 'done' && fixResult && (
                      <div className="mt-3">
                        <p className="text-xs leading-relaxed text-zinc-300">
                          <span className="font-semibold text-emerald-300">
                            {fixResult.summary.autoFixable} mechanical fix{fixResult.summary.autoFixable === 1 ? '' : 'es'}
                          </span>
                          {fixResult.summary.advisories > 0 && (
                            <> · {fixResult.summary.advisories} advisory</>
                          )}
                          {fixResult.pr && (
                            <>
                              {' '}· PR spec{' '}
                              <span className="text-amber-200">{fixResult.pr.simulated ? 'simulated' : 'opened'}</span>{' '}
                              <span className="text-zinc-600">({fixResult.pr.reason})</span>
                            </>
                          )}
                        </p>
                        <ul className="mt-3 space-y-2">
                          {fixResult.plans.map((p) => (
                            <li key={p.id} className="rounded-md border border-zinc-800 bg-zinc-950/70 p-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${
                                    p.advisory
                                      ? 'border-zinc-600/60 bg-zinc-800/60 text-zinc-300'
                                      : p.safe
                                        ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                                        : 'border-yellow-400/30 bg-yellow-400/10 text-yellow-200'
                                  }`}
                                >
                                  {p.advisory ? (
                                    'advisory'
                                  ) : p.safe ? (
                                    <>
                                      <ShieldCheck className="h-2.5 w-2.5" aria-hidden="true" /> mechanical
                                    </>
                                  ) : (
                                    'review'
                                  )}
                                </span>
                                <span className="font-mono text-xs text-zinc-200">{p.rule}</span>
                                <span className="font-mono text-[11px] text-zinc-600">
                                  {p.findingFile}:{p.findingLine}
                                </span>
                              </div>
                              <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">{p.summary}</p>
                              {p.edits.length > 0 && (
                                <p className="mt-1 font-mono text-[11px] text-zinc-600">
                                  touches: {p.edits.map((e) => e.path).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
                                </p>
                              )}
                            </li>
                          ))}
                        </ul>
                        {!fixResult.pr && (
                          <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
                            no GitHub remote associated with this scan — plan shown, PR authoring
                            skipped (scan a repo by URL to get a full PR spec)
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
