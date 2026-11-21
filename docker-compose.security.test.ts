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

describe("standalone Web runtime", () => {
  const standalone = readFileSync("deploy/images/compose.web.yml", "utf8");
  const webEnv = readFileSync(".env.web.example", "utf8");

  test("runs only the qualified Web image with a loopback port and independent liveness", () => {
    expect(standalone.match(/^ {2}[a-z-]+:$/gm)).toEqual(["  web:"]);
    expect(standalone).toContain("pull_policy: never");
    expect(standalone).toContain("127.0.0.1:");
    expect(standalone).toContain("/api/health");
    expect(standalone).not.toMatch(/^\s+(build|depends_on|env_file):/m);
    const environment = standalone.split("    environment:\n")[1]?.split(/^ {4}ports:/m)[0] ?? "";
    expect([...environment.matchAll(/^ {6}([A-Z_]+):/gm)].map((match) => match[1])).toEqual([
      "CORE_API_ORIGIN",
      "CORE_PROXY_TOKEN",
      "WEB_PUBLIC_ORIGIN",
      "FRONTEND_TRUSTED_PROXY_HEADER",
    ]);
    expect(webEnv).toContain("WEB_PUBLIC_ORIGIN=");
  });

  test("retains same-origin realtime by default in the source Compose build", () => {
    expect(production).toContain(`NEXT_PUBLIC_WS_URL: \${NEXT_PUBLIC_WS_URL:-same-origin}`);
    expect(exampleEnv).toMatch(/^NEXT_PUBLIC_WS_URL=same-origin$/m);
  });
});
