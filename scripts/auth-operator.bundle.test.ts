import { spawnSync } from "node:child_process";
import { access, copyFile, mkdtemp, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

test("the shipped worker builder emits an operator CLI runnable without checkout sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "warpdrive-operator-bundle-"));
  try {
    for (const name of ["src", "scripts", "node_modules"])
      await symlink(resolve(name), join(root, name), "dir");
    await copyFile(resolve("tsconfig.json"), join(root, "tsconfig.json"));
    const build = spawnSync("bun", ["scripts/build-workers.mjs"], { cwd: root, encoding: "utf8" });
    expect(build.status, build.stderr).toBe(0);
    await access(join(root, "dist/auth-operator.mjs"));
    await unlink(join(root, "src"));
    await unlink(join(root, "scripts"));
    await unlink(join(root, "tsconfig.json"));
    const usage = spawnSync("bun", ["dist/auth-operator.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
    });
    expect(usage.status, usage.stderr).toBe(2);
    expect(usage.stderr).toContain("Usage:");
    expect(usage.stderr).toContain("--confirm-ownership");
    expect(usage.stderr).not.toContain("Invalid environment");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
