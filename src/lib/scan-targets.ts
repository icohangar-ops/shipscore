/**
 * ShipScore — shared scan-target resolution.
 *
 * Used by both /api/scan and /api/fix. "self" scans the ShipScore deployment
 * (dogfood); anything else must be a relative path under SCANS_ROOT —
 * absolute paths and traversal are rejected.
 */

import path from "node:path";
import fs from "node:fs";
import { SELF_ROOT, SCANS_ROOT, FIXTURE_DIR } from "@/lib/runtime-paths";

export { SELF_ROOT };

/** alias accepted by both /api/scan and /api/fix for the vulnerable fixture */
export const DEMO_TARGET = "demo";
/** where the fixture is staged under SCANS_ROOT so it scans like any other target */
export const DEMO_STAGE_DIR = "fixture-demo";

export interface ResolvedTarget {
  root: string;
  label: string;
}

/**
 * "demo" = the deliberately vulnerable sample repo, copied under SCANS_ROOT
 * so it scans (and fix-plans) exactly like any other staged target. Shared by
 * /api/scan and the fix agent so both accept the same alias; idempotent.
 */
export function stageDemoTarget(raw: unknown): unknown {
  if (raw !== DEMO_TARGET) return raw;
  const demoDir = path.join(SCANS_ROOT, DEMO_STAGE_DIR);
  try {
    if (!fs.existsSync(demoDir)) {
      fs.cpSync(FIXTURE_DIR, demoDir, { recursive: true });
    }
  } catch (e) {
    throw new Error(`demo staging failed: ${(e as Error).message}`);
  }
  return DEMO_STAGE_DIR;
}

export function resolveTarget(raw: unknown): ResolvedTarget {
  if (raw === undefined || raw === null || raw === "self") {
    return { root: SELF_ROOT, label: "shipscore (self-scan)" };
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("target must be a non-empty string or 'self'");
  }
  const resolved = path.resolve(SCANS_ROOT, raw);
  if (!resolved.startsWith(path.resolve(SCANS_ROOT) + path.sep)) {
    throw new Error("target escapes the allowed scan root");
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`target directory not found: ${raw}`);
  }
  return { root: resolved, label: path.basename(resolved) };
}
