import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { CustomFieldTarget } from "@/constants/customFieldTypes";
import type { Db } from "@/db/client";
import { customFieldDefs } from "@/db/schema";
import type { CustomFieldDef } from "@/types/customFields";
import { toDef } from "./defsRepo";
import { buildCustomFieldsSchema } from "./validate";

const preparedBrand: unique symbol = Symbol("current-custom-field-validation");
export interface PreparedCustomFieldValidation {
  readonly [preparedBrand]: true;
  readonly defs: CustomFieldDef[];
  parseByKey(raw: unknown): z.ZodSafeParseResult<Record<string, unknown>>;
}

function allowedNestedKeys(def: CustomFieldDef): readonly string[] | undefined {
  if (def.type === "address")
    return ["street", "city", "region", "postal", "country", "lat", "lng"];
  if (def.type === "date_range" || def.type === "time_range") return ["start", "end"];
  return undefined;
}

function rejectNestedKeys(def: CustomFieldDef, value: unknown, ctx: z.RefinementCtx) {
  const allowed = allowedNestedKeys(def);
  if (allowed === undefined || value === null || typeof value !== "object" || Array.isArray(value))
    return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key))
      ctx.addIssue({
        code: "custom",
        path: [def.key, key],
        message: "Unknown custom value setting",
      });
  }
}

function strictSchema(defs: CustomFieldDef[]) {
  const byKey = new Map(defs.map((def) => [def.key, def]));
  return z
    .record(z.string(), z.unknown())
    .superRefine((values, ctx) => {
      for (const key of Object.keys(values)) {
        const def = byKey.get(key);
        if (def === undefined)
          ctx.addIssue({ code: "custom", path: [key], message: "Unknown custom field" });
        else rejectNestedKeys(def, values[key], ctx);
      }
    })
    .pipe(buildCustomFieldsSchema(defs));
}

// Server-only context: functions/private symbol are intentionally not a wire DTO.
// A caller may reuse it for a nested savepoint; it is never tied to Db object identity.
export async function prepareCurrentCustomFieldValidation(
  db: Db,
  target: CustomFieldTarget,
  signal: AbortSignal,
): Promise<PreparedCustomFieldValidation> {
  signal.throwIfAborted();
  const rows = await db
    .select()
    .from(customFieldDefs)
    .where(and(eq(customFieldDefs.targetEntity, target), isNull(customFieldDefs.archivedAt)))
    .orderBy(asc(customFieldDefs.order), asc(customFieldDefs.id));
  signal.throwIfAborted();
  const defs = rows.map(toDef);
  const schema = strictSchema(defs);
  return Object.freeze({
    [preparedBrand]: true as const,
    // Exposing a copy prevents a consumer mutating the parser's prepared identity/options.
    get defs() {
      return structuredClone(defs);
    },
    parseByKey(raw: unknown) {
      return schema.safeParse(raw);
    },
  });
}
