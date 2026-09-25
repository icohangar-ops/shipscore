/**
 * ShipScore fix agent — orchestrator (Day 3-4 skeleton).
 *
 * runFixAgent(input) is the single entry point used by /api/fix:
 *
 *   resolve input -> ScanReport (from DB recordId, or a fresh scan)
 *   -> planFixes (deterministic rules, read-only)
 *   -> build PR spec (folded file contents)
 *   -> dry-run by default; a REAL PR needs GITHUB_TOKEN
 *      + FIX_AGENT_ENABLED=1 + an explicit apply:true
 *
 * The agent never mutates the scanned tree and never calls an LLM:
 * every edit is a reviewed rule from planner.ts, which is exactly the
 * story we tell on stage ("deterministic fixes, human in the loop").
 */

import fs from "node:fs";
import path from "node:path";
import { scanPath } from "@/lib/scanner";
import { cloneRepo } from "@/lib/scanner/clone";
import { resolveTarget, stageDemoTarget, SELF_ROOT } from "@/lib/scan-targets";
import { getScanRecord } from "@/lib/persist";
import { planFixes } from "./planner";
import { buildPullRequestSpec, openPullRequest, simulatePr } from "./pr";
import type { AgentRunResult, FixPlan } from "./types";

export * from "./types";

export type FixAgentInput =
  | { recordId: string; apply?: boolean }
  | { target: "self" | string; repoUrl?: string; apply?: boolean }
  | { repoUrl: string; refresh?: boolean; apply?: boolean };

export function canApply(apply?: boolean): { allowed: boolean; reason: string } {
  if (apply !== true) return { allowed: false, reason: "dry-run (apply not requested)" };
  if (process.env.FIX_AGENT_ENABLED !== "1") {
    return { allowed: false, reason: "dry-run (FIX_AGENT_ENABLED!=1)" };
  }
  if (!process.env.GITHUB_TOKEN) {
    return { allowed: false, reason: "dry-run (GITHUB_TOKEN missing)" };
  }
  return { allowed: true, reason: "apply enabled" };
}

interface ResolvedInput {
  report: ReturnType<typeof scanPath>;
  repoUrl: string | null;
  recordId?: string;
}

async function resolveInput(input: FixAgentInput): Promise<ResolvedInput> {
  if ("recordId" in input) {
    const record = await getScanRecord(input.recordId);
    if (!record) throw new Error(`no persisted scan with id ${input.recordId}`);
    const report = JSON.parse(record.reportJson) as ReturnType<typeof scanPath>;
    if (!report || !Array.isArray(report.touchpoints)) {
      throw new Error("persisted record has no usable report payload");
    }
    return { report, repoUrl: record.repoUrl, recordId: record.id };
  }

  if ("repoUrl" in input && typeof input.repoUrl === "string") {
    // the target-variant union member also carries an optional repoUrl, so
    // `in`-narrowing alone doesn't guarantee the refresh field exists
    const forceRefresh = (input as { refresh?: boolean }).refresh === true;
    const clone = await cloneRepo(input.repoUrl, { forceRefresh });
    const report = scanPath(clone.dir, clone.label);
    return { report, repoUrl: input.repoUrl };
  }

  if ("target" in input) {
    const resolved = resolveTarget(stageDemoTarget(input.target));
    const extraIgnore =
      resolved.root === SELF_ROOT ? ["fixtures", "scans"] : undefined;
    const report = scanPath(resolved.root, resolved.label, { extraIgnoreDirs: extraIgnore });
    return { report, repoUrl: input.repoUrl ?? null };
  }

  throw new Error("provide recordId, target, or repoUrl");
}

export async function runFixAgent(input: FixAgentInput): Promise<AgentRunResult> {
  const { report, repoUrl, recordId } = await resolveInput(input);
  const gate = canApply(input.apply);

  const { plans, skipped } = planFixes(report, {
    root: report.root,
    repoUrl,
  });

  const notes: string[] = [];
  let pr: AgentRunResult["pr"] = null;

  const patchable = plans.filter((p: FixPlan) => !p.advisory && p.edits.length > 0);
  if (patchable.length === 0) {
    notes.push("no mechanical fixes available for this report — advisory plans only");
  } else if (!repoUrl) {
    notes.push("self/path scans have no GitHub remote — showing the plan, PR authoring skipped");
  } else {
    const built = buildPullRequestSpec({
      plans,
      repoUrl,
      meta: {
        repo: report.repo,
        score: report.overallScore,
        grade: report.grade,
        engine: report.engineVersion,
      },
      readOriginal: (p) => {
        try {
          return fs.readFileSync(path.join(report.root, p), "utf8");
        } catch {
          return null;
        }
      },
    });

    if ("error" in built) {
      notes.push(built.error);
    } else {
      notes.push(...built.warnings);
      if (gate.allowed) {
        try {
          const opened = await openPullRequest(built.spec, repoUrl);
          pr = { simulated: false, spec: built.spec, url: opened.url, reason: gate.reason };
        } catch (e) {
          notes.push(`PR creation failed: ${(e as Error).message}`);
          pr = simulatePr(built.spec, "fell back to simulation after API error");
        }
      } else {
        pr = simulatePr(built.spec, gate.reason);
      }
    }
  }

  notes.push(...skipped.map((s) => `skipped ${s.finding}: ${s.reason}`));

  return {
    engine: "fix-agent@0.1.0",
    dryRun: !gate.allowed,
    recordId,
    report: {
      repo: report.repo,
      overallScore: report.overallScore,
      grade: report.grade,
      scannedAt: report.scannedAt,
    },
    plans,
    skipped,
    pr,
    summary: {
      autoFixable: patchable.filter((p) => p.safe).length,
      advisories: plans.length - patchable.length,
      filesTouched: pr ? pr.spec.commits.flatMap((c) => c.files.map((f) => f.path)).length : 0,
    },
    notes,
  };
}
