// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type { BomPlan } from "../contracts";
import { BomPlanViews } from "./BomPlanViews";
import { bomMessages } from "./messages";

const cable = {
  id: "cable-part",
  sku: "CABLE-A",
  code: "CABLE",
  name: "Cable",
  revision: "A",
  unit: "mm",
} as const;
const alternate = {
  ...cable,
  id: "alternate-cable",
  sku: "ALT-CABLE-A",
  code: "ALT-CABLE",
  name: "Alternate cable",
};
const plan: BomPlan = {
  release: {
    id: "board-release",
    part: {
      id: "board-part",
      sku: "BOARD-A",
      code: "BOARD",
      name: "Controller",
      revision: "A",
      unit: "each",
    },
    revision: "2",
    checksum: "sealed-checksum",
  },
  quantity: 2,
  subassemblies: [],
  requirements: [
    {
      part: cable,
      releaseId: null,
      required: 500,
      available: 300,
      shortage: 200,
      genericAssemblyAvailable: 0,
      consumable: false,
    },
  ],
  edges: [
    {
      releaseId: "board-release",
      primary: { ...cable, quantity: 250 },
      alternatives: [{ ...alternate, quantity: 250 }],
      chosenItemId: cable.id,
      childReleaseId: null,
      optional: true,
      included: true,
      consumable: false,
      inherited: false,
      enteredQuantity: "0.25",
      enteredUnit: "m",
      piecesPerParent: 3,
      requiredPieces: 6,
    },
  ],
};

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

test("keeps an optional line keyboard-operable and offers only approved material choices", async () => {
  const user = userEvent.setup();
  const change = vi.fn();
  const t = bomMessages.en;
  render(<BomPlanViews plan={plan} hasSite={false} pending={false} change={change} t={t} />);

  const requirements = within(screen.getByRole("region", { name: t.requirements }));
  expect(requirements.getByText("500 mm")).toBeVisible();
  expect(requirements.queryByRole("columnheader", { name: t.available })).not.toBeInTheDocument();
  expect(screen.getByText("6")).toBeVisible();

  const optional = screen.getByRole("checkbox", { name: t.includeOptional });
  await user.tab();
  expect(optional).toHaveFocus();
  await user.keyboard(" ");
  expect(change).toHaveBeenLastCalledWith({
    releaseId: plan.release.id,
    itemId: cable.id,
    include: false,
  });

  fireEvent.click(screen.getByRole("combobox", { name: `${t.approvedComponent} · ${cable.code}` }));
  const options = within(screen.getByRole("listbox"));
  expect(options.getAllByRole("option")).toHaveLength(2);
  fireEvent.click(options.getByRole("option", { name: /ALT-CABLE/ }));
  expect(change).toHaveBeenLastCalledWith({
    releaseId: plan.release.id,
    itemId: cable.id,
    substituteItemId: alternate.id,
  });
});
