import type { CompanyBrandingInput, LegalEntityData } from "./contracts";

export function identityReadiness(data: LegalEntityData) {
  const missing = [
    "line1",
    "city",
    ...(["AE", "HK", "IE", "MO"].includes(data.country) ? [] : ["postalCode"]),
  ]
    .filter((field) => !data.registeredAddress[field as keyof typeof data.registeredAddress])
    .map((field) => `registeredAddress.${field}`);
  if (data.registeredAddress.country && data.registeredAddress.country !== data.country)
    missing.push("registeredAddress.country_mismatch");
  return {
    status: missing.length ? ("incomplete" as const) : ("ready" as const),
    missing,
    scope: "identity_record_only" as const,
  };
}
export function readableForeground(color: string | null): "#000000" | "#ffffff" {
  const rgb = (color ?? "#ffffff")
    .slice(1)
    .match(/.{2}/g)
    ?.map((c) => Number.parseInt(c, 16) / 255) ?? [1, 1, 1];
  const linear = rgb.map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  const luminance =
    (linear[0] ?? 1) * 0.2126 + (linear[1] ?? 1) * 0.7152 + (linear[2] ?? 1) * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}
export const assetUrl = (id: string | null) =>
  id === null ? null : `/api/company-profile/assets/${id}`;
export function brandProjection(input: CompanyBrandingInput) {
  return {
    ...input,
    iconUrl: assetUrl(input.iconAssetId),
    logoUrl: assetUrl(input.logoAssetId),
    foregroundColor: readableForeground(input.accentColor),
  };
}
