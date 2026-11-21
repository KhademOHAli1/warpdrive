export const projectBrandIcons = [
  "folder",
  "rocket",
  "sparkles",
  "briefcase",
  "target",
  "layers",
  "flag",
  "globe",
  "code",
  "palette",
  "chart",
  "book",
  "heart",
  "lightbulb",
  "package",
  "shield",
] as const;
export type ProjectBrandIcon = (typeof projectBrandIcons)[number];

export type ProjectLogo =
  | { kind: "emoji"; value: string }
  | { kind: "icon"; value: ProjectBrandIcon; color: string };

export const projectCoverPresets = ["aurora", "dusk", "ocean", "orchid"] as const;
export type ProjectCoverPreset = (typeof projectCoverPresets)[number];
export type ProjectCover =
  | { kind: "preset"; value: ProjectCoverPreset }
  | { kind: "image"; value: string };

export type ProjectBrandChange = {
  timeZone?: string;
  logo?: ProjectLogo | null;
  cover?: { kind: "preset"; value: ProjectCoverPreset } | null;
  coverImage?: string;
};

export const maxProjectCoverUpload = 4 * 1024 * 1024;
export const maxStoredProjectCover = 768 * 1024;

export function projectCoverPath(projectId: string, version: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/cover/${encodeURIComponent(version)}`;
}
