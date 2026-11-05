import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { err, ok } from "@/types/result";
import { MAX_RUN_HISTORY_CURSOR_LENGTH } from "./runHistoryPageInput";

const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine((value) => {
    const date = new Date(value);
    return (
      Number(value.slice(0, 4)) > 0 &&
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 23) === value.slice(0, 23)
    );
  });
const cursor = z.strictObject({
  version: z.literal(1),
  kind: z.literal("workflow-runs"),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  key: z.strictObject({
    createdAt: timestamp,
    id: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
  }),
});
export type RunHistoryCursor = z.infer<typeof cursor>;
export type RunHistoryCursorKey = RunHistoryCursor["key"];

// This is a consistency fingerprint, not a signature or authority token.
// Every continued page independently checks current actor/workflow access.
export function runHistoryCursorFingerprint(
  context: Record<string, string | number | null>,
): string {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}

function decode(raw: string): unknown {
  if (
    raw.length === 0 ||
    raw.length > MAX_RUN_HISTORY_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(raw)
  )
    return null;
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) return null;
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

export function readRunHistoryCursor(raw: string, expectedFingerprint: string) {
  const parsed = cursor.safeParse(decode(raw));
  return !parsed.success || parsed.data.fingerprint !== expectedFingerprint
    ? err(ERROR_IDS.WORKFLOW_INVALID)
    : ok(parsed.data);
}

export function writeRunHistoryCursor(
  expectedFingerprint: string,
  key: RunHistoryCursorKey,
): string {
  const parsed = cursor.safeParse({
    version: 1,
    kind: "workflow-runs",
    fingerprint: expectedFingerprint,
    key,
  });
  if (!parsed.success)
    throw new AppError(ERROR_IDS.DB_INVARIANT, "Invalid workflow run-history cursor key");
  // Validation must retain the original six-digit PostgreSQL timestamp text.
  // It must never be reconstructed from the display Date's millisecond precision.
  return Buffer.from(JSON.stringify(parsed.data)).toString("base64url");
}
