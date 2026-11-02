import { z } from "zod";
import { err, ok, type Result } from "@/types/result";

const int32 = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const timeoutMs = z.number().int().min(1).max(60_000);
const specSchema = z.strictObject({
  key: z.tuple([int32, int32]),
  mode: z.enum(["shared", "exclusive"]),
  sqlTimeouts: z
    .strictObject({ lockMs: timeoutMs, statementMs: timeoutMs, idleMs: timeoutMs })
    .refine((value) => value.lockMs <= value.statementMs && value.statementMs <= value.idleMs),
});

export type AuthorityTransactionSpec = z.infer<typeof specSchema>;

// Native candidate configuration only; valid syntax does not reserve a production lock key.
export function parseAuthorityTransactionSpec(
  input: unknown,
): Result<AuthorityTransactionSpec, "invalid_authority_transaction_spec"> {
  const parsed = specSchema.safeParse(input);
  return parsed.success ? ok(parsed.data) : err("invalid_authority_transaction_spec");
}
