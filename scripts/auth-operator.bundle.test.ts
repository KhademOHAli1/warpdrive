import { spawnSync } from "node:child_process";
import { access, copyFile, mkdtemp, realpath, rm, symlink, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";

test("the shipped builder emits an operator CLI and production config runnable without checkout sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "warpdrive-operator-bundle-"));
  try {
    for (const name of ["src", "scripts", "node_modules"])
      await symlink(resolve(name), join(root, name), "dir");
    await copyFile(resolve("tsconfig.json"), join(root, "tsconfig.json"));
    await copyFile(resolve("next.config.ts"), join(root, "next.config.ts"));
    const build = spawnSync("bun", ["scripts/build-workers.mjs"], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
    });
    expect(build.status, build.stderr).toBe(0);
    await access(join(root, "dist/auth-operator.mjs"));
    await copyFile(join(root, "dist/next.config.mjs"), join(root, "next.config.mjs"));
    await unlink(join(root, "src"));
    await unlink(join(root, "scripts"));
    await unlink(join(root, "tsconfig.json"));
    await unlink(join(root, "next.config.ts"));
    const usage = spawnSync("bun", ["dist/auth-operator.mjs"], {
      cwd: root,
      encoding: "utf8",
      timeout: 5_000,
      env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
    });
    expect(usage.status, usage.stderr).toBe(2);
    expect(usage.stderr).toContain("Usage:");
    expect(usage.stderr).toContain("--confirm-ownership");
    expect(usage.stderr).not.toContain("Invalid environment");

    const config = spawnSync(
      "bun",
      [
        "--no-env-file",
        "-e",
        `process.argv.push("start");
         const {default: loadConfig} = await import("next/dist/server/config.js");
         const config = await loadConfig("phase-production-server", process.cwd());
         const webpack = config.webpack({
           context: process.cwd(), resolve: {alias: {}}, cache: {type: "filesystem"}
         }, {dev: false});
         console.log(JSON.stringify({
           headers: await config.headers(),
           serverActions: config.experimental.serverActions,
           proxyClientMaxBodySize: config.experimental.proxyClientMaxBodySize,
           reactCompiler: config.reactCompiler,
           externalPackages: config.serverExternalPackages,
           logging: config.logging,
           productionCache: webpack.cache,
           intlAlias: webpack.resolve.alias["next-intl/config"],
           webpackHook: typeof config.webpack
         }));`,
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "production" },
      },
    );
    expect(config.status, config.stderr).toBe(0);
    const loaded = JSON.parse(config.stdout.trim());
    expect(loaded).toMatchObject({
      serverActions: { bodySizeLimit: "64mb" },
      proxyClientMaxBodySize: 64 * 1024 ** 2,
      reactCompiler: true,
      externalPackages: ["pg", "pg-boss", "isomorphic-dompurify"],
      logging: { serverFunctions: false },
      productionCache: { type: "filesystem" },
      intlAlias: join(await realpath(root), "src/features/i18n/request.ts"),
      webpackHook: "function",
    });
    expect(loaded.headers).toEqual([
      expect.objectContaining({
        source: "/oauth/authorize/consent",
        headers: expect.arrayContaining([
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
          },
        ]),
      }),
      expect.objectContaining({
        headers: expect.arrayContaining([
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
          },
        ]),
      }),
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 45_000);
