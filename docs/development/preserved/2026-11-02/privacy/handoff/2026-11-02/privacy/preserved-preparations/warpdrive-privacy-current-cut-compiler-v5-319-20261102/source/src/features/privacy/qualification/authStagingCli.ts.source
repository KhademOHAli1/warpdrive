import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { err, ok, type Result } from "@/types/result";
import { prepareAuthStagingRun } from "./authStaging";
import { probeAuthStagingHttps } from "./authStagingProbe";

const MAX_CONFIG_BYTES = 64 * 1024;
function parseArgs(
  args: readonly string[],
): Result<{ inputPath: string | undefined; probe: boolean }, "staging_cli_arguments"> {
  let inputPath: string | undefined;
  let probe = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--probe" && !probe) probe = true;
    else if (argument === "--input" && inputPath === undefined) {
      const path = args[++index];
      if (path === undefined || path.length === 0 || path.length > 4096 || path.startsWith("--"))
        return err("staging_cli_arguments");
      inputPath = path;
    } else return err("staging_cli_arguments");
  }
  return probe && inputPath === undefined ? err("staging_cli_arguments") : ok({ inputPath, probe });
}

async function readConfig(
  path: string,
  signal: AbortSignal,
): Promise<
  Result<
    unknown,
    "staging_config_read_failed" | "staging_config_too_large" | "staging_config_invalid_json"
  >
> {
  signal.throwIfAborted();
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      signal.throwIfAborted();
      const stat = await file.stat();
      signal.throwIfAborted();
      if (!stat.isFile()) return err("staging_config_read_failed");
      const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const result = await file.read(buffer, bytes, buffer.length - bytes, bytes);
        signal.throwIfAborted();
        if (result.bytesRead === 0) break;
        bytes += result.bytesRead;
      }
      if (bytes > MAX_CONFIG_BYTES) return err("staging_config_too_large");
      try {
        const input: unknown = JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
        return ok(input);
      } catch {
        return err("staging_config_invalid_json");
      }
    } finally {
      await file.close();
      signal.throwIfAborted();
    }
  } catch {
    signal.throwIfAborted();
    return err("staging_config_read_failed");
  }
}

export async function runAuthStagingCli(args: readonly string[], signal: AbortSignal) {
  signal.throwIfAborted();
  const options = parseArgs(args);
  if (!options.ok) return err({ code: options.error, exitCode: 2 as const });
  const loaded =
    options.value.inputPath === undefined
      ? ok({})
      : await readConfig(options.value.inputPath, signal);
  signal.throwIfAborted();
  if (!loaded.ok) return err({ code: loaded.error, exitCode: 2 as const });
  if (options.value.probe) {
    const observed = await probeAuthStagingHttps(loaded.value, signal);
    return observed.ok
      ? ok({ exitCode: 0 as const, report: observed.value })
      : err({ ...observed.error, exitCode: 1 as const });
  }
  const prepared = prepareAuthStagingRun(loaded.value, signal);
  return prepared.ok
    ? ok({ exitCode: 0 as const, report: prepared.value })
    : err({ code: prepared.error, exitCode: 2 as const });
}
