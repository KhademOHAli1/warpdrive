// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STRINGS } from "@/constants/strings";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
type UpdateProfileResult = { ok: true } | { ok: false; error: { id: string } };
const { updateUserProfileAction, refresh } = vi.hoisted(() => ({
  updateUserProfileAction: vi.fn((): Promise<UpdateProfileResult> => Promise.resolve({ ok: true })),
  refresh: vi.fn(),
}));
vi.mock("@/features/identity/profileActions", () => ({ updateUserProfileAction }));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

beforeEach(() => {
  updateUserProfileAction.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
});

// Avatar upload has its own suite; stub it here so these tests don't pull the server-only
// avatar actions (db/minio) into the client render.
vi.mock("@/features/identity/avatar/AvatarUpload", () => ({
  AvatarUpload: () => null,
}));

import { ProfileClient } from "./ProfileClient";

describe("ProfileClient", () => {
  it("saves an edited display name via updateUserProfileAction", async () => {
    render(<ProfileClient name="Jane" email="jane@example.com" avatarUrl={null} />);

    const nameInput = screen.getByLabelText(STRINGS.settings.name);
    fireEvent.change(nameInput, { target: { value: "Real Name" } });
    fireEvent.click(screen.getByRole("button", { name: STRINGS.settings.saveName }));

    await vi.waitFor(() =>
      expect(updateUserProfileAction).toHaveBeenCalledWith({ name: "Real Name" }, "csrf"),
    );
  });

  it("retains the name and shows an error id when the name save fails", async () => {
    updateUserProfileAction.mockResolvedValueOnce({
      ok: false,
      error: { id: "E_USER_002" },
    });
    render(<ProfileClient name="Jane" email="jane@example.com" avatarUrl={null} />);

    fireEvent.change(screen.getByLabelText(STRINGS.settings.name), {
      target: { value: "Changed Name" },
    });
    fireEvent.click(screen.getByRole("button", { name: STRINGS.settings.saveName }));

    await vi.waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("E_USER_002"));
    expect(screen.getByLabelText(STRINGS.settings.name)).toHaveValue("Changed Name");
  });

  it("disables unchanged and blank names, and recognizes the last saved name", async () => {
    render(<ProfileClient name="Jane" email="jane@example.com" avatarUrl={null} />);
    const input = screen.getByLabelText(STRINGS.settings.name);
    const save = screen.getByRole("button", { name: STRINGS.settings.saveName });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: "   " } });
    expect(save).toBeDisabled();
    fireEvent.change(input, { target: { value: "Jane Doe" } });
    fireEvent.click(save);
    expect(await screen.findByRole("status")).toHaveTextContent(STRINGS.settings.saved);
    expect(save).toBeDisabled();
  });

  it("keeps regional and appearance controls out of the identity form", () => {
    render(<ProfileClient name="Jane" email="jane@example.com" avatarUrl={null} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText("jane@example.com")).toBeInTheDocument();
  });

  it.each(["returned", "rejected"] as const)(
    "retries the retained name after a %s failure and waits for acknowledgement",
    async (failure) => {
      if (failure === "returned") {
        updateUserProfileAction.mockResolvedValueOnce({ ok: false, error: { id: "E_USER_002" } });
      } else {
        updateUserProfileAction.mockRejectedValueOnce(new Error("private transport diagnostic"));
      }
      render(<ProfileClient name="Jane" email="jane@example.com" avatarUrl={null} />);
      const input = screen.getByLabelText(STRINGS.settings.name);
      const save = screen.getByRole("button", { name: STRINGS.settings.saveName });
      fireEvent.change(input, { target: { value: "  Jane Doe  " } });
      fireEvent.click(save);
      await screen.findByRole("alert");
      expect(input).toHaveValue("  Jane Doe  ");
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(save).toBeEnabled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.queryByText("private transport diagnostic")).not.toBeInTheDocument();
      expect(refresh).not.toHaveBeenCalled();

      let settle!: (value: UpdateProfileResult) => void;
      const pending = new Promise<UpdateProfileResult>((resolve) => {
        settle = resolve;
      });
      updateUserProfileAction.mockReturnValueOnce(pending);
      fireEvent.click(save);
      expect(save).toBeDisabled();
      expect(input).toHaveValue("  Jane Doe  ");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(updateUserProfileAction).toHaveBeenCalledTimes(2);
      expect(updateUserProfileAction).toHaveBeenNthCalledWith(2, { name: "Jane Doe" }, "csrf");
      expect(refresh).not.toHaveBeenCalled();
      await act(async () => {
        settle({ ok: true });
        await pending;
      });
      expect(screen.getByRole("status")).toHaveTextContent(STRINGS.settings.saved);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(input).toHaveAttribute("aria-invalid", "false");
      expect(save).toBeDisabled();
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(updateUserProfileAction).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["en", "de", "fa"] as const)(
    "keeps the saved name truthful when refresh fails in %s",
    async (locale) => {
      const L = settingsMessagesForLocale(locale);
      refresh.mockImplementationOnce(() => {
        throw new Error("refresh interrupted");
      });
      render(
        <LocaleProvider locale={locale}>
          <ProfileClient name="Jane" email="jane@example.com" avatarUrl={null} />
        </LocaleProvider>,
      );
      const input = screen.getByLabelText(L.name);
      const save = screen.getByRole("button", { name: L.saveName });
      fireEvent.change(input, { target: { value: "Jane Doe" } });
      fireEvent.click(save);
      expect(await screen.findByRole("status")).toHaveTextContent(L.saved);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(input).toHaveAttribute("aria-invalid", "false");
      expect(save).toBeDisabled();
      expect(updateUserProfileAction).toHaveBeenCalledExactlyOnceWith({ name: "Jane Doe" }, "csrf");
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );
});
