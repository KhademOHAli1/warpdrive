// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { validateProviderSvg } from "@/test/providerSvgGuard";
import {
  ADVERSARIAL_SVGS,
  POSITIVE_SVGS,
  SVG_PATH,
  svgFixture,
} from "@/test/providerSvgGuardFixtures";
import { INTEGRATIONS } from "./catalog";

it("ships self-contained SVGs for the recognizable provider marks", () => {
  for (const { id } of INTEGRATIONS.filter((item) => item.id !== "other-mcp")) {
    const svg = readFileSync(`public/integrations/${id}.svg`, "utf8");
    expect(validateProviderSvg(svg), id).toMatchObject({ ok: true });
  }
});

it.each(ADVERSARIAL_SVGS)("refuses $id", ({ source, code }) => {
  expect(validateProviderSvg(source)).toEqual({ ok: false, error: { code } });
});

it.each(POSITIVE_SVGS)("preserves $id", ({ source }) => {
  expect(validateProviderSvg(source)).toMatchObject({ ok: true });
});

it.each([
  svgFixture("<script>alert(1)</script>"),
  svgFixture("<foreignObject/>"),
  svgFixture(SVG_PATH, 'onload="alert(1)"'),
  svgFixture('<image href="https://asset.invalid/x.svg"/>'),
  svgFixture().replace("<title>Fixture</title>", ""),
  svgFixture().replace('viewBox="0 0 24 24"', ""),
])("retains existing rejected-markup coverage %#", (source) => {
  expect(validateProviderSvg(source).ok).toBe(false);
});

it("refuses entity declarations before invoking the XML parser", () => {
  const parse = vi.spyOn(DOMParser.prototype, "parseFromString");
  try {
    const entity = ADVERSARIAL_SVGS.find(({ id }) => id.startsWith("A-20"));
    expect(entity).toBeDefined();
    if (entity === undefined) return;
    expect(validateProviderSvg(entity.source)).toEqual({
      ok: false,
      error: { code: "declaration" },
    });
    expect(parse).not.toHaveBeenCalled();
  } finally {
    parse.mockRestore();
  }
});
