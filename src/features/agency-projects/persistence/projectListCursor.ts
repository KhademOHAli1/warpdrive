// No Date conversion: the key is copied from the database's explicit UTC microsecond projection.
import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { err, ok, type Result } from "@/types/result";
import { canonicalUuidSchema } from "../valueSchemas";

const timestampSchema = z
  .string()
  .length(27)
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/u)
  .refine((value) => {
    if (value.startsWith("0000-")) return false;
    try {
      return Temporal.Instant.from(value).toString({ fractionalSecondDigits: 6 }) === value;
    } catch {
      return false;
    }
  });

export const projectListCursorSchema = z.strictObject({
  schemaVersion: z.literal(1),
  createdAt: timestampSchema,
  id: canonicalUuidSchema,
  filterKey: z.string().min(1).max(768),
});
export type ProjectListCursor = z.infer<typeof projectListCursorSchema>;

export function decodeProjectListCursor(
  encoded: string,
  expectedFilterKey: string,
): Result<ProjectListCursor, "invalid_project_list_input"> {
  if (encoded.length > 2_048 || !/^[A-Za-z0-9_-]+$/u.test(encoded))
    return err("invalid_project_list_input");
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.length > 1_024 || bytes.toString("base64url") !== encoded)
    return err("invalid_project_list_input");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return err("invalid_project_list_input");
  }
  const parsed = projectListCursorSchema.safeParse(value);
  return parsed.success && parsed.data.filterKey === expectedFilterKey
    ? ok(parsed.data)
    : err("invalid_project_list_input");
}

// Trusted database-derived cursor only. Validate raw query rows at their DB ingress before this.
export function encodeProjectListCursor(cursor: ProjectListCursor): string {
  return Buffer.from(
    JSON.stringify({
      schemaVersion: cursor.schemaVersion,
      createdAt: cursor.createdAt,
      id: cursor.id,
      filterKey: cursor.filterKey,
    }),
    "utf8",
  ).toString("base64url");
}
