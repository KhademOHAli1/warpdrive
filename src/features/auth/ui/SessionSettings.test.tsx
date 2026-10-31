// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { SessionSettings } from "./SessionSettings";

const { action } = vi.hoisted(() => ({ action: vi.fn() }));
vi.mock("./workflowRequest", () => ({ workflowAction: action }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("revokes another device by its public session id and refreshes account state", async () => {
  action.mockResolvedValue({ data: {} });
  const refresh = vi.fn();
  render(
    <LocaleProvider locale="de">
      <SessionSettings
        refresh={refresh}
        sessions={[
          {
            id: "public-id",
            current: false,
            createdAt: "2026-10-31T08:00:00Z",
            lastSeenAt: "2026-10-31T08:30:00Z",
            expiresAt: "2026-11-01T08:00:00Z",
            ipAddress: null,
            userAgent: "Browser",
          },
        ]}
      />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Gerät abmelden" }));
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith(
      { action: "revokeSession", id: "public-id" },
      expect.any(AbortSignal),
    ),
  );
  expect(refresh).toHaveBeenCalledOnce();
});
