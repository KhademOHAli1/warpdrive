import type { AssetMediaTarget } from "./contracts";

export const assetMediaBinaryCsp = "sandbox; default-src 'none'";

export const assetMediaHeaders = {
  actor: "x-asset-media-actor",
  csrf: "x-csrf-token",
  version: "x-asset-media-version",
  request: "x-asset-media-request",
  name: "x-asset-media-name",
  kind: "x-asset-media-kind",
} as const;

export type AssetMediaFileView = "preview" | "download";

export function assetMediaPath(
  target: AssetMediaTarget,
  fileId?: string,
  view: AssetMediaFileView = "download",
) {
  const path = `/api/assets/media/${target.type}/${encodeURIComponent(target.id)}`;
  return fileId === undefined ? path : `${path}?fileId=${encodeURIComponent(fileId)}&view=${view}`;
}
