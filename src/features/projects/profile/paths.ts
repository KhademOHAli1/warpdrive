import type { ProfileCursor, ProfileItem, ProfileItemsInput, ProfileView } from "./contracts";

export const PROJECT_PROFILE_PATH = "/projects/internal/profile";

function profileViewPath(
  view: ProfileView | "activity",
  { status, priority, cursor }: ProfileItemsInput,
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

export function profileItemsPath(view: ProfileView, filter: ProfileItemsInput = {}) {
  return profileViewPath(view, filter);
}

export function profileActivityPath(cursor?: ProfileCursor) {
  return profileViewPath("activity", { cursor });
}

export function profileItemPath(item: Pick<ProfileItem, "id" | "project">) {
  return `/projects/internal/${encodeURIComponent(item.project.id)}?item=${encodeURIComponent(item.id)}`;
}
