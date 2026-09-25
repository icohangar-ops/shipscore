import "@/lib/runtime-paths"; // must run first: DATABASE_URL fallback for read-only deployments
import { PrismaClient } from '@prisma/client'
import path from "node:path";
import fs from "node:fs";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Make sure the SQLite file + schema exist before the first query.
 *
 * Locally this is a no-op (db push already created everything, IF NOT EXISTS
 * is idempotent). On serverless the DB lives on a fresh per-instance tmp
 * volume, so we create the directory and mirror prisma/schema.prisma with
 * CREATE TABLE IF NOT EXISTS on first use — persistence works with zero
 * manual steps on any fresh host.
 */
let readyPromise: Promise<void> | null = null;

function sqlitePathFromUrl(url: string): string | null {
  if (!url.startsWith("file:")) return null;
  const raw = url.slice("file:".length);
  // absolute paths pass through; relative ones resolve against prisma/ (Prisma's rule)
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), "prisma", raw);
}

async function makeReady(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  const dbFile = sqlitePathFromUrl(url);
  if (dbFile) {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  }

  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ScanRecord" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "repoKey" TEXT NOT NULL,
      "repo" TEXT NOT NULL,
      "repoUrl" TEXT,
      "owner" TEXT,
      "name" TEXT,
      "overallScore" INTEGER NOT NULL,
      "grade" TEXT NOT NULL,
      "scoreDesign" INTEGER NOT NULL,
      "scoreShip" INTEGER NOT NULL,
      "scoreRun" INTEGER NOT NULL,
      "scoreSecure" INTEGER NOT NULL,
      "scoreTest" INTEGER NOT NULL,
      "engineVersion" TEXT NOT NULL,
      "filesScanned" INTEGER NOT NULL,
      "filesWithTouchpoints" INTEGER NOT NULL,
      "totalLines" INTEGER NOT NULL,
      "totalTouchpoints" INTEGER NOT NULL,
      "criticalCount" INTEGER NOT NULL,
      "highCount" INTEGER NOT NULL,
      "durationMs" INTEGER NOT NULL,
      "notesJson" TEXT NOT NULL,
      "reportJson" TEXT NOT NULL,
      "source" TEXT NOT NULL DEFAULT 'web',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ScanRecord_repoKey_createdAt_idx" ON "ScanRecord"("repoKey", "createdAt")`
  );
  await db.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "ScanRecord_createdAt_idx" ON "ScanRecord"("createdAt")`
  );
}

export function ensureDbReady(): Promise<void> {
  readyPromise ??= makeReady().catch((e) => {
    readyPromise = null; // allow a retry on the next call after a transient failure
    throw e;
  });
  return readyPromise;
}
