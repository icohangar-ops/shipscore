/**
 * ShipScore — runtime path resolution.
 *
 * One source of truth for where the app may READ (repo trees, fixtures) and
 * WRITE (clones, staged scans, the SQLite database).
 *
 * Local / sandbox dev: the project root itself is writable — everything works
 * exactly as before (scans/, clones/ and db/ live in the workspace).
 *
 * Vercel / serverless: the deployment directory (/var/task) is READ-ONLY and
 * ephemeral, so every write target moves under <os.tmpdir()>/shipscore. The
 * detection is an actual write probe — permission bits can lie about
 * read-only mounts, a real write cannot.
 *
 * Node builtins only — this module is intentionally dependency-free so it
 * stays safe to pull into any bundle graph.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** deployment root: the workspace locally, the traced bundle on serverless */
export const PROJECT_ROOT = process.cwd();

/** dogfood scan root ("self") — what the scanner walks when asked to scan itself */
export const SELF_ROOT = PROJECT_ROOT;

/** where the deliberately vulnerable demo fixture lives inside the deployment */
export const FIXTURE_DIR = path.join(PROJECT_ROOT, "tests", "fixtures", "sample-ai-repo");

function canActuallyWrite(dir: string): boolean {
  try {
    const probe = path.join(dir, `.shipscore-write-probe-${process.pid}`);
    fs.writeFileSync(probe, "ok");
    fs.rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Writable base for ALL runtime artifacts (scans/, clones/, db/).
 * Falls back to a per-instance tmp dir on read-only deployments — each warm
 * instance gets its own, which is the best SQLite can do without a hosted DB.
 */
export const WRITABLE_ROOT: string = canActuallyWrite(PROJECT_ROOT)
  ? PROJECT_ROOT
  : path.join(os.tmpdir(), "shipscore");

/** staged scan targets (fixture-demo, future uploads) live here */
export const SCANS_ROOT: string =
  process.env.SCANNER_ROOT ?? path.join(WRITABLE_ROOT, "scans");

/** git clone cache lives here */
export const CLONES_ROOT: string = path.join(WRITABLE_ROOT, "scans", "clones");

/**
 * DATABASE_URL fallback for read-only deployments.
 *
 * Must run BEFORE PrismaClient is constructed (db.ts imports this module
 * first, so module-evaluation order guarantees that). If DATABASE_URL is
 * unset — or set but unusable (e.g. a leaked dev .env pointing at a path
 * that does not exist on the deployment host) — we point Prisma at a
 * writable tmp file and `ensureDbReady()` (db.ts) creates the schema there.
 * Locally .env wins and this is a no-op.
 */
export function ensureSqliteUrl(): void {
  const current = process.env.DATABASE_URL;
  if (current?.startsWith("file:")) {
    const raw = current.slice("file:".length);
    const abs = path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, "prisma", raw);
    try {
      const dir = path.dirname(abs);
      fs.mkdirSync(dir, { recursive: true });
      if (canActuallyWrite(dir)) return; // usable as-is
    } catch {
      /* read-only or missing parent — fall through to the tmp override */
    }
  }
  const fallback = `file:${path.join(WRITABLE_ROOT, "db", "custom.db")}`;
  process.env.DATABASE_URL = fallback;
  console.log(`[runtime] DATABASE_URL unset or unusable — using ${fallback}`);
}

// apply the env fallback at import time, before db.ts builds the client
ensureSqliteUrl();
