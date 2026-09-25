/**
 * ShipScore fix agent — contracts (Day 3-4 skeleton).
 *
 * The agent turns scanner findings into deterministic, reviewable fix plans,
 * and (when explicitly enabled) opens real GitHub PRs. v0 rules only touch
 * findings with a provably safe transformation; everything else is advisory.
 *
 * Safety posture:
 *  - dry-run is the default and needs no credentials and no network
 *  - a real PR requires GITHUB_TOKEN **and** FIX_AGENT_ENABLED=1 **and**
 *    an explicit `apply: true` on the request
 *  - edits are line-scoped with the original text verified before replacing
 */

import type { ScanReport, Severity, TouchpointKind } from "@/lib/scanner/types";

export type EditKind = "replace-line" | "insert-after" | "insert-top" | "create-file";

export interface PlannedEdit {
  kind: EditKind;
  /** repo-relative posix path (matches Touchpoint.file) */
  path: string;
  /** 1-based line number for line-scoped edits */
  line?: number;
  /** expected original trimmed line (replace-line verification) */
  oldText?: string;
  newText: string;
  note: string;
}

export interface FixPlan {
  id: string;
  rule: string;
  title: string;
  findingFile: string;
  findingLine: number;
  findingKind: TouchpointKind;
  severity: Severity;
  /** what the plan does, one sentence */
  summary: string;
  edits: PlannedEdit[];
  commitMessage: string;
  /** true when the edit set is mechanical and low-risk (auto-apply candidate) */
  safe: boolean;
  /** advisory plans carry no edits — guidance only */
  advisory: boolean;
}

export interface PullRequestSpec {
  /** branch name, e.g. "shipscore/fix-hardcoded-secrets" */
  head: string;
  base: string;
  title: string;
  body: string;
  /** per-commit file payloads (path -> full new content) */
  commits: {
    message: string;
    files: { path: string; content: string; encoding: "utf-8" }[];
  }[];
}

export interface PrOutcome {
  simulated: boolean;
  spec: PullRequestSpec;
  /** populated only when a real PR was opened */
  url?: string;
  reason: string;
}

export interface AgentRunResult {
  engine: "fix-agent@0.1.0";
  dryRun: boolean;
  recordId?: string;
  report: {
    repo: string;
    overallScore: number;
    grade: string;
    scannedAt: string;
  };
  plans: FixPlan[];
  skipped: { finding: string; reason: string }[];
  pr: PrOutcome | null;
  summary: {
    autoFixable: number;
    advisories: number;
    filesTouched: number;
  };
  notes: string[];
}

/** context handed to the planner */
export interface PlanContext {
  /** absolute scanned root — lets the planner verify old text on disk */
  root: string;
  repoUrl?: string | null;
}
