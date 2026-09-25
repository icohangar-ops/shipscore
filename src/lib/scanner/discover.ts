/**
 * ShipScore scanner — deterministic file discovery.
 * Walks a directory tree in sorted order (stable output), skipping heavy
 * directories that never carry first-party AI code, and enforcing size caps.
 */

import fs from "node:fs";
import path from "node:path";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "dist",
  "build",
  "out",
  "coverage",
  ".nyc_output",
  "vendor",
  "venv",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  "target",
  ".cache",
  "tmp",
  "logs",
  ".idea",
  ".vscode",
]);

const CODE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const PY_EXTS = new Set([".py"]);
const DATA_EXTS = new Set([".json", ".yaml", ".yml"]);
const ENV_NAMES = new Set([".env", ".env.local", ".env.production", ".env.development"]);

export const SCAN_EXTS = new Set([...CODE_EXTS, ...PY_EXTS, ...DATA_EXTS]);

export type FileFlavor = "code" | "python" | "data" | "env";

export interface DiscoveredFile {
  absPath: string;
  /** repo-relative posix path */
  relPath: string;
  ext: string;
  size: number;
  lines: number;
  flavor: FileFlavor;
}

export interface DiscoverResult {
  files: DiscoveredFile[];
  truncated: boolean;
  totalLines: number;
}

function flavorFor(relPath: string, ext: string): FileFlavor {
  const base = path.posix.basename(relPath);
  if (ENV_NAMES.has(base) || base.startsWith(".env.")) return "env";
  if (PY_EXTS.has(ext)) return "python";
  if (CODE_EXTS.has(ext)) return "code";
  return "data";
}

export function discoverFiles(
  root: string,
  opts: { maxFiles?: number; maxFileBytes?: number; extraIgnoreDirs?: string[] } = {},
): DiscoverResult {
  const maxFiles = opts.maxFiles ?? 2000;
  const maxFileBytes = opts.maxFileBytes ?? 512 * 1024;
  const ignore = opts.extraIgnoreDirs
    ? new Set([...IGNORE_DIRS, ...opts.extraIgnoreDirs])
    : IGNORE_DIRS;

  const files: DiscoveredFile[] = [];
  let truncated = false;
  let totalLines = 0;

  // queue of relative dirs; seeded with root — sorted traversal for determinism
  const queue: string[] = [""];

  while (queue.length > 0) {
    const relDir = queue.shift() as string;
    const absDir = relDir === "" ? root : path.join(root, relDir);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir — skip silently
    }

    // sorted for deterministic output
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;

      if (entry.isDirectory()) {
        // keep hidden dirs that matter (.github), skip other hidden dirs
        if (entry.name.startsWith(".") && entry.name !== ".github") continue;
        if (ignore.has(entry.name)) continue;
        queue.push(rel);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.posix.extname(entry.name).toLowerCase();
      const isEnv = ENV_NAMES.has(entry.name) || entry.name.startsWith(".env.");
      if (!SCAN_EXTS.has(ext) && !isEnv) continue;

      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }

      const absPath = path.join(root, rel);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(absPath);
      } catch {
        continue;
      }
      if (stat.size > maxFileBytes) continue; // too big to be first-party source we care about

      let lines = 0;
      try {
        const content = fs.readFileSync(absPath, "utf8");
        lines = content.length === 0 ? 0 : content.split("\n").length;
      } catch {
        continue; // binary / unreadable — skip
      }

      totalLines += lines;
      files.push({
        absPath,
        relPath: rel,
        ext,
        size: stat.size,
        lines,
        flavor: flavorFor(rel, ext),
      });
    }
  }

  return { files, truncated, totalLines };
}
