// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { type DateDisplayOptions, formatDateTime } from "@/lib/localeFormatting";
import type * as FormattersModule from "@/lib/useFormatters";
import { MailboxConnectionRow } from "./MailboxConnectionRow";
import { mailboxConnectionMessages, mailboxConnectionTranslator } from "./messages";
import type { MailboxConnectionActions, MailboxConnectionView } from "./types";

const environment = vi.hoisted((): { mode: "server" | "client" | "real" } => ({ mode: "real" }));

vi.mock("@/lib/useFormatters", async (importOriginal) => {
  const actual = await importOriginal<typeof FormattersModule>();
  return {
    ...actual,
    useFormatters() {
      const format = actual.useFormatters();
      return {
        ...format,
        dateTime(value: Date | string | number, options?: DateDisplayOptions) {
          // Exact Bun 1.4.4 / Chromium outputs from the controlled production probe.
          if (environment.mode === "server") return "Nov 3, 2026 at 01:37 PM";
          if (environment.mode === "client") return "Nov 3, 2026, 01:37 PM";
          return format.dateTime(value, options);
        },
      };
    },
  };
});

const lastSyncAtIso = "2026-11-03T13:37:52.202Z";
const mailbox: MailboxConnectionView = {
  id: "owned-mailbox",
  provider: "imap_smtp",
  emailAddress: "owner@example.com",
  status: "connected",
  isDefault: false,
  lastSyncAtIso,
  capabilities: { read: true, send: true, markRead: true, move: false, trash: false },
};

function facade(): MailboxConnectionActions {
  return {
    check: vi.fn().mockResolvedValue({ ok: false, error: "unknown" }),
    save: vi.fn().mockResolvedValue({ ok: false, error: "unknown" }),
    mutate: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
  };
}

afterEach(() => {
  cleanup();
  environment.mode = "real";
});

for (const locale of ["en", "fa", "de"] as const) {
  it(`hydrates a populated timestamp without losing localized text or controls in ${locale}`, async () => {
    const actions = facade();
    const L = mailboxConnectionMessages(locale);
    const t = mailboxConnectionTranslator(locale);
    const view = (
      <LocaleProvider locale={locale} timeZone="UTC">
        <ul>
          <MailboxConnectionRow
            mailbox={mailbox}
            actions={actions}
            gmailAvailable={false}
            onChanged={vi.fn()}
            onNotice={vi.fn()}
          />
        </ul>
      </LocaleProvider>
    );
    const container = document.createElement("div");
    document.body.append(container);
    let root: Root | undefined;
    try {
      environment.mode = locale === "en" ? "server" : "real";
      container.innerHTML = renderToString(view);
      const serverText = container.querySelector("time")?.textContent;
      const recoverableErrors: unknown[] = [];
      environment.mode = locale === "en" ? "client" : "real";
      await act(async () => {
        root = hydrateRoot(container, view, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        });
        await Promise.resolve();
      });
      const localized =
        locale === "en"
          ? "Nov 3, 2026, 01:37 PM"
          : formatDateTime(lastSyncAtIso, {
              locale,
              calendar: locale === "fa" ? "persian" : "gregory",
              timeZone: "UTC",
            });
      await waitFor(() =>
        expect(container.querySelector("time")).toHaveTextContent(
          t("lastSynced", { date: localized }),
        ),
      );
      expect(recoverableErrors).toEqual([]);
      expect(serverText?.trim()).toBeTruthy();
      if (locale === "en") expect(serverText).toBe(t("lastSynced", { date: lastSyncAtIso }));
      expect(container.querySelector("time")).toHaveAttribute("dateTime", lastSyncAtIso);
      fireEvent.click(screen.getByRole("button", { name: L.manage }));
      expect(screen.getByRole("button", { name: L.setDefault })).toBeVisible();
      fireEvent.click(screen.getByRole("button", { name: L.pause }));
      await waitFor(() =>
        expect(actions.mutate).toHaveBeenCalledWith(
          "owned-mailbox",
          "pause",
          expect.any(AbortSignal),
        ),
      );
    } finally {
      await act(async () => {
        root?.unmount();
        await Promise.resolve();
      });
      container.remove();
    }
  });

  it(`keeps the never-synced state and management control through hydration in ${locale}`, async () => {
    const L = mailboxConnectionMessages(locale);
    const view = (
      <LocaleProvider locale={locale} timeZone="UTC">
        <ul>
          <MailboxConnectionRow
            mailbox={{ ...mailbox, lastSyncAtIso: null }}
            actions={facade()}
            gmailAvailable={false}
            onChanged={vi.fn()}
            onNotice={vi.fn()}
          />
        </ul>
      </LocaleProvider>
    );
    const container = document.createElement("div");
    document.body.append(container);
    let root: Root | undefined;
    try {
      environment.mode = "server";
      container.innerHTML = renderToString(view);
      expect(container.querySelector("time")).toBeNull();
      const recoverableErrors: unknown[] = [];
      environment.mode = "client";
      await act(async () => {
        root = hydrateRoot(container, view, {
          onRecoverableError: (error) => recoverableErrors.push(error),
        });
        await Promise.resolve();
      });
      expect(screen.getByText(L.neverSynced)).toBeVisible();
      expect(container.querySelector("time")).toBeNull();
      expect(screen.getByRole("button", { name: L.manage })).toBeEnabled();
      expect(recoverableErrors).toEqual([]);
    } finally {
      await act(async () => {
        root?.unmount();
        await Promise.resolve();
      });
      container.remove();
    }
  });
}
