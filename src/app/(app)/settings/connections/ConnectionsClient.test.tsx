// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MockActionResult } from "@/test/actionResult";

const { revoke, refresh } = vi.hoisted(() => ({
  revoke: vi.fn<() => Promise<MockActionResult>>(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/oauth/revokeAction", () => ({ revokeConnectionAction: revoke }));

import { ConnectionsClient } from "./ConnectionsClient";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const connections = [
  { clientId: "c1", clientName: "Claude Desktop", connectedAtIso: null, lastUsedAtIso: null },
];

it("explains the named app's lost access before revoking and can cancel", () => {
  render(<ConnectionsClient connections={connections} />);
  fireEvent.click(screen.getByRole("button", { name: /Revoke/ }));
  const dialog = screen.getByRole("alertdialog", { name: "Revoke Claude Desktop?" });
  expect(dialog).toHaveTextContent("Claude Desktop will lose access to Warpdrive");
  expect(revoke).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
});

it.each(["result", "transport"])(
  "recovers from a %s revoke failure without removing the app",
  async (failure) => {
    let finish: (value: MockActionResult) => void = () => {};
    let reject: (reason: TypeError) => void = () => {};
    revoke.mockImplementationOnce(
      () =>
        new Promise((resolve, fail) => {
          finish = resolve;
          reject = fail;
        }),
    );
    render(<ConnectionsClient connections={connections} />);
    fireEvent.click(screen.getByRole("button", { name: /Revoke/ }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Revoke" }),
    );
    expect(revoke).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: /Revoking/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Revoking/ }));
    expect(revoke).toHaveBeenCalledOnce();
    if (failure === "result") finish({ ok: false, error: { id: "E_PERM_001" } });
    else reject(new TypeError("connection lost"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not revoke");
    await waitFor(() => expect(screen.getByRole("button", { name: /Revoke/ })).toBeEnabled());
    expect(screen.getByText("Claude Desktop")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  },
);

it("links mailbox sync to its actual settings page", () => {
  render(<ConnectionsClient connections={[]} />);
  expect(screen.getByRole("link", { name: "Open Email sync" })).toHaveAttribute(
    "href",
    "/settings/email-sync",
  );
});
