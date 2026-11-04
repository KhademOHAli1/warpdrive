import { GITHUB_RELEASES_URL } from "./constants";

// Derive the repository from the same source-configured endpoint used by the worker, so a fork
// can repoint that constant without separately changing the cache's disclosure rule.
const RELEASE_REPOSITORY = new URL(GITHUB_RELEASES_URL).pathname
  .split("/")
  .slice(2, 4)
  .join("/")
  .toLowerCase();

// Older installations may retain an upstream release in the singleton cache. A row with an
// unknown or different repository stays stored for recovery, but must not reach the client.
export function isDistributionReleaseUrl(value: string | null): boolean {
  if (value === null || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    const releasePath = /^\/([^/]+\/[^/]+)\/releases\/tag\/[^/]+$/.exec(url.pathname);
    return (
      url.origin === "https://github.com" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      releasePath?.[1]?.toLowerCase() === RELEASE_REPOSITORY
    );
  } catch {
    return false;
  }
}
