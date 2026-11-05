import { z } from "zod";
import { isValidMailRecipient } from "@/features/email/recipientAddress";
import type { MappingTarget } from "./mappingTypes";
import { bindingSchema } from "./schemas";

const MAX_RECIPIENTS_PER_FIELD = 20;
const MAX_RECIPIENT_TEXT = MAX_RECIPIENTS_PER_FIELD * 256;
const MAX_SUBJECT = 255;
const MAX_BODY = 20_000;
const mailAddress = z.email({ pattern: z.regexes.unicodeEmail }).refine(isValidMailRecipient);

function singleLine(value: string): boolean {
  return !value.includes("\0") && !/[\r\n]/u.test(value);
}

function recipients(required: boolean) {
  return z
    .string()
    .max(MAX_RECIPIENT_TEXT)
    .refine(singleLine)
    .transform((value) => (value.trim() === "" ? [] : value.split(",").map((part) => part.trim())))
    .pipe(
      z
        .array(mailAddress)
        .min(required ? 1 : 0)
        .max(MAX_RECIPIENTS_PER_FIELD),
    );
}

const compose = {
  to: recipients(true),
  cc: recipients(false),
  bcc: recipients(false),
  subject: z.string().max(MAX_SUBJECT).refine(singleLine),
  body: z
    .string()
    .max(MAX_BODY)
    .refine((value) => !value.includes("\0")),
};

export const workflowEmailDraftFields = [
  { key: "to", required: true, maxLength: MAX_RECIPIENT_TEXT },
  { key: "cc", required: false, maxLength: MAX_RECIPIENT_TEXT },
  { key: "bcc", required: false, maxLength: MAX_RECIPIENT_TEXT },
  { key: "subject", required: false, maxLength: MAX_SUBJECT },
  { key: "body", required: false, maxLength: MAX_BODY },
] as const;

export type WorkflowEmailDraftField = (typeof workflowEmailDraftFields)[number];

export const workflowEmailDraftConfig = z
  .strictObject({
    accountId: z.uuid(),
    to: bindingSchema,
    cc: bindingSchema.optional(),
    bcc: bindingSchema.optional(),
    subject: bindingSchema.optional(),
    body: bindingSchema.optional(),
  })
  .superRefine((config, context) => {
    for (const { key } of workflowEmailDraftFields) {
      const binding = config[key];
      if (
        binding?.kind === "value" &&
        (binding.literalType !== undefined || !compose[key].safeParse(binding.value).success)
      ) {
        context.addIssue({ code: "custom", path: [key], message: "invalid_value" });
      }
    }
  });

export type WorkflowEmailDraftConfig = z.infer<typeof workflowEmailDraftConfig>;

export const workflowEmailDraftCompose = z.strictObject({
  to: compose.to,
  cc: compose.cc.default([]),
  bcc: compose.bcc.default([]),
  subject: compose.subject.default(""),
  body: compose.body.default(""),
});

export function workflowEmailDraftFieldTarget(
  nodeId: string,
  key: string,
): MappingTarget | undefined {
  const field = workflowEmailDraftFields.find((entry) => entry.key === key);
  if (field === undefined) return undefined;
  return {
    nodeId,
    path: [field.key],
    contract: { kind: "text", nullable: false },
    required: field.required,
    mode: "binding",
  };
}
