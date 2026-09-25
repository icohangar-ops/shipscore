/**
 * ShipScore scanner — shared types.
 * Deterministic, no-LLM AST + text detection of AI touchpoints in a codebase.
 * The scoring engine (Day 3-4) will consume ScanReport; the numbers produced
 * here are the canonical v0 heuristic.
 */

export type Category = "design" | "ship" | "run" | "secure" | "test";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type TouchpointKind =
  /** prompt text as code: variables, template literals, prompt files */
  | "prompt"
  /** a call into an LLM SDK / HTTP endpoint */
  | "llm-call"
  /** tool / function-calling definition handed to an agent */
  | "tool-definition"
  /** MCP (Model Context Protocol) server configuration */
  | "mcp-config"
  /** broad or dangerous permission granted to an agent or workflow */
  | "agent-permission"
  /** eval harness / golden-set usage (a positive signal) */
  | "eval"
  /** hardcoded credential or committed secret material */
  | "secret"
  /** hardcoded model name (not configurable) */
  | "model-ref"
  /** prompt construction that interpolates untrusted input */
  | "injection"
  /** observability / retry / fallback signal on AI paths (a positive signal) */
  | "runtime-guard";

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export interface Touchpoint {
  kind: TouchpointKind;
  category: Category;
  /** repo-relative posix path */
  file: string;
  line: number;
  column: number;
  /** trimmed source line, max ~200 chars */
  snippet: string;
  /** one-line human explanation of why this was flagged */
  detail: string;
  severity: Severity;
  /** detected SDK / framework, e.g. "openai", "anthropic", "z-ai-web-dev-sdk" */
  framework?: string;
}

export interface ScanOptions {
  /** max files walked (default 2000) */
  maxFiles?: number;
  /** max bytes per file (default 512 KiB) */
  maxFileBytes?: number;
  /** max files parsed with the TS AST (default 1000) */
  maxAstFiles?: number;
  /** extra directory names to ignore */
  extraIgnoreDirs?: string[];
}

export interface ScanReport {
  /** display label, e.g. repo name or "self" */
  repo: string;
  /** absolute path that was scanned */
  root: string;
  scannedAt: string;
  durationMs: number;
  engineVersion: string;
  /** canonical rubric version that produced the scores, e.g. "1.0.0" */
  rubricVersion: string;
  filesScanned: number;
  filesWithTouchpoints: number;
  totalLines: number;
  /** files discovered but skipped (AST cap), still text-scanned */
  astSkipped: number;
  touchpoints: Touchpoint[];
  countsByKind: Partial<Record<TouchpointKind, number>>;
  countsByCategory: Record<Category, number>;
  categoryScores: Record<Category, number>;
  overallScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  /** short human-readable notes explaining major deductions */
  notes: string[];
}
