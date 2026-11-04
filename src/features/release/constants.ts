// Follow releases of this distribution. Other forks can repoint this repository.
const RELEASE_REPO = "KhademOHAli1/warpdrive";
export const GITHUB_RELEASES_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;

// GitHub asks unauthenticated callers to send a User-Agent; omitting it gets requests rejected.
export const RELEASE_FETCH_USER_AGENT = "warpdrive-version-check";
export const RELEASE_FETCH_TIMEOUT_MS = 10_000;

// Every 6 hours. GitHub's unauthenticated rate limit is 60/hour/IP, so this is negligible.
export const RELEASE_CHECK_CRON = "0 */6 * * *";

// localStorage key the banner writes the dismissed version to; keyed by version so a newer
// release re-shows the banner.
export const RELEASE_DISMISS_KEY = "warpdrive.dismissed_version";
