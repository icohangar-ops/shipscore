/**
 * ShipScore — shared score visualization widgets (dial + category bars).
 * Pure presentational components used by the hero preview and the live
 * scanner demo. No hooks — safe in both server and client trees.
 */

const DIAL_TRACK = 'oklch(0.28 0 0)';
const DIAL_FG = 'oklch(0.83 0.16 84)'; // amber

export function ScoreDial({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' | 'lg' }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  const box = size === 'lg' ? 'h-44 w-44' : size === 'sm' ? 'h-20 w-20' : 'h-36 w-36';
  const num = size === 'lg' ? 'text-5xl' : size === 'sm' ? 'text-xl' : 'text-4xl';
  return (
    <div className={`relative shrink-0 ${box}`} role="img" aria-label={`Overall score ${score} of 100`}>
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={r} fill="none" stroke={DIAL_TRACK} strokeWidth="10" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke={DIAL_FG}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`${num} font-bold tabular-nums text-zinc-50`}>{score}</span>
        {size !== 'sm' && <span className="text-xs text-zinc-500">/ 100</span>}
      </div>
    </div>
  );
}

/** compact five-bar strip for scoreboard rows */
export function MiniCategoryBars({ scores }: { scores: Record<string, number> }) {
  const entries = Object.entries(scores);
  const tone = (v: number) => (v >= 70 ? 'bg-emerald-400' : v >= 50 ? 'bg-amber-400' : 'bg-red-400');
  return (
    <div className="flex items-end gap-1.5" aria-hidden="true">
      {entries.map(([name, v]) => {
        const s = Math.max(0, Math.min(100, v));
        return (
          <div key={name} className="flex w-7 flex-col items-center gap-1" title={`${name} ${s}/100`}>
            <div className="flex h-8 w-full items-end overflow-hidden rounded-sm bg-zinc-800">
              <div className={`w-full rounded-sm ${tone(s)}`} style={{ height: `${s}%` }} />
            </div>
            <span className="text-[9px] uppercase tracking-wide text-zinc-600">{name.slice(0, 3)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function CategoryBar({ name, score }: { name: string; score: number }) {
  const tone = score >= 70 ? 'bg-emerald-400' : score >= 50 ? 'bg-amber-400' : 'bg-red-400';
  const s = Math.max(0, Math.min(100, score));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <span className="font-medium capitalize text-zinc-300">{name}</span>
        <span className="tabular-nums text-zinc-500">{s}/100</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ease-out ${tone}`}
          style={{ width: `${s}%` }}
        />
      </div>
    </div>
  );
}
