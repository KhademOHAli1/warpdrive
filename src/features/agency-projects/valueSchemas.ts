import { z } from "zod";

export const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const canonicalUuidSchema = z.uuid().toLowerCase();

function isControl(code: number): boolean {
  return code < 32 || (code >= 127 && code <= 159);
}

export const reasonSchema = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => value.length === 0 || value.replace(/\p{Cf}/gu, "").trim().length > 0)
  .refine((value) =>
    Array.from(value).every((character) => {
      const code = character.charCodeAt(0);
      return !isControl(code) || code === 9 || code === 10 || code === 13;
    }),
  );

function isSafeReference(value: string): boolean {
  if (value !== value.trim() || value.includes("<") || value.includes(">")) return false;
  if (/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) return false;
  if (value.startsWith("//") || value.startsWith("\\")) return false;
  if (!/^[a-z][a-z\d+.-]*:/iu.test(value)) return true;
  if (!/^https?:\/\//iu.test(value) || /\s/u.test(value)) return false;
  try {
    const url = new URL(value);
    return url.username.length === 0 && url.password.length === 0 && url.hostname.length > 0;
  } catch {
    return false;
  }
}

// Validate without canonicalizing an external version's identity or fetching it.
export const referenceSchema = z.string().min(1).max(2048).refine(isSafeReference);
