/**
 * ShipScore scanner — git-clone support (Day 2).
 *
 * Clones a public GitHub repo shallowly into SCANNER_ROOT/clones/<owner>-<repo>
 * and reuses the local copy as cache — which doubles as the stage-demo's
 * offline fallback: if the venue wifi dies, previously cloned repos still scan.
 *
 * Security: URL is strictly validated (github.com only), git runs via execFile
 * (no shell), terminal prompts disabled, clones capped + per-dir locked.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { CLONES_ROOT, SCANS_ROOT } from "@/lib/runtime-paths";
import { fetchRepoTarball, TARBALL_MARKER } from "./tarball";

const GITHUB_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;

export const CLONE_TIMEOUT_MS = 120_000;
const MAX_CLONE_DIRS = 12;

export function scannerRoot(): string {
  // SCANNER_ROOT env override kept for back-compat; default resolves through
  // runtime-paths so clones land on a writable volume on serverless too
  return SCANS_ROOT;
}

export function clonesRoot(): string {
  return CLONES_ROOT;
}

export interface ParsedRepo {
  owner: string;
  repo: string;
}

export function parseGithubUrl(raw: string): ParsedRepo {
  const m = GITHUB_URL_RE.exec(raw.trim());
  if (!m) {
    throw new Error("Only https://github.com/<owner>/<repo> URLs are supported in v0");
  }
  const [, owner, repo] = m;
  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    throw new Error("Invalid repository path");
  }
  return { owner, repo };
}

function dirName({ owner, repo }: ParsedRepo): string {
  return `${owner}-${repo}`.toLowerCase();
}

function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs: number }): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
      },
      (err, _stdout, stderr) => {
        if (err) reject(new Error(`${cmd} failed: ${String(stderr || err.message).slice(0, 300)}`));
        else resolve();
      },
    );
  });
}

function rmRf(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** some hosts (Vercel serverless) ship no git binary — detect once, cache the verdict */
let gitAvailable: boolean | null = null;
function hasGit(): Promise<boolean> {
  if (gitAvailable !== null) return Promise.resolve(gitAvailable);
  return new Promise((resolve) => {
    execFile("git", ["--version"], { timeout: 5_000 }, (err) => {
      gitAvailable = !err;
      resolve(gitAvailable);
    });
  });
}

function enforceCloneCap(): void {
  const root = clonesRoot();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const abs = path.join(root, e.name);
      return { abs, mtime: fs.statSync(abs).mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime); // oldest first

  while (dirs.length > MAX_CLONE_DIRS) {
    const oldest = dirs.shift();
    if (oldest) rmRf(oldest.abs);
  }
}

export interface CloneResult {
  dir: string;
  label: string;
  parsed: ParsedRepo;
  cached: boolean;
  note: string;
}

/** per-dir in-flight locks so concurrent requests never double-clone */
const locks = new Map<string, Promise<CloneResult>>();

export function cloneRepo(rawUrl: string, opts: { forceRefresh?: boolean } = {}): Promise<CloneResult> {
  const parsed = parseGithubUrl(rawUrl); // throws on bad URL — fail fast, outside the lock
  const key = dirName(parsed);
  const existing = locks.get(key);
  if (existing) return existing;

  const job = doClone(parsed, key, opts).finally(() => locks.delete(key));
  locks.set(key, job);
  return job;
}

async function doClone(parsed: ParsedRepo, key: string, opts: { forceRefresh?: boolean }): Promise<CloneResult> {
  const root = clonesRoot();
  fs.mkdirSync(root, { recursive: true });
  const dir = path.join(root, key);
  const url = `https://github.com/${parsed.owner}/${parsed.repo}.git`;
  const label = `${parsed.owner}/${parsed.repo}`;

  enforceCloneCap();

  const gitMode = await hasGit();
  const cachedMarker = gitMode ? path.join(dir, ".git") : path.join(dir, TARBALL_MARKER);

  if (opts.forceRefresh) {
    rmRf(dir);
  }

  if (fs.existsSync(cachedMarker)) {
    // cached — the offline-fallback path. Try a fast update; keep stale copy on failure.
    if (gitMode) {
      try {
        await run("git", ["pull", "--ff-only", "--quiet"], { cwd: dir, timeoutMs: 30_000 });
        return { dir, label, parsed, cached: true, note: "cached copy refreshed" };
      } catch {
        return { dir, label, parsed, cached: true, note: "offline — using cached copy" };
      }
    }
    try {
      rmRf(dir); // tarball refresh = re-download into a clean dir
      await fetchRepoTarball(parsed, dir);
      return { dir, label, parsed, cached: true, note: "cached snapshot refreshed" };
    } catch {
      if (!fs.existsSync(cachedMarker)) {
        throw new Error("cached snapshot is gone and refresh failed");
      }
      return { dir, label, parsed, cached: true, note: "offline — using cached copy" };
    }
  }

  if (gitMode) {
    try {
      await run("git", ["clone", "--depth", "1", "--single-branch", "--quiet", url, dir], {
        timeoutMs: CLONE_TIMEOUT_MS,
      });
      return { dir, label, parsed, cached: false, note: "fresh shallow clone" };
    } catch (e) {
      rmRf(dir); // clean partial clone
      throw e;
    }
  }

  // no git binary (serverless) — tarball snapshot via codeload
  try {
    await fetchRepoTarball(parsed, dir);
    return {
      dir,
      label,
      parsed,
      cached: false,
      note: "fresh snapshot (no git on this host — fetched archive tarball)",
    };
  } catch (e) {
    rmRf(dir); // clean partial extraction
    throw e;
  }
}
