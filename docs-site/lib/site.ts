export const DOCS_ORIGIN = "https://docs.warpdrivecrm.com";
export const WEBSITE_URL = "https://warpdrivecrm.com";
export const REPOSITORY_URL = "https://github.com/KhademOHAli1/warpdrive";
export const SEARCH_INDEX_URL = "/api/search.json";
export const SITE_DESCRIPTION =
  "Documentation for Warpdrive, the open-source, self-hosted CRM for business-development teams.";

// Fumadocs removes trailing slashes when indexing pages. The static public URLs keep them.
export function publicDocPath(path: string) {
  return path.endsWith("/") ? path : `${path}/`;
}
