import { statfsSync } from "node:fs";

const DEVELOPMENT_CACHE_HEADROOM_BYTES = 4 * 1024 ** 3;
type CacheConfiguration = { cache?: unknown; [key: string]: unknown };

function availableWorkspaceBytes(): number | undefined {
  try {
    const stats = statfsSync(process.cwd());
    return stats.bavail * stats.bsize;
  } catch {
    return undefined;
  }
}

// Large development pack-file writes can exhaust a nearly full host volume and make
// unrelated auth/CRM routes return 500. Preserve production caching and normal dev defaults.
export function applyDevelopmentCachePolicy(
  config: CacheConfiguration,
  development: boolean,
  readAvailableBytes: () => number | undefined = availableWorkspaceBytes,
): CacheConfiguration {
  if (!development) return config;
  const available = readAvailableBytes();
  if (available === undefined || available < DEVELOPMENT_CACHE_HEADROOM_BYTES)
    config.cache = { type: "memory" };
  return config;
}
