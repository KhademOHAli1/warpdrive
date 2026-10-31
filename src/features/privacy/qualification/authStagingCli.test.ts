import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { runAuthStagingCli } from "./authStagingCli";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "warpdrive-staging-config-"));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
const signal = () => AbortSignal.timeout(1000);

test("P29B: default CLI mode prepares the OPEN checklist and cannot probe or send", async () => {
  const result = await runAuthStagingCli([], signal());
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.value.report).toMatchObject({
    status: "OPEN",
    accepted: false,
    evidenceLevel: "preparation_only",
  });
  expect(result.value.exitCode).toBe(0);
  expect(await runAuthStagingCli(["--probe"], signal())).toEqual({
    ok: false,
    error: { code: "staging_cli_arguments", exitCode: 2 },
  });
  expect(await runAuthStagingCli(["--send-mail"], signal())).toEqual({
    ok: false,
    error: { code: "staging_cli_arguments", exitCode: 2 },
  });
});

test("C10: malformed, secret-bearing and oversized config failures do not echo contents or filenames", async () => {
  const file = join(directory, "PRIVATE-SENTINEL.json");
  for (const [content, code] of [
    ["{PRIVATE-SENTINEL", "staging_config_invalid_json"],
    [JSON.stringify({ smtpPassword: "PRIVATE-SENTINEL" }), "staging_input_invalid"],
    ["PRIVATE-SENTINEL".repeat(5000), "staging_config_too_large"],
  ] as const) {
    await writeFile(file, content, { mode: 0o600 });
    const result = await runAuthStagingCli(["--input", file], signal());
    expect(result).toEqual({ ok: false, error: { code, exitCode: 2 } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE-SENTINEL");
  }
});

test("P29B: probe mode requires target-specific authorization even with a configuration file", async () => {
  const file = join(directory, "input.json");
  await writeFile(
    file,
    JSON.stringify({
      environment: "synthetic",
      origin: "https://127.0.0.1:9",
      revision: "a".repeat(40),
    }),
    { mode: 0o600 },
  );
  expect(await runAuthStagingCli(["--input", file, "--probe"], signal())).toMatchObject({
    ok: false,
    error: { code: "probe_not_authorized", exitCode: 1 },
  });
});

test("C06: aborted config reads preserve cancellation", async () => {
  await expect(runAuthStagingCli([], AbortSignal.abort())).rejects.toMatchObject({
    name: "AbortError",
  });
});
