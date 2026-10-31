import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./src/config/env";
import { testEnvInput } from "./src/test/envInput";

// Docker consumers pass APP_COMMIT as a build arg. Both the build and runtime stages must
// preserve it; dropping either silently produces unstamped prerendered or dynamic pages.
// Public CI's separate app-build stamp contract lives in ciWorkflow.test.ts. The upstream
// private deployment workflow is not part of this checkout (see docs/public-ci.md).
const dockerfile = readFileSync(new URL("./Dockerfile", import.meta.url), "utf8");

function stage(name: string): string {
  const stages = dockerfile.split(/^FROM .+ AS /m);
  const found = stages.find((s) => s.startsWith(name));
  if (found === undefined) throw new Error(`no such Dockerfile stage: ${name}`);
  return found;
}

describe("build metadata (APP_COMMIT)", () => {
  it("is declared in the build stage so prerendered pages carry it", () => {
    const build = stage("build");
    expect(build).toMatch(/^ARG APP_COMMIT/m);
    expect(build).toMatch(/APP_COMMIT=\$\{?APP_COMMIT\}?/);
  });

  it("is declared in the runtime stage so dynamic pages carry it", () => {
    const runtime = stage("runtime");
    expect(runtime).toMatch(/^ARG APP_COMMIT/m);
    expect(runtime).toMatch(/^ENV APP_COMMIT=\$\{APP_COMMIT\}/m);
  });

  it("declares the runtime stamp after the COPY layers so a new SHA cannot bust their cache", () => {
    const runtime = stage("runtime");
    expect(runtime.indexOf("ARG APP_COMMIT")).toBeGreaterThan(runtime.lastIndexOf("\nCOPY "));
  });
});

describe("Bun dependency patches", () => {
  it.each(["deps", "prod-deps"])("copies patches before the %s frozen install", (name) => {
    const dependencyStage = stage(name);
    const copyPatches = dependencyStage.indexOf("COPY patches ./patches");
    expect(copyPatches).toBeGreaterThan(-1);
    expect(copyPatches).toBeLessThan(dependencyStage.indexOf("RUN bun install --frozen-lockfile"));
  });
});

it("build placeholders satisfy the production auth environment without runtime secrets", () => {
  const build = stage("build");
  const command = build.slice(
    build.indexOf("RUN NODE_ENV=production"),
    build.indexOf("bun run build:docker"),
  );
  const values = Object.fromEntries(
    [...command.matchAll(/\b([A-Z][A-Z0-9_]*)=([^\s\\]+)/g)].map((match) => [match[1], match[2]]),
  );
  expect(parseEnv({ ...testEnvInput(), ...values }).ok).toBe(true);
});
