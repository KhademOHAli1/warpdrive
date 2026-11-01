import { z } from "zod";

export function plainTextSchema(limit: number, multiline: boolean) {
  return z
    .string()
    .min(1)
    .max(limit)
    .refine((value) => value.replace(/\p{Cf}/gu, "").trim().length > 0)
    .refine((value) => {
      const checked = multiline
        ? value.replaceAll("\t", "").replaceAll("\r", "").replaceAll("\n", "")
        : value;
      return !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(checked);
    });
}

export const communicationChannelSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["email", "phone", "whatsapp", "meeting"]) }),
  z.strictObject({ kind: z.literal("other"), label: plainTextSchema(80, false) }),
]);
