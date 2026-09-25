/**
 * ShipScore scanner — tarball fallback for hosts without a git binary.
 *
 * Vercel's serverless runtime does not ship `git`, so git-clone is impossible
 * there. This module fetches the same content from codeload.github.com
 * (the endpoint that powers the "Download ZIP/tar.gz" button — generous
 * rate limits, no REST API quota) and extracts it with a minimal,
 * dependency-free ustar/pax parser.
 *
 * Security:
 * - the repo URL must pass the same strict github.com-only regex as git mode
 * - tar entries are zip-slip-guarded (no "..", no absolute paths, no
 *   symlink/hardlink entries are extracted)
 * - decompressed size is capped
 */

import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { ParsedRepo } from "./clone";

const MAX_TARBALL_BYTES = 80 * 1024 * 1024; // compressed download cap
const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024; // decompressed content cap
const MAX_ENTRIES = 20_000;

export const TARBALL_MARKER = ".shipscore-tarball.json";

interface TarEntry {
  path: string;
  size: number;
  type: string;
  /** raw entry payload (null for headers/dirs) */
  data: Buffer | null;
  /** pax "path" override or GNU longname for the NEXT entry */
  pendingName?: string;
}

function parseOctal(buf: Buffer, start: number, len: number): number {
  const s = buf.toString("ascii", start, start + len).replace(/[\0 ]+$/, "").trim();
  if (s === "") return 0;
  return parseInt(s, 8) || 0;
}

/**
 * Iterate entries of an uncompressed tar buffer. Handles ustar + GNU
 * longname ('L') + pax extended headers ('x', only the "path" record is
 * consumed — the only one we need).
 */
function* iterateTar(buf: Buffer): Generator<TarEntry> {
  let offset = 0;
  let pendingName: string | undefined;

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // end-of-archive

    let name = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
    const sizeField = parseOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 0x30);
    const magic = header.toString("ascii", 257, 262);

    // GNU base-256 size encoding (rare, but Go writers can emit it for >8GB — reject)
    if ((header[124] & 0x80) !== 0) {
      throw new Error("unsupported tar size encoding");
    }

    let dataStart = offset + 512;
    const dataLen = sizeField;
    let data: Buffer | null = dataLen > 0 ? buf.subarray(dataStart, dataStart + dataLen) : null;

    if (magic.startsWith("ustar") && type === "x" && data) {
      // pax extended header for the NEXT entry — pull the "path" record
      const text = data.toString("utf8");
      const m = /(?:^|\n)\d+ path=([^\n]+)/.exec(text);
      if (m) pendingName = m[1];
      offset = dataStart + dataLen + (512 - (dataLen % 512 || 512));
      continue;
    }
    if (magic.startsWith("ustar") && type === "L" && data) {
      pendingName = data.toString("utf8").replace(/\0.*$/, "");
      offset = dataStart + dataLen + (512 - (dataLen % 512 || 512));
      continue;
    }
    if (pendingName !== undefined) {
      name = pendingName;
      pendingName = undefined;
    }

    yield { path: name, size: dataLen, type, data, pendingName: undefined };

    offset = dataStart + dataLen + (512 - (dataLen % 512 || 512));
  }
}

/** zip-slip guard: normalized, relative, and stays inside the target root */
function safeJoin(root: string, relPath: string): string | null {
  if (relPath.startsWith("/") || relPath.includes("\0")) return null;
  const normalized = path.normalize(relPath);
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) return null;
  const abs = path.join(root, normalized);
  if (!abs.startsWith(root + path.sep)) return null;
  return abs;
}

export interface TarballResult {
  dir: string;
  sha: string | null;
  bytes: number;
  files: number;
}

/**
 * Download <owner>/<repo>'s default-branch tarball and extract it under
 * clonesRoot/<owner>-<repo>. Tries `main` then `master` — codeload needs an
 * explicit ref, and this avoids burning REST API rate limits on shared IPs.
 */
export async function fetchRepoTarball(parsed: ParsedRepo, destDir: string): Promise<TarballResult> {
  const url = `https://github.com/${parsed.owner}/${parsed.repo}`;
  let buf: Buffer | null = null;
  let sha: string | null = null;
  let lastError = "";

  for (const branch of ["main", "master"]) {
    try {
      const res = await fetch(`${url}/archive/refs/heads/${branch}.tar.gz`, {
        redirect: "follow",
        signal: AbortSignal.timeout(90_000),
        headers: { "User-Agent": "shipscore-scanner" },
      });
      if (!res.ok) {
        lastError = `codeload ${res.status} for branch ${branch}`;
        continue;
      }
      // GitHub redirects to codeload and exposes the commit sha in the location
      const loc = res.url || "";
      const shaMatch = /\/([0-9a-f]{40})/.exec(loc);
      sha = shaMatch ? shaMatch[1] : null;
      const arrayBuf = await res.arrayBuffer();
      if (arrayBuf.byteLength > MAX_TARBALL_BYTES) {
        throw new Error(`tarball too large: ${arrayBuf.byteLength} bytes`);
      }
      buf = Buffer.from(arrayBuf);
      break;
    } catch (e) {
      lastError = (e as Error).message;
    }
  }

  if (!buf) throw new Error(`tarball fetch failed: ${lastError}`);

  let extracted: Buffer;
  try {
    extracted = gunzipSync(buf);
  } catch {
    throw new Error("tarball is not valid gzip");
  }
  if (extracted.length > MAX_EXTRACTED_BYTES) {
    throw new Error(`extracted content too large: ${extracted.length} bytes`);
  }

  // entries carry a "<repo>-<sha>/" root — discover it, then strip it
  let rootPrefix: string | null = null;
  fs.mkdirSync(destDir, { recursive: true });

  let files = 0;
  let bytes = 0;
  for (const entry of iterateTar(extracted)) {
    if (rootPrefix === null && entry.path.includes("/")) {
      rootPrefix = entry.path.slice(0, entry.path.indexOf("/") + 1);
    }
    let rel = rootPrefix && entry.path.startsWith(rootPrefix) ? entry.path.slice(rootPrefix.length) : entry.path;
    if (rel === "") continue;
    if (entry.type !== "0" && entry.type !== "\0" && entry.type !== "5") continue; // no links/specials
    if (rel.endsWith("/")) continue; // directories are created implicitly

    const abs = safeJoin(destDir, rel);
    if (!abs) continue; // zip-slip attempt — skip silently
    if (files >= MAX_ENTRIES) throw new Error("tarball has too many entries");

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, entry.data ?? Buffer.alloc(0));
    files += 1;
    bytes += entry.size;
  }

  if (files === 0) throw new Error("tarball contained no usable files");

  fs.writeFileSync(
    path.join(destDir, TARBALL_MARKER),
    JSON.stringify({ mode: "tarball", owner: parsed.owner, repo: parsed.repo, sha, fetchedAt: new Date().toISOString() }),
  );

  return { dir: destDir, sha, bytes, files };
}
