// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  Reply,
  Search,
  Undo2,
} from "lucide-react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CollapsibleSection } from "@/features/deal-workspace/CollapsibleSection";
import { ContactsIcon, DashboardIcon, FinanceNavGlyph, PipelineIcon } from "../shell/NavIcons";
import navIconStyles from "../shell/NavIcons.module.css";
import { Checkbox } from "./Checkbox";

let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement("style");
  const navCss = readFileSync("src/components/shell/NavIcons.module.css", "utf8").replaceAll(
    ".icon",
    `.${navIconStyles.icon}`,
  );
  style.textContent = `${readFileSync("src/components/ui/iconDirection.css", "utf8")}\n${navCss}`;
  document.head.append(style);
});
afterEach(() => {
  cleanup();
  style.remove();
});

describe("semantic icon direction", () => {
  it("mirrors directional navigation and reply/history actions in RTL", () => {
    render(
      <div dir="rtl">
        <ArrowRight data-testid="arrow" />
        <Reply data-testid="reply" />
        <Undo2 data-testid="undo" />
      </div>,
    );
    for (const name of ["arrow", "reply", "undo"])
      expect(screen.getByTestId(name)).toHaveStyle({ scale: "-1 1" });
  });
  it("keeps checkmarks, search, calendar and vertical disclosure symbols unchanged", () => {
    render(
      <div dir="rtl">
        <Check data-testid="check" />
        <CheckCheck data-testid="checks" />
        <Search data-testid="search" />
        <CalendarDays data-testid="calendar" />
        <ChevronDown data-testid="down" />
        <Checkbox checked label="Selected contact" onCheckedChange={() => {}} />
      </div>,
    );
    for (const name of ["check", "checks", "search", "calendar", "down"])
      expect(screen.getByTestId(name)).not.toHaveStyle({ scale: "-1 1" });
    expect(screen.getByRole("checkbox").querySelector("svg")).not.toHaveStyle({ scale: "-1 1" });
  });
  it("preserves the shape of ordinary sidebar pictograms", () => {
    const { container } = render(
      <nav dir="rtl">
        <PipelineIcon />
        <ContactsIcon />
        <DashboardIcon />
      </nav>,
    );
    const icons = container.querySelectorAll("[data-finance-icon]");
    expect(icons).toHaveLength(3);
    for (const icon of icons) expect(icon).not.toHaveStyle({ scale: "-1 1" });
  });
  it("mirrors logical mask chevrons and leaves physical choices alone", () => {
    const { container } = render(
      <nav dir="rtl">
        <FinanceNavGlyph name="chevron-left" />
        <FinanceNavGlyph name="chevron-right" mirror={false} />
      </nav>,
    );
    const icons = container.querySelectorAll("[data-finance-icon]");
    expect(icons[0]).toHaveStyle({ scale: "-1 1" });
    expect(icons[1]).not.toHaveStyle({ scale: "-1 1" });
  });
  it("respects nested LTR content and avoids a second RTL transform", () => {
    render(
      <div dir="rtl">
        <div dir="ltr">
          <ArrowRight data-testid="ltr" />
          <PipelineIcon />
        </div>
        <ChevronLeft data-testid="shadcn" className="rtl:rotate-180" />
        <ChevronLeft data-testid="physical" data-rtl-mirror="false" />
      </div>,
    );
    for (const name of ["ltr", "shadcn", "physical"])
      expect(screen.getByTestId(name)).not.toHaveStyle({ scale: "-1 1" });
  });
  it.each(["ltr", "rtl"])(
    "points a closed disclosure toward the text and an open one down in %s",
    (direction) => {
      render(
        <div dir={direction}>
          <CollapsibleSection title="Profile" defaultOpen={false} showFilter={false}>
            Details
          </CollapsibleSection>
        </div>,
      );
      const trigger = screen.getByRole("button", { name: "Profile" });
      const icon = trigger.querySelector("svg");
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(icon).toHaveStyle({ rotate: direction === "rtl" ? "90deg" : "-90deg" });
      expect(icon).not.toHaveStyle({ scale: "-1 1" });
      fireEvent.click(trigger);
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(icon).toHaveStyle({ rotate: "0deg" });
    },
  );
});
