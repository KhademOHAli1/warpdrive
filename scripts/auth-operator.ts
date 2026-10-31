import { parseAuthOperatorArgs } from "../src/features/auth/management/operatorCommand";

const invocation =
  process.argv[1]?.endsWith(".mjs") === true
    ? "bun dist/auth-operator.mjs"
    : "bun run auth:operator";
const usage = `Usage:
  ${invocation} bootstrap --email owner@example.com --name "Owner" --locale fa --confirm
  ${invocation} resend-bootstrap --email owner@example.com --confirm
  ${invocation} recover --request-id <approved-case-uuid> --confirm
  ${invocation} recover --request-id <pending-sole-admin-case-uuid> --confirm --emergency-last-admin --confirm-ownership
This host-only tool never prints bearer links, passwords, tokens or recovery codes.`;

async function main(): Promise<number> {
  const command = parseAuthOperatorArgs(process.argv.slice(2));
  if (!command.ok) {
    console.error(usage);
    return 2;
  }
  const [
    { db, pool },
    { bootstrapFirstAdministrator, recoverAccountAsOperator, renewFirstAdministratorInvitation },
  ] = await Promise.all([
    import("../src/db/client"),
    import("../src/features/auth/management/bootstrapOperator"),
  ]);
  try {
    const signal = AbortSignal.timeout(30_000);
    let result: { ok: boolean };
    let successMessage: string;
    switch (command.value.command) {
      case "bootstrap":
        result = await bootstrapFirstAdministrator(db, command.value, signal);
        successMessage = "Bootstrap invitation queued for the configured administrator.";
        break;
      case "resend-bootstrap":
        result = await renewFirstAdministratorInvitation(db, command.value, signal);
        successMessage = "Replacement invitation queued for the original administrator.";
        break;
      case "recover":
        result = await recoverAccountAsOperator(db, command.value, signal);
        successMessage =
          "Approved recovery completed and a password-reset message was queued for the verified owner.";
        break;
    }
    if (!result.ok) {
      console.error(
        "Operation refused. Review the configured workspace and the approved case; no credentials were issued by this command.",
      );
      return 1;
    }
    console.warn(successMessage);
    return 0;
  } finally {
    await pool.end();
  }
}

try {
  process.exitCode = await main();
} catch {
  console.error(
    "Operation failed. Check host configuration and service health; no secrets are printed.",
  );
  process.exitCode = 1;
}
