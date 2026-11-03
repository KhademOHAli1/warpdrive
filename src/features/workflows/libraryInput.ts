import { z } from "zod";

export const MAX_LIBRARY_CURSOR_LENGTH = 4096;
const query = z
  .string()
  .trim()
  .max(200)
  .refine((value) => !value.includes("\0"))
  .default("");
const archive = z.enum(["current", "archived"]).default("current");
const limit = z.number().int().min(1).max(100).default(25);
const cursor = z
  .string()
  .max(MAX_LIBRARY_CURSOR_LENGTH)
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const libraryOptions = z
  .strictObject({
    query,
    archive,
    status: z.enum(["all", "draft", "active", "paused"]).default("all"),
    ownerId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase())
      .optional(),
    health: z.enum(["all", "latest-live-failed"]).default("all"),
    sort: z.enum(["updated-desc", "name-asc", "name-desc"]).default("updated-desc"),
    limit,
    cursor,
  })
  .refine((input) => input.archive !== "archived" || input.status === "all");

const ownersOptions = z.strictObject({ query, archive, limit, cursor });

export const workflowLibraryInputSchema = libraryOptions.default({
  query: "",
  archive: "current",
  status: "all",
  health: "all",
  sort: "updated-desc",
  limit: 25,
  cursor: undefined,
});
export const workflowOwnersInputSchema = ownersOptions.default({
  query: "",
  archive: "current",
  limit: 25,
  cursor: undefined,
});
export type WorkflowLibraryInput = z.input<typeof libraryOptions>;
export type WorkflowOwnersInput = z.input<typeof ownersOptions>;
export type NormalizedWorkflowLibraryInput = z.output<typeof libraryOptions>;
export type NormalizedWorkflowOwnersInput = z.output<typeof ownersOptions>;

// ILIKE is parameterized by the caller. Escape the pattern metacharacters so the
// query remains a literal substring, including percent, underscore and backslash.
export function librarySubstringPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}
