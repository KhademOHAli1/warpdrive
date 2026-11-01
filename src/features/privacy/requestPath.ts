import { z } from "zod";

export const PRIVACY_CASE_PATH_HEADER = "x-warpdrive-privacy-case-path";
const CASE_PATH_PREFIX = "/settings/privacy/requests/";
const UUID_LENGTH = 36;
const caseIdSchema = z.uuid();

export function privacyCaseReturnPath(input: unknown): string | null {
  if (
    typeof input !== "string" ||
    input.length !== CASE_PATH_PREFIX.length + UUID_LENGTH ||
    !input.startsWith(CASE_PATH_PREFIX)
  )
    return null;
  return caseIdSchema.safeParse(input.slice(CASE_PATH_PREFIX.length)).success ? input : null;
}
