/**
 * ShipScore — persistence layer (Day 3-4).
 *
 * Writes every completed scan into Prisma/SQLite and reads the live
 * scoreboard back. The DB is a single file, so scores survive server
 * restarts, hot reloads and dev/prod flips — the whole point of the
 * scoreboard is that it keeps its memory between demo sessions.
 *
 * Persistence is best-effort by design: a DB hiccup must never fail a
 * scan, it only costs a row (callers wrap persistScanReport in try/catch).
 */

import { db, ensureDbReady } from "@/lib/db";
import { parseGithubUrl } from "@/lib/scanner/clone";
import { SELF_ROOT } from "@/lib/runtime-paths";
import { ENGINE_VERSION } from "@/lib/scanner";
import type { ScanReport } from "@/lib/scanner/types";

export interface ScanRecordSummary {
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
  createdAt: string;
}

/** canonical identity for a scan: github.com/owner/repo, or "self" */
export function repoKeyFor(report: ScanReport, repoUrl?: string | null): string {
  if (repoUrl) {
    try {
      const { owner, repo } = parseGithubUrl(repoUrl);
      return `github.com/${owner}/${repo}`.toLowerCase();
    } catch {
      /* fall through to label-based key */
    }
  }
  if (report.root === SELF_ROOT) return "self";
  return `path:${report.repo}`;
}

export interface PersistInput {
  report: ScanReport;
  /** truncated touchpoint list actually sent to the client (stored verbatim) */
  responsePayload: unknown;
  repoUrl?: string | null;
  cloneMeta?: { cached: boolean; note: string } | null;
  source?: string;
}

export interface PersistResult {
  id: string;
  repoKey: string;
}

export async function persistScanReport(input: PersistInput): Promise<PersistResult> {
  await ensureDbReady();
  const { report, responsePayload, repoUrl, cloneMeta, source } = input;
  const repoKey = repoKeyFor(report, repoUrl);

  let owner: string | null = null;
  let name: string | null = null;
  if (repoUrl) {
    try {
      const parsed = parseGithubUrl(repoUrl);
      owner = parsed.owner;
      name = parsed.repo;
    } catch {
      /* non-github label — keep nulls */
    }
  }

  const row = await db.scanRecord.create({
    data: {
      repoKey,
      repo: report.repo,
      repoUrl: repoUrl ?? null,
      owner,
      name,
      overallScore: report.overallScore,
      grade: report.grade,
      scoreDesign: report.categoryScores.design,
      scoreShip: report.categoryScores.ship,
      scoreRun: report.categoryScores.run,
      scoreSecure: report.categoryScores.secure,
      scoreTest: report.categoryScores.test,
      engineVersion: report.engineVersion,
      filesScanned: report.filesScanned,
      filesWithTouchpoints: report.filesWithTouchpoints,
      totalLines: report.totalLines,
      totalTouchpoints: report.touchpoints.length,
      criticalCount: report.touchpoints.filter((t) => t.severity === "critical").length,
      highCount: report.touchpoints.filter((t) => t.severity === "high").length,
      durationMs: report.durationMs,
      notesJson: JSON.stringify(report.notes),
      reportJson: JSON.stringify({
        ...(responsePayload as Record<string, unknown>),
        clone: cloneMeta ?? null,
        repoUrl: repoUrl ?? null,
      }),
      source: source ?? "web",
    },
  });

  return { id: row.id, repoKey };
}

export interface LeaderboardEntry extends ScanRecordSummary {
  scans: number;
  /** scores of the most recent scans, newest first (max 6) for trend sparks */
  trend: number[];
  /** delta vs the previous scan of the same repo (null on first scan) */
  delta: number | null;
  engineVersion: string;
  lastScanAt: string;
}

export interface Scoreboard {
  leaderboard: LeaderboardEntry[];
  recent: ScanRecordSummary[];
  stats: {
    repos: number;
    scans: number;
    avgBestScore: number;
    lastScanAt: string | null;
    engineVersion: string;
  };
}

const RECENT_CAP = 10;
const TREND_CAP = 6;

export async function getScoreboard(limit = 25): Promise<Scoreboard> {
  const rows = await db.scanRecord.findMany({
    orderBy: { createdAt: "desc" },
    // scoreboard volume at hackathon scale is tiny; one indexed query
    // plus in-memory reduce keeps it simple and correct
    take: 2000,
  });
  return summarizeScoreboard(rows, limit);
}

/**
 * DB-proof scoreboard for the live demo: on a serverless cold start or a DB
 * hiccup the board renders empty with a note instead of erroring out —
 * scans themselves never depend on persistence.
 */
export async function getScoreboardSafe(limit = 25): Promise<Scoreboard & { degraded: boolean }> {
  try {
    await ensureDbReady();
    return { ...(await getScoreboard(limit)), degraded: false };
  } catch (e) {
    console.error("[persist] scoreboard read failed — returning empty board:", e);
    return {
      leaderboard: [],
      recent: [],
      stats: { repos: 0, scans: 0, avgBestScore: 0, lastScanAt: null, engineVersion: ENGINE_VERSION },
      degraded: true,
    };
  }
}

function summarizeScoreboard(
  rows: Array<{
    id: string;
    repoKey: string;
    repo: string;
    repoUrl: string | null;
    overallScore: number;
    grade: string;
    scoreDesign: number;
    scoreShip: number;
    scoreRun: number;
    scoreSecure: number;
    scoreTest: number;
    criticalCount: number;
    highCount: number;
    totalTouchpoints: number;
    engineVersion: string;
    createdAt: Date;
  }>,
  limit: number,
): Scoreboard {

  const summaries = rows.map((r) => ({
    id: r.id,
    repoKey: r.repoKey,
    repo: r.repo,
    repoUrl: r.repoUrl,
    overallScore: r.overallScore,
    grade: r.grade,
    categoryScores: {
      design: r.scoreDesign,
      ship: r.scoreShip,
      run: r.scoreRun,
      secure: r.scoreSecure,
      test: r.scoreTest,
    },
    criticalCount: r.criticalCount,
    highCount: r.highCount,
    totalTouchpoints: r.totalTouchpoints,
    createdAt: r.createdAt.toISOString(),
  }));

  // best score per repoKey (ties → the newer scan wins)
  const bestByRepo = new Map<string, ScanRecordSummary>();
  for (const s of summaries) {
    const cur = bestByRepo.get(s.repoKey);
    if (!cur || s.overallScore > cur.overallScore) bestByRepo.set(s.repoKey, s);
  }

  const leaderboard: LeaderboardEntry[] = [...bestByRepo.values()]
    .sort((a, b) => b.overallScore - a.overallScore || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((s) => {
      const history = summaries.filter((x) => x.repoKey === s.repoKey);
      const trend = history.slice(0, TREND_CAP).map((x) => x.overallScore);
      const prev = history[1];
      return {
        ...s,
        scans: history.length,
        trend,
        delta: prev ? s.overallScore - prev.overallScore : null,
        engineVersion: rows.find((r) => r.id === s.id)?.engineVersion ?? ENGINE_VERSION,
        lastScanAt: s.createdAt,
      };
    });

  return {
    leaderboard,
    recent: summaries.slice(0, RECENT_CAP),
    stats: {
      repos: bestByRepo.size,
      scans: summaries.length,
      avgBestScore:
        leaderboard.length > 0
          ? Math.round(leaderboard.reduce((acc, e) => acc + e.overallScore, 0) / leaderboard.length)
          : 0,
      lastScanAt: summaries[0]?.createdAt ?? null,
      engineVersion: rows[0]?.engineVersion ?? ENGINE_VERSION,
    },
  };
}

/** load a persisted report (for the fix agent) — null on miss OR on DB failure */
export async function getScanRecord(id: string) {
  try {
    await ensureDbReady();
    return await db.scanRecord.findUnique({ where: { id } });
  } catch (e) {
    console.error("[persist] scan record read failed:", e);
    return null;
  }
}
