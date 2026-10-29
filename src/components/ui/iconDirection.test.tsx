// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { ArrowRight, ChevronLeft, Reply, Search, Undo2 } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContactsIcon, DashboardIcon, PipelineIcon } from "../shell/NavIcons";

let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement("style");
  style.textContent = readFileSync("src/components/ui/iconDirection.css", "utf8");
  document.head.append(style);
});
afterEach(() => {
  cleanup();
  style.remove();
});

describe("interface icon direction", () => {
  it("mirrors all interface pictograms in RTL", () => {
    render(
      <div dir="rtl">
        <ArrowRight data-testid="arrow" />
        <Reply data-testid="reply" />
        <Undo2 data-testid="undo" />
        <Search data-testid="search" />
      </div>,
    );
    for (const name of ["arrow", "reply", "undo", "search"])
      expect(screen.getByTestId(name)).toHaveStyle({ scale: "-1 1" });
  });

  it("mirrors the pipeline, contacts and dashboard sidebar icons", () => {
    const { container } = render(
      <nav dir="rtl">
        <PipelineIcon />
        <ContactsIcon />
        <DashboardIcon />
      </nav>,
    );
    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(3);
    for (const icon of icons) expect(icon).toHaveStyle({ scale: "-1 1" });
  });

  it("respects LTR islands and avoids mirroring icons already handled by shadcn or application logic", () => {
    render(
      <div dir="rtl">
        <div dir="ltr">
          <ArrowRight data-testid="ltr" />
        </div>
        <ChevronLeft data-testid="shadcn" className="rtl:rotate-180" />
        <ChevronLeft data-testid="physical" data-rtl-mirror="false" />
      </div>,
    );
    for (const name of ["ltr", "shadcn", "physical"])
      expect(screen.getByTestId(name)).not.toHaveStyle({ scale: "-1 1" });
  });
});
