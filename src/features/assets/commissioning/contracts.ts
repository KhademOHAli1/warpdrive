import { z } from "zod";

const id = z.uuid().toLowerCase();

function text(maximum: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .refine((value) => !value.includes("\u0000"));
}

export const commissionAssetCommand = z.strictObject({
  requestId: id,
  positionId: id,
  siteId: id,
  locationId: id,
  serial: text(80),
  lot: text(80).nullable(),
  code: text(80),
  name: text(120),
  reason: text(400),
});

export type CommissionAssetCommand = z.infer<typeof commissionAssetCommand>;
export type CommissionAssetIntent = Omit<CommissionAssetCommand, "requestId">;
export type CommissionAssetError = "invalid" | "unavailable" | "ineligible" | "stale" | "conflict";
export type CommissionAssetResult =
  | { ok: true; assetId: string; handoffId: string }
  | { ok: false; error: CommissionAssetError };

export type CommissionStockSource = Pick<
  CommissionAssetIntent,
  "positionId" | "siteId" | "locationId" | "serial" | "lot"
> & {
  partCode: string;
  partName: string;
  revision: string;
  siteName: string;
  locationName: string;
};

export function validCommissionAssetIntent(intent: CommissionAssetIntent): boolean {
  return commissionAssetCommand.safeParse({
    ...intent,
    requestId: "00000000-0000-4000-8000-000000000000",
  }).success;
}
