// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationType } from "@/constants/notificationTypes";
import { NOTIFICATION_TYPES } from "@/constants/notificationTypes";
import { messagesForLocale } from "@/features/i18n/catalog";

type Preferences = Record<NotificationType, { inApp: boolean; email: boolean }>;
const store = vi.hoisted(() => ({
  data: undefined as Preferences | undefined,
  isError: false,
  refetch: vi.fn(),
  setData: vi.fn(),
  cancel: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      notifications: {
        preferences: { setData: store.setData, invalidate: store.invalidate, cancel: store.cancel },
      },
    }),
    notifications: { preferences: { useQuery: () => store } },
  },
}));
vi.mock("@/features/notifications/actions", () => ({ setPreferenceAction: vi.fn() }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

import { setPreferenceAction } from "@/features/notifications/actions";
import NotificationSettingsPage from "./page";

const labels = messagesForLocale("en").notifications.preferences;
const mentionName = `${labels.typeLabels.mention}: ${labels.columnInApp}`;
const assignmentName = `${labels.typeLabels.activity_assigned}: ${labels.columnEmail}`;

beforeEach(() => {
  store.data = Object.fromEntries(
    NOTIFICATION_TYPES.map((type) => [type, { inApp: false, email: false }]),
  ) as Preferences;
  store.isError = false;
  store.cancel.mockReset().mockResolvedValue(undefined);
  store.refetch.mockReset().mockResolvedValue({});
  store.invalidate.mockReset().mockResolvedValue(undefined);
  store.setData
    .mockReset()
    .mockImplementation(
      (_input, update: (old: Preferences | undefined) => Preferences | undefined) => {
        store.data = update(store.data);
      },
    );
  vi.mocked(setPreferenceAction).mockReset().mockResolvedValue({ ok: true, value: {} });
});
afterEach(cleanup);

function deferred() {
  let resolve: (result: Awaited<ReturnType<typeof setPreferenceAction>>) => void = () => {};
  const promise = new Promise<Awaited<ReturnType<typeof setPreferenceAction>>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("Notification settings", () => {
  it("retains the heading while preferences are loading", () => {
    store.data = undefined;
    render(<NotificationSettingsPage />);
    expect(screen.getByRole("heading", { name: "Notification preferences" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading preferences");
  });

  it("distinguishes a failed initial read from loading and offers retry", async () => {
    store.data = undefined;
    store.isError = true;
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);
    expect(screen.getByRole("heading", { name: "Notification preferences" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(store.refetch).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("locks an in-flight event, preserves the intent, and restores the saved value after rejection", async () => {
    const pending = deferred();
    vi.mocked(setPreferenceAction).mockReturnValueOnce(pending.promise);
    render(<NotificationSettingsPage />);
    const toggle = screen.getByRole("switch", { name: mentionName });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    await waitFor(() => expect(setPreferenceAction).toHaveBeenCalledOnce());
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await act(async () => {
      pending.resolve({ ok: false, error: { id: "E_AUTH_CSRF" } });
      await pending.promise;
    });
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to save");
    await userEvent.click(
      within(screen.getByRole("group", { name: labels.typeLabels.mention })).getByRole("button", {
        name: "Try again",
      }),
    );
    await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
    expect(setPreferenceAction).toHaveBeenLastCalledWith(
      { type: "mention", inApp: true, email: false },
      "csrf",
    );
  });

  it("recovers from rejected transport and leaves unrelated events usable", async () => {
    vi.mocked(setPreferenceAction).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);
    await user.click(screen.getByRole("switch", { name: mentionName }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to save");
    const other = screen.getByRole("switch", { name: assignmentName });
    expect(other).toBeEnabled();
    await user.click(other);
    await waitFor(() => expect(other).toHaveAttribute("aria-checked", "true"));
    expect(screen.getByRole("switch", { name: mentionName })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("cancels an older preference read before writing a new value", async () => {
    let release = () => {};
    const staleRead = new Promise<void>((resolve) => {
      release = resolve;
    });
    store.cancel.mockReturnValueOnce(staleRead);
    render(<NotificationSettingsPage />);
    fireEvent.click(screen.getByRole("switch", { name: mentionName }));
    expect(store.cancel).toHaveBeenCalledOnce();
    expect(setPreferenceAction).not.toHaveBeenCalled();
    await act(async () => {
      release();
      await staleRead;
    });
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: mentionName })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect(setPreferenceAction).toHaveBeenCalledOnce();
  });

  it("keeps concurrent saves for different events without clobbering either result", async () => {
    const mention = deferred();
    const assignment = deferred();
    vi.mocked(setPreferenceAction)
      .mockReturnValueOnce(mention.promise)
      .mockReturnValueOnce(assignment.promise);
    render(<NotificationSettingsPage />);
    fireEvent.click(screen.getByRole("switch", { name: mentionName }));
    fireEvent.click(screen.getByRole("switch", { name: assignmentName }));
    await act(async () => {
      assignment.resolve({ ok: true, value: {} });
      await assignment.promise;
    });
    await act(async () => {
      mention.resolve({ ok: true, value: {} });
      await mention.promise;
    });
    expect(screen.getByRole("switch", { name: mentionName })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("switch", { name: assignmentName })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(store.data?.mention).toEqual({ inApp: true, email: false });
    expect(store.data?.activity_assigned).toEqual({ inApp: false, email: true });
  });
});
