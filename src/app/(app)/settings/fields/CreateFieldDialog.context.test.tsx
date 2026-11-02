// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CreateFieldDialog } from "./CreateFieldDialog";

const field = vi.hoisted(() => ({
  id: "definition",
  key: "decision_date",
  name: "Decision date",
  type: "date",
  targetEntity: "deal",
  options: [],
  isRequired: false,
}));
const action = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true, value: field })));
vi.mock("@/features/custom-fields/actions", () => ({ createDefAction: action }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
afterEach(() => {
  cleanup();
  action.mockClear();
});

it("explains the definition scope in context, respects the server name limit and returns the created definition", async () => {
  const created = vi.fn();
  render(
    <CreateFieldDialog
      target="deal"
      entityLabel="Deals"
      onCreated={created}
      description="Available on all deals. Each deal keeps its own value."
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add field" }));
  expect(
    screen.getByText("Available on all deals. Each deal keeps its own value."),
  ).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Field name" })).toHaveAttribute("maxlength", "80");
  fireEvent.change(screen.getByRole("textbox", { name: "Field name" }), {
    target: { value: "Decision date" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add field" }));
  await waitFor(() => expect(created).toHaveBeenCalledWith(field));
});
