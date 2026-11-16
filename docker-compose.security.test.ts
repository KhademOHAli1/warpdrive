import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const production = readFileSync("docker-compose.yml", "utf8");
const development = readFileSync("docker-compose.dev.yml", "utf8");
const exampleEnv = readFileSync(".env.example", "utf8");
const deploymentGuide = readFileSync("docs/deploy.md", "utf8");

describe("single-box security settings", () => {
  test("production requires a database password instead of accepting a known fallback", () => {
    expect(production).toMatch(/^\s+POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?[^}]+\}$/m);
    expect(production).not.toMatch(/^\s+POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:-/m);
    expect(exampleEnv).toMatch(/^POSTGRES_PASSWORD=$/m);
    expect(deploymentGuide).not.toContain("postgres://warpdrive:warpdrive@");
  });

  test("Web forwards the socket peer only behind the trusted production ingress", () => {
    const service = (source: string, name: string) =>
      source.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[a-z0-9-]+:\n/)[0];
    expect(service(production, "app")).toMatch(/^\s+FRONTEND_TRUSTED_PROXY_HEADER: x-real-ip$/m);
    expect(service(development, "app")).toMatch(/^\s+FRONTEND_TRUSTED_PROXY_HEADER: none$/m);
    expect(service(production, "core-api")).toMatch(/^\s+AUTH_TRUSTED_PROXY_HEADER: x-real-ip$/m);
    expect(exampleEnv).toMatch(/^AUTH_TRUSTED_PROXY_HEADER=none$/m);
  });
});
