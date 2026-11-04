import { z } from "zod";

export interface LibraryLocationInput {
  query: string;
  archive: "current" | "archived";
  status: "all" | "draft" | "active" | "paused";
  health: "all" | "latest-live-failed";
  sort: "updated-desc" | "name-asc" | "name-desc";
  limit: number;
  ownerId?: string;
  cursor?: string;
}

const keys = ["query", "archive", "status", "ownerId", "health", "sort", "limit", "cursor"];
const uuid = z.string().uuid();
const cursor = /^[A-Za-z0-9_-]{1,4096}$/;

export function defaultLibraryLocation(): LibraryLocationInput {
  return {
    query: "",
    archive: "current",
    status: "all",
    health: "all",
    sort: "updated-desc",
    limit: 25,
  };
}

export function parseLibraryLocation(search: string): LibraryLocationInput {
  const queryStart = search.indexOf("?");
  const params = new URLSearchParams(
    search.startsWith("/workflows") ? (queryStart < 0 ? "" : search.slice(queryStart + 1)) : search,
  );
  const value = defaultLibraryLocation();
  value.query = (params.get("query") ?? "").trim().slice(0, 200);
  if (params.get("archive") === "archived") value.archive = "archived";
  const status = params.get("status");
  if (
    value.archive === "current" &&
    (status === "draft" || status === "active" || status === "paused")
  )
    value.status = status;
  if (params.get("health") === "latest-live-failed") value.health = "latest-live-failed";
  const sort = params.get("sort");
  if (sort === "name-asc" || sort === "name-desc") value.sort = sort;
  const limit = params.get("limit");
  if (limit !== null && /^\d{1,3}$/.test(limit) && Number(limit) >= 1 && Number(limit) <= 100)
    value.limit = Number(limit);
  const owner = uuid.safeParse(params.get("ownerId"));
  if (owner.success) value.ownerId = owner.data.toLowerCase();
  const token = params.get("cursor");
  if (token !== null && cursor.test(token)) value.cursor = token;
  return value;
}

export function buildLibraryLocation(input: LibraryLocationInput): string {
  const params = new URLSearchParams();
  if (input.query.trim() !== "") params.set("query", input.query.trim());
  if (input.archive !== "current") params.set("archive", input.archive);
  if (input.status !== "all" && input.archive === "current") params.set("status", input.status);
  if (input.ownerId !== undefined) params.set("ownerId", input.ownerId.toLowerCase());
  if (input.health !== "all") params.set("health", input.health);
  if (input.sort !== "updated-desc") params.set("sort", input.sort);
  if (input.limit !== 25) params.set("limit", String(input.limit));
  if (input.cursor !== undefined && input.cursor !== "") params.set("cursor", input.cursor);
  const query = params.toString();
  return query === "" ? "/workflows" : `/workflows?${query}`;
}

// Return state grants no authority. Keep only an internal workflow-library location;
// a malformed cursor drops its continuation while retaining valid filter context.
function validParameters(params: URLSearchParams): boolean {
  if ((params.get("query") ?? "").trim().length > 200 || (params.get("query") ?? "").includes("\0"))
    return false;
  const owner = params.get("ownerId");
  if (owner !== null && !uuid.safeParse(owner).success) return false;
  const limit = params.get("limit");
  if (limit !== null && (!/^\d{1,3}$/.test(limit) || Number(limit) < 1 || Number(limit) > 100))
    return false;
  const choices: Record<string, string[]> = {
    archive: ["current", "archived"],
    status: ["all", "draft", "active", "paused"],
    health: ["all", "latest-live-failed"],
    sort: ["updated-desc", "name-asc", "name-desc"],
  };
  return Object.entries(choices).every(
    ([key, allowed]) => !params.has(key) || allowed.includes(params.get(key) ?? ""),
  );
}

export function sanitizeLibraryReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || raw.length > 8192 || !raw.startsWith("/") || raw.startsWith("//"))
    return "/workflows";
  let url: URL;
  try {
    url = new URL(raw, "https://workflow.invalid");
  } catch {
    return "/workflows";
  }
  if (url.origin !== "https://workflow.invalid" || url.pathname !== "/workflows" || url.hash !== "")
    return "/workflows";
  const params = url.searchParams;
  for (const key of params.keys())
    if (!keys.includes(key) || params.getAll(key).length !== 1) return "/workflows";
  if (!validParameters(params)) return "/workflows";
  return buildLibraryLocation(parseLibraryLocation(url.search));
}

export function workflowLocation(id: string, returnTo: string, history = false): string {
  if (!uuid.safeParse(id).success) return "/workflows";
  const params = new URLSearchParams();
  if (history) params.set("history", "1");
  const safe = sanitizeLibraryReturnTo(returnTo);
  if (safe !== "/workflows") params.set("returnTo", safe);
  const query = params.toString();
  return `/workflows/${id}${query === "" ? "" : `?${query}`}`;
}
