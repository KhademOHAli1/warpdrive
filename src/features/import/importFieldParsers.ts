import { z } from "zod";
import { parseImportDate } from "./parseImportDate";

const MAX_LOST_REASON_LEN = 255;
const DONE_VALUES = ["1", "true", "yes", "done"];
const NOT_DONE_VALUES = ["0", "false", "no", ""];
const DEAL_STATUSES = ["open", "won", "lost"] as const;

export const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

export const importDate = z.string().transform((v, ctx) => {
  const iso = parseImportDate(v);
  if (iso === null) {
    ctx.addIssue({ code: "custom", message: "must be a valid date" });
    return z.NEVER;
  }
  return iso;
});

export const optionalImportDate = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return undefined;
    const iso = parseImportDate(v);
    if (iso === null) {
      ctx.addIssue({ code: "custom", message: "must be a valid date" });
      return z.NEVER;
    }
    return iso;
  })
  .optional();

export const dealStatus = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => (v === "" ? undefined : v))
  .pipe(z.enum(DEAL_STATUSES).optional())
  .optional();

export const lostReason = z
  .string()
  .trim()
  .max(MAX_LOST_REASON_LEN)
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const uniqueLabels = (labels: string[]): string[] => [
  ...new Set(labels.map((label) => label.trim()).filter((label) => label !== "")),
];

export const labelList = z
  .union([
    z.array(z.string()).transform(uniqueLabels),
    z.string().transform((v) => uniqueLabels(v.split(","))),
  ])
  .optional();

const doneText = z.string().transform((v, ctx) => {
  const normalized = v.trim().toLowerCase();
  if (DONE_VALUES.includes(normalized)) return true;
  if (NOT_DONE_VALUES.includes(normalized)) return false;
  ctx.addIssue({ code: "custom", message: "must be yes, no, true, false, 1, 0 or done" });
  return z.NEVER;
});

export const doneFlag = z.union([z.boolean(), doneText]).optional();

export const pipedriveLinkShape = {
  dealPipedriveId: optionalText,
  personPipedriveId: optionalText,
  orgPipedriveId: optionalText,
  dealTitle: optionalText,
  personName: optionalText,
  orgName: optionalText,
};
