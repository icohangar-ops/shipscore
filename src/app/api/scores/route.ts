import { NextRequest, NextResponse } from "next/server";
import { getScoreboardSafe } from "@/lib/persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scores — the live scoreboard, straight from SQLite.
 * Persists across restarts/redeploys; every scan via /api/scan adds a row.
 *
 * Never 500s: on a fresh serverless instance or a DB hiccup it returns an
 * empty board with `degraded: true` so the landing page stays demoable.
 *
 * Query: ?limit=25 (leaderboard cap)
 */
export async function GET(req: NextRequest) {
  const rawLimit = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(Math.max(Number(rawLimit) || 25, 1), 100);

  const scoreboard = await getScoreboardSafe(limit);
  return NextResponse.json(scoreboard, {
    headers: { "Cache-Control": "no-store" },
  });
}
