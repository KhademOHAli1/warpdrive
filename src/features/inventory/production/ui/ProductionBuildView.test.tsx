// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { subcontractMessages } from "../../subcontract/ui/messages";
import type {
  ProductionDetail,
  ProductionMaterial,
  ProductionWorkspace,
  SubcontractView,
} from "../contracts";
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
  subcontractOptions: null,
  subcontract: null,
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

const subcontractText = subcontractMessages.en;
const companyMaterial: ProductionMaterial = {
  id: "board-material",
  part: { ...part, code: "PCB" },
  releaseId: null,
  perUnit: 1,
  demand: 4,
  allocated: 4,
  consumed: 0,
  consumable: false,
  positions: [],
  allocations: [
    {
      quantity: 3,
      position: {
        id: "copper",
        location: "W01",
        lot: "CU-001",
        serial: null,
        free: 0,
        buildOutputId: null,
      },
    },
    {
      quantity: 1,
      position: {
        id: "serial",
        location: "W02",
        lot: "CU-002",
        serial: "PART-009",
        free: 0,
        buildOutputId: null,
      },
    },
  ],
};
const subcontract: SubcontractView = {
  orderId: "purchase",
  reference: "PO-27",
  orderStatus: "partial",
  supplierBin: "Partner dock",
  companyMaterialIds: [companyMaterial.id],
  custody: [],
  outputs: [{ outputId: "wip-batch", receiptLineId: "receipt-row" }],
  canDispatch: true,
  canReturn: true,
  canRelease: true,
};

test("keeps a held supplier receipt on the subcontract release path", () => {
  const open = vi.fn();
  const linkedBuild = { ...build, materials: [companyMaterial], subcontract };
  const { rerender } = render(
    <ProductionBuildView build={linkedBuild} {...{ open, t }} busy={false} />,
  );
  const batches = within(screen.getByRole("region", { name: t.batches }));
  expect(batches.queryByRole("button", { name: t.startBatch })).not.toBeInTheDocument();
  expect(batches.queryByRole("button", { name: t.completeBatch })).not.toBeInTheDocument();
  expect(batches.getByText(subcontractText.pendingRelease)).toBeVisible();
  expect(screen.getByRole("link", { name: "PO-27" })).toHaveAttribute(
    "href",
    "/inventory/purchase-orders?siteId=west&orderId=purchase",
  );
  fireEvent.click(batches.getByRole("button", { name: subcontractText.releaseSubcontractOutput }));
  expect(open).toHaveBeenCalledWith(expect.anything(), {
    type: "releaseSubcontractOutput",
    build: linkedBuild,
    output: linkedBuild.outputs[0],
  });
  rerender(
    <ProductionBuildView
      build={{
        ...linkedBuild,
        subcontract: { ...subcontract, orderId: null, reference: null, canRelease: false },
      }}
      {...{ open, t }}
      busy={false}
    />,
  );
  expect(
    batches.queryByRole("button", { name: subcontractText.releaseSubcontractOutput }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "PO-27" })).not.toBeInTheDocument();
});

test("dispatches the selected quantity from its exact allocation", () => {
  const save = vi.fn();
  const linkedBuild = { ...build, subcontract, materials: [companyMaterial] };
  render(
    <ProductionEditors
      workspace={workspace}
      editor={{ type: "dispatchSubcontract", build: linkedBuild, link: subcontract }}
      t={t}
      dialog={{
        pending: false,
        blocked: false,
        error: null,
        close: vi.fn(),
        restoreFocus: vi.fn(),
        save,
      }}
    />,
  );
  const dialog = within(screen.getByRole("dialog", { name: subcontractText.dispatchSubcontract }));
  const [lot, serial] = dialog.getAllByRole("textbox", { name: t.allocationQuantity });
  if (lot === undefined || serial === undefined) throw new Error("Expected both allocation rows");
  fireEvent.change(lot, { target: { value: "2" } });
  fireEvent.change(serial, { target: { value: "" } });
  fireEvent.change(dialog.getByRole("textbox", { name: t.reason }), {
    target: { value: "Supplier shipment" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Save" }));
  expect(save).toHaveBeenCalledWith({
    type: "dispatchSubcontract",
    buildId: build.id,
    version: build.version,
    reason: "Supplier shipment",
    allocations: [{ materialId: companyMaterial.id, positionId: "copper", quantity: 2 }],
  });
});
