import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { envSchema } from "@/config/env";

// The test scripts run under Bun. Use its YAML 1.2 parser without adding another dependency.
declare const Bun: { YAML: { parse(source: string): unknown } };

const stepSchema = z
  .object({
    name: z.string(),
    uses: z.string().optional(),
    with: z.record(z.string(), z.unknown()).optional(),
    run: z.string().optional(),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict()
  .refine((step) => (step.uses === undefined) !== (step.run === undefined), {
    message: "a CI step must contain exactly one of uses or run",
  });
const workflow = z
  .object({
    name: z.string(),
    on: z.record(z.string(), z.unknown()),
    permissions: z.object({ contents: z.literal("read") }).strict(),
    concurrency: z.object({ group: z.string(), "cancel-in-progress": z.literal(true) }).strict(),
    jobs: z.record(
      z.string(),
      z
        .object({
          name: z.string(),
          "runs-on": z.literal("ubuntu-24.04"),
          "timeout-minutes": z.number().positive(),
          defaults: z
            .object({ run: z.object({ "working-directory": z.string() }).strict() })
            .strict()
            .optional(),
          steps: z.array(stepSchema),
        })
        .strict(),
    ),
  })
  .strict()
  .parse(
    Bun.YAML.parse(readFileSync(new URL("./.github/workflows/ci.yml", import.meta.url), "utf8")),
  );

const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const SETUP_BUN = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6";
const PACKAGES = { crm: "package.json", site: "site/package.json", docs: "docs-site/package.json" };

function job(name: keyof typeof PACKAGES) {
  const found = workflow.jobs[name];
  if (found === undefined) throw new Error(`missing public CI job: ${name}`);
  return found;
}
function commands(name: keyof typeof PACKAGES): string[] {
  return job(name).steps.flatMap((step) => (step.run === undefined ? [] : [step.run]));
}

describe("public Bun CI", () => {
  it("checks every branch push, ordinary pull requests and manual runs with a read-only token", () => {
    expect(workflow.on).toEqual({ push: null, pull_request: null, workflow_dispatch: null });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency.group).toContain("github.workflow");
    expect(workflow.concurrency.group).toContain("github.ref");
  });

  it("contains only the three public check jobs and no deployment/publishing job", () => {
    expect(Object.keys(workflow.jobs).sort()).toEqual(["crm", "docs", "site"]);
    for (const name of Object.keys(PACKAGES) as (keyof typeof PACKAGES)[]) {
      const check = job(name);
      expect(check["timeout-minutes"]).toBeLessThanOrEqual(30);
      expect(check.steps.map((step) => step.uses).filter((uses) => uses !== undefined)).toEqual([
        CHECKOUT,
        SETUP_BUN,
      ]);
    }
  });

  it("pins reviewed official actions and selects Bun from each package instead of floating latest", () => {
    for (const [name, path] of Object.entries(PACKAGES)) {
      const steps = job(name as keyof typeof PACKAGES).steps;
      expect(steps[0]?.with).toEqual({ "persist-credentials": false });
      expect(steps[1]?.with).toEqual({ "bun-version-file": path });
      const metadata = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as {
        packageManager: string;
      };
      expect(metadata.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
    }
  });

  it("generates and checks app types before lint, then gates unit tests and both build outputs", () => {
    expect(commands("crm")).toEqual([
      "bun install --frozen-lockfile",
      "bun run typecheck",
      "bun run lint",
      "bun run test:unit --maxWorkers=2",
      "bun run test:integration --maxWorkers=2",
      "bun run build",
      "bun run build:workers",
    ]);
    const metadata = JSON.parse(
      readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(metadata.scripts.typecheck).toMatch(/next typegen\s*&&.*tsc/);
  });

  it("checks the independent site and docs with scripts those packages actually provide", () => {
    expect(job("site").defaults?.run["working-directory"]).toBe("site");
    expect(commands("site")).toEqual([
      "bun install --frozen-lockfile",
      "bun --bun next typegen",
      "bun run typecheck",
      "bun run test",
      "bun run build",
    ]);
    expect(job("docs").defaults?.run["working-directory"]).toBe("docs-site");
    expect(commands("docs")).toEqual([
      "bun install --frozen-lockfile",
      "bun run typecheck",
      "bun run build",
    ]);
    for (const [name, path] of Object.entries(PACKAGES)) {
      const metadata = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as {
        scripts: Record<string, string>;
      };
      for (const command of commands(name as keyof typeof PACKAGES)) {
        if (command.startsWith("bun run "))
          expect(metadata.scripts).toHaveProperty(command.split(" ")[2] ?? "");
      }
    }
  });

  it("keeps schema-valid, fake app configuration on the app build step and stamps its checked commit", () => {
    const build = job("crm").steps.find((step) => step.run === "bun run build");
    expect(build?.env).toBeDefined();
    const env = build?.env ?? {};
    expect(envSchema.safeParse(env).success).toBe(true);
    expect(env.NODE_ENV).toBe("production");
    expect(env.APP_COMMIT).toMatch(/^\$\{\{\s*github\.sha\s*\}\}$/);
    expect(env.DATABASE_URL).toBe("postgres://build:build@127.0.0.1:5432/build");
    expect(env.BASE_URL).toBe("https://build.example.invalid");
    expect(env.MINIO_ENDPOINT).toBe("http://127.0.0.1:9000");
    expect(env.NEXT_PUBLIC_WS_URL).toBe("ws://127.0.0.1:8080");
    expect(env.GOOGLE_WORKSPACE_DOMAIN).toBe("build.example.invalid");
    expect(env.GOOGLE_OAUTH_CLIENT_ID).toBe("ci-build-client");
    expect(env.GOOGLE_OAUTH_CLIENT_SECRET).toBe("ci-build-secret");
    expect(env.MINIO_ACCESS_KEY).toBe("ci-build-access");
    expect(env.MINIO_SECRET_KEY).toBe("ci-build-secret");
    expect(env.TOKEN_ENCRYPTION_KEY).toBe(Buffer.alloc(32).toString("base64"));
    expect(env.OAUTH_SIGNING_KEY).toBe(Buffer.alloc(32).toString("base64"));
    expect(env.WS_TICKET_SECRET).toMatch(/^ci_build_placeholder_/);
    expect(env.SEED_ADMIN_EMAIL).toBe("build@example.invalid");
    expect(env.ALLOW_FIRST_LOGIN_ADMIN).toBe("false");
    for (const [key, value] of Object.entries(env)) {
      if (key !== "APP_COMMIT") expect(value).not.toContain("${{");
    }
    for (const check of Object.values(workflow.jobs)) {
      for (const step of check.steps) {
        if (step.run !== "bun run build") expect(step.env).toBeUndefined();
      }
    }
  });
});
