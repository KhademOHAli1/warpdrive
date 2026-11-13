// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GlobalAddMenu } from "./GlobalAddMenu";

const { capture, createNote, people, refresh } = vi.hoisted(() => ({
  capture: vi.fn(),
  createNote: vi.fn(),
  people: vi.fn(() => ({
    data: [
      { id: "p1", name: "Ada" },
      { id: "p2", name: "Ada" },
      { id: "p3", name: "Mina" },
    ],
  })),
  refresh: vi.fn(),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    pipeline: { list: { useQuery: () => ({ data: [] }) } },
    contacts: { personOptions: { useQuery: people } },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/observability/capture", () => ({ capture, currentRoute: () => "/contacts" }));
vi.mock("@/features/collaboration/actions", () => ({ createNoteAction: createNote }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/deals/AddDealModal", () => ({ AddDealModal: () => null }));
vi.mock("@/features/leads/AddLeadModal", () => ({ AddLeadModal: () => null }));
vi.mock("@/features/activities/AddActivityModal", () => ({ AddActivityModal: () => null }));
vi.mock("./GlobalContactModal", () => ({ GlobalContactModal: () => null }));

let popoverStyle: HTMLStyleElement;
beforeEach(() => {
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  // jsdom's popover stylesheet keeps these elements hidden without a native top layer.
  popoverStyle = document.createElement("style");
  popoverStyle.textContent = "[popover] { display: block !important }";
  document.head.append(popoverStyle);
});

it("presses Enter on the current result immediately after changing the person search", async () => {
  const user = userEvent.setup();
  render(<GlobalAddMenu />);
  await user.click(screen.getByRole("button", { name: "Quick add" }));
  await user.click(screen.getByRole("menuitem", { name: /Note/ }));
  const dialog = await screen.findByRole("dialog", { name: "New note" });
  const picker = within(dialog).getByRole("button", { name: "Note target person" });
  await user.click(picker);
  const search = screen.getByRole("combobox", { name: "Search..." });

  fireEvent.change(search, { target: { value: "Ada" } });
  fireEvent.change(search, { target: { value: "Mina" } });
  expect(screen.getByRole("option", { name: "Mina" })).toBeVisible();
  fireEvent.keyDown(search, { key: "Enter" });
  expect(picker).toHaveTextContent("Mina");

  await user.click(picker);
  expect(screen.getByRole("combobox", { name: "Search..." })).toHaveValue("");
  await user.keyboard("{Escape}");
  expect(dialog).toBeVisible();
  expect(picker).toHaveTextContent("Mina");
  expect(createNote).not.toHaveBeenCalled();
});
afterEach(() => {
  cleanup();
  popoverStyle.remove();
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  vi.clearAllMocks();
});

it("starts the picker after Quick Add closes and writes to the chosen same-name person", async () => {
  const user = userEvent.setup();
  createNote.mockResolvedValueOnce({ ok: true });
  render(
    <StrictMode>
      <GlobalAddMenu />
    </StrictMode>,
  );
  expect(people).not.toHaveBeenCalled();
  const quickAdd = screen.getByRole("button", { name: "Quick add" });
  await user.click(quickAdd);
  await user.click(screen.getByRole("menuitem", { name: /Note/ }));
  const dialog = await screen.findByRole("dialog", { name: "New note" }, { timeout: 1500 });
  const picker = within(dialog).getByRole("button", { name: "Note target person" });
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  await user.click(picker);
  const search = await screen.findByRole("combobox", { name: "Search..." }, { timeout: 1500 });
  await user.type(search, "Ada");
  const options = screen.getAllByRole("option", { name: "Ada" });
  expect(options).toHaveLength(2);
  expect(options[0]?.id).not.toEqual(options[1]?.id);
  await user.click(options[1] as HTMLElement);
  const note = within(dialog).getByRole("textbox", { name: /Note/ });
  await waitFor(() => expect(note).toHaveFocus(), { timeout: 1500 });
  await user.type(note, "A note");
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(dialog).not.toBeInTheDocument(), { timeout: 1500 });
  await waitFor(() => expect(quickAdd).toHaveFocus(), { timeout: 1500 });
  expect(createNote).toHaveBeenCalledExactlyOnceWith(
    { entityType: "person", entityId: "p2", body: "A note", pinned: false },
    "csrf",
  );
  expect(refresh).toHaveBeenCalledOnce();
  expect(capture.mock.calls).toEqual([
    ["modal_opened", { route: "/contacts" }],
    ["modal_closed", { route: "/contacts", reason: "programmatic" }],
  ]);
});
