export const assetPhotoMaxBytes = 5 * 1024 * 1024;
export const assetDocumentMaxBytes = 10 * 1024 * 1024;
export const assetMediaFilenameMaxLength = 180;
export const assetMediaPhotoTypes = ["image/jpeg", "image/png"] as const;
export const assetMediaDocumentType = "application/pdf" as const;

export type AssetMediaTarget = { type: "asset" | "model"; id: string };
export type AssetMediaKind = "photo" | "document";
export type AssetMediaMime = (typeof assetMediaPhotoTypes)[number] | typeof assetMediaDocumentType;

export type AssetMediaFile = {
  id: string;
  kind: AssetMediaKind;
  name: string;
  sizeBytes: number;
  mime: AssetMediaMime;
  uploadedAt: string;
  uploadedBy: string;
  previewHref: string | null;
  downloadHref: string;
};

export type AssetMediaEvent = {
  id: string;
  type: "uploaded" | "cover_changed";
  fileId: string | null;
  at: string;
  actor: string;
};

export type AssetMediaWorkspace = {
  target: AssetMediaTarget;
  version: number;
  canManage: boolean;
  files: AssetMediaFile[];
  coverId: string | null;
  inheritedCover: AssetMediaFile | null;
  history: AssetMediaEvent[];
};

export type AssetMediaResult =
  | { ok: true; value: AssetMediaWorkspace }
  | { ok: false; error: "unavailable" | "invalid" | "conflict" | "storage" };

export type AssetMediaRevision = {
  target: AssetMediaTarget;
  version: number;
  requestId: string;
};

export type AssetMediaUpload = AssetMediaRevision & { kind: AssetMediaKind; file: File };
export type AssetMediaSelectCover = AssetMediaRevision & { fileId: string | null };

export type AssetMediaAccess = {
  read: (target: AssetMediaTarget) => Promise<AssetMediaResult>;
  upload: (input: AssetMediaUpload) => Promise<AssetMediaResult>;
  setCover: (input: AssetMediaSelectCover) => Promise<AssetMediaResult>;
};
