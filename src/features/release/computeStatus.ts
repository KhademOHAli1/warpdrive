import { compareVersions } from "./compareVersions";
import { isDistributionReleaseUrl } from "./releaseProvenance";
import type { ReleaseRow, VersionStatus } from "./types";

const OFF: Omit<VersionStatus, "current" | "disabled"> = {
  latest: null,
  releaseUrl: null,
  releaseNotes: null,
  updateAvailable: null,
  checkedAt: null,
};

// Derive the client payload from the running version and the cached release row.
// Disabled, no row or an untrusted repository => no release data. The row itself is preserved.
// Otherwise compute updateAvailable, which is null for non-semver (dev) builds.
export function computeStatus(
  current: string,
  row: ReleaseRow | null,
  disabled: boolean,
): VersionStatus {
  if (disabled) return { current, ...OFF, disabled: true };
  if (row === null || !isDistributionReleaseUrl(row.releaseUrl))
    return { current, ...OFF, disabled: false };
  return {
    current,
    latest: row.latestTag,
    releaseUrl: row.releaseUrl,
    releaseNotes: row.releaseNotes,
    updateAvailable: compareVersions(current, row.latestTag),
    checkedAt: row.fetchedAt.toISOString(),
    disabled: false,
  };
}
