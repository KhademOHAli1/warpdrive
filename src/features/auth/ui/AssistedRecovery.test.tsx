// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { AssistedRecovery } from "./AssistedRecovery";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./workflowRequest", () => ({ workflowRequest: request, mutationSchema: {} }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("offers the same acknowledgement without disclosing whether a Persian account exists", async () => {
  request.mockResolvedValue({ ok: true, data: {} });
  render(
    <LocaleProvider locale="fa">
      <AssistedRecovery />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByLabelText("نشانی ایمیل"), {
    target: { value: "unknown@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "درخواست کمک برای بازیابی" }));
  await waitFor(() =>
    expect(request).toHaveBeenCalledWith(
      "recovery-request",
      expect.anything(),
      expect.any(AbortSignal),
      { email: "unknown@example.com" },
    ),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "اگر بازیابی حساب با این نشانی امکان‌پذیر باشد",
  );
});
