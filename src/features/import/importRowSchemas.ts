// CSV-boundary schemas for the deal/lead/activity import targets (STANDARD_IMPORT_FIELDS'
// shape for each). These validate only the STATIC shape (required fields, numeric/date
// coercion); referential fields (a deal's pipeline/stage NAMES, an activity's typeKey) stay
// as raw strings here and are resolved to real ids later, at commit time (commitDeal.ts /
// commitActivity.ts), since that resolution needs a DB lookup and the referenced row could
// change between validate and commit.
import { z } from "zod";
import { SOURCE_CHANNEL_KEYS } from "@/constants/sourceChannels";
import {
  MAX_DOMAIN_LEN,
  MAX_INDUSTRY_LEN,
  MAX_LINKEDIN_URL_LEN,
  personCreateInput,
} from "@/features/contacts/schemas";
import { currencyCode, moneyAmount } from "@/features/currencies/currencySchema";
import { moneyInputValue } from "@/lib/canonicalMoney";
import {
  archivedFlag,
  dealStatus,
  doneFlag,
  importDate,
  labelList,
  lostReason,
  optionalImportDate,
  optionalText,
  pipedriveLinkShape,
} from "./importFieldParsers";

// CSV cells arrive as strings; z.coerce.number() converts (or fails on non-numeric input,
// which is reported as a row error rather than silently coerced to null).
const currencyValue = moneyAmount.transform(moneyInputValue).nullable().default(null);

const MISSING_NAME_MESSAGE = "name is required without a Pipedrive ID";

function requireNameOrPipedriveId(
  value: { name?: string | undefined; pipedriveId?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.name === undefined && value.pipedriveId === undefined) {
    ctx.addIssue({ code: "custom", path: ["name"], message: MISSING_NAME_MESSAGE });
  }
}

export const orgImportBaseSchema = z.object({
  name: z.string().trim().min(1).max(255),
  pipedriveId: optionalText,
  owner: optionalText,
  domain: z.string().trim().max(MAX_DOMAIN_LEN).optional(),
  industry: z.string().trim().max(MAX_INDUSTRY_LEN).optional(),
  linkedinUrl: z.string().trim().max(MAX_LINKEDIN_URL_LEN).optional(),
  employeeCount: z.coerce.number().int().nonnegative().optional(),
  // numeric(14,2) in Postgres; kept a string so a malformed cell fails Zod, not the DB cast.
  annualRevenue: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  address: z
    .object({
      street: z.string().trim().optional(),
      city: z.string().trim().optional(),
      region: z.string().trim().optional(),
      postal: z.string().trim().optional(),
      country: z.string().trim().optional(),
    })
    .optional(),
});

export const orgImportGroupSchema = orgImportBaseSchema
  .partial({ name: true })
  .superRefine(requireNameOrPipedriveId);

// The person block of a deal row: the contact the deal belongs to, resolved by name or email.
//
// Reuses personCreateInput's own contact-point schemas rather than a loose shape of its own:
// resolvePersonLink creates the person through personCreateInput at commit, so anything this
// accepts and that rejects would show as a valid row in preview and then fail on Import.
export const personImportBaseSchema = personCreateInput
  .pick({
    name: true,
    firstName: true,
    lastName: true,
    emails: true,
    phones: true,
  })
  .extend({ pipedriveId: optionalText, owner: optionalText });

export const personImportGroupSchema = personImportBaseSchema
  .partial({ name: true })
  .superRefine(requireNameOrPipedriveId);

// The 50k cap mirrors noteCreateInput. createNote does not re-parse its input, so a row whose note
// body (a huge mapped cell, or a wide rowNoteFromUnmapped dump) exceeds it would otherwise insert
// an over-length note at commit instead of failing in preview.
export const noteImportGroupSchema = z.object({ body: z.string().trim().min(1).max(50_000) });

export const dealImportRowSchema = z.object({
  title: z.string().min(1).max(255),
  value: currencyValue,
  currency: currencyCode.optional(),
  expectedCloseDate: z.string().date().nullable().default(null),
  pipeline: z.string().trim().min(1).nullable().default(null),
  stage: z.string().trim().min(1).nullable().default(null),
  pipedriveId: optionalText,
  owner: optionalText,
  status: dealStatus,
  wonTime: optionalImportDate,
  lostTime: optionalImportDate,
  createdAt: optionalImportDate,
  lostReason,
  labels: labelList,
  customFields: z.record(z.string(), z.unknown()).default({}),
});

export const leadImportRowSchema = z.object({
  title: z.string().min(1).max(255),
  value: currencyValue,
  currency: currencyCode.optional(),
  expectedCloseDate: z.string().date().nullable().default(null),
  sourceChannel: z
    .enum(SOURCE_CHANNEL_KEYS as [string, ...string[]])
    .nullable()
    .default(null),
  sourceChannelId: z.string().trim().min(1).max(255).nullable().default(null),
  pipedriveId: optionalText,
  owner: optionalText,
  labels: labelList,
  createdAt: optionalImportDate,
  archived: archivedFlag,
  customFields: z.record(z.string(), z.unknown()).default({}),
});

const dueAtField = importDate.nullable().default(null);

export const activityImportRowSchema = z.object({
  subject: z.string().min(1).max(255),
  typeKey: z.string().trim().min(1).nullable().default(null),
  dueAt: dueAtField,
  allDay: z.boolean().optional(),
  dueDate: z.string().date().nullable().optional(),
  durationMinutes: z.coerce.number().int().positive().nullable().default(null),
  pipedriveId: optionalText,
  assignee: optionalText,
  done: doneFlag,
  doneAt: optionalImportDate,
  ...pipedriveLinkShape,
  customFields: z.record(z.string(), z.unknown()).default({}),
});

export const noteImportRowSchema = z.object({
  body: z.string().trim().min(1).max(50_000),
  createdAt: optionalImportDate,
  pipedriveId: optionalText,
  ...pipedriveLinkShape,
});
