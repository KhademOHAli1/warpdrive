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

  test("only Caddy-fronted production app trusts X-Real-IP", () => {
    const productionApp = production.split("\n  app:\n")[1]?.split("\n  ws:\n")[0];
    const developmentApp = development.split("\n  app:\n")[1]?.split("\n  ws:\n")[0];
    expect(productionApp).toMatch(/^\s+AUTH_TRUSTED_PROXY_HEADER: x-real-ip$/m);
    expect(developmentApp).toMatch(/^\s+AUTH_TRUSTED_PROXY_HEADER: none$/m);
    expect(exampleEnv).toMatch(/^AUTH_TRUSTED_PROXY_HEADER=none$/m);
  });
});
