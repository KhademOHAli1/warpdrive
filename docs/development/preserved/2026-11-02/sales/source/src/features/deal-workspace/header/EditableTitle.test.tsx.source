// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const updateDealAction = vi.hoisted(() => vi.fn());
vi.mock("@/features/deals/updateAction", () => ({ updateDealAction }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import {
  dealClientFixture,
  FIRST_DEAL_VERSION,
  SECOND_DEAL_VERSION,
} from "@/features/deals/dealClientFixture";
import { EditableTitle } from "./EditableTitle";

beforeEach(() => {
  updateDealAction.mockResolvedValue({
    ok: true,
    deal: dealClientFixture({ id: "d1", writeVersion: SECOND_DEAL_VERSION }),
  });
});

afterEach(() => {
  cleanup();
  updateDealAction.mockClear();
});

const props = { dealId: "d1", title: "Acme", expectedWriteVersion: FIRST_DEAL_VERSION };

it("saves a changed title via the shared inline-edit footer", () => {
  render(<EditableTitle {...props} />);
  expect(screen.getByRole("heading", { name: "Acme" })).toHaveClass("text-display");
  fireEvent.click(screen.getByRole("button", { name: "Edit deal title" }));
  const input = screen.getByRole("textbox", { name: "Edit deal title" });
  fireEvent.change(input, { target: { value: "Acme Corp" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(updateDealAction).toHaveBeenCalledWith(
    { dealId: "d1", expectedWriteVersion: props.expectedWriteVersion, title: "Acme Corp" },
    "csrf",
  );
});

it("does not call the action for an unchanged or empty title", () => {
  render(<EditableTitle {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit deal title" }));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit deal title" }));
  const input2 = screen.getByRole("textbox", { name: "Edit deal title" });
  fireEvent.change(input2, { target: { value: "   " } });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(updateDealAction).not.toHaveBeenCalled();
});

it("reverts through the shared Cancel action without calling the mutation", () => {
  render(<EditableTitle {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit deal title" }));
  const input = screen.getByRole("textbox", { name: "Edit deal title" });
  fireEvent.change(input, { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(updateDealAction).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Acme" })).toBeInTheDocument();
});

it("keeps an open draft bound to its original snapshot through a props refresh and conflict", async () => {
  updateDealAction.mockResolvedValue({ ok: false, error: { id: "E_DEAL_002" } });
  const { rerender } = render(<EditableTitle {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit deal title" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Edit deal title" }), {
    target: { value: "My retained draft" },
  });
  rerender(
    <EditableTitle
      {...props}
      title="Another actor's title"
      expectedWriteVersion={SECOND_DEAL_VERSION}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/Your draft is kept/);
  expect(updateDealAction).toHaveBeenLastCalledWith(
    { dealId: "d1", expectedWriteVersion: FIRST_DEAL_VERSION, title: "My retained draft" },
    "csrf",
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit deal title" }));
  expect(screen.getByRole("textbox", { name: "Edit deal title" })).toHaveValue("My retained draft");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(updateDealAction).toHaveBeenLastCalledWith(
    { dealId: "d1", expectedWriteVersion: FIRST_DEAL_VERSION, title: "My retained draft" },
    "csrf",
  );
});
