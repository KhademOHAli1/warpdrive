// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type { ProductionDetail, ProductionWorkspace } from "../contracts";
import { productionMessages } from "./messages";
import { ProductionBuildView } from "./ProductionBuildView";
import { ProductionEditors } from "./ProductionEditors";
import { ProductionList } from "./ProductionList";

const t = productionMessages.en;
const part = {
  id: "controller",
  code: "CTRL",
  sku: "CTRL-A",
  name: "Controller",
  revision: "A",
  unit: "each",
} as const;
const build: ProductionDetail = {
  id: "build",
  version: 4,
  siteId: "west",
  site: "West",
  location: "W01",
  release: { id: "release", revision: "2", part, checksum: null },
  parentId: null,
  quantity: 4,
  completed: 0,
  scrapped: 0,
  status: "issued",
  priority: "normal",
  dueDate: "2026-12-01",
  createdAt: "2026-11-21T19:00:00Z",
  trackable: true,
  canManage: true,
  project: null,
  children: [],
  materials: [],
  history: [],
  outputs: [
    {
      id: "wip-batch",
      quantity: 1,
      lot: null,
      serials: [],
      status: "wip",
      reason: null,
      createdAt: "2026-11-21T19:00:00Z",
      inputs: [],
    },
  ],
};
const workspace: ProductionWorkspace = {
  detail: build,
  builds: [build],
  releases: [{ ...build.release, templateAvailable: false }],
  sites: [{ id: build.siteId, name: build.site, code: "WST", canManage: true, locations: [] }],
};

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

test("changes the site filter and marks the selected build", () => {
  const selectSite = vi.fn();
  const props = { workspace, scope: { buildId: build.id }, selectSite, t };
  const { rerender } = render(<ProductionList {...props} busy={false} />);
  const selected = screen.getByRole("link", { name: /Controller/ });
  expect(selected).toHaveAttribute("aria-current", "page");
  expect(selected).toHaveAttribute("href", "/inventory/production?buildId=build");

  fireEvent.click(screen.getByRole("combobox", { name: t.site }));
  fireEvent.click(screen.getByRole("option", { name: /WST.*West/ }));
  expect(selectSite).toHaveBeenCalledWith("west");

  rerender(<ProductionList {...props} scope={{ siteId: "west", buildId: "build" }} busy />);
  expect(screen.getByRole("combobox", { name: t.site })).toBeDisabled();
  expect(selected).toHaveAttribute("href", "/inventory/production?siteId=west&buildId=build");
});

test("keeps WIP actions scoped to the build status and current manager", () => {
  const open = vi.fn();
  const { rerender } = render(<ProductionBuildView {...{ build, open, t }} busy={false} />);
  const batches = within(screen.getByRole("region", { name: t.batches }));
  fireEvent.click(batches.getByRole("button", { name: t.completeBatch }));
  expect(open).toHaveBeenCalledWith(expect.anything(), {
    type: "completeBatch",
    build,
    output: build.outputs[0],
  });

  rerender(<ProductionBuildView {...{ build, open, t }} busy />);
  expect(batches.getByRole("button", { name: t.completeBatch })).toBeDisabled();
  expect(batches.getByRole("button", { name: t.startBatch })).toBeDisabled();

  rerender(
    <ProductionBuildView {...{ open, t }} build={{ ...build, canManage: false }} busy={false} />,
  );
  expect(batches.queryByRole("button")).not.toBeInTheDocument();
  expect(batches.getByText(t.wip)).toBeVisible();
});

test("prevents a stale editor from submitting", () => {
  const save = vi.fn();
  render(
    <ProductionEditors
      workspace={workspace}
      editor={{ type: "hold", build }}
      t={t}
      dialog={{
        pending: false,
        blocked: true,
        error: t.stale,
        close: vi.fn(),
        restoreFocus: vi.fn(),
        save,
      }}
    />,
  );
  const dialog = within(screen.getByRole("dialog", { name: t.hold }));
  fireEvent.change(dialog.getByRole("textbox", { name: t.reason }), {
    target: { value: "Check upstream stock" },
  });
  const submit = dialog.getByRole("button", { name: "Save" });
  expect(submit).toBeDisabled();
  expect(dialog.getByRole("alert")).toHaveTextContent(t.stale);
  fireEvent.click(submit);
  expect(save).not.toHaveBeenCalled();
});
