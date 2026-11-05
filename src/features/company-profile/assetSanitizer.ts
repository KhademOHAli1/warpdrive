import sharp from "sharp";
import { err, ok, type Result } from "@/types/result";
import { type CompanyCrop, cropSchema } from "./contracts";

export const MAX_COMPANY_ASSET_BYTES = 2 * 1024 * 1024;
export const MAX_COMPANY_ASSET_PIXELS = 16_000_000;
export interface SanitizedCompanyAsset {
  bytes: Buffer;
  width: number;
  height: number;
}
function rasterSignature(bytes: Buffer) {
  return (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
    (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP")
  );
}
function animatedPng(bytes: Buffer) {
  for (let offset = 8; offset + 12 <= bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    if (
      bytes.subarray(offset + 4, offset + 8).toString() === "acTL" ||
      length > bytes.length - offset - 12
    )
      return true;
    offset += length + 12;
  }
  return false;
}
function animatedWebp(bytes: Buffer) {
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const kind = bytes.subarray(offset, offset + 4).toString();
    const length = bytes.readUInt32LE(offset + 4);
    if (
      kind === "ANIM" ||
      kind === "ANMF" ||
      (kind === "VP8X" && ((bytes[offset + 8] ?? 0) & 2) !== 0)
    )
      return true;
    if (length > bytes.length - offset - 8) return true;
    offset += length + 8 + (length % 2);
  }
  return false;
}
function animatedContainer(bytes: Buffer) {
  return bytes[0] === 137
    ? animatedPng(bytes)
    : bytes.subarray(0, 4).toString() === "RIFF" && animatedWebp(bytes);
}
export async function sanitizeCompanyAsset(
  bytes: Buffer,
  slot: "icon" | "logo",
  crop: CompanyCrop | undefined,
  signal: AbortSignal,
): Promise<Result<SanitizedCompanyAsset, "asset_invalid">> {
  signal.throwIfAborted();
  if (
    bytes.length === 0 ||
    bytes.length > MAX_COMPANY_ASSET_BYTES ||
    !rasterSignature(bytes) ||
    animatedContainer(bytes) ||
    (crop !== undefined && !cropSchema.safeParse(crop).success)
  )
    return err("asset_invalid");
  try {
    const image = sharp(bytes, {
      limitInputPixels: MAX_COMPANY_ASSET_PIXELS,
      failOn: "warning",
      animated: false,
    }).timeout({ seconds: 5 });
    const metadata = await image.metadata();
    if (
      !["png", "jpeg", "webp"].includes(metadata.format) ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_COMPANY_ASSET_PIXELS
    )
      return err("asset_invalid");
    // Decode and orient first; crop coordinates are applied to exactly the displayed pixels.
    const oriented = await image.rotate().raw().toBuffer({ resolveWithObject: true });
    signal.throwIfAborted();
    let sanitized = sharp(oriented.data, {
      raw: {
        width: oriented.info.width,
        height: oriented.info.height,
        channels: oriented.info.channels,
      },
    });
    if (crop) {
      const left = Math.floor(crop.left * oriented.info.width),
        top = Math.floor(crop.top * oriented.info.height);
      const width = Math.max(1, Math.floor(crop.width * oriented.info.width)),
        height = Math.max(1, Math.floor(crop.height * oriented.info.height));
      if (left + width > oriented.info.width || top + height > oriented.info.height)
        return err("asset_invalid");
      sanitized = sanitized.extract({ left, top, width, height });
    }
    const result = await sanitized
      .resize({
        width: slot === "icon" ? 512 : 2048,
        height: slot === "icon" ? 512 : 1024,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png({ compressionLevel: 9 })
      .timeout({ seconds: 5 })
      .toBuffer({ resolveWithObject: true });
    signal.throwIfAborted();
    if (result.data.length > MAX_COMPANY_ASSET_BYTES) return err("asset_invalid");
    return ok({ bytes: result.data, width: result.info.width, height: result.info.height });
  } catch (cause) {
    signal.throwIfAborted();
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    return err("asset_invalid");
  }
}
