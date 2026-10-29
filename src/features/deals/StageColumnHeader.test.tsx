// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { StageColumnHeader } from "./StageColumnHeader";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));
vi.mock("./AddDealModal", () => ({ AddDealModal: () => null }));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

function renderHeader(locale: "en" | "fa", stageName = "Qualified", dealCount = 7) {
  const onToggleCollapse = vi.fn();
  render(
    <LocaleProvider locale={locale}>
      <QueryClientProvider client={new QueryClient()}>
        <StageColumnHeader
          stageId="s1"
          stageName={stageName}
          order={0}
          pipelineId="p1"
          pipelines={[]}
          totalValue="232000"
          dealCount={dealCount}
          baseCurrency="USD"
          collapsed={false}
          onToggleCollapse={onToggleCollapse}
        />
      </QueryClientProvider>
    </LocaleProvider>,
  );
  return { onToggleCollapse };
}

describe("pipeline stage header direction", () => {
  it("gives the title and menu separate layout slots in both directions", () => {
    for (const locale of ["en", "fa"] as const) {
      renderHeader(locale, "A very long stage name for an international sales team");
      const heading = screen.getByRole("heading");
      const button = screen.getByRole("button");
      const header = heading.closest("header");
      expect(header).toHaveClass("grid");
      expect(button.parentElement).toBe(header);
      expect(heading.parentElement?.contains(button)).toBe(false);
      expect(heading).toHaveClass("truncate");
      expect(button).toHaveClass("shrink-0");
      expect(button.className).not.toContain("absolute");
      cleanup();
    }
  });

  it("mirrors the Persian header and isolates mixed-script metrics", () => {
    renderHeader("fa");
    const heading = screen.getByRole("heading", { name: "Qualified" });
    expect(heading.parentElement?.style.clipPath).toContain("0 50%");
    expect(heading.parentElement?.style.borderInlineStart).toContain("3px");
    expect(heading.querySelector("bdi")).toHaveAttribute("dir", "auto");
    const count = screen.getByText("۷ فرصت فروش");
    expect(count.tagName).toBe("BDI");
    expect(count).toHaveAttribute("dir", "auto");
    const amount = screen.getByText(/۲۳۲٬۰۰۰/);
    expect(amount.tagName).toBe("BDI");
    expect(amount.textContent).toContain("$");
    expect(amount).toHaveAttribute("dir", "auto");
    expect(screen.getByRole("button", { name: "عملیات مرحلهٔ Qualified" })).toBeVisible();
  });

  it.each([
    [0, "0 deals"],
    [1, "1 deal"],
    [7, "7 deals"],
  ])("retains English plural handling for %i deals", (count, label) => {
    renderHeader("en", "Qualified", count);
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByRole("heading").parentElement?.style.clipPath).toContain("100% 50%");
  });

  it("keeps the Persian menu keyboard accessible and restores focus", async () => {
    const { onToggleCollapse } = renderHeader("fa", "مذاکره");
    const trigger = screen.getByRole("button", { name: "عملیات مرحلهٔ مذاکره" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter", code: "Enter" });
    fireEvent.click(screen.getByRole("menuitem", { name: "جمع کردن ستون" }));
    expect(onToggleCollapse).toHaveBeenCalledOnce();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
