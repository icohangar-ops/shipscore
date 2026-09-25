import { NextRequest, NextResponse } from "next/server";
import { ENGINE_VERSION, scanPath } from "@/lib/scanner";
import { DEFAULT_RUBRIC } from "@/lib/scoring/engine";
import { cloneRepo } from "@/lib/scanner/clone";
import { persistScanReport, type PersistResult } from "@/lib/persist";
import { resolveTarget, stageDemoTarget, SELF_ROOT } from "@/lib/scan-targets";
import { SCANS_ROOT } from "@/lib/runtime-paths";
import type { Touchpoint } from "@/lib/scanner/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/scan — engine metadata for the dashboard.
 */
export async function GET() {
  return NextResponse.json({
    engine: ENGINE_VERSION,
    detectors: [
      "ai-sdk-imports",
      "llm-call-sites",
      "prompt-literals",
      "injection-surfaces",
      "tool-definitions",
      "mcp-configs",
      "agent-permissions",
      "hardcoded-secrets",
      "model-refs",
      "eval-harnesses",
      "runtime-guards",
    ],
    scoring:
      "v1 weighted rubric: severity deductions + capped kind penalties + structural gaps + capped credits, weakest-link aggregate",
    rubric: DEFAULT_RUBRIC.version,
    rubricName: DEFAULT_RUBRIC.name,
    rubricWeights: DEFAULT_RUBRIC.weights,
  });
}

/**
 * POST /api/scan — run the scanner.
 * Body: { "target": "self" } (dogfood: scan this workspace)
 *    or { "target": "<relative path under SCANNER_ROOT>" }
 *
 * SCANS_ROOT (default: <writable-root>/scans — the workspace locally, a
 * per-instance tmp dir on serverless) is the only allowed external root;
 * absolute paths and traversal are rejected.
 */

const MAX_TOUCHPOINTS_IN_RESPONSE = 500;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { target, repoUrl, refresh } = (body ?? {}) as {
    target?: unknown;
    repoUrl?: unknown;
    refresh?: unknown;
  };

  // "demo" = the deliberately vulnerable sample repo, staged under SCANS_ROOT
  // so the stage demo works offline and always shows the full finding spread
  let effectiveTarget: unknown;
  try {
    effectiveTarget = stageDemoTarget(target);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  let resolved: { root: string; label: string };
  let cloneMeta: { cached: boolean; note: string } | undefined;

  try {
    if (typeof repoUrl === "string" && repoUrl.trim() !== "") {
      // GitHub mode: shallow-clone into SCANNER_ROOT/clones, then scan
      const result = await cloneRepo(repoUrl, { forceRefresh: refresh === true });
      resolved = { root: result.dir, label: result.label };
      cloneMeta = { cached: result.cached, note: result.note };
    } else {
      resolved = resolveTarget(effectiveTarget);
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  try {
    // self-scan skips synthetic fixtures — they are deliberately vulnerable
    const extraIgnore =
      resolved.root === SELF_ROOT
        ? ["fixtures", "scans"] // scans/ holds cloned repos — never self-scan them
        : undefined;
    const report = scanPath(resolved.root, resolved.label, { extraIgnoreDirs: extraIgnore });
    const truncated = report.touchpoints.length > MAX_TOUCHPOINTS_IN_RESPONSE;
    const payload = {
      ...report,
      touchpoints: report.touchpoints.slice(0, MAX_TOUCHPOINTS_IN_RESPONSE) as Touchpoint[],
      truncated,
      totalTouchpoints: report.touchpoints.length,
      clone: cloneMeta,
    };

    // persist for the live scoreboard — best-effort, a DB hiccup never fails a scan
    let persisted: PersistResult | null = null;
    try {
      persisted = await persistScanReport({
        report,
        responsePayload: payload,
        repoUrl: typeof repoUrl === "string" && repoUrl.trim() !== "" ? repoUrl : null,
        cloneMeta,
        source: "web",
      });
    } catch (dbErr) {
      console.error("[scan] persist failed (scan result still returned):", dbErr);
    }

    return NextResponse.json({ ...payload, persisted });
  } catch (e) {
    return NextResponse.json({ error: `scan failed: ${(e as Error).message}` }, { status: 500 });
  }
}
