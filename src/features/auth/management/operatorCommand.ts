import { parseArgs } from "node:util";
import { z } from "zod";
import { err, ok, type Result } from "@/types/result";

const bootstrap = z.object({
  command: z.literal("bootstrap"),
  email: z
    .string()
    .trim()
    .email()
    .transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(200),
  locale: z.enum(["fa", "de", "en"]).default("fa"),
  operatorConfirmed: z.literal(true),
});
const recovery = z.object({
  command: z.literal("recover"),
  requestId: z.uuid(),
  operatorConfirmed: z.literal(true),
  emergencyLastAdministrator: z.boolean(),
  ownershipConfirmed: z.boolean(),
});
const renewal = bootstrap
  .pick({ email: true, operatorConfirmed: true })
  .extend({ command: z.literal("resend-bootstrap") });
export type AuthOperatorCommand =
  | z.infer<typeof bootstrap>
  | z.infer<typeof recovery>
  | z.infer<typeof renewal>;

export function parseAuthOperatorArgs(
  args: string[],
): Result<AuthOperatorCommand, "invalid_arguments"> {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      tokens: true,
      options: {
        email: { type: "string" },
        name: { type: "string" },
        locale: { type: "string" },
        "request-id": { type: "string" },
        confirm: { type: "boolean", default: false },
        "emergency-last-admin": { type: "boolean", default: false },
        "confirm-ownership": { type: "boolean", default: false },
      },
    });
    const names = parsed.tokens
      .filter((token) => token.kind === "option")
      .map((token) => token.name);
    if (new Set(names).size !== names.length || parsed.positionals.length !== 1)
      return err("invalid_arguments");
    const values = parsed.values;
    if (parsed.positionals[0] === "resend-bootstrap") {
      if (
        values.name !== undefined ||
        values.locale !== undefined ||
        values["request-id"] !== undefined ||
        values["emergency-last-admin"] ||
        values["confirm-ownership"]
      )
        return err("invalid_arguments");
      const command = renewal.safeParse({
        command: "resend-bootstrap",
        email: values.email,
        operatorConfirmed: values.confirm,
      });
      return command.success ? ok(command.data) : err("invalid_arguments");
    }
    if (parsed.positionals[0] === "bootstrap") {
      if (
        values["request-id"] !== undefined ||
        values["emergency-last-admin"] ||
        values["confirm-ownership"]
      )
        return err("invalid_arguments");
      const command = bootstrap.safeParse({
        command: "bootstrap",
        email: values.email,
        name: values.name,
        locale: values.locale,
        operatorConfirmed: values.confirm,
      });
      return command.success ? ok(command.data) : err("invalid_arguments");
    }
    if (
      parsed.positionals[0] !== "recover" ||
      values.email !== undefined ||
      values.name !== undefined ||
      values.locale !== undefined
    )
      return err("invalid_arguments");
    if (values["emergency-last-admin"] !== values["confirm-ownership"])
      return err("invalid_arguments");
    const command = recovery.safeParse({
      command: "recover",
      requestId: values["request-id"],
      operatorConfirmed: values.confirm,
      emergencyLastAdministrator: values["emergency-last-admin"],
      ownershipConfirmed: values["confirm-ownership"],
    });
    return command.success ? ok(command.data) : err("invalid_arguments");
  } catch {
    return err("invalid_arguments");
  }
}
