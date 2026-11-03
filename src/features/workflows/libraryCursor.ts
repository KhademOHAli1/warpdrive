import { createHash } from "node:crypto";
import { z } from "zod";
import { ERROR_IDS } from "@/constants/errorIds";
import { err, ok } from "@/types/result";
import { MAX_LIBRARY_CURSOR_LENGTH } from "./libraryInput";

const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
  .refine((value) => {
    const parsed = new Date(value);
    return (
      Number(value.slice(0, 4)) > 0 &&
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 23) === value.slice(0, 23)
    );
  });
const libraryKey = z.discriminatedUnion("sort", [
  z.strictObject({ sort: z.literal("updated-desc"), updatedAt: timestamp, id: uuid }),
  z.strictObject({
    sort: z.enum(["name-asc", "name-desc"]),
    name: z
      .string()
      .max(120)
      .refine((value) => !value.includes("\0")),
    id: uuid,
  }),
]);
const libraryCursor = z.strictObject({
  version: z.literal(1),
  kind: z.literal("workflows"),
  fingerprint,
  key: libraryKey,
});
const ownersCursor = z.strictObject({
  version: z.literal(1),
  kind: z.literal("owners"),
  fingerprint,
  ownerId: uuid,
});
export type WorkflowLibraryCursorKey = z.infer<typeof libraryKey>;
export type WorkflowLibraryCursor = z.infer<typeof libraryCursor>;
export type WorkflowOwnersCursor = z.infer<typeof ownersCursor>;

// This binds a cursor to normalized query/visibility context. It is not a signature
// or authority token; every continued request reapplies current permissions in SQL.
export function libraryCursorFingerprint(context: Record<string, string | number | null>): string {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}

function decode(raw: string): unknown {
  if (raw.length === 0 || raw.length > MAX_LIBRARY_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw))
    return null;
  try {
    const bytes = Buffer.from(raw, "base64url");
    if (bytes.toString("base64url") !== raw) return null;
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

export function readWorkflowLibraryCursor(raw: string, expectedFingerprint: string) {
  const parsed = libraryCursor.safeParse(decode(raw));
  return !parsed.success || parsed.data.fingerprint !== expectedFingerprint
    ? err(ERROR_IDS.WORKFLOW_INVALID)
    : ok(parsed.data);
}

export function writeWorkflowLibraryCursor(
  expectedFingerprint: string,
  key: WorkflowLibraryCursorKey,
): string {
  return Buffer.from(
    JSON.stringify({ version: 1, kind: "workflows", fingerprint: expectedFingerprint, key }),
  ).toString("base64url");
}

export function readWorkflowOwnersCursor(raw: string, expectedFingerprint: string) {
  const parsed = ownersCursor.safeParse(decode(raw));
  return !parsed.success || parsed.data.fingerprint !== expectedFingerprint
    ? err(ERROR_IDS.WORKFLOW_INVALID)
    : ok(parsed.data);
}

export function writeWorkflowOwnersCursor(expectedFingerprint: string, ownerId: string): string {
  return Buffer.from(
    JSON.stringify({ version: 1, kind: "owners", fingerprint: expectedFingerprint, ownerId }),
  ).toString("base64url");
}
