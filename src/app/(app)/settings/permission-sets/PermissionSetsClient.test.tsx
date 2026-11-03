// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import {
  settingsMessagesForLocale,
  settingsPermissionLabel,
} from "@/features/identity/settingsMessages";

type SaveResult = { ok: true; value: true } | { ok: false; error: string };

const { update, refresh } = vi.hoisted(() => ({
  update:
    vi.fn<
      (
        csrf: string,
        input: { setId: string; flags: Record<string, boolean> },
      ) => Promise<SaveResult>
    >(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/identity/actions/permission-sets", () => ({
  createPermissionSetAction: vi.fn(),
  updateFlagsAction: update,
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

import { PermissionSetsClient } from "./PermissionSetsClient";

const sets = [
  { id: "sales", name: "Sales", flags: { "deal.create": true }, isDefault: true },
  { id: "support", name: "Support", flags: { "contact.create": true }, isDefault: false },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

beforeEach(() => {
  update.mockReset().mockResolvedValue({ ok: true, value: true });
  refresh.mockReset();
});

function deferred() {
  let resolve!: (result: SaveResult) => void;
  const promise = new Promise<SaveResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("focused permission-set journey", () => {
  it("shows one selected editor and opens creation only when requested", async () => {
    const user = userEvent.setup();
    render(<PermissionSetsClient sets={sets} />);
    expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Support" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Permission set name" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sales" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Create a permission set" }));
    expect(screen.getByRole("dialog", { name: "Create a permission set" })).toBeInTheDocument();
  });

  it("tracks dirty flags and Cancel restores the last saved values", async () => {
    const user = userEvent.setup();
    render(<PermissionSetsClient sets={sets} />);
    expect(screen.getByRole("button", { name: "Save flags" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Create contacts" }));
    expect(screen.getByRole("button", { name: "Save flags" })).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("checkbox", { name: "Create contacts" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save flags" })).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
  });

  it("can cancel a role switch without losing its unsaved draft", async () => {
    const user = userEvent.setup();
    render(<PermissionSetsClient sets={sets} />);
    await user.click(screen.getByRole("checkbox", { name: "Create contacts" }));
    await user.click(screen.getByRole("button", { name: "Support" }));
    const confirm = screen.getByRole("alertdialog", { name: "Unsaved permission changes" });
    expect(within(confirm).getByRole("button", { name: "Save and switch" })).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Create contacts" })).toBeChecked();
  });

  it("discards only after confirmation and does not submit the discarded changes", async () => {
    const user = userEvent.setup();
    render(<PermissionSetsClient sets={sets} />);
    await user.click(screen.getByRole("checkbox", { name: "Create contacts" }));
    await user.click(screen.getByRole("button", { name: "Support" }));
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByRole("heading", { name: "Support" })).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Sales" }));
    expect(screen.getByRole("checkbox", { name: "Create contacts" })).not.toBeChecked();
  });

  it.each(["returned", "rejected"] as const)(
    "keeps the role and draft on %s Save and switch failure, then switches only after retry ACK",
    async (failure) => {
      const user = userEvent.setup();
      if (failure === "returned")
        update.mockResolvedValueOnce({ ok: false, error: "unauthorized" });
      else update.mockRejectedValueOnce(new Error("private role mutation diagnostic"));
      render(<PermissionSetsClient sets={sets} />);
      const salesHeading = screen.getByRole("heading", { name: "Sales" });
      await user.click(screen.getByRole("checkbox", { name: "Create contacts" }));
      await user.click(screen.getByRole("button", { name: "Support" }));
      await user.click(screen.getByRole("button", { name: "Save and switch" }));
      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(screen.queryByText("private role mutation diagnostic")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "Create contacts" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Create deals" })).toBeChecked();
      expect(screen.getByRole("button", { name: "Save flags" })).toBeEnabled();
      expect(refresh).not.toHaveBeenCalled();
      const retry = deferred();
      update.mockReturnValueOnce(retry.promise);
      await user.click(screen.getByRole("button", { name: "Support" }));
      await user.click(screen.getByRole("button", { name: "Save and switch" }));
      const dialog = screen.getByRole("alertdialog");
      expect(within(dialog).getByRole("button", { name: "Discard changes" })).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
      expect(salesHeading).toBeInTheDocument();
      expect(update).toHaveBeenCalledTimes(2);
      expect(update.mock.calls[1]?.[1]).toEqual(update.mock.calls[0]?.[1]);
      expect(update).toHaveBeenNthCalledWith(2, "csrf", {
        setId: "sales",
        flags: expect.objectContaining({ "deal.create": true, "contact.create": true }),
      });
      await act(async () => {
        retry.resolve({ ok: true, value: true });
        await retry.promise;
      });
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "Support" })).toBeInTheDocument(),
      );
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(screen.getByRole("checkbox", { name: "Create contacts" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Create deals" })).not.toBeChecked();
    },
  );

  it.each(["en", "de", "fa"] as const)(
    "honors Save and switch after an acknowledged save when refresh throws in %s",
    async (locale) => {
      const user = userEvent.setup();
      const L = settingsMessagesForLocale(locale);
      refresh.mockImplementationOnce(() => {
        throw new Error("refresh interrupted");
      });
      render(
        <LocaleProvider locale={locale}>
          <PermissionSetsClient sets={sets} />
        </LocaleProvider>,
      );
      await user.click(
        screen.getByRole("checkbox", { name: settingsPermissionLabel(L, "contact.create") }),
      );
      await user.click(screen.getByRole("button", { name: "Support" }));
      const dialog = screen.getByRole("alertdialog", { name: L._hierarchy.permissionSwitchTitle });
      await user.click(
        within(dialog).getByRole("button", { name: L._hierarchy.permissionSaveAndSwitch }),
      );
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "Support" })).toBeInTheDocument(),
      );
      expect(screen.getByRole("button", { name: "Support" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.getByRole("checkbox", { name: settingsPermissionLabel(L, "contact.create") }),
      ).toBeChecked();
      expect(
        screen.getByRole("checkbox", { name: settingsPermissionLabel(L, "deal.create") }),
      ).not.toBeChecked();
      expect(screen.getByRole("button", { name: L._identity.flagEditor.save })).toBeDisabled();
      expect(update).toHaveBeenCalledExactlyOnceWith("csrf", {
        setId: "sales",
        flags: expect.objectContaining({ "deal.create": true, "contact.create": true }),
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(document.documentElement.dir).toBe(locale === "fa" ? "rtl" : "ltr");
    },
  );

  it.each(["unrefreshed", "throwing"] as const)(
    "keeps acknowledged flags on role re-entry with %s refresh and in the next full-map save",
    async (refreshOutcome) => {
      const user = userEvent.setup();
      if (refreshOutcome === "throwing") {
        refresh.mockImplementation(() => {
          throw new Error("refresh interrupted");
        });
      }
      render(
        <PermissionSetsClient
          sets={[
            {
              id: "sales",
              name: "Sales",
              isDefault: true,
              flags: { "deal.create": true, "deal.edit_own": true, "deal.edit_team": true },
            },
            { id: "support", name: "Support", isDefault: false, flags: { "contact.create": true } },
          ]}
        />,
      );
      await user.click(screen.getByRole("checkbox", { name: "Create contacts" }));
      await user.click(screen.getByRole("button", { name: "Support" }));
      await user.click(screen.getByRole("button", { name: "Save and switch" }));
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "Support" })).toBeInTheDocument(),
      );
      await user.click(screen.getByRole("button", { name: "Sales" }));
      expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "Create contacts" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Edit own deals" })).toBeChecked();
      expect(
        screen.getByRole("checkbox", { name: "Edit deals owned by managed team members" }),
      ).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Edit any deal" })).not.toBeChecked();
      expect(screen.getByRole("button", { name: "Save flags" })).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(update).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("checkbox", { name: "Edit any deal" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("checkbox", { name: "Create contacts" })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Edit any deal" })).not.toBeChecked();
      expect(update).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole("checkbox", { name: "Edit own deals" }));
      await user.click(screen.getByRole("button", { name: "Save flags" }));
      expect(await screen.findByRole("status")).toHaveTextContent("Saved");
      expect(update).toHaveBeenNthCalledWith(2, "csrf", {
        setId: "sales",
        flags: expect.objectContaining({
          "deal.create": true,
          "contact.create": true,
          "deal.edit_own": false,
          "deal.edit_team": true,
          "deal.edit_any": false,
        }),
      });
      expect(update).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it("reconciles genuinely refreshed role props after keeping a local acknowledged baseline", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PermissionSetsClient sets={sets} />);
    await user.click(screen.getByRole("checkbox", { name: "Create contacts" }));
    await user.click(screen.getByRole("button", { name: "Support" }));
    await user.click(screen.getByRole("button", { name: "Save and switch" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Support" })).toBeInTheDocument(),
    );
    rerender(
      <PermissionSetsClient
        sets={[
          {
            id: "sales",
            name: "Sales refreshed",
            isDefault: true,
            flags: { "deal.create": true, "contact.create": false, "deal.edit_own": true },
          },
          { id: "support", name: "Support", isDefault: false, flags: { "contact.create": true } },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Support" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sales refreshed" }));
    expect(screen.getByRole("heading", { name: "Sales refreshed" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Create contacts" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Edit own deals" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Edit deals owned by managed team members" }),
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Save flags" })).toBeDisabled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does not confuse a set named Admin with an administrator account", () => {
    render(
      <PermissionSetsClient
        sets={[
          { id: "admin-set", name: "Admin", flags: { "deal.create": true }, isDefault: false },
        ]}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Create deals" })).toBeEnabled();
    expect(screen.getByText(/flags apply to non-administrator accounts/i)).toBeInTheDocument();
  });

  it("blocks discard and further switching until Save and switch has a result", async () => {
    const user = userEvent.setup();
    let finish: (result: { ok: false; error: string }) => void = vi.fn();
    update.mockReturnValueOnce(
      new Promise<SaveResult>((resolve) => {
        finish = resolve;
      }),
    );
    render(<PermissionSetsClient sets={sets} />);
    await user.click(screen.getByRole("checkbox", { name: "Create contacts" }));
    await user.click(screen.getByRole("button", { name: "Support" }));
    await user.click(screen.getByRole("button", { name: "Save and switch" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Discard changes" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    finish({ ok: false, error: "unauthorized" });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Sales" })).toBeInTheDocument();
  });
});
