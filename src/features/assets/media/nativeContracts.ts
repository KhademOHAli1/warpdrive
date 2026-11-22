import { z } from "zod";
import { assetMediaDocumentType, assetMediaPhotoTypes } from "./contracts";

export const assetMediaId = z.uuid().toLowerCase();
export const assetMediaVersion = z.number().int().min(0).max(2_147_483_646);
export const assetMediaTargetInput = z.strictObject({
  type: z.enum(["asset", "model"]),
  id: assetMediaId,
});
export const assetMediaKindInput = z.enum(["photo", "document"]);
export const assetMediaMimeInput = z.enum([...assetMediaPhotoTypes, assetMediaDocumentType]);
export const assetMediaCoverInput = z.strictObject({
  target: assetMediaTargetInput,
  version: assetMediaVersion,
  requestId: assetMediaId,
  fileId: assetMediaId.nullable(),
});
