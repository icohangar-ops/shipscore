/**
 * ShipScore fix agent — deterministic rule table (v0 skeleton).
 *
 * planFixes(report, ctx) reads the flagged files (read-only!) and emits
 * FixPlans. Rules are intentionally conservative:
 *
 *  - secret            -> replace the literal with an env-var lookup +
 *                         add a .env.example placeholder entry  [safe]
 *  - agent-permission  -> rewrite `permissions: write-all` to least privilege [safe]
 *  - injection         -> wrap the interpolated expression in promptGuard()
 *                         and scaffold the helper next to the finding [review]
 *  - eval gap / other  -> advisory plans with concrete guidance, no edits
 *
 * Everything here is pure file-reading + string shaping: no writes, no
 * network, no LLM. The actual disk/PR writes live in pr.ts and are gated.
 */

import fs from "node:fs";
import path from "node:path";
import type { ScanReport, Touchpoint } from "@/lib/scanner/types";
import type { FixPlan, PlanContext, PlannedEdit } from "./types";

const MAX_PLANS = 8;
const SECRET_MIN_LITERAL_LEN = 6;

function isPython(file: string): boolean {
  return file.endsWith(".py");
}

function readLines(root: string, file: string): string[] | null {
  const abs = path.join(root, file);
  try {
    return fs.readFileSync(abs, "utf8").split(/\r?\n/);
  } catch {
    return null;
  }
}

function pathExists(root: string, file: string): boolean {
  try {
    return fs.existsSync(path.join(root, file));
  } catch {
    return false;
  }
}

// --- rule: hardcoded secret -> env var ------------------------------------

/** derives a deterministic env var name from the code around the literal */
export function envNameFor(line: string, file: string): string {
  // covers `const KEY = "..."`, `apiKey: "..."`, `KEY = "..."` shapes
  const m = /\b([A-Za-z_][A-Za-z0-9]{2,})\s*[:=]\s*["'`]/.exec(line);
  if (m) {
    const candidate = m[1].replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
    if (!["CONST", "LET", "VAR", "EXPORT", "DEF", "SELF", "VALUE", "KEY"].includes(candidate)) {
      return candidate;
    }
  }
  const base = path
    .basename(file)
    .replace(/\.[^.]+$/, "")
    .replace(/[^A-Za-z0-9]/g, "_")
    .toUpperCase();
  return `${base}_SECRET`;
}

function planSecret(tp: Touchpoint, ctx: PlanContext): FixPlan | { skip: string } {
  const lines = readLines(ctx.root, tp.file);
  const original = lines?.[tp.line - 1]?.trim();
  if (!original || original !== tp.snippet.trim()) {
    return { skip: `source drifted at ${tp.file}:${tp.line} — refusing to guess` };
  }

  const envFromLine = envNameFor(tp.snippet, tp.file);
  const access = isPython(tp.file)
    ? `os.environ["${envFromLine}"]`
    : `process.env.${envFromLine}`;

  // swap the string literal for the env lookup (only the literal, nothing else)
  const literalRe = new RegExp(`(["'\`])[^"'\`]{${SECRET_MIN_LITERAL_LEN},}\\1`);
  if (!literalRe.test(tp.snippet)) {
    return { skip: "no recognizable quoted literal on the flagged line" };
  }
  const replaced = tp.snippet.replace(literalRe, access);

  const edits: PlannedEdit[] = [
    {
      kind: "replace-line",
      path: tp.file,
      line: tp.line,
      oldText: tp.snippet,
      newText: replaced,
      note: `secret literal -> ${access}`,
    },
  ];

  // python: make sure `import os` exists at the top of the module
  if (isPython(tp.file) && lines && !lines.some((l) => /^import os\b/m.test(l))) {
    edits.push({
      kind: "insert-top",
      path: tp.file,
      newText: "import os",
      note: "os lookup needs the import",
    });
  }

  // .env.example placeholder (only when it does not exist yet)
  if (!pathExists(ctx.root, ".env.example")) {
    edits.push({
      kind: "create-file",
      path: ".env.example",
      newText: `${envFromLine}=\n# moved out of ${tp.file}:${tp.line} by shipscore fix-agent\n`,
      note: "document the required secret without leaking its value",
    });
  }

  return {
    id: `fix-secret-${tp.file}-${tp.line}`,
    rule: "secret-to-env",
    title: `Move hardcoded secret in ${tp.file}:${tp.line} to an env var`,
    findingFile: tp.file,
    findingLine: tp.line,
    findingKind: tp.kind,
    severity: tp.severity,
    summary: `Replace the credential literal with ${access} and document it in .env.example.`,
    edits,
    commitMessage: `fix(security): move hardcoded secret (${tp.file}:${tp.line}) to env var`,
    safe: true,
    advisory: false,
  };
}

// --- rule: workflow permissions write-all -> least privilege ---------------

function planPermissions(tp: Touchpoint, _ctx: PlanContext): FixPlan | { skip: string } {
  const original = tp.snippet.trim();
  if (!/permissions\s*:\s*write-all/i.test(original)) {
    return { skip: "permission finding without a rewrite rule yet" };
  }
  return {
    id: `fix-perms-${tp.file}-${tp.line}`,
    rule: "least-privilege-workflow",
    title: `Least-privilege permissions in ${tp.file}:${tp.line}`,
    findingFile: tp.file,
    findingLine: tp.line,
    findingKind: tp.kind,
    severity: tp.severity,
    summary: "Replace `permissions: write-all` with the minimal set the workflow declares.",
    edits: [
      {
        kind: "replace-line",
        path: tp.file,
        line: tp.line,
        oldText: original,
        newText: "permissions:\n  contents: read",
        note: "write-all -> contents: read (raise per-job only where proven needed)",
      },
    ],
    commitMessage: `fix(security): least-privilege workflow permissions (${tp.file})`,
    safe: true,
    advisory: false,
  };
}

// --- rule: untrusted interpolation -> prompt guard --------------------------

export function promptGuardModuleName(file: string): string {
  return isPython(file) ? "prompt_guard.py" : "prompt-guard.ts";
}

function planInjection(tp: Touchpoint, ctx: PlanContext): FixPlan | { skip: string } {
  const original = tp.snippet.trim();
  if (!/\$\{[^}]+\}/.test(original)) {
    return { skip: "no template interpolation on the flagged line" };
  }
  const wrapped = original.replace(/\$\{([^}]+)\}/g, "${promptGuard($1)}");
  const helper = promptGuardModuleName(tp.file);
  const helperPath = path.join(path.dirname(tp.file), helper).split(path.sep).join("/");

  const edits: PlannedEdit[] = [
    {
      kind: "replace-line",
      path: tp.file,
      line: tp.line,
      oldText: original,
      newText: wrapped,
      note: "untrusted segment routed through promptGuard()",
    },
  ];

  if (!pathExists(ctx.root, helperPath)) {
    edits.push(
      isPython(tp.file)
        ? {
            kind: "create-file",
            path: helperPath,
            newText: [
              '"""ShipScore auto-fix helper — sanitize untrusted strings before prompt use."""',
              "import re",
              "",
              "",
              "def prompt_guard(untrusted: str, max_len: int = 4000) -> str:",
              '    """Strip control chars, chat markers and role headers."""',
              '    out = re.sub(r"[\\x00-\\x1f\\x7f]", " ", untrusted)',
              '    out = re.sub(r"<\\|[^|>]*\\|>", "", out)',
              '    out = re.sub(r"(system|assistant|user)\\s*:", r"\\1\\\\:", out, flags=re.I)',
              "    return out[:max_len]",
              "",
            ].join("\n"),
            note: "scaffolded sanitizer (review before merge)",
          }
        : {
            kind: "create-file",
            path: helperPath,
            newText: [
              "/**",
              " * ShipScore auto-fix helper — sanitize untrusted strings before they are",
              " * interpolated into a prompt. Strips control characters, chat-marker",
              " * tokens and role headers that could terminate the system context.",
              " */",
              "export function promptGuard(untrusted: string, maxLen = 4000): string {",
              "  return untrusted",
              "    .replace(/[\\u0000-\\u001f\\u007f]/g, ' ')",
              "    .replace(/<\\|[^|>]*\\|>/g, '')",
              "    .replace(/(system|assistant|user)\\s*:/gi, '$1\\\\:')",
              "    .slice(0, maxLen);",
              "}",
              "",
            ].join("\n"),
            note: "scaffolded sanitizer (review before merge)",
          },
    );
    edits.push({
      kind: "insert-top",
      path: tp.file,
      newText: isPython(tp.file)
        ? `from .${path.basename(helper, ".py")} import prompt_guard  # shipscore fix-agent`
        : `import { promptGuard } from './${path.basename(helper, ".ts")}'; // shipscore fix-agent`,
      note: "helper import (adjust path to your module system)",
    });
  }

  return {
    id: `fix-injection-${tp.file}-${tp.line}`,
    rule: "prompt-guard-wrap",
    title: `Route untrusted interpolation in ${tp.file}:${tp.line} through a guard`,
    findingFile: tp.file,
    findingLine: tp.line,
    findingKind: tp.kind,
    severity: tp.severity,
    summary: "Wrap interpolated input in promptGuard() so injected instructions are neutralized.",
    edits,
    commitMessage: `fix(security): guard untrusted prompt interpolation (${tp.file}:${tp.line})`,
    safe: false,
    advisory: false,
  };
}

// --- advisory: eval coverage ------------------------------------------------

function advisoryEvalPlan(report: ScanReport): FixPlan {
  const llmFiles = [...new Set(report.touchpoints.filter((t) => t.kind === "llm-call").map((t) => t.file))];
  const example = llmFiles[0] ?? "src/lib/ai";
  return {
    id: "fix-adv-eval-coverage",
    rule: "add-eval-coverage",
    title: "Add eval coverage for every LLM path",
    findingFile: llmFiles[0] ?? "-",
    findingLine: 0,
    findingKind: "eval",
    severity: "high",
    summary: `No eval harness detected. Start with golden-set tests against ${example}, then gate CI on the eval score.`,
    edits: [],
    commitMessage: "test: add eval coverage for LLM paths",
    safe: false,
    advisory: true,
  };
}

// --- orchestrating planner ---------------------------------------------------

export interface PlannerOutput {
  plans: FixPlan[];
  skipped: { finding: string; reason: string }[];
}

export function planFixes(report: ScanReport, ctx: PlanContext): PlannerOutput {
  const plans: FixPlan[] = [];
  const skipped: { finding: string; reason: string }[] = [];

  const planFor = (tp: Touchpoint): FixPlan | { skip: string } | null => {
    switch (tp.kind) {
      case "secret":
        return planSecret(tp, ctx);
      case "agent-permission":
        return planPermissions(tp, ctx);
      case "injection":
        return planInjection(tp, ctx);
      default:
        return null; // no v0 rule — silently unhandled, advisories cover the rest
    }
  };

  for (const tp of report.touchpoints) {
    if (plans.length >= MAX_PLANS) break;
    const outcome = planFor(tp);
    if (!outcome) continue;
    if ("skip" in outcome) {
      skipped.push({ finding: `${tp.kind} ${tp.file}:${tp.line}`, reason: outcome.skip });
      continue;
    }
    // de-dupe: one plan per file:line
    if (!plans.some((p) => p.findingFile === tp.file && p.findingLine === tp.line)) {
      plans.push(outcome);
    }
  }

  // structural gap: LLM calls but zero evals -> advisory
  const hasLlmCalls = (report.countsByKind["llm-call"] ?? 0) > 0;
  const hasEvals = (report.countsByKind["eval"] ?? 0) > 0;
  if (hasLlmCalls && !hasEvals && plans.length < MAX_PLANS) {
    plans.push(advisoryEvalPlan(report));
  }

  return { plans, skipped };
}
