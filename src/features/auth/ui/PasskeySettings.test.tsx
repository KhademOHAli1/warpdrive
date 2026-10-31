// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { PasskeySettings } from "./PasskeySettings";

const { updatePasskey } = vi.hoisted(() => ({ updatePasskey: vi.fn() }));
vi.mock("../better/client", () => ({
  authClient: { passkey: { updatePasskey, addPasskey: vi.fn(), deletePasskey: vi.fn() } },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("renames an existing passkey without registering a replacement", async () => {
  updatePasskey.mockResolvedValue({ data: { status: true }, error: null });
  const refresh = vi.fn();
  render(
    <LocaleProvider locale="fa">
      <PasskeySettings
        refresh={refresh}
        passkeys={[
          {
            id: "key-id",
            name: "Old device",
            createdAt: "2026-10-31T08:00:00Z",
            deviceType: "singleDevice",
            backedUp: false,
          },
        ]}
      />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByDisplayValue("Old device"), { target: { value: "دستگاه کاری" } });
  fireEvent.click(screen.getByRole("button", { name: "تغییر نام" }));
  await waitFor(() =>
    expect(updatePasskey).toHaveBeenCalledWith({ id: "key-id", name: "دستگاه کاری" }),
  );
  expect(refresh).toHaveBeenCalledOnce();
});
