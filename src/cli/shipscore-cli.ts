#!/usr/bin/env node
/**
 * ShipScore CLI — the GitHub Action's runtime (bundled to action/dist/cli.mjs)
 * and a standalone local scorer. Runs the SAME canonical engine as the web
 * app: ../lib/scanner (scanner@0.2.0) + ../lib/scoring (rubric 1.0.0).
 *
 * Deliberately dependency-light: node builtins + the scanner only. No Next,
 * no Prisma, no SDKs — so bun build can bundle it into one portable file.
 *
 * Usage:
 *   node cli.mjs --path ./my-repo [--label my-repo] [--format json|summary|both]
 *        [--output shipscore-report.json] [--summary GITHUB_STEP_SUMMARY]
 *        [--threshold 60] [--categories design,ship,run,secure,test]
 *        [--max-files 2000] [--version]
 *
 * CI behavior (GitHub Action):
 *   - appends the markdown breakdown to $GITHUB_STEP_SUMMARY
 *   - writes score/grade/report/passed to $GITHUB_OUTPUT
 *   - posts the breakdown as a PR comment on pull_request events
 *   - exits 1 when the overall score is below --threshold
 */

import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ENGINE_VERSION, scanPath } from "../lib/scanner";
import { DEFAULT_RUBRIC, selectCategories, scoreWithRubric } from "../lib/scoring/engine";
import type { ScanReport } from "../lib/scanner/types";
import type { Category } from "../lib/scanner/types";

const CATEGORIES: Category[] = ["design", "ship", "run", "secure", "test"];

const USAGE = `ShipScore — Lighthouse for the AI era.

Options:
  --path <dir>        directory to scan (default: $GITHUB_WORKSPACE or cwd)
  --label <name>      display label (default: directory name)
  --format <f>        json | summary | both (default: both)
  --output <file>     JSON report path; "none" disables (default: <path>/shipscore-report.json)
  --summary <file>    markdown summary is APPENDED to this file (default: $GITHUB_STEP_SUMMARY)
  --threshold <n>     exit 1 when the overall score is below this (default: 0)
  --categories <csv>  subset of design,ship,run,secure,test; weights renormalize
  --max-files <n>     scanner file cap passthrough (default: 2000)
  --version           print engine + rubric versions and exit
`;

interface CliArgs {
  path: string;
  label?: string;
  format: "json" | "summary" | "both";
  output: string;
  summary?: string;
  threshold: number;
  categories?: Category[];
  maxFiles?: number;
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    options: {
      path: { type: "string" },
      label: { type: "string" },
      format: { type: "string", default: "both" },
      output: { type: "string", default: "" },
      summary: { type: "string" },
      threshold: { type: "string", default: "" },
      categories: { type: "string" },
      "max-files": { type: "string" },
      version: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });

  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (values.version) {
    process.stdout.write(`engine ${ENGINE_VERSION} · rubric ${DEFAULT_RUBRIC.version} (${DEFAULT_RUBRIC.name})\n`);
    process.exit(0);
  }

  const format = values.format as CliArgs["format"];
  if (format !== "json" && format !== "summary" && format !== "both") {
    process.stderr.write(`ShipScore: invalid --format "${format}" (json|summary|both)\n`);
    process.exit(2);
  }

  const thresholdRaw = values.threshold || process.env.INPUT_THRESHOLD || "0";
  const threshold = Number(thresholdRaw);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    process.stderr.write(`ShipScore: invalid --threshold "${thresholdRaw}" (0-100)\n`);
    process.exit(2);
  }

  let categories: Category[] | undefined;
  if (values.categories) {
    const requested = String(values.categories)
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s !== "");
    const unknown = requested.filter((c) => !CATEGORIES.includes(c as Category));
    if (unknown.length > 0) {
      process.stderr.write(`ShipScore: unknown categories: ${unknown.join(", ")}\n`);
      process.exit(2);
    }
    if (requested.length === 0) {
      process.stderr.write("ShipScore: --categories selected nothing\n");
      process.exit(2);
    }
    categories = requested as Category[];
  }

  let maxFiles: number | undefined;
  if (values["max-files"]) {
    const n = Number(values["max-files"]);
    if (!Number.isInteger(n) || n <= 0) {
      process.stderr.write(`ShipScore: invalid --max-files "${values["max-files"]}"\n`);
      process.exit(2);
    }
    maxFiles = n;
  }

  return {
    path: values.path ?? process.env.GITHUB_WORKSPACE ?? process.cwd(),
    label: values.label,
    format,
    output: values.output ?? "",
    summary: values.summary,
    threshold,
    categories,
    maxFiles,
  };
}

/**
 * Re-score for a --categories subset. scanPath always scores all five with
 * the default rubric; a filtered run renormalizes weights over the picked
 * categories and recomputes from the same touchpoints — no second scan.
 */
function applyCategoryFilter(report: ScanReport, root: string, categories: Category[]): ScanReport {
  const rubric = selectCategories(DEFAULT_RUBRIC, categories);
  const signals = {
    hasLlmCalls: (report.countsByKind["llm-call"] ?? 0) > 0,
    hasEvals: (report.countsByKind["eval"] ?? 0) > 0,
    hasTelemetry: report.touchpoints.some((t) => t.kind === "runtime-guard"),
    hasCiWorkflows: existsSync(join(root, ".github", "workflows")),
  };
  const breakdown = scoreWithRubric({ touchpoints: report.touchpoints, signals }, rubric);
  return {
    ...report,
    categoryScores: Object.fromEntries(
      Object.entries(breakdown.categories).map(([c, cb]) => [c, cb.score]),
    ) as ScanReport["categoryScores"],
    overallScore: breakdown.overall.score,
    grade: breakdown.grade,
    notes: breakdown.notes,
  };
}

function gradeTone(score: number): string {
  return score >= 70 ? "\u{1F7E9}" : score >= 50 ? "\u{1F7E8}" : "\u{1F534}";
}

function verdict(score: number): string {
  return score >= 70
    ? "\u2705 **Shipping AI responsibly.**"
    : score >= 50
      ? "\u26A0\uFE0F **Fixable gaps found.** The fix agent can draft PRs for the mechanical ones."
      : "\u{1F534} **High AI-era risk.** Guardrails and evals before the next merge.";
}

/** Markdown breakdown for $GITHUB_STEP_SUMMARY and PR comments. */
function renderSummary(report: ScanReport, threshold: number, passed: boolean): string {
  const weight = (c: Category): string => {
    const w = DEFAULT_RUBRIC.weights[c];
    // when a category filter renormalized weights the per-cat score line
    // still shows the default weight — acceptable display simplification
    return `${Math.round(w * 100)}%`;
  };

  const rows = CATEGORIES.map((c) => {
    const s = report.categoryScores[c];
    const filled = Math.round(s / 10);
    const bar = "\u2593".repeat(filled) + "\u2591".repeat(10 - filled);
    return `| ${gradeTone(s)} ${c[0].toUpperCase()}${c.slice(1)} | ${weight(c)} | ${bar} | ${s}/100 |`;
  }).join("\n");

  const notes =
    report.notes.length > 0
      ? report.notes.map((n) => `- ${n}`).join("\n")
      : "- no structural gaps or bonus credits triggered";

  const findings = report.touchpoints
    .slice(0, 15)
    .map((t) => `- \`${t.severity}\` **${t.kind}** — ${t.file}:${t.line} — ${t.detail}`)
    .join("\n");

  const more =
    report.touchpoints.length > 15
      ? `\n\n_…and ${report.touchpoints.length - 15} more finding(s) in the JSON report._`
      : "";

  const thresholdLine = passed
    ? `Threshold: ${threshold} — passed.`
    : `\u274C Score **${report.overallScore}** is below the required threshold **${threshold}** — merge blocked.`;

  return `## \u{1F6A8} ShipScore: **${report.overallScore}/100** (${report.grade}) — ${verdict(report.overallScore)}

> _Lighthouse for the AI era — how safely does this repo ship AI?_

| Category | Weight | Score | |
|---|---|---|---|
${rows}

**Why the score moves**

${notes}

<details>
<summary><strong>Top AI touchpoints (${report.touchpoints.length} total)</strong></summary>

${findings || "- none"}${more}

</details>

${thresholdLine}

---

<sub>${report.engineVersion} · rubric ${report.rubricVersion} (${DEFAULT_RUBRIC.name}) · ${report.filesScanned} files · ${report.totalLines} lines · ${report.durationMs}ms · Team Dash · WeAreDevelopers Hackathon 2026</sub>
`;
}

/** PR comment on pull_request events — mirrors the v0 action contract. */
async function postPrComment(summary: string): Promise<void> {
  const token = process.env.INPUT_GITHUB_TOKEN;
  const { GITHUB_EVENT_PATH, GITHUB_REPOSITORY, GITHUB_EVENT_NAME } = process.env;
  if (!token || !GITHUB_EVENT_PATH || GITHUB_EVENT_NAME !== "pull_request") return;

  try {
    const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, "utf8")) as {
      pull_request?: { number?: number };
    };
    const pr = event.pull_request?.number;
    if (!pr) return;
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPOSITORY}/issues/${pr}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "shipscore-action",
        },
        body: JSON.stringify({ body: summary }),
      },
    );
    if (!res.ok) console.error(`ShipScore: PR comment failed (${res.status})`);
    else console.log(`ShipScore: posted score comment on PR #${pr}`);
  } catch (err) {
    console.error("ShipScore: PR comment skipped —", (err as Error).message);
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs();

  const root = isAbsolute(args.path) ? args.path : resolve(args.path);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stderr.write(`ShipScore: scan target is not a directory: ${root}\n`);
    process.exit(2);
  }

  if (process.env.INPUT_FIX_PRS === "true") {
    console.log("ShipScore: fix-prs requested — the fix agent runs server-side; CI wiring lands in a later cut.");
  }

  let report = scanPath(root, args.label, { maxFiles: args.maxFiles });
  if (args.categories) {
    report = applyCategoryFilter(report, root, args.categories);
  }

  const passed = report.overallScore >= args.threshold;

  // --- JSON report artifact (full ScanReport + legacy-compat keys) ---
  // Default: <root>/shipscore-report.json (the v0 contract location).
  // --output <file> relocates it; --output none disables writing entirely.
  if (args.output !== "none") {
    const outPath = args.output === "" ? join(root, "shipscore-report.json") : resolve(args.output);
    const legacy = {
      ...report,
      version: 1,
      overall: report.overallScore,
      categories: report.categoryScores,
      touchpoints: report.touchpoints.length,
      threshold: args.threshold,
      passed,
    };
    writeFileSync(outPath, JSON.stringify(legacy, null, 2));
  }

  // --- outputs for downstream steps ---
  const ghOutput = process.env.GITHUB_OUTPUT;
  if (ghOutput) {
    writeFileSync(
      ghOutput,
      `score=${report.overallScore}\ngrade=${report.grade}\nreport=shipscore-report.json\npassed=${passed}\n`,
      { flag: "a" },
    );
  }

  // --- summary markdown ---
  const summary = renderSummary(report, args.threshold, passed);
  const summaryPath = args.summary ?? process.env.GITHUB_STEP_SUMMARY;
  if ((args.format === "summary" || args.format === "both") && summaryPath) {
    writeFileSync(summaryPath, summary, { flag: "a" });
  }
  await postPrComment(summary);

  // --- console output ---
  if (args.format === "json") {
    process.stdout.write(JSON.stringify({ ...report, threshold: args.threshold, passed }, null, 2) + "\n");
  } else if (args.format === "summary") {
    process.stdout.write(summary);
  } else {
    const cats = CATEGORIES.map((c) => `${c}=${report.categoryScores[c]}`).join(" ");
    process.stdout.write(
      `ShipScore: ${report.overallScore}/100 (${report.grade}) — rubric ${report.rubricVersion}\n${cats}\n`,
    );
    for (const n of report.notes) process.stdout.write(`  note: ${n}\n`);
  }

  if (!passed) {
    process.stderr.write(`ShipScore: ${report.overallScore} < threshold ${args.threshold} — failing the job.\n`);
    process.exit(1);
  }
}

main().catch((err: Error) => {
  process.stderr.write(`ShipScore: ${err.message}\n`);
  process.exit(1);
});
