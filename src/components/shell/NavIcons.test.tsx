// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  ActivitiesIcon,
  ContactsIcon,
  DashboardIcon,
  DealsIcon,
  DocsIcon,
  FinanceNavGlyph,
  InboxIcon,
  LeadsIcon,
  PipelineIcon,
  SettingsIcon,
} from "./NavIcons";

afterEach(cleanup);

const ICONS = [
  ["PipelineIcon", PipelineIcon],
  ["DealsIcon", DealsIcon],
  ["LeadsIcon", LeadsIcon],
  ["ContactsIcon", ContactsIcon],
  ["ActivitiesIcon", ActivitiesIcon],
  ["InboxIcon", InboxIcon],
  ["DashboardIcon", DashboardIcon],
  ["SettingsIcon", SettingsIcon],
  ["DocsIcon", DocsIcon],
] as const;

const FINANCE_GLYPHS = [
  "pipeline-board",
  "lead-person-plus",
  "performance-bars",
  "settings-cog",
  "guide-open-book",
  "user-group",
  "folder-open",
  "calendar-01",
  "chevron-left",
  "chevron-right",
  "chevron-down",
  "bars",
] as const;

function paintAttribute(element: Element, name: string, fallback: string): string {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const value = node.getAttribute(name);
    if (value !== null) return value.replace("#353535", "currentColor");
  }
  return fallback;
}

function artwork(svg: Element) {
  return [...svg.getElementsByTagName("*")]
    .filter((shape) => ["path", "rect", "circle"].includes(shape.tagName))
    .map((shape) => {
      const stroke = paintAttribute(shape, "stroke", "none");
      return {
        tag: shape.tagName,
        geometry: Object.fromEntries(
          [...shape.attributes]
            .filter(({ name }) => /^(d|x|y|width|height|rx|ry|cx|cy|r)$/.test(name))
            .map(({ name, value }) => [name, value]),
        ),
        fill: paintAttribute(shape, "fill", "black"),
        stroke,
        ...(stroke === "none"
          ? {}
          : {
              strokeWidth: paintAttribute(shape, "stroke-width", "1"),
              strokeLinecap: paintAttribute(shape, "stroke-linecap", "butt"),
              strokeLinejoin: paintAttribute(shape, "stroke-linejoin", "miter"),
            }),
      };
    });
}

describe("NavIcons", () => {
  it.each(ICONS)("%s is decorative (aria-hidden), so the link label names the link", (_n, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg, [data-finance-icon]");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });

  it.each(ICONS)("%s defaults to the 18px nav size", (_n, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg, [data-finance-icon]");
    expect(svg?.getAttribute("class")).toContain("h-[18px] w-[18px] shrink-0");
  });

  it.each(ICONS)("%s honours a className override", (_n, Icon) => {
    const { container } = render(<Icon className="h-5 w-5" />);
    const svg = container.querySelector("svg, [data-finance-icon]");
    expect(svg?.getAttribute("class")).toContain("h-5 w-5");
    expect(svg?.getAttribute("class")).not.toContain("h-[18px]");
  });

  it("renders every nav glyph distinctly", () => {
    const shapes = ICONS.map(([, Icon]) => {
      const html = render(<Icon />).container.innerHTML;
      cleanup();
      return html;
    });
    expect(new Set(shapes).size).toBe(ICONS.length);
  });

  it("includes the artwork in the server response without fetching icon images", () => {
    const markup = renderToStaticMarkup(
      <nav>
        {FINANCE_GLYPHS.map((name) => (
          <FinanceNavGlyph key={name} name={name} />
        ))}
      </nav>,
    );
    const document = new DOMParser().parseFromString(markup, "text/html");
    expect(document.querySelectorAll("svg[data-finance-icon]")).toHaveLength(FINANCE_GLYPHS.length);
    expect(document.querySelectorAll("svg path").length).toBeGreaterThan(0);
    expect(markup).not.toMatch(/finance-os-icons|url\(|href=|<image|<use/);
    expect(readFileSync("src/components/shell/NavIcons.module.css", "utf8")).not.toMatch(
      /mask|url\(/,
    );
  });

  it.each(FINANCE_GLYPHS)("preserves %s artwork and its centered optical size", (name) => {
    const source = new DOMParser().parseFromString(
      readFileSync(`public/finance-os-icons/${name}.svg`, "utf8"),
      "image/svg+xml",
    ).documentElement;
    const { container } = render(<FinanceNavGlyph name={name} size={32} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(artwork(svg!)).toEqual(artwork(source));
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
    expect(svg).toHaveStyle({ width: "32px", height: "32px" });
    const [x, y, width, height] = svg!.getAttribute("viewBox")!.split(" ").map(Number);
    expect([width, height]).toEqual([24, 24]);
    expect(x! + 12).toBeCloseTo(Number(source.getAttribute("width")) / 2);
    expect(y! + 12).toBeCloseTo(Number(source.getAttribute("height")) / 2);
  });
});
