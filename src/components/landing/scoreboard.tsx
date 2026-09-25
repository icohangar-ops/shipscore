'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScoreDial, MiniCategoryBars } from '@/components/landing/score-widgets';
import { ArrowDown, ArrowUp, Database, Loader2, Minus, RefreshCw, ScanSearch, Trophy } from 'lucide-react';

/**
 * Live scoreboard — reads everything from SQLite via /api/scores.
 * Every scan that runs on this site lands here and STAYS here across
 * restarts and redeploys (Day 3-4: Prisma persistence). The section
 * refreshes itself when a scan finishes elsewhere on the page
 * (shipscore:scan-persisted event) and on manual refresh.
 */

interface LeaderboardEntry {
  id: string;
  repoKey: string;
  repo: string;
  repoUrl: string | null;
  overallScore: number;
  grade: string;
  categoryScores: Record<string, number>;
  criticalCount: number;
  highCount: number;
  totalTouchpoints: number;
  scans: number;
  trend: number[];
  delta: number | null;
  lastScanAt: string;
}

interface ScoreboardData {
  leaderboard: LeaderboardEntry[];
  recent: {
    id: string;
    repo: string;
    repoKey: string;
    overallScore: number;
    grade: string;
    createdAt: string;
  }[];
  stats: {
    repos: number;
    scans: number;
    avgBestScore: number;
    lastScanAt: string | null;
    engineVersion: string;
  };
}

const GRADE_STYLES: Record<string, string> = {
  A: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  B: 'border-lime-400/30 bg-lime-400/10 text-lime-300',
  C: 'border-yellow-400/30 bg-yellow-400/10 text-yellow-300',
  D: 'border-orange-400/30 bg-orange-400/10 text-orange-300',
  F: 'border-red-400/30 bg-red-400/10 text-red-300',
};

const SCROLLBAR =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-zinc-900 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function Delta({ value }: { value: number | null }) {
  if (value === null || value === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-zinc-600">
        <Minus className="h-3 w-3" aria-hidden="true" />
        —
      </span>
    );
  }
  const up = value > 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-xs tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}
    >
      {up ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />}
      {Math.abs(value)}
    </span>
  );
}

export function ScoreboardSection() {
  const [data, setData] = useState<ScoreboardData | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      const res = await fetch('/api/scores', { cache: 'no-store' });
      const payload = (await res.json()) as ScoreboardData | { error: string };
      if (!res.ok || 'error' in payload) {
        throw new Error('error' in payload ? payload.error : `HTTP ${res.status}`);
      }
      setData(payload);
      setPhase('ready');
      setError(null);
    } catch (e) {
      setError((e as Error).message);
      setPhase('error');
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // refresh when any scan on this page persists (the demo section fires this)
    const onPersisted = () => void load();
    window.addEventListener('shipscore:scan-persisted', onPersisted);
    return () => window.removeEventListener('shipscore:scan-persisted', onPersisted);
  }, [load]);

  return (
    <section id="scoreboard" className="scroll-mt-20 border-y border-zinc-800/60 bg-zinc-900/30" aria-labelledby="scoreboard-heading">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <Badge variant="outline" className="mb-4 gap-2 border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-300">
              <Database className="h-3 w-3" aria-hidden="true" />
              Persisted · survives restarts
            </Badge>
            <h2 id="scoreboard-heading" className="text-3xl font-bold tracking-tight text-zinc-50 sm:text-4xl">
              Live scoreboard
            </h2>
            <p className="mt-4 max-w-2xl leading-relaxed text-zinc-400">
              Every scan that runs on this page is written to the ShipScore database and ranked here —
              best score per repository, newest scans first to verify. This is not a mockup: the list
              keeps its memory across restarts and redeploys, because a scoreboard that forgets is
              just a flashcard.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => void load(true)}
            className="gap-2 border-zinc-700 bg-transparent text-zinc-300 hover:bg-zinc-900 hover:text-amber-300"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            Refresh
          </Button>
        </div>

        {data?.stats && (
          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'repos audited', value: data.stats.repos },
              { label: 'scans stored', value: data.stats.scans },
              { label: 'avg best score', value: `${data.stats.avgBestScore}/100` },
              { label: 'last scan', value: data.stats.lastScanAt ? timeAgo(data.stats.lastScanAt) : '—' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
                <p className="text-2xl font-bold tabular-nums text-zinc-50">{s.value}</p>
                <p className="mt-1 text-xs uppercase tracking-wider text-zinc-500">{s.label}</p>
              </div>
            ))}
          </div>
        )}

        {phase === 'loading' && (
          <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70">
            <Loader2 className="h-8 w-8 animate-spin text-amber-400" aria-hidden="true" />
            <p className="text-sm text-zinc-500">loading the board…</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-2xl border border-red-400/30 bg-red-400/5">
            <p className="text-sm font-semibold text-red-300">Scoreboard unavailable</p>
            <p className="max-w-sm text-center text-xs text-zinc-500">{error}</p>
          </div>
        )}

        {phase === 'ready' && data && data.leaderboard.length === 0 && (
          <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/70">
            <ScanSearch className="h-8 w-8 text-zinc-700" aria-hidden="true" />
            <p className="max-w-xs text-center text-sm text-zinc-500">
              No scores yet — be the first.{' '}
              <a href="#try" className="text-amber-300 underline-offset-4 hover:underline">
                Scan a repo above
              </a>{' '}
              and it lands here permanently.
            </p>
          </div>
        )}

        {phase === 'ready' && data && data.leaderboard.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/70 shadow-2xl shadow-black/40">
            <ul className={`max-h-[32rem] divide-y divide-zinc-800/70 overflow-y-auto ${SCROLLBAR}`}>
              {data.leaderboard.map((entry, i) => (
                <li key={entry.repoKey} className="flex flex-wrap items-center gap-4 p-4 sm:gap-6 sm:p-5">
                  <div className="flex w-10 shrink-0 items-center justify-center">
                    {i === 0 ? (
                      <Trophy className="h-6 w-6 text-amber-400" aria-label="rank 1" />
                    ) : (
                      <span className="font-mono text-lg tabular-nums text-zinc-600">#{i + 1}</span>
                    )}
                  </div>
                  <ScoreDial score={entry.overallScore} size="sm" />
                  <div className="min-w-0 flex-1 basis-48">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={entry.repoUrl ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`truncate font-mono text-sm ${entry.repoUrl ? 'text-zinc-200 hover:text-amber-300' : 'text-zinc-200'}`}
                      >
                        {entry.repo}
                      </a>
                      <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold ${GRADE_STYLES[entry.grade] ?? GRADE_STYLES.F}`}>
                        {entry.grade}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-600">
                      {entry.scans} scan{entry.scans === 1 ? '' : 's'} · last {timeAgo(entry.lastScanAt)} ·{' '}
                      {entry.criticalCount > 0 ? (
                        <span className="text-red-400">{entry.criticalCount} critical</span>
                      ) : entry.highCount > 0 ? (
                        <span className="text-orange-400">{entry.highCount} high</span>
                      ) : (
                        'no criticals'
                      )}{' '}
                      · {entry.totalTouchpoints} touchpoints
                    </p>
                  </div>
                  <MiniCategoryBars scores={entry.categoryScores} />
                  <div className="w-16 text-right">
                    <Delta value={entry.delta} />
                    <p className="text-[10px] uppercase tracking-wider text-zinc-600">vs prev</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {phase === 'ready' && data && data.recent.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              recent scan feed
            </p>
            <div className="flex flex-wrap gap-2">
              {data.recent.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/60 px-3 py-1 font-mono text-xs text-zinc-400"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
                  {r.repo} <span className="tabular-nums text-zinc-200">{r.overallScore}</span>
                  <span className="text-zinc-600">{r.grade}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
