import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const script = fileURLToPath(new URL("./operations-source.ts", import.meta.url));

function invoke(path: string) {
  return spawnSync(process.execPath, ["--no-env-file", script, "enroll", path], {
    env: { NODE_ENV: "test", DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused" },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 8_192,
    timeout: 10_000,
    killSignal: "SIGKILL",
  });
}

it("holds unsafe configuration files, connections and key input without printing private values", () => {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "wd-operations-source-"));
  chmodSync(directory, 0o700);
  try {
    const path = join(directory, "source.json");
    const alias = join(directory, "alias.json");
    const privateValue = randomBytes(32).toString("hex");
    const config = {
      databaseUrl: `postgres://fixture:${privateValue}@127.0.0.1:1/disposable`,
      role: "host_collector",
      binding: { installationId: randomUUID(), sourceId: randomUUID(), generationId: randomUUID() },
    };
    const cases = [
      { input: config, mode: 0o644, selected: path },
      { input: config, mode: 0o600, selected: alias },
      {
        input: {
          ...config,
          databaseUrl: config.databaseUrl.replace("127.0.0.1", "external.invalid"),
        },
        mode: 0o600,
        selected: path,
      },
      {
        input: { ...config, databaseUrl: `${config.databaseUrl}?options=-c` },
        mode: 0o600,
        selected: path,
      },
      { input: { ...config, signingKey: privateValue }, mode: 0o600, selected: path },
    ];
    symlinkSync(path, alias);
    for (const { input, mode, selected } of cases) {
      writeFileSync(path, JSON.stringify(input), { mode: 0o600 });
      chmodSync(path, mode);
      const result = invoke(selected);
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "Operations source enrollment held. Keep the exact configuration for readback.\n",
      );
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
