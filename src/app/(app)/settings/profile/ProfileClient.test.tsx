// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { STRINGS } from "@/constants/strings";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
type UpdateProfileResult = { ok: true } | { ok: false; error: { id: string } };
const { updateUserProfileAction } = vi.hoisted(() => ({
  updateUserProfileAction: vi.fn((): Promise<UpdateProfileResult> => Promise.resolve({ ok: true })),
}));
vi.mock("@/features/identity/profileActions", () => ({ updateUserProfileAction }));

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
});
