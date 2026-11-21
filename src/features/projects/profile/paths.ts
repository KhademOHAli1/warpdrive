import type { ProfileItem, ProfileItemsInput, ProfileView } from "./contracts";

export const PROJECT_PROFILE_PATH = "/projects/internal/profile";

export function profileItemsPath(
  view: ProfileView,
  { status, priority, cursor }: ProfileItemsInput = {},
) {
  const params = new URLSearchParams();
  if (status !== undefined) params.set("status", status);
  if (priority !== undefined) params.set("priority", priority);
  if (cursor !== undefined) {
    params.set("after", cursor.createdAt);
    params.set("afterId", cursor.id);
  }
  const query = params.toString();
  return `${PROJECT_PROFILE_PATH}/${view}${query === "" ? "" : `?${query}`}`;
}

export function profileItemPath(item: ProfileItem) {
  return `/projects/internal/${encodeURIComponent(item.project.id)}?item=${encodeURIComponent(item.id)}`;
}
