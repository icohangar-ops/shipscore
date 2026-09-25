/**
 * ShipScore — canonical scoring engine v1.
 *
 * A pure interpreter of the rubric in ./rubric.ts. No I/O, no clocks, no
 * randomness: identical (touchpoints, signals, rubric) triples always
 * produce byte-identical breakdowns. This is what lets the web app, the
 * GitHub Action, and any future CLI all claim to run "the same engine" —
 * they literally call this function.
 *
 * The engine refuses to score with an invalid rubric (assertValidRubric)
 * and explains every point of movement through structured line items, so
 * "why is my score 74?" has a mechanical answer, not a vibe.
 */

import type { Category, Touchpoint } from "../scanner/types";
import {
  assertValidRubric,
  CATEGORY_ORDER,
  DEFAULT_RUBRIC,
  selectCategories,
  type Grade,
  type GradeBand,
  type ScoreRubric,
} from "./rubric";

export {
  assertValidRubric,
  CATEGORY_ORDER,
  DEFAULT_RUBRIC,
  selectCategories,
  type Grade,
  type ScoreRubric,
} from "./rubric";

/** Repo-level AI signals the structural gaps and credits condition on. */
export interface AiSignals {
  hasLlmCalls: boolean;
  hasEvals: boolean;
  hasCiWorkflows: boolean;
  hasTelemetry: boolean;
}

export interface EngineScoreInput {
  touchpoints: Touchpoint[];
  signals: AiSignals;
}

/** One explainable score movement. delta < 0 = deduction, > 0 = credit. */
export interface ScoreLineItem {
  /** stable id, e.g. "severity:secret:.env:3" or "gap:no-evals" */
  id: string;
  delta: number;
  reason: string;
}

export interface CategoryBreakdown {
  category: Category;
  /** rubric weight after any category selection/renormalization */
  weight: number;
  /** accumulated raw points before clamping (starts at 100) */
  raw: number;
  /** clamped, rounded score in [0, 100] */
  score: number;
  lineItems: ScoreLineItem[];
}

export interface OverallBreakdown {
  weightedAverage: number;
  minimum: number;
  /** round(wAvgShare * weightedAverage + minShare * minimum) */
  score: number;
}

export interface ScoreBreakdown {
  rubricVersion: string;
  rubricName: string;
  weights: Record<Category, number>;
  categories: Record<Category, CategoryBreakdown>;
  overall: OverallBreakdown;
  grade: Grade;
  /** human-readable note lines (same style as v0) */
  notes: string[];
  totalDeductions: number;
  totalCredits: number;
}

/**
 * Grade for an integer-ish score. Bands are first-match-wins from the
 * rubric (strictly descending); anything below the last band is an F.
 */
export function gradeFor(score: number, bands: GradeBand[]): Grade {
  for (const band of bands) {
    if (score >= band.min) return band.grade;
  }
  return "F";
}

/**
 * Weakest-link aggregation, exported separately so tests (and any future
 * surfaces) can verify the math independently of detection.
 */
export function aggregate(
  scores: Record<Category, number>,
  rubric: ScoreRubric,
): OverallBreakdown {
  let weightedSum = 0;
  for (const c of CATEGORY_ORDER) {
    weightedSum += scores[c] * rubric.weights[c];
  }
  const minimum = Math.min(...CATEGORY_ORDER.map((c) => scores[c]));
  const blended =
    rubric.aggregation.weightedAverageShare * weightedSum +
    rubric.aggregation.minimumShare * minimum;
  return {
    weightedAverage: Math.round(weightedSum * 100) / 100,
    minimum,
    score: Math.round(blended),
  };
}

function formatNote(category: Category, delta: number, reason: string): string {
  const sign = delta >= 0 ? "+" : "-";
  return `${sign}${Math.abs(delta)} ${category}: ${reason}`;
}

/**
 * Score a scan input against a rubric. Deterministic and side-effect free.
 */
export function scoreWithRubric(
  input: EngineScoreInput,
  rubric: ScoreRubric = DEFAULT_RUBRIC,
): ScoreBreakdown {
  assertValidRubric(rubric);

  const { touchpoints, signals } = input;

  const lineItems: Record<Category, ScoreLineItem[]> = {
    design: [],
    ship: [],
    run: [],
    secure: [],
    test: [],
  };
  const raw: Record<Category, number> = {
    design: 100,
    ship: 100,
    run: 100,
    secure: 100,
    test: 100,
  };

  const apply = (category: Category, id: string, delta: number, reason: string) => {
    raw[category] += delta;
    lineItems[category].push({ id, delta, reason });
  };

  // 1. per-finding severity deductions (info findings deduct 0 — skip)
  for (const t of touchpoints) {
    if (t.severity === "info") continue;
    const delta = -rubric.severityDeductions[t.severity];
    apply(
      t.category,
      `severity:${t.kind}:${t.file}:${t.line}`,
      delta,
      `${t.severity} ${t.kind} at ${t.file}:${t.line}`,
    );
  }

  // 2. per-kind flat penalties, capped (injection surfaces, secrets)
  //    The rubric declares the rule without a category; the penalty lands
  //    where the detectors place that kind's findings (secure, in practice).
  const kindPenaltyDeltas: Array<{ category: Category; delta: number; reason: string }> = [];
  for (const rule of rubric.kindPenalties) {
    const n = touchpoints.filter((t) => t.kind === rule.kind).length;
    if (n === 0) continue;
    const category = touchpointCategory(touchpoints, rule.kind);
    const uncapped = n * rule.perOccurrence;
    const capped = Math.min(rule.cap, uncapped);
    const delta = -capped;
    apply(
      category,
      `penalty:${rule.kind}`,
      delta,
      rule.reasonTemplate.replace("{n}", String(n)) + (capped < uncapped ? " (capped)" : ""),
    );
    kindPenaltyDeltas.push({
      category,
      delta,
      reason: rule.reasonTemplate.replace("{n}", String(n)),
    });
  }

  // 3. structural gaps — only where LLM calls exist and the signal doesn't
  const gapDeltas: Array<{ category: Category; delta: number; reason: string }> = [];
  if (signals.hasLlmCalls) {
    for (const gap of rubric.structuralGaps) {
      const present =
        gap.absentSignal === "evals"
          ? signals.hasEvals
          : gap.absentSignal === "telemetry"
            ? signals.hasTelemetry
            : signals.hasCiWorkflows;
      if (present) continue;
      const delta = -gap.deduction;
      apply(gap.category, `gap:${gap.id}`, delta, gap.reason);
      gapDeltas.push({ category: gap.category, delta, reason: gap.reason });
    }
  }

  // 4. capped positive credits
  const creditDeltas: Array<{ category: Category; delta: number; reason: string }> = [];
  for (const rule of rubric.credits) {
    // extract so the `in`-narrowing survives into the filter closure
    const source = rule.source;
    let n: number;
    if ("kind" in source) {
      n = touchpoints.filter((t) => t.kind === source.kind).length;
    } else {
      n = source.signal === "ciWorkflows" && signals.hasCiWorkflows ? 1 : 0;
    }
    const delta = Math.min(rule.cap, n * rule.perOccurrence);
    if (delta <= 0) continue;
    apply(rule.category, `credit:${rule.id}`, delta, rule.reasonTemplate);
    creditDeltas.push({ category: rule.category, delta, reason: rule.reasonTemplate });
  }

  // 5. clamp + round category scores
  const categories = {} as Record<Category, CategoryBreakdown>;
  for (const c of CATEGORY_ORDER) {
    const score = Math.max(0, Math.min(100, Math.round(raw[c])));
    categories[c] = {
      category: c,
      weight: rubric.weights[c],
      raw: raw[c],
      score,
      lineItems: lineItems[c],
    };
  }

  const overall = aggregate(
    Object.fromEntries(CATEGORY_ORDER.map((c) => [c, categories[c].score])) as Record<
      Category,
      number
    >,
    rubric,
  );

  // 6. notes — v0-compatible ordering: credits, gaps, kind penalties
  const notes: string[] = [];
  for (const { category, delta, reason } of creditDeltas) {
    notes.push(formatNote(category, delta, reason));
  }
  for (const { category, delta, reason } of gapDeltas) {
    notes.push(formatNote(category, delta, reason));
  }
  for (const { category, delta, reason } of kindPenaltyDeltas) {
    notes.push(formatNote(category, delta, reason));
  }

  const totalDeductions = CATEGORY_ORDER.reduce(
    (sum, c) => sum + lineItems[c].filter((li) => li.delta < 0).reduce((s, li) => s + -li.delta, 0),
    0,
  );
  const totalCredits = CATEGORY_ORDER.reduce(
    (sum, c) => sum + lineItems[c].filter((li) => li.delta > 0).reduce((s, li) => s + li.delta, 0),
    0,
  );

  return {
    rubricVersion: rubric.version,
    rubricName: rubric.name,
    weights: { ...rubric.weights },
    categories,
    overall,
    grade: gradeFor(overall.score, rubric.gradeBands),
    notes,
    totalDeductions,
    totalCredits,
  };
}

/**
 * Kind penalties in the rubric are declared without a category (the same
 * kind could land in different categories across repos). In practice the
 * category is taken from the first touchpoint of that kind — deterministic
 * because scanPath sorts touchpoints before scoring.
 */
function touchpointCategory(touchpoints: Touchpoint[], kind: string): Category {
  const first = touchpoints.find((t) => t.kind === kind);
  return first ? first.category : "design";
}
