import { runAuthStagingCli } from "../src/features/privacy/qualification/authStagingCli";

const QUALIFICATION_TIMEOUT_MS = 30_000;
const result = await runAuthStagingCli(
  process.argv.slice(2),
  AbortSignal.timeout(QUALIFICATION_TIMEOUT_MS),
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? result.value.exitCode : result.error.exitCode;
