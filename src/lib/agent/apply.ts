/**
 * ShipScore fix agent — edit application (pure, in-memory).
 *
 * applyEdits folds PlannedEdits into file contents without touching disk.
 * The PR builder (pr.ts) uses these folded contents as commit payloads;
 * the API layer uses previewEdits to render before/after diffs for the
 * dry-run response. Line-scoped edits verify the expected original text
 * and become no-ops (with a warning) when the file drifted.
 */

import type { PlannedEdit } from "./types";

export interface ApplyResult {
  content: string;
  warnings: string[];
}

export function applyEdits(originalContent: string, edits: PlannedEdit[], filePath: string): ApplyResult {
  const warnings: string[] = [];
  let lines = originalContent.split(/\r?\n/);

  for (const edit of edits) {
    if (edit.path !== filePath) continue;
    if (edit.kind === "create-file") continue; // handled by the caller

    const idx = (edit.line ?? 1) - 1;

    if (edit.kind === "replace-line") {
      if (idx < 0 || idx >= lines.length) {
        warnings.push(`${filePath}:${edit.line} — line out of range, skipped`);
        continue;
      }
      if (edit.oldText !== undefined && lines[idx].trim() !== edit.oldText.trim()) {
        warnings.push(`${filePath}:${edit.line} — content drifted, edit skipped`);
        continue;
      }
      // multi-line replacements (e.g. yaml permission blocks) splice in place
      lines = [...lines.slice(0, idx), ...edit.newText.split("\n"), ...lines.slice(idx + 1)];
    } else if (edit.kind === "insert-after") {
      if (idx < 0 || idx >= lines.length) {
        warnings.push(`${filePath}:${edit.line} — anchor out of range, skipped`);
        continue;
      }
      lines = [...lines.slice(0, idx + 1), ...edit.newText.split("\n"), ...lines.slice(idx + 1)];
    } else if (edit.kind === "insert-top") {
      lines = [...edit.newText.split("\n"), ...lines];
    }
  }

  return { content: lines.join("\n"), warnings };
}

export interface FilePreview {
  path: string;
  existed: boolean;
  before: string;
  after: string;
}

/** build before/after previews for every file a set of plans touches */
export function previewEdits(
  plans: { edits: PlannedEdit[] }[],
  readOriginal: (path: string) => string | null,
): { previews: FilePreview[]; warnings: string[] } {
  const byPath = new Map<string, PlannedEdit[]>();
  for (const plan of plans) {
    for (const edit of plan.edits) {
      const list = byPath.get(edit.path) ?? [];
      list.push(edit);
      byPath.set(edit.path, list);
    }
  }

  const previews: FilePreview[] = [];
  const warnings: string[] = [];

  for (const [filePath, edits] of byPath) {
    const original = readOriginal(filePath);
    const createOnly = edits.every((e) => e.kind === "create-file");

    if (original === null || createOnly) {
      const created = edits
        .filter((e) => e.kind === "create-file")
        .map((e) => e.newText)
        .join("\n");
      previews.push({
        path: filePath,
        existed: false,
        before: "",
        after: created.length > 0 ? created : (original ?? ""),
      });
      continue;
    }

    const res = applyEdits(original, edits, filePath);
    warnings.push(...res.warnings);
    previews.push({ path: filePath, existed: true, before: original, after: res.content });
  }

  return { previews, warnings };
}
