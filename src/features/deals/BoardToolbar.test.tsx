// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/pipeline",
}));

import { BoardToolbar, type BoardToolbarProps } from "./BoardToolbar";

afterEach(cleanup);

function renderToolbar(props: Partial<BoardToolbarProps> = {}) {
  return render(
    <BoardToolbar
      pipelineId="p1"
      pipelines={[
        { id: "p1", name: "Sales" },
        { id: "p2", name: "Partners" },
      ]}
      totalValue="1000"
      dealCount={2}
      {...props}
    />,
  );
}

describe("BoardToolbar view toggle", () => {
  it.each(["list", "archived"] as const)("retains %s when selecting a pipeline", async (view) => {
    const user = userEvent.setup();
    renderToolbar({ activeView: view });
    await user.click(screen.getByRole("button", { name: "Select dashboard: Sales" }));
    expect(screen.getByRole("menuitem", { name: "Partners" }).getAttribute("href")).toBe(
      `/pipeline/p2/${view}`,
    );
  });
  it("renders Board and List as icon buttons (Pipedrive), with accessible names", () => {
    renderToolbar();
    const board = screen.getByRole("link", { name: "Board view" });
    const list = screen.getByRole("link", { name: "List view" });
    // Each control carries an icon glyph, not just a text label.
    expect(board.querySelector("svg")).not.toBeNull();
    expect(list.querySelector("svg")).not.toBeNull();
    // The active view is marked for assistive tech.
    expect(board.getAttribute("aria-current")).toBe("page");
  });

  it("shows a visible text label on each segment so List/Archive are discoverable (P6)", () => {
    renderToolbar();
    expect(screen.getByRole("link", { name: "Board view" }).textContent).toContain("Board");
    expect(screen.getByRole("link", { name: "List view" }).textContent).toContain("List");
    expect(screen.getByRole("link", { name: "Archive view" }).textContent).toContain("Archive");
  });

  it("links to the Edit Pipeline page from a pencil control", () => {
    renderToolbar({ canManagePipelines: true });
    const edit = screen.getByRole("link", { name: "Edit pipeline" });
    expect(edit.getAttribute("href")).toBe("/pipeline/p1/edit");
    expect(edit.querySelector("svg")).not.toBeNull();
  });

  it("offers Board bulk selection via the List without duplicating Edit pipeline", async () => {
    const user = userEvent.setup();
    renderToolbar({ canManagePipelines: true });
    await user.click(screen.getByRole("button", { name: "Board actions" }));
    expect(
      screen.getByRole("menuitem", { name: "Select multiple deals" }).getAttribute("href"),
    ).toBe("/pipeline/p1/list");
    expect(screen.queryByRole("menuitem", { name: "Edit pipeline" })).toBeNull();
  });

  it("hides Edit pipeline from a Board viewer without pipeline management access", () => {
    renderToolbar();
    expect(screen.queryByRole("link", { name: "Edit pipeline" })).toBeNull();
  });

  it("defaults to the Board tab being current", () => {
    renderToolbar();
    expect(screen.getByRole("link", { name: "Board view" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(screen.getByRole("link", { name: "List view" }).getAttribute("aria-current")).toBeNull();
  });

  it("marks the List tab current (and not Board) when the list view is active", () => {
    renderToolbar({ activeView: "list" });
    expect(screen.getByRole("link", { name: "List view" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Board view" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("marks the Archive tab current when the archived view is active", () => {
    renderToolbar({ activeView: "archived" });
    expect(screen.getByRole("link", { name: "Archive view" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      screen.getByRole("link", { name: "Board view" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it.each(["board", "list", "archived"] as const)(
    "keeps the dashboard switcher first on %s",
    (view) => {
      renderToolbar({ activeView: view });
      const selector = screen.getByRole("button", { name: "Select dashboard: Sales" });
      const board = screen.getByRole("link", { name: "Board view" });
      expect(selector.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    },
  );

  it.each(["list", "archived"] as const)(
    "keeps summary, filters and sort on %s without Board actions",
    (view) => {
      renderToolbar({
        activeView: view,
        canManagePipelines: true,
        createSlot: <button type="button">New deal</button>,
        filterSlot: <button type="button">Filter deals</button>,
        sortSlot: <button type="button">Sort deals</button>,
      });
      expect(screen.queryByRole("link", { name: "Edit pipeline" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Board actions" })).toBeNull();
      expect(screen.getByRole("button", { name: "Filter deals" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Sort deals" })).toBeTruthy();
      expect(screen.getByText("2 deals")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "New deal" }) !== null).toBe(view === "list");
    },
  );
});
