// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { InventoryCommand, InventoryResult } from "../contracts";
import { applyInventoryFixture, inventoryFixture } from "../fixtures";
import { InventoryClient } from "./InventoryClient";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(cleanup);

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
