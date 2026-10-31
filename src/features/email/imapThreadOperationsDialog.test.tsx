// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { emailMessagesForLocale } from "./emailMessages";

const folders = [
  { path: "INBOX", name: "INBOX", readOnly: false, selected: true },
  { path: "Archiv", name: "Archiv", readOnly: null, selected: false },
];
const list = vi.fn(() => Promise.resolve({ ok: true, value: { folders } }));
const move = vi.fn(() => Promise.resolve({ ok: true, value: { threadId: "thread" } }));
vi.mock("./imapThreadOperationsActions", () => ({
  listThreadMoveFoldersAction: (...args: unknown[]) => list(...(args as [])),
  moveThreadAction: (...args: unknown[]) => move(...(args as [])),
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
const report = vi.fn();
vi.mock("@/components/shell/ActionErrorProvider", () => ({ useActionError: () => report }));

import { ImapThreadMoveDialog } from "./imapThreadOperationsDialog";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => {
  cleanup();
  list.mockClear();
  move.mockClear();
  report.mockClear();
});

it.each(["fa", "de"] as const)(
  "offers a localized accessible folder workflow and submits one frozen target (%s)",
  async (locale) => {
    const E = emailMessagesForLocale(locale).remoteActions;
    const changed = vi.fn();
    render(
      <LocaleProvider locale={locale}>
        <ImapThreadMoveDialog threadId="thread" enabled onMoved={changed} />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: E.move }));
    expect(await screen.findByRole("dialog")).toHaveAttribute(
      "dir",
      locale === "fa" ? "rtl" : "ltr",
    );
    const picker = await screen.findByRole("combobox", { name: E.folder });
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("option", { name: "Archiv" }));
    expect(screen.getByText(E.outsideView)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: E.confirm }));
    await waitFor(() => expect(move).toHaveBeenCalledTimes(1));
    expect(move).toHaveBeenCalledWith("csrf", { threadId: "thread", destinationPath: "Archiv" });
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  },
);

it("disables an unsupported remote move before opening or requesting folders", () => {
  render(<ImapThreadMoveDialog threadId="thread" enabled={false} onMoved={() => {}} />);
  const button = screen.getByRole("button", { name: "Move to folder" });
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(list).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("requires a refresh after an unknown move instead of offering an immediate duplicate submission", async () => {
  const E = emailMessagesForLocale("en").remoteActions;
  move.mockResolvedValueOnce({ ok: false, error: { id: "E_MAIL_008" } } as never);
  const refresh = vi.fn();
  render(<ImapThreadMoveDialog threadId="thread" enabled onMoved={() => {}} onRefresh={refresh} />);
  fireEvent.click(screen.getByRole("button", { name: E.move }));
  const picker = await screen.findByRole("combobox", { name: E.folder });
  fireEvent.keyDown(picker, { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("option", { name: "Archiv" }));
  fireEvent.click(screen.getByRole("button", { name: E.confirm }));
  expect(await screen.findByRole("alert")).toHaveTextContent(E.refreshBeforeRetry);
  expect(screen.queryByRole("button", { name: E.confirm })).toBeNull();
  expect(move).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: E.refresh }));
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});
