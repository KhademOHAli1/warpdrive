import type { z } from "zod";
import { DEFAULT_IMPORT_SOURCE, type ImportSource } from "@/constants/importSources";
import { personCreateInput } from "@/features/contacts/schemas";
import { buildCustomFieldsSchema } from "@/features/custom-fields/validate";
import type { CustomFieldDef } from "@/types/customFields";
import type { MappedRow } from "@/types/import";
import { assertNever } from "@/types/result";
import type { ImportDateOptions } from "./importDateConventions";
import { optionalText } from "./importFieldParsers";
import { PIPEDRIVE_ID_FIELD, requiredFieldsFor } from "./importFields";
import {
  activityImportRowSchema,
  dealImportRowSchema,
  leadImportRowSchema,
  noteImportGroupSchema,
  noteImportRowSchema,
  orgImportBaseSchema,
  orgImportGroupSchema,
  personImportGroupSchema,
} from "./importRowSchemas";
import { normalizeImportDates } from "./normalizeImportDates";
import type { ImportTarget } from "./wizardState";

interface RowIssue {
  field: string;
  message: string;
}

type ValidateResult = { ok: true; value: MappedRow } | { ok: false; errors: RowIssue[] };

const PIPEDRIVE_ID_REQUIRED_MESSAGE = "Pipedrive ID is required";
const DUE_TIME_NEEDS_DATE_MESSAGE = "a due time needs a due date";

function issuesOf(error: z.ZodError, prefix = ""): RowIssue[] {
  return error.issues.map((i) => ({
    field: `${prefix}${i.path.join(".")}`,
    message: i.message,
  }));
}

function primarySchema(target: ImportTarget, cfSchema: z.ZodTypeAny): z.ZodTypeAny {
  switch (target) {
    case "person":
      return personCreateInput.extend({
        customFields: cfSchema,
        pipedriveId: optionalText,
        owner: optionalText,
      });
    case "organization":
      return orgImportBaseSchema.extend({ customFields: cfSchema });
    case "deal":
      return dealImportRowSchema.extend({ customFields: cfSchema });
    case "lead":
      return leadImportRowSchema.extend({ customFields: cfSchema });
    case "activity":
      return activityImportRowSchema.extend({ customFields: cfSchema });
    case "note":
      return noteImportRowSchema;
    default:
      return assertNever(target);
  }
}

function sourceIssues(
  target: ImportTarget,
  source: ImportSource,
  primary: Record<string, unknown>,
): RowIssue[] {
  const issues: RowIssue[] = [];
  const needsId = requiredFieldsFor(target, source).some((f) => f.field === PIPEDRIVE_ID_FIELD);
  if (needsId && primary[PIPEDRIVE_ID_FIELD] === undefined) {
    issues.push({ field: PIPEDRIVE_ID_FIELD, message: PIPEDRIVE_ID_REQUIRED_MESSAGE });
  }
  return issues;
}

function strayDueTimeIssues(target: ImportTarget, raw: Record<string, unknown>): RowIssue[] {
  if (target === "activity" && raw.dueTime !== undefined && raw.dueAt === undefined) {
    return [{ field: "dueTime", message: DUE_TIME_NEEDS_DATE_MESSAGE }];
  }
  return [];
}

function validateCanonicalMappedRow(
  target: ImportTarget,
  mapped: MappedRow,
  defs: CustomFieldDef[],
  source: ImportSource = DEFAULT_IMPORT_SOURCE,
): ValidateResult {
  const cfSchema = buildCustomFieldsSchema(defs);
  const errors: RowIssue[] = [];
  const out: MappedRow = { primary: {} };

  const primary = primarySchema(target, cfSchema).safeParse(mapped.primary);
  if (primary.success) {
    out.primary = primary.data as Record<string, unknown>;
    errors.push(...sourceIssues(target, source, out.primary));
  } else {
    errors.push(...issuesOf(primary.error));
  }
  errors.push(...strayDueTimeIssues(target, mapped.primary));

  if (mapped.organization !== undefined) {
    const org = orgImportGroupSchema.safeParse(mapped.organization);
    if (org.success) out.organization = org.data;
    else errors.push(...issuesOf(org.error, "organization."));
  }
  if (mapped.person !== undefined) {
    const person = personImportGroupSchema.safeParse(mapped.person);
    if (person.success) out.person = person.data;
    else errors.push(...issuesOf(person.error, "person."));
  }
  if (mapped.note !== undefined) {
    const note = noteImportGroupSchema.safeParse(mapped.note);
    if (note.success) out.note = note.data;
    else errors.push(...issuesOf(note.error, "note."));
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: out };
}

export function validateMappedRow(
  target: ImportTarget,
  mapped: MappedRow,
  defs: CustomFieldDef[],
  source: ImportSource = DEFAULT_IMPORT_SOURCE,
  options: ImportDateOptions = {},
): ValidateResult {
  const dates = normalizeImportDates(target, mapped, defs, options);
  return dates.ok
    ? validateCanonicalMappedRow(target, dates.value, defs, source)
    : { ok: false, errors: dates.error };
}
