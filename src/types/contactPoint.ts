import type { PhoneCountry } from "@/utils/phoneNormalization";

export type PhonePointMetadata = {
  country?: PhoneCountry;
  e164?: string;
  normalization?: "valid" | "review";
};
export type ContactPoint = { label: string; value: string; primary: boolean } & PhonePointMetadata;
