import { err, ok, type Result } from "@/types/result";

export type SmsTextError =
  | { code: "invalid_type" | "empty_text" }
  | { code: "invalid_utf16" | "unsupported_control"; utf16Index: number };

export type SmsEstimateUncertainty = "provider_billing_unqualified" | "non_bmp_unqualified";

export interface SmsSegmentEstimate {
  readonly originalText: string;
  readonly encoding: "gsm7" | "unicode";
  readonly unit: "septet" | "utf16_code_unit";
  readonly units: number;
  readonly segments: number;
  readonly segmentUnits: readonly number[];
  readonly singleSegmentCapacity: 160 | 70;
  readonly multipartSegmentCapacity: 153 | 67;
  readonly estimateOnly: true;
  readonly uncertainty: readonly SmsEstimateUncertainty[];
}

// ETSI TS 123 038, sections 6.2.1/6.2.1.1. Literal ESC is prohibited input;
// extension symbols below each need the protocol's ESC plus one septet.
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
);
const GSM_EXTENSION = new Set("^{}\\[~]|€");

function gsmWeight(character: string): number {
  if (GSM_BASIC.has(character)) return 1;
  return GSM_EXTENSION.has(character) ? 2 : 0;
}

function isUnsupportedControl(code: number): boolean {
  // CR/LF are supported SMS line breaks. Tab and form feed are intentionally
  // rejected until their provider behavior is qualified; ZWNJ/ZWJ are preserved.
  return (code < 32 && code !== 10 && code !== 13) || (code >= 127 && code <= 159);
}

function packMultipart(text: string, gsm7: boolean, capacity: number): number[] {
  const parts: number[] = [];
  let used = 0;
  for (const character of text) {
    // Iterating code points keeps a surrogate pair and each GSM escape pair
    // atomic. ceil(total/capacity) would undercount some multipart messages.
    const weight = gsm7 ? gsmWeight(character) : character.length;
    if (used + weight > capacity) {
      parts.push(used);
      used = 0;
    }
    used += weight;
  }
  if (used > 0) parts.push(used);
  return parts;
}

interface TextInspection {
  gsm7: boolean;
  gsmUnits: number;
  nonBmp: boolean;
}

function inspectText(text: string): Result<TextInspection, SmsTextError> {
  let gsm7 = true;
  let gsmUnits = 0;
  let utf16Index = 0;
  let nonBmp = false;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) {
      return err({ code: "invalid_utf16", utf16Index });
    }
    if (isUnsupportedControl(code)) return err({ code: "unsupported_control", utf16Index });
    const weight = gsmWeight(character);
    if (weight === 0) gsm7 = false;
    gsmUnits += weight;
    if (character.length === 2) nonBmp = true;
    utf16Index += character.length;
  }
  return ok({ gsm7, gsmUnits, nonBmp });
}

/** Pure estimate; no provider limits, delivery guarantee, billing or text rewriting. */
export function estimateSmsSegments(input: unknown): Result<SmsSegmentEstimate, SmsTextError> {
  if (typeof input !== "string") return err({ code: "invalid_type" });
  const inspection = inspectText(input);
  if (!inspection.ok) return inspection;
  if (input.trim().length === 0) return err({ code: "empty_text" });

  const { gsm7, gsmUnits, nonBmp } = inspection.value;
  const units = gsm7 ? gsmUnits : input.length;
  const singleSegmentCapacity = gsm7 ? 160 : 70;
  const multipartSegmentCapacity = gsm7 ? 153 : 67;
  const segmentUnits =
    units <= singleSegmentCapacity ? [units] : packMultipart(input, gsm7, multipartSegmentCapacity);
  const uncertainty: SmsEstimateUncertainty[] = ["provider_billing_unqualified"];
  if (nonBmp) uncertainty.push("non_bmp_unqualified");
  return ok({
    originalText: input,
    encoding: gsm7 ? "gsm7" : "unicode",
    unit: gsm7 ? "septet" : "utf16_code_unit",
    units,
    segments: segmentUnits.length,
    segmentUnits,
    singleSegmentCapacity,
    multipartSegmentCapacity,
    estimateOnly: true,
    uncertainty,
  });
}
