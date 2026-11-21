// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { InventoryCommand, InventoryItem, InventoryResult } from "../contracts";
import { applyInventoryFixture, inventoryFixture } from "../fixtures";
import { InventoryClient } from "./InventoryClient";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

function ProductReleasesPreview({ item }: { item: InventoryItem }) {
  return <div>{item.sku} release preview</div>;
}

test("retries an unconfirmed receipt with its original intent without receiving stock twice", async () => {
  const initial = inventoryFixture(undefined);
  let saved = initial;
  const results = new Map<string, InventoryResult>();
  const submit = vi.fn((command: InventoryCommand): Promise<InventoryResult> => {
    const prior = results.get(command.requestId);
    if (prior !== undefined) return Promise.resolve(prior);
    const result = applyInventoryFixture(saved, command);
    if (result.ok) saved = result.value;
    results.set(command.requestId, result);
    return results.size === 1
      ? Promise.reject(new Error("Connection closed"))
      : Promise.resolve(result);
  });
  render(<InventoryClient initial={initial} submit={submit} />);
  const detail = within(screen.getByRole("region", { name: "Item detail" }));
  const input = detail.getByRole("spinbutton", { name: "Quantity to receive" });
  const receive = detail.getByRole("button", { name: "Receive stock" });

  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.click(receive);
  expect(await screen.findByRole("alert")).toHaveTextContent("could not be confirmed");
  expect(detail.getAllByText("4")).toHaveLength(2);
  fireEvent.click(receive);
  expect(await screen.findByText("Stock received")).toBeVisible();
  expect(detail.getAllByText("7")).toHaveLength(2);
  expect(submit.mock.calls[0]?.[0].requestId).toBe(submit.mock.calls[1]?.[0].requestId);

  fireEvent.change(input, { target: { value: "2" } });
  fireEvent.click(receive);
  expect(await detail.findAllByText("9")).toHaveLength(2);
  expect(submit.mock.calls[2]?.[0].requestId).not.toBe(submit.mock.calls[1]?.[0].requestId);
});

test("shows the Releases panel only on a product with a release adapter", () => {
  const initial = inventoryFixture(undefined);
  const submit = vi.fn(() => Promise.resolve({ ok: true as const, value: initial }));
  const { rerender } = render(<InventoryClient initial={initial} submit={submit} />);
  expect(screen.queryByRole("tab", { name: "Releases" })).not.toBeInTheDocument();

  rerender(
    <InventoryClient
      initial={initial}
      submit={submit}
      ProductReleases={ProductReleasesPreview}
      openReleases
    />,
  );
  expect(screen.getByRole("tab", { name: "Releases", selected: true })).toBeVisible();
  expect(screen.getByText("IO-24-DIN release preview")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /PCB-IO-24/ }));
  expect(screen.queryByRole("tab", { name: "Releases" })).not.toBeInTheDocument();
});
