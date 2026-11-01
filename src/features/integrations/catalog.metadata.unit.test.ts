import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INTEGRATIONS } from "./catalog";

describe("provider registry metadata", () => {
  it("distinguishes implemented auth from roadmap candidates without implying configuration", () => {
    for (const provider of INTEGRATIONS) {
      expect(provider).toMatchObject({
        availability: provider.delivery === "planned" ? "planned" : "local",
        authTypes: provider.delivery === "planned" ? [] : ["oauth2"],
      });
    }
    expect(
      INTEGRATIONS.filter((provider) => provider.delivery !== "planned").map(({ id }) => id),
    ).toEqual(["chatgpt", "claude", "other-mcp", "gmail", "slack"]);
  });

  it("resolves stable unique IDs and local assets from the same entries", () => {
    expect(new Set(INTEGRATIONS.map(({ id }) => id)).size).toBe(INTEGRATIONS.length);
    for (const provider of INTEGRATIONS) {
      expect(provider).toMatchObject({
        asset: provider.id === "other-mcp" ? null : `/integrations/${provider.id}.svg`,
      });
    }
  });

  it.each(["fa", "de", "en"])("resolves every registry description in %s", (locale) => {
    const messages = JSON.parse(
      readFileSync(`src/features/integrations/messages/integrations.${locale}.json`, "utf8"),
    ) as { providers: Record<string, { description: string }> };
    for (const provider of INTEGRATIONS) {
      expect(provider).toMatchObject({ descriptionKey: `providers.${provider.id}.description` });
      expect(messages.providers[provider.id]?.description.trim().length).toBeGreaterThan(0);
    }
  });
});
