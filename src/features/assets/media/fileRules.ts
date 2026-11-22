import { validateDisplayFilename } from "@/features/files/keys";
import {
  type AssetMediaKind,
  type AssetMediaMime,
  type AssetMediaTarget,
  assetDocumentMaxBytes,
  assetMediaDocumentType,
  assetMediaFilenameMaxLength,
  assetPhotoMaxBytes,
} from "./contracts";

const signatures: Record<AssetMediaMime, readonly number[]> = {
  "image/jpeg": [255, 216, 255],
  "image/png": [137, 80, 78, 71, 13, 10, 26, 10],
  "application/pdf": [37, 80, 68, 70, 45],
};

function allowedAssetMediaMime(
  target: AssetMediaTarget,
  kind: AssetMediaKind,
  mime: string,
): AssetMediaMime | null {
  if (kind === "photo" && (mime === "image/jpeg" || mime === "image/png")) return mime;
  if (kind === "document" && target.type === "asset" && mime === assetMediaDocumentType)
    return mime;
  return null;
}

export function assetMediaUploadMetadata(input: {
  target: AssetMediaTarget;
  kind: AssetMediaKind;
  name: string;
  mime: string;
  sizeBytes: number;
}): { name: string; mime: AssetMediaMime; sizeBytes: number } | null {
  const { kind, mime, sizeBytes, target } = input;
  const acceptedMime = allowedAssetMediaMime(target, kind, mime);
  const limit = kind === "photo" ? assetPhotoMaxBytes : assetDocumentMaxBytes;
  if (
    acceptedMime === null ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > limit
  )
    return null;
  if (
    input.name.length > assetMediaFilenameMaxLength ||
    /[\p{Cc}\p{Bidi_Control}]/u.test(input.name)
  )
    return null;
  const name = validateDisplayFilename(input.name);
  if (!name.ok) return null;
  const displayName = name.value.trim();
  return displayName.length > 0 ? { name: displayName, mime: acceptedMime, sizeBytes } : null;
}

export function hasAssetMediaSignature(bytes: Uint8Array, mime: AssetMediaMime) {
  const signature = signatures[mime];
  return bytes.length > signature.length && signature.every((byte, index) => bytes[index] === byte);
}
