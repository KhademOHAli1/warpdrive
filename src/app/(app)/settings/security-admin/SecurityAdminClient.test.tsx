// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ManagementSnapshot } from "@/features/auth/management/contracts";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { SecurityAdminClient } from "./SecurityAdminClient";

const snapshot: ManagementSnapshot = {
  viewerIsAdmin: true,
  users: [],
  permissionSets: [],
  assignees: [],
  total: 0,
  page: 1,
  pageCount: 1,
  policy: { requireMfaForAll: false, idleMinutes: 30, absoluteHours: 168, freshMinutes: 5 },
  deliveries: [],
  audit: [],
  auditPage: 1,
  auditPageCount: 1,
  auditTotal: 0,
  requests: [],
  integrationRevocations: [],
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
test("German administration loads a real workflow form and submits the invitation locale", async () => {
  const fetcher = vi.fn((_url: unknown, options?: RequestInit) =>
    Promise.resolve(Response.json({ ok: true, data: options?.method === "POST" ? {} : snapshot })),
  );
  vi.stubGlobal("fetch", fetcher);
  render(
    <LocaleProvider locale="de">
      <SecurityAdminClient />
    </LocaleProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Person einladen" }));
  expect(await screen.findByRole("dialog", { name: "Person einladen" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Name", { exact: true }), {
    target: { value: "Neue Person" },
  });
  fireEvent.change(screen.getByLabelText("E-Mail-Adresse", { exact: true }), {
    target: { value: "new@example.com" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Einladung senden" }));
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        (call) =>
          call[1]?.method === "POST" &&
          typeof call[1].body === "string" &&
          call[1].body.includes('"locale":"de"'),
      ),
    ).toBe(true),
  );
});
test("Farsi administration keeps addresses left-to-right and explains a fresh-authentication denial in Farsi", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: unknown, options?: RequestInit) =>
      Promise.resolve(
        Response.json(
          options?.method === "POST"
            ? { ok: false, error: "fresh_auth_required" }
            : { ok: true, data: snapshot },
        ),
      ),
    ),
  );
  render(
    <LocaleProvider locale="fa">
      <SecurityAdminClient />
    </LocaleProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "دعوت از همکار" }));
  expect(await screen.findByRole("dialog", { name: "دعوت از همکار" })).toBeTruthy();
  expect(screen.getByLabelText("نشانی ایمیل").getAttribute("dir")).toBe("ltr");
  fireEvent.change(screen.getByLabelText("نام", { exact: true }), {
    target: { value: "همکار تازه" },
  });
  fireEvent.change(screen.getByLabelText("نشانی ایمیل"), { target: { value: "new@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "ارسال دعوت" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("هویت خود را دوباره");
});

test("administration starts with a compact directory and reveals policy editing in a dialog", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ ok: true, data: snapshot }))),
  );
  render(
    <LocaleProvider locale="en">
      <SecurityAdminClient />
    </LocaleProvider>,
  );
  expect(await screen.findByRole("tab", { name: "People" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save policy" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Manage policy" }));
  expect(await screen.findByRole("dialog", { name: "Authentication policy" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save policy" })).toBeTruthy();
});

test.each(["Invite a colleague", "Manage policy"])(
  "closing %s restores keyboard focus to its own trigger",
  async (name) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ ok: true, data: snapshot }))),
    );
    render(
      <LocaleProvider locale="en">
        <SecurityAdminClient />
      </LocaleProvider>,
    );
    const trigger = await screen.findByRole("button", { name });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  },
);

test("closing account details returns focus to the account that opened it", async () => {
  const withUser = {
    ...snapshot,
    total: 1,
    users: [
      {
        id: "00000000-0000-4000-8000-0000000000bb",
        name: "Member",
        email: "member@example.com",
        isAdmin: false,
        isActive: true,
        invitedAt: null,
        permissionSetId: null,
        activeSessions: 0,
        invitation: null,
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({ ok: true, data: withUser }))),
  );
  render(
    <LocaleProvider locale="en">
      <SecurityAdminClient />
    </LocaleProvider>,
  );
  const trigger = await screen.findByRole("button", { name: "Account details: Member" });
  trigger.focus();
  fireEvent.click(trigger);
  await screen.findByRole("dialog", { name: "Member" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(trigger).toHaveFocus());
});
