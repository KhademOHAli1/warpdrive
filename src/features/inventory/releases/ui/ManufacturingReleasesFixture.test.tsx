// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { InventoryItem } from "../../contracts";
import { inventoryFixture } from "../../fixtures";
import {
  ManufacturingReleaseFixtureProvider,
  ManufacturingReleasesFixture,
} from "./ManufacturingReleasesFixture";

afterEach(cleanup);

function inventoryProduct() {
  const product = inventoryFixture(undefined).items.find(({ sku }) => sku === "IO-24-DIN");
  if (product === undefined) throw new Error("Expected a fixture product");
  return product;
}

function releaseTab(item: InventoryItem | null) {
  return (
    <ManufacturingReleaseFixtureProvider>
      {item !== null && <ManufacturingReleasesFixture item={item} />}
    </ManufacturingReleaseFixtureProvider>
  );
}

test("approves a completed draft and opens each build's own release after returning to the tab", () => {
  const product = inventoryProduct();
  const { rerender } = render(releaseTab(product));
  const history = within(screen.getByRole("region", { name: "Release history" }));
  fireEvent.click(history.getByRole("button", { name: "Rev B" }));
  expect(screen.getByText(/Required files still missing.*PCB fabrication/)).toBeVisible();
  const approve = screen.getByRole("button", { name: "Approve release" });
  const input = screen.getByLabelText("Production file");
  const artifactForm = input.closest("form");
  if (artifactForm === null) throw new Error("Expected the production file form");
  expect(approve).toBeDisabled();

  const invalid = new File(["synthetic"], "fabrication.txt", { type: "text/plain" });
  fireEvent.change(input, { target: { files: [invalid] } });
  // JSDOM does not reflect fireEvent's injected FileList in native validity checks.
  fireEvent.submit(artifactForm);
  expect(screen.getByRole("alert")).toHaveTextContent("Use ZIP for PCB fabrication");
  expect(approve).toBeDisabled();

  const valid = new File([Uint8Array.of(80, 75, 3, 4)], "fabrication-B.zip", {
    type: "application/zip",
  });
  fireEvent.change(input, { target: { files: [valid] } });
  fireEvent.submit(artifactForm);
  expect(approve).toBeEnabled();
  fireEvent.click(approve);
  expect(screen.queryByLabelText("Production file")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Preview build" }));

  rerender(releaseTab(null));
  expect(screen.queryByRole("region", { name: "Manufacturing releases" })).not.toBeInTheDocument();
  rerender(releaseTab(product));
  const pins = within(screen.getByRole("region", { name: "Build pins" }));
  expect(pins.getAllByRole("listitem")).toHaveLength(2);
  fireEvent.click(pins.getByRole("button", { name: "Open release for BUILD-001" }));
  const oldPackage = within(screen.getByRole("region", { name: "Release files · Rev A" }));
  expect(
    oldPackage.getByRole("button", { name: /Download IO-24-DIN-A-fabrication/ }),
  ).toBeVisible();
  expect(oldPackage.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();

  fireEvent.click(pins.getByRole("button", { name: "Open release for BUILD-002" }));
  const newPackage = within(screen.getByRole("region", { name: "Release files · Rev B" }));
  expect(newPackage.getByRole("button", { name: "Download fabrication-B.zip" })).toBeVisible();
  expect(newPackage.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
});
