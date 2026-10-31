import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { INTEGRATIONS } from "./catalog";

it("ships self-contained SVGs for the recognizable provider marks", () => {
  for (const { id } of INTEGRATIONS.filter((item) => item.id !== "other-mcp")) {
    const svg = readFileSync(`public/integrations/${id}.svg`, "utf8");
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox=");
    expect(svg).not.toMatch(/<script|<foreignObject|onload=|href=["']https?:/i);
  }
});
