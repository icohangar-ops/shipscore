/**
 * ShipScore scoring — v0-shaped compatibility shim.
 *
 * The scoring logic itself lives in src/lib/scoring (canonical rubric
 * v1.0.0 + engine). This module keeps the old `computeScores` signature
 * alive for existing callers and maps the rich v1 breakdown onto the flat
 * v0 shape. New code should call scoreWithRubric() directly.
 */

import { DEFAULT_RUBRIC, scoreWithRubric, type AiSignals, type ScoreBreakdown } from "../scoring/engine";
import type { Category, ScanReport, Touchpoint } from "./types";

export interface ScoreInput {
  touchpoints: Touchpoint[];
  hasLlmCalls: boolean;
  hasEvals: boolean;
  hasCiWorkflows: boolean;
  hasTelemetry: boolean;
}

export interface ScoreOutput {
  categoryScores: Record<Category, number>;
  overallScore: number;
  grade: ScanReport["grade"];
  notes: string[];
  rubricVersion: string;
}

/** Flatten a v1 breakdown into the v0 output shape. */
export function scoreToOutput(breakdown: ScoreBreakdown): ScoreOutput {
  const categoryScores = Object.fromEntries(
    Object.entries(breakdown.categories).map(([c, cb]) => [c, cb.score]),
  ) as Record<Category, number>;
  return {
    categoryScores,
    overallScore: breakdown.overall.score,
    grade: breakdown.grade,
    notes: breakdown.notes,
    rubricVersion: breakdown.rubricVersion,
  };
}

/** Backward-compatible entry point — scores with the canonical v1 rubric. */
export function computeScores(input: ScoreInput): ScoreOutput {
  const signals: AiSignals = {
    hasLlmCalls: input.hasLlmCalls,
    hasEvals: input.hasEvals,
    hasCiWorkflows: input.hasCiWorkflows,
    hasTelemetry: input.hasTelemetry,
  };
  return scoreToOutput(scoreWithRubric({ touchpoints: input.touchpoints, signals }, DEFAULT_RUBRIC));
}
