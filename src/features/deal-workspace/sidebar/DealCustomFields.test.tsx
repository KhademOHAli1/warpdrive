// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DealCustomFields } from "./DealCustomFields";

const definition = vi.hoisted(() => ({
  id: "field",
  key: "renewal_priority",
  name: "Renewal priority",
  type: "text" as const,
  targetEntity: "deal" as const,
  options: [],
  isRequired: false,
  isImportant: false,
  showInAddForm: false,
  order: 0,
  archivedAt: null,
}));
const create = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true, value: definition })));
vi.mock("@/features/custom-fields/actions", () => ({ createDefAction: create }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
afterEach(cleanup);

it("explains the empty field section using the visible creation action", () => {
  render(<DealCustomFields defs={[]} values={{}} currency="USD" canManage onSave={vi.fn()} />);
  expect(screen.getByText("Add a field to track the details your team needs.")).toBeInTheDocument();
});

it("shows an in-flight field save and prevents another edit until it finishes", async () => {
  let finish: (() => void) | undefined;
  const save = vi.fn(
    () =>
      new Promise<{ ok: true; value: undefined }>((resolve) => {
        finish = () => resolve({ ok: true, value: undefined });
      }),
  );
  render(
    <DealCustomFields defs={[definition]} values={{}} currency="USD" canManage onSave={save} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit Renewal priority" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Renewal priority" }), {
    target: { value: "High" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("status")).toHaveTextContent("Saving field…");
  expect(screen.queryByRole("button", { name: "Edit Renewal priority" })).not.toBeInTheDocument();
  await act(async () => {
    finish?.();
    await Promise.resolve();
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("creates a definition in context and immediately opens its value editor, saving only that value", async () => {
  const save = vi.fn(() => Promise.resolve({ ok: true as const, value: undefined }));
  render(
    <DealCustomFields
      defs={[]}
      values={{ existing: "preserve" }}
      currency="USD"
      canManage
      onSave={save}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Add field" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByRole("textbox", { name: "Field name" }), {
    target: { value: "Renewal priority" },
  });
  fireEvent.click(dialog.getByRole("button", { name: "Add field" }));
  await waitFor(
    () => expect(screen.getByRole("textbox", { name: "Renewal priority" })).toBeInTheDocument(),
    { timeout: 1000 },
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Renewal priority" }), {
    target: { value: "High" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ renewal_priority: "High" }));
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ targetEntity: "deal", name: "Renewal priority" }),
    "csrf",
  );
});
