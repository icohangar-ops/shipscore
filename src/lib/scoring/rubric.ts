/**
 * ShipScore — canonical scoring rubric v1.0.0 ("weighted rubrics").
 *
 * This file is the single source of truth for HOW a ScanReport becomes a
 * score. It is pure data (serializable, no functions) so it can be:
 *   - published and diffed in the repo (score debates become PRs to this file)
 *   - pinned by CI consumers ("we gate merges on rubric 1.0.0 exactly")
 *   - replayed offline: same inputs + same rubric => byte-identical scores
 *
 * History:
 *   v0 (scanner@0.1.0) — inline heuristic in src/lib/scanner/score.ts:
 *        unweighted category average blended with the minimum. The numbers
 *        below reproduce v0 exactly when weights are equal (see
 *        makeEqualWeightRubric), so v0 scores remain auditable forever.
 *   v1 (scanner@0.2.0) — weighted rubrics. Rationale for the default
 *        weights, in the order judges will ask:
 *          secure 0.30 — a repo with a committed secret cannot grade "B".
 *            Security carries the largest single weight on purpose.
 *          test 0.20 — shipping LLM paths with zero evals is THE failure
 *            mode of the AI era; it deserves real aggregate pull.
 *          run 0.20 — unobservable AI paths fail silently in production.
 *          ship 0.20 — no CI means no gate; the score must gate.
 *          design 0.10 — prompt architecture is the softest signal today;
 *            it informs, but should not dominate, the aggregate.
 *
 * Everything the engine does is expressed here: per-finding severity
 * deductions, per-kind flat penalties with caps, structural gaps gated on
 * AI usage, capped positive credits, weakest-link aggregation, and grade
 * bands. The engine (engine.ts) is a dumb interpreter of this object —
 * that separation is what makes the scoring canonical.
 */

import type { Category, Severity, TouchpointKind } from "../scanner/types";

export type Grade = "A" | "B" | "C" | "D" | "F";

/** Canonical display/iteration order for the five congress tracks. */
export const CATEGORY_ORDER: Category[] = ["design", "ship", "run", "secure", "test"];

/** Deduction applied per finding of a given severity. info costs nothing. */
export type SeverityDeductions = Record<Severity, number>;

/**
 * Flat penalty per occurrence of a TouchpointKind, capped.
 * reasonTemplate placeholders: {n} = occurrence count.
 */
export interface KindPenaltyRule {
  kind: TouchpointKind;
  perOccurrence: number;
  /** hard ceiling on the total deduction for this kind */
  cap: number;
  reasonTemplate: string;
}

/**
 * Structural gap: present only when the repo actually calls LLMs
 * (hasLlmCalls) AND the named signal is absent. This is the congress
 * theme quantified: AI code without evals/telemetry/CI is the era's gap.
 */
export interface StructuralGapRule {
  id: string;
  category: Category;
  deduction: number;
  reason: string;
  /** the signal whose ABSENCE triggers the gap */
  absentSignal: "evals" | "telemetry" | "ciWorkflows";
}

/** Capped positive credit. Sourced from a touchpoint kind or a boolean signal. */
export interface CreditRule {
  id: string;
  category: Category;
  perOccurrence: number;
  cap: number;
  source: { kind: TouchpointKind } | { signal: "ciWorkflows" };
  reasonTemplate: string;
}

/** Weakest-link aggregation: overall = wAvgShare * weightedAvg + minShare * min. */
export interface AggregationConfig {
  weightedAverageShare: number;
  minimumShare: number;
}

export interface GradeBand {
  /** score >= min earns the grade (first matching band wins; else F) */
  min: number;
  grade: Grade;
}

export interface ScoreRubric {
  version: string;
  name: string;
  /** aggregate weight per category; must sum to 1 */
  weights: Record<Category, number>;
  severityDeductions: SeverityDeductions;
  kindPenalties: KindPenaltyRule[];
  structuralGaps: StructuralGapRule[];
  credits: CreditRule[];
  aggregation: AggregationConfig;
  gradeBands: GradeBand[];
}

export const DEFAULT_RUBRIC: ScoreRubric = {
  version: "1.0.0",
  name: "shipscore-canonical",
  weights: { design: 0.1, ship: 0.2, run: 0.2, secure: 0.3, test: 0.2 },
  severityDeductions: { critical: 18, high: 12, medium: 7, low: 3, info: 0 },
  kindPenalties: [
    {
      kind: "injection",
      perOccurrence: 5,
      cap: 15,
      reasonTemplate: "{n} injection surface(s)",
    },
    {
      kind: "secret",
      perOccurrence: 10,
      cap: 20,
      reasonTemplate: "{n} hardcoded secret(s)",
    },
  ],
  structuralGaps: [
    {
      id: "no-evals",
      category: "test",
      deduction: 25,
      reason: "LLM paths ship with zero evals",
      absentSignal: "evals",
    },
    {
      id: "no-telemetry",
      category: "run",
      deduction: 15,
      reason: "no observability signal on AI paths",
      absentSignal: "telemetry",
    },
    {
      id: "no-ci",
      category: "ship",
      deduction: 15,
      reason: "no CI pipeline visible",
      absentSignal: "ciWorkflows",
    },
  ],
  credits: [
    {
      id: "eval-coverage",
      category: "test",
      perOccurrence: 6,
      cap: 12,
      source: { kind: "eval" },
      reasonTemplate: "eval harness detected",
    },
    {
      id: "runtime-guards",
      category: "run",
      perOccurrence: 4,
      cap: 8,
      source: { kind: "runtime-guard" },
      reasonTemplate: "retry/fallback logic present",
    },
    {
      id: "ci-present",
      category: "ship",
      perOccurrence: 5,
      cap: 5,
      source: { signal: "ciWorkflows" },
      reasonTemplate: "CI workflows present",
    },
  ],
  aggregation: { weightedAverageShare: 0.6, minimumShare: 0.4 },
  gradeBands: [
    { min: 90, grade: "A" },
    { min: 80, grade: "B" },
    { min: 70, grade: "C" },
    { min: 60, grade: "D" },
  ],
};

/**
 * The v0-compatible rubric: identical rules, equal weights. Under this
 * rubric the engine reproduces the v0 heuristic bit-for-bit (unweighted
 * average + minimum blend), which is the regression baseline asserted in
 * scripts/smoke_scoring.ts.
 */
export function makeEqualWeightRubric(version = "1.0.0-equal-weight"): ScoreRubric {
  return {
    ...DEFAULT_RUBRIC,
    version,
    weights: { design: 0.2, ship: 0.2, run: 0.2, secure: 0.2, test: 0.2 },
  };
}

/**
 * Build a rubric restricted to a subset of categories, with the remaining
 * weights renormalized to sum to 1. Used by the GitHub Action's
 * `categories` input so filtered runs stay rubric-compliant instead of
 * inventing their own math.
 */
export function selectCategories(rubric: ScoreRubric, categories: Category[]): ScoreRubric {
  const picked = categories.filter((c, i) => categories.indexOf(c) === i); // dedupe, keep order
  if (picked.length === 0) {
    throw new Error("selectCategories: no categories selected");
  }
  const unknown = picked.filter((c) => !CATEGORY_ORDER.includes(c));
  if (unknown.length > 0) {
    throw new Error(`selectCategories: unknown categories: ${unknown.join(", ")}`);
  }
  const rawSum = picked.reduce((sum, c) => sum + rubric.weights[c], 0);
  if (rawSum <= 0) {
    throw new Error("selectCategories: selected categories have zero total weight");
  }
  const weights = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, picked.includes(c) ? rubric.weights[c] / rawSum : 0]),
  ) as Record<Category, number>;
  return { ...rubric, weights };
}

/**
 * Rubric sanity checks. The engine refuses to score with an invalid
 * rubric — a canonical spec that cannot be trusted is worse than none.
 */
export function assertValidRubric(rubric: ScoreRubric): void {
  const eps = 1e-6;
  const label = `rubric ${rubric.name}@${rubric.version}`;

  const weightSum = CATEGORY_ORDER.reduce((s, c) => s + rubric.weights[c], 0);
  if (Math.abs(weightSum - 1) > eps) {
    throw new Error(`${label}: weights must sum to 1, got ${weightSum}`);
  }
  for (const c of CATEGORY_ORDER) {
    if (rubric.weights[c] < 0) {
      throw new Error(`${label}: negative weight for ${c}`);
    }
  }

  const aggSum = rubric.aggregation.weightedAverageShare + rubric.aggregation.minimumShare;
  if (Math.abs(aggSum - 1) > eps) {
    throw new Error(`${label}: aggregation shares must sum to 1, got ${aggSum}`);
  }
  if (rubric.aggregation.weightedAverageShare < 0 || rubric.aggregation.minimumShare < 0) {
    throw new Error(`${label}: negative aggregation share`);
  }

  for (const sev of ["critical", "high", "medium", "low", "info"] as Severity[]) {
    const d = rubric.severityDeductions[sev];
    if (!Number.isFinite(d) || d < 0) {
      throw new Error(`${label}: invalid severity deduction for ${sev}: ${d}`);
    }
  }

  for (const rule of rubric.kindPenalties) {
    if (rule.perOccurrence < 0 || rule.cap < rule.perOccurrence) {
      throw new Error(`${label}: invalid kindPenalty for ${rule.kind}`);
    }
  }
  for (const gap of rubric.structuralGaps) {
    if (gap.deduction < 0) {
      throw new Error(`${label}: negative structural gap ${gap.id}`);
    }
  }
  for (const credit of rubric.credits) {
    if (credit.perOccurrence < 0 || credit.cap < credit.perOccurrence) {
      throw new Error(`${label}: invalid credit ${credit.id}`);
    }
  }

  let prevMin = Number.POSITIVE_INFINITY;
  for (const band of rubric.gradeBands) {
    if (band.min >= prevMin) {
      throw new Error(`${label}: grade bands must be strictly descending`);
    }
    prevMin = band.min;
  }
}
