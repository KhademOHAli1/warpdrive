// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type { QualityStepDraft } from "../../quality/contracts";
import { QualityPlanEditor } from "./QualityPlanEditor";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

test("saves typed tests and retries an unchanged plan with the same request ID", async () => {
  const create = vi.fn<(name: string, steps: QualityStepDraft[], id: string) => Promise<boolean>>();
  create.mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<QualityPlanEditor pending={false} initial={undefined} create={create} />);

  fireEvent.click(screen.getByRole("button", { name: "Create test plan version" }));
  const name = screen.getByRole("textbox", { name: "Plan name" });
  expect(name).toHaveFocus();
  fireEvent.change(name, { target: { value: "Electrical acceptance " } });
  const first = within(screen.getByRole("group", { name: "Test 1" }));
  fireEvent.change(first.getByRole("textbox", { name: "Test name" }), {
    target: { value: "Leakage current" },
  });
  fireEvent.change(first.getByRole("textbox", { name: "Unit" }), { target: { value: "mA" } });
  const minimum = first.getByRole("spinbutton", { name: "Minimum" });
  const maximum = first.getByRole("spinbutton", { name: "Maximum" });
  fireEvent.change(minimum, { target: { value: "0" } });
  fireEvent.change(maximum, { target: { value: "-1" } });
  const save = screen.getByRole("button", { name: "Save new version" });
  expect(save).toBeDisabled();
  expect(minimum).toHaveAttribute("aria-invalid", "true");
  fireEvent.change(maximum, { target: { value: "1.25" } });
  fireEvent.click(first.getByRole("checkbox", { name: "Require evidence file" }));

  fireEvent.click(screen.getByRole("button", { name: "Add test" }));
  const second = within(screen.getByRole("group", { name: "Test 2" }));
  fireEvent.change(second.getByRole("textbox", { name: "Test name" }), {
    target: { value: "Housing sealed" },
  });
  fireEvent.click(second.getByRole("combobox", { name: "Test type" }));
  fireEvent.click(screen.getByRole("option", { name: "Pass/fail check" }));
  expect(second.queryByRole("textbox", { name: "Unit" })).toBeNull();
  fireEvent.click(save);

  expect(create).toHaveBeenCalledWith(
    "Electrical acceptance",
    [
      {
        key: expect.any(String),
        kind: "measurement",
        label: "Leakage current",
        evidenceRequired: true,
        unit: "mA",
        minimum: 0,
        maximum: 1.25,
      },
      { key: expect.any(String), kind: "check", label: "Housing sealed", evidenceRequired: false },
    ],
    expect.any(String),
  );
  fireEvent.click(save);
  expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
  fireEvent.change(maximum, { target: { value: "1.5" } });
  fireEvent.click(save);
  expect(create.mock.calls[2]?.[2]).not.toBe(create.mock.calls[0]?.[2]);
  await waitFor(() => expect(save).not.toBeInTheDocument());
});
