export const PROJECT_GUEST_PATH_HEADER = "x-warpdrive-project-guest-path";

export function isProjectGuestPage(pathname: string) {
  return pathname === "/projects/internal" || pathname.startsWith("/projects/internal/");
}
