import { NextRequest, NextResponse } from "next/server";
import { runFixAgent, canApply, type FixAgentInput } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fix — agent capability card (what the UI can render before calling).
 */
export function GET() {
  return NextResponse.json({
    engine: "fix-agent@0.1.0",
    rules: ["secret-to-env", "least-privilege-workflow", "prompt-guard-wrap", "add-eval-coverage (advisory)"],
    safety: {
      dryRunDefault: true,
      applyRequires: ["FIX_AGENT_ENABLED=1", "GITHUB_TOKEN", "body apply:true"],
      llmInLoop: false,
      writesToScannedTree: false,
    },
  });
}

/**
 * POST /api/fix — plan (and optionally open) fix PRs for a scanned repo.
 *
 * Body: { recordId }                      — plan from a persisted scan (preferred)
 *     | { target: "self" | <path> }       — fresh scan then plan
 *     | { repoUrl, refresh? }             — clone, scan, plan
 *     | apply?: boolean                   — request a REAL PR (still gated server-side)
 *
 * Default is a full dry-run: plans + PR spec, zero network, zero writes.
 */
/** flat body shape — FixAgentInput itself is a discriminated union */
type FixAgentBody = {
  recordId?: string;
  target?: string;
  repoUrl?: string;
  refresh?: boolean;
  apply?: boolean;
};

export async function POST(req: NextRequest) {
  let body: FixAgentBody;
  try {
    body = (await req.json()) as FixAgentBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const hasRecord = typeof body.recordId === "string" && body.recordId.trim() !== "";
  const hasTarget = "target" in body && body.target !== undefined;
  const hasUrl = typeof body.repoUrl === "string" && body.repoUrl.trim() !== "";

  if (!hasRecord && !hasTarget && !hasUrl) {
    return NextResponse.json(
      { error: "provide one of: recordId, target, repoUrl" },
      { status: 400 },
    );
  }

  try {
    const result = await runFixAgent(body as FixAgentInput);
    return NextResponse.json({ ...result, gate: canApply(body.apply) });
  } catch (e) {
    return NextResponse.json({ error: `fix agent failed: ${(e as Error).message}` }, { status: 400 });
  }
}
