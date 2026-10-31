// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { LoginScreen } from "../LoginScreen";

const { retry } = vi.hoisted(() => ({ retry: vi.fn() }));
vi.mock("./useAccountStatus", () => ({
  useAuthProviders: () => ({ config: null, error: true, retry }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("../better/client", () => ({ authClient: {} }));
afterEach(cleanup);
it("lets German users retry loading sign-in methods after a server failure", () => {
  render(
    <LocaleProvider locale="de">
      <LoginScreen />
    </LocaleProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
  expect(retry).toHaveBeenCalledOnce();
});
