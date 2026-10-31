import { Temporal } from "@js-temporal/polyfill";
import { z } from "zod";
import { err, ok, type Result } from "@/types/result";

export const deadlinePolicySchema = z.object({
  id: z.string().trim().min(1).max(100),
  version: z.number().int().positive(),
  activated: z.literal(true),
  jurisdiction: z.string().trim().min(1).max(200),
  timeZone: z.string().min(1),
  calendar: z.literal("gregory"),
  responseMonths: z.number().int().min(1).max(12),
  maxExtensionMonths: z.number().int().min(0).max(12),
  disambiguation: z.enum(["earlier", "later", "reject"]).default("reject"),
});
export const extensionSchema = z.object({
  additionalMonths: z.number().int().min(1).max(12),
  reason: z.string().trim().min(1).max(2000),
  noticeReference: z.string().trim().min(1).max(200),
  noticeRecordedAt: z.string(),
});

type DeadlinePolicy = Readonly<z.infer<typeof deadlinePolicySchema>>;
type Extension = Readonly<z.infer<typeof extensionSchema>>;
export interface PrivacyDeadline {
  readonly receivedAt: string;
  readonly originalDueAt: string;
  readonly dueAt: string;
  readonly policy: DeadlinePolicy;
  readonly extensionMonths: number;
  readonly extensions: readonly Extension[];
}
export type DeadlineFailure =
  | "policy_unconfigured"
  | "policy_invalid"
  | "receipt_invalid"
  | "deadline_unresolvable"
  | "extension_invalid"
  | "notice_invalid"
  | "notice_late"
  | "notice_conflict";

function canonical(instant: Temporal.Instant): string {
  return instant.toString({ fractionalSecondDigits: 9 }).replace(/0{1,6}Z$/, "Z");
}

function dueInstant(receivedAt: string, months: number, policy: DeadlinePolicy): string {
  const receipt = Temporal.Instant.from(receivedAt).toZonedDateTimeISO(policy.timeZone);
  // Add to the original civil date, then explicitly resolve the target wall time.
  const local = receipt.toPlainDateTime().add({ months }, { overflow: "constrain" });
  return canonical(
    local.toZonedDateTime(policy.timeZone, { disambiguation: policy.disambiguation }).toInstant(),
  );
}

export function createPrivacyDeadline(
  receivedAt: string,
  policyInput: unknown,
): Result<PrivacyDeadline, DeadlineFailure> {
  if (policyInput === null || policyInput === undefined) return err("policy_unconfigured");
  const parsed = deadlinePolicySchema.safeParse(policyInput);
  if (!parsed.success) return err("policy_invalid");
  let receipt: string;
  try {
    receipt = canonical(Temporal.Instant.from(receivedAt));
  } catch {
    return err("receipt_invalid");
  }
  try {
    const dueAt = dueInstant(receipt, parsed.data.responseMonths, parsed.data);
    return ok({
      receivedAt: receipt,
      originalDueAt: dueAt,
      dueAt,
      policy: parsed.data,
      extensionMonths: 0,
      extensions: [],
    });
  } catch {
    return err("deadline_unresolvable");
  }
}

function sameNotice(left: Extension, right: Extension): boolean {
  return (
    left.additionalMonths === right.additionalMonths &&
    left.reason === right.reason &&
    left.noticeReference === right.noticeReference &&
    left.noticeRecordedAt === right.noticeRecordedAt
  );
}

export function extendPrivacyDeadline(
  deadline: PrivacyDeadline,
  input: unknown,
): Result<PrivacyDeadline, DeadlineFailure> {
  const parsed = extensionSchema.safeParse(input);
  if (!parsed.success) return err("extension_invalid");
  let extension: Extension;
  try {
    const notice = Temporal.Instant.from(parsed.data.noticeRecordedAt);
    if (Temporal.Instant.compare(notice, deadline.receivedAt) < 0) return err("notice_invalid");
    if (Temporal.Instant.compare(notice, deadline.originalDueAt) > 0) return err("notice_late");
    extension = { ...parsed.data, noticeRecordedAt: canonical(notice) };
  } catch {
    return err("notice_invalid");
  }
  const existing = deadline.extensions.find(
    (entry) => entry.noticeReference === extension.noticeReference,
  );
  if (existing !== undefined)
    return sameNotice(existing, extension) ? ok(deadline) : err("notice_conflict");
  const extensionMonths = deadline.extensionMonths + extension.additionalMonths;
  if (extensionMonths > deadline.policy.maxExtensionMonths) return err("extension_invalid");
  try {
    return ok({
      ...deadline,
      dueAt: dueInstant(
        deadline.receivedAt,
        deadline.policy.responseMonths + extensionMonths,
        deadline.policy,
      ),
      extensionMonths,
      extensions: [...deadline.extensions, extension],
    });
  } catch {
    return err("deadline_unresolvable");
  }
}
