import type { FileStatus } from "./types";

export interface ChangeStats {
  readonly total: number;
  readonly added: number;
  readonly modified: number;
  readonly removed: number;
  readonly renamed: number;
  readonly copied: number;
}

export function getChangeStats(
  fileStatuses: readonly FileStatus[],
): ChangeStats {
  const stats = {
    total: fileStatuses.length,
    added: 0,
    modified: 0,
    removed: 0,
    renamed: 0,
    copied: 0,
  };

  for (const file of fileStatuses) {
    switch (file.type) {
      case "A":
        stats.added++;
        break;
      case "M":
        stats.modified++;
        break;
      case "D":
        stats.removed++;
        break;
      case "R":
        stats.renamed++;
        break;
      case "C":
        stats.copied++;
        break;
    }
  }

  return stats;
}

export function formatChangeStats(stats: ChangeStats): string {
  const parts = [
    `${stats.total} file${stats.total === 1 ? "" : "s"} changed`,
  ];
  const counts: readonly [number, string][] = [
    [stats.modified, "modified"],
    [stats.added, "added"],
    [stats.removed, "removed"],
    [stats.renamed, "renamed"],
    [stats.copied, "copied"],
  ];
  for (const [count, label] of counts) {
    if (count > 0) {
      parts.push(`${count} ${label}`);
    }
  }
  return parts.join(" · ");
}
