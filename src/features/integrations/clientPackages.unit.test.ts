import { expect, it } from "vitest";
import { buildClientPackage } from "./clientPackages";

it("creates self-contained client packages using OAuth and the selected deployment", () => {
  const openai = buildClientPackage("https://crm.example.test", "chatgpt");
  const claude = buildClientPackage("https://crm.example.test", "claude");
  expect(openai.ok && claude.ok).toBe(true);
  if (!openai.ok || !claude.ok) return;
  expect(JSON.parse(openai.value["mcp.json"] ?? "").mcpServers.warpdrive).toMatchObject({
    type: "streamable-http",
    url: "https://crm.example.test/api/mcp",
    extensions: { "com.openai": { auth: { type: "oauth" } } },
  });
  expect(JSON.parse(claude.value[".mcp.json"] ?? "").mcpServers.warpdrive).toMatchObject({
    type: "http",
    url: "https://crm.example.test/api/mcp",
  });
  expect(openai.value["skills/warpdrive-crm/SKILL.md"]).toContain("draft");
  expect(claude.value["skills/warpdrive-crm/references/localization.md"]).toContain("فارسی");
  expect(claude.value["skills/warpdrive-crm/references/localization.md"]).toContain("Deutsch");
  expect(Object.values(openai.value).join("\n")).not.toContain("clientSecret");
});

it.each([
  "http://crm.example.test",
  "https://user:password@crm.example.test",
  "https://crm.example.test/?token=secret",
  "https://crm.example.test/admin",
])("refuses unsafe or ambiguous deployment addresses: %s", (url) => {
  expect(buildClientPackage(url, "chatgpt").ok).toBe(false);
});
