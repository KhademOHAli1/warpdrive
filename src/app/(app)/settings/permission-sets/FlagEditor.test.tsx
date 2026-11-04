// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PERMISSION_FLAG_KEYS } from "@/constants/permissionFlags";
import { IDENTITY_ERROR_MESSAGES } from "@/constants/settingsIdentity";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import {
  settingsMessagesForLocale,
  settingsPermissionLabel,
} from "@/features/identity/settingsMessages";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

type ResultLike = { ok: true; value: true } | { ok: false; error: string };
const { updateFlagsAction } = vi.hoisted(() => ({
  updateFlagsAction:
    vi.fn<
      (
        csrf: string,
        input: { setId: string; flags: Record<string, boolean> },
      ) => Promise<ResultLike>
    >(),
}));
vi.mock("@/features/identity/actions/permission-sets", () => ({
  createPermissionSetAction: vi.fn(() =>
    Promise.resolve({ ok: true as const, value: { id: "x" } }),
  ),
  updateFlagsAction,
}));
vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

beforeEach(() => {
  updateFlagsAction.mockReset().mockResolvedValue({ ok: true, value: true });
});

import { FlagEditor, type FlagEditorHandle } from "./FlagEditor";

const SET_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function deferred() {
  let resolve!: (result: ResultLike) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ResultLike>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("FlagEditor", () => {
  it("uses readable action and ownership labels instead of exposing permission keys", () => {
    render(<FlagEditor setId={SET_ID} name="Sales" flags={{}} onSaved={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "Create deals" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Edit own deals" })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Edit deals owned by managed team members" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "deal.create" })).not.toBeInTheDocument();
  });

  it("prefills checkboxes from the set's current flags", () => {
    render(
      <FlagEditor
        setId={SET_ID}
        name="Sales"
        flags={{ "deal.create": true, "deal.edit_own": true }}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Create deals" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Edit own deals" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Create contacts" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Edit any deal" })).not.toBeChecked();
  });

  it("submits the updated flags map via updateFlagsAction", async () => {
    render(
      <FlagEditor setId={SET_ID} name="Sales" flags={{ "deal.create": true }} onSaved={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Create contacts" }));
    fireEvent.click(screen.getByRole("button", { name: "Save flags" }));
    await waitFor(() => expect(updateFlagsAction).toHaveBeenCalledTimes(1));
    expect(updateFlagsAction).toHaveBeenCalledWith(
      "csrf",
      expect.objectContaining({
        setId: SET_ID,
        flags: expect.objectContaining({
          "deal.create": true,
          "contact.create": true,
          "deal.edit_any": false,
        }),
      }),
    );
  });

  it("shows an inline error when the update fails", async () => {
    updateFlagsAction.mockResolvedValueOnce({ ok: false as const, error: "unauthorized" });
    render(<FlagEditor setId={SET_ID} name="Sales" flags={{}} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Create contacts" }));
    fireEvent.click(screen.getByRole("button", { name: "Save flags" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(IDENTITY_ERROR_MESSAGES.permission);
  });

  it.each(["returned", "rejected"] as const)(
    "retains independent flags after a %s save failure and retries the same complete map",
    async (failure) => {
      const failed = deferred();
      const onSaved = vi.fn();
      const dirty = vi.fn();
      const pending = vi.fn();
      updateFlagsAction.mockReturnValueOnce(failed.promise);
      render(
        <FlagEditor
          setId={SET_ID}
          name="Sales"
          flags={{ "deal.create": true, "deal.edit_own": true, "deal.edit_team": true }}
          onSaved={onSaved}
          onDirtyChange={dirty}
          onPendingChange={pending}
        />,
      );
      const contact = screen.getByRole("checkbox", { name: "Create contacts" });
      const save = screen.getByRole("button", { name: "Save flags" });
      fireEvent.click(contact);
      fireEvent.click(save);
      expect(contact).toBeChecked();
      expect(contact).toBeDisabled();
      expect(save).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
      expect(updateFlagsAction).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (failure === "returned") failed.resolve({ ok: false, error: "unauthorized" });
        else failed.reject(new Error("private permission mutation diagnostic"));
        await failed.promise.catch(() => undefined);
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        failure === "returned"
          ? IDENTITY_ERROR_MESSAGES.permission
          : settingsMessagesForLocale("en")._errors.generic,
      );
      expect(screen.queryByText("private permission mutation diagnostic")).not.toBeInTheDocument();
      expect(contact).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Edit own deals" })).toBeChecked();
      expect(
        screen.getByRole("checkbox", { name: "Edit deals owned by managed team members" }),
      ).toBeChecked();
      expect(screen.getByRole("checkbox", { name: "Edit any deal" })).not.toBeChecked();
      expect(save).toBeEnabled();
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      expect(dirty).not.toHaveBeenCalledWith(false);
      expect(pending).toHaveBeenLastCalledWith(false);

      const retry = deferred();
      updateFlagsAction.mockReturnValueOnce(retry.promise);
      fireEvent.click(save);
      fireEvent.click(save);
      expect(updateFlagsAction).toHaveBeenCalledTimes(2);
      expect(updateFlagsAction).toHaveBeenNthCalledWith(2, "csrf", {
        setId: SET_ID,
        flags: expect.objectContaining({
          "deal.create": true,
          "deal.edit_own": true,
          "deal.edit_team": true,
          "deal.edit_any": false,
          "contact.create": true,
        }),
      });
      expect(updateFlagsAction.mock.calls[1]?.[1]).toEqual(updateFlagsAction.mock.calls[0]?.[1]);
      expect(Object.keys(updateFlagsAction.mock.calls[1]?.[1].flags ?? {}).sort()).toEqual(
        [...ALL_PERMISSION_FLAG_KEYS].sort(),
      );
      expect(onSaved).not.toHaveBeenCalled();
      await act(async () => {
        retry.resolve({ ok: true, value: true });
        await retry.promise;
      });
      expect(screen.getByRole("status")).toHaveTextContent("Saved");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(onSaved).toHaveBeenCalledWith(updateFlagsAction.mock.calls[1]?.[1].flags);
      expect(dirty).toHaveBeenLastCalledWith(false);
      expect(save).toBeDisabled();
      expect(contact).toBeChecked();
      expect(pending).toHaveBeenLastCalledWith(false);
    },
  );

  it.each(["en", "de", "fa"] as const)(
    "returns acknowledged success without a save error when onSaved throws in %s",
    async (locale) => {
      const L = settingsMessagesForLocale(locale);
      const ref = createRef<FlagEditorHandle>();
      const dirty = vi.fn();
      const pending = vi.fn();
      const onSaved = vi.fn(() => {
        throw new Error("refresh interrupted");
      });
      render(
        <LocaleProvider locale={locale}>
          <FlagEditor
            ref={ref}
            setId={SET_ID}
            name="Sales"
            flags={{ "deal.create": true, "deal.edit_own": true, "deal.edit_team": true }}
            onSaved={onSaved}
            onDirtyChange={dirty}
            onPendingChange={pending}
          />
        </LocaleProvider>,
      );
      const contact = screen.getByRole("checkbox", {
        name: settingsPermissionLabel(L, "contact.create"),
      });
      fireEvent.click(contact);
      let result: boolean | undefined;
      await act(async () => {
        result = await ref.current?.save();
      });
      expect(result).toBe(true);
      expect(screen.getByRole("status")).toHaveTextContent(L.saved);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(contact).toBeChecked();
      expect(
        screen.getByRole("checkbox", { name: settingsPermissionLabel(L, "deal.edit_own") }),
      ).toBeChecked();
      expect(
        screen.getByRole("checkbox", { name: settingsPermissionLabel(L, "deal.edit_team") }),
      ).toBeChecked();
      expect(
        screen.getByRole("checkbox", { name: settingsPermissionLabel(L, "deal.edit_any") }),
      ).not.toBeChecked();
      expect(screen.getByRole("button", { name: L._identity.flagEditor.save })).toBeDisabled();
      expect(screen.getByRole("button", { name: L.cancel })).toBeDisabled();
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(onSaved).toHaveBeenCalledWith(updateFlagsAction.mock.calls[0]?.[1].flags);
      expect(dirty).toHaveBeenLastCalledWith(false);
      expect(pending).toHaveBeenLastCalledWith(false);
      expect(updateFlagsAction).toHaveBeenCalledExactlyOnceWith("csrf", {
        setId: SET_ID,
        flags: expect.objectContaining({
          "deal.create": true,
          "deal.edit_own": true,
          "deal.edit_team": true,
          "deal.edit_any": false,
          "contact.create": true,
        }),
      });
      expect(document.documentElement.dir).toBe(locale === "fa" ? "rtl" : "ltr");
      expect(screen.getByText(L._hierarchy.noPendingChanges)).toBeInTheDocument();
    },
  );

  it("labels its fieldsets with the muted token so Night keeps them readable", () => {
    render(<FlagEditor setId={SET_ID} name="Sales" flags={{}} onSaved={vi.fn()} />);
    const legend = screen.getByText("Global");
    expect(legend).toHaveClass("text-muted-foreground");
    expect(legend.className).not.toMatch(/-gray-/);
  });
});
