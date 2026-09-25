/**
 * ShipScore scanner — orchestrator.
 * scanPath(root) -> ScanReport. Deterministic; safe for CI and for the
 * /api/scan route. No network, no LLM — pure local analysis.
 *
 * Since scanner@0.2.0 the scores come from the canonical weighted-rubric
 * engine in ../scoring (rubric 1.0.0). The GitHub Action bundles this same
 * module, so web + CI always agree.
 */

import fs from "node:fs";
import path from "node:path";
import { discoverFiles } from "./discover";
import { scanCodeFiles } from "./detectors/ts-ast";
import { scanEnvFile, scanJson, scanPython, scanYaml } from "./detectors/text";
import { DEFAULT_RUBRIC, scoreWithRubric } from "../scoring/engine";
import { SEVERITY_ORDER, type ScanOptions, type ScanReport, type Touchpoint } from "./types";

export const ENGINE_VERSION = "scanner@0.2.0";

export { discoverFiles } from "./discover";
export { computeScores } from "./score";
export { DEFAULT_RUBRIC, scoreWithRubric } from "../scoring/engine";
export * from "./types";

export function scanPath(root: string, label?: string, opts: ScanOptions = {}): ScanReport {
  const started = Date.now();
  const absRoot = path.resolve(root);
  if (!fs.existsSync(absRoot) || !fs.statSync(absRoot).isDirectory()) {
    throw new Error(`scan target is not a directory: ${absRoot}`);
  }

  const discovered = discoverFiles(absRoot, {
    maxFiles: opts.maxFiles,
    maxFileBytes: opts.maxFileBytes,
    extraIgnoreDirs: opts.extraIgnoreDirs,
  });

  const relByAbs = new Map(discovered.files.map((f) => [f.absPath, f.relPath]));
  const touchpoints: Touchpoint[] = [];

  // --- AST pass (JS/TS) ---
  const codeFiles = discovered.files.filter((f) => f.flavor === "code");
  const ast = scanCodeFiles(
    codeFiles.map((f) => f.absPath),
    relByAbs,
    { maxAstFiles: opts.maxAstFiles },
  );
  touchpoints.push(...ast.touchpoints);

  // --- text passes (python / yaml / json / env) ---
  for (const f of discovered.files) {
    let content: string;
    try {
      content = fs.readFileSync(f.absPath, "utf8");
    } catch {
      continue;
    }

    if (f.flavor === "python") {
      scanPython(f.relPath, content, touchpoints);
    } else if (f.flavor === "data") {
      if (f.ext === ".yaml" || f.ext === ".yml") scanYaml(f.relPath, content, touchpoints);
      else if (f.ext === ".json") scanJson(f.relPath, content, touchpoints);
    } else if (f.flavor === "env") {
      scanEnvFile(f.relPath, content, touchpoints);
    }
  }

  // --- CI presence (ship credit) ---
  const hasCiWorkflows =
    discovered.files.some((f) => f.relPath.startsWith(".github/workflows/")) || fs.existsSync(path.join(absRoot, ".github", "workflows"));

  // --- finalize ---
  touchpoints.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );

  const countsByKind: ScanReport["countsByKind"] = {};
  const countsByCategory: ScanReport["countsByCategory"] = {
    design: 0,
    ship: 0,
    run: 0,
    secure: 0,
    test: 0,
  };
  for (const t of touchpoints) {
    countsByKind[t.kind] = (countsByKind[t.kind] ?? 0) + 1;
    countsByCategory[t.category] += 1;
  }

  const hasLlmCalls = (countsByKind["llm-call"] ?? 0) > 0;
  const hasEvals = (countsByKind["eval"] ?? 0) > 0;
  const hasTelemetry = touchpoints.some((t) => t.kind === "runtime-guard");

  const breakdown = scoreWithRubric(
    {
      touchpoints,
      signals: { hasLlmCalls, hasEvals, hasCiWorkflows, hasTelemetry },
    },
    DEFAULT_RUBRIC,
  );

  const filesWithTouchpoints = new Set(touchpoints.map((t) => t.file)).size;

  return {
    repo: label ?? path.basename(absRoot),
    root: absRoot,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    engineVersion: ENGINE_VERSION,
    rubricVersion: breakdown.rubricVersion,
    filesScanned: discovered.files.length,
    filesWithTouchpoints,
    totalLines: discovered.totalLines,
    astSkipped: ast.astSkipped,
    touchpoints,
    countsByKind,
    countsByCategory,
    categoryScores: Object.fromEntries(
      Object.entries(breakdown.categories).map(([c, cb]) => [c, cb.score]),
    ) as ScanReport["categoryScores"],
    overallScore: breakdown.overall.score,
    grade: breakdown.grade,
    notes: breakdown.notes,
  };
}
