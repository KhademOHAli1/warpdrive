// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { MailboxConnectionView } from "../connections/types";
import { emailMessagesForLocale } from "../emailMessages";

const save =
  vi.fn<
    (
      csrf: unknown,
      input: Record<string, unknown>,
    ) => Promise<{ ok: true; value: { id: string } } | { ok: false; error: { id: string } }>
  >();
const send = vi.fn(() =>
  Promise.resolve({
    ok: true,
    value: { status: "needs_review", deliveryOutcome: { state: "unknown" } },
  }),
);
const cancel = vi.fn(() => Promise.resolve({ ok: true, value: { id: "attempt" } }));
const status = vi.fn(() =>
  Promise.resolve({
    ok: true,
    value: { status: "needs_review", deliveryOutcome: { state: "unknown" } },
  }),
);
vi.mock("../sendStatusAction", () => ({
  getSendStatusAction: (...args: unknown[]) => status(...(args as [])),
}));
vi.mock("../folderActions", () => ({
  saveDraftAction: (csrf: unknown, input: Record<string, unknown>) => save(csrf, input),
  deleteDraftAction: () => Promise.resolve({ ok: true, value: { id: "old-draft" } }),
  cancelOutboxAction: (...args: unknown[]) => cancel(...(args as [])),
}));
vi.mock("../actions", () => ({ sendEmail: (...args: unknown[]) => send(...(args as [])) }));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/features/activities/actions", () => ({
  createActivityAction: () => Promise.resolve({ ok: true, value: { id: "activity" } }),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    email: { signatures: { list: { useQuery: () => ({ data: [] }) } } },
    activities: { listTypes: { useQuery: () => ({ data: [] }) } },
    contacts: { listPeople: { useQuery: () => ({ data: { rows: [], total: 0 } }) } },
  },
}));
vi.mock("./InsertToolbar", () => ({ InsertToolbar: () => null }));
vi.mock("./RichTextBodyLazy", () => ({
  RichTextBody: ({
    html,
    onChange,
    ariaLabel,
    readOnly,
  }: {
    html: string;
    onChange: (value: string) => void;
    ariaLabel: string;
    readOnly?: boolean;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={html}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

import { Composer } from "./Composer";
import { composerMailboxMessages } from "./mailboxMessages";

const mailboxes: MailboxConnectionView[] = ["first", "second"].map((id) => ({
  id,
  emailAddress: `${id}@example.com`,
  provider: "imap_smtp",
  status: "connected",
  isDefault: id === "first",
  lastSyncAtIso: null,
  capabilities: { read: true, send: true, markRead: true, move: true, trash: true },
}));
const draft = {
  id: "old-draft",
  accountId: "first",
  subject: "پیشنهاد همکاری",
  bodyHtml: "<p>سلام، Grüße aus Berlin</p>",
  to: ["customer@example.com"],
  cc: ["copy@example.com"],
  bcc: ["private@example.com"],
  attachments: [{ fileId: "file", filename: "پیشنهاد.pdf", size: 10 }],
  sendIntentId: "9d65da88-eae5-4f81-a674-d3f52fcb03d9",
  trackOpens: true,
  trackLinks: false,
};
afterEach(cleanup);
beforeEach(() => {
  save.mockReset();
  save.mockImplementation((_csrf, input) =>
    Promise.resolve({ ok: true, value: { id: String(input.id ?? input.createId) } }),
  );
  send.mockClear();
  status.mockClear();
  cancel.mockClear();
});
for (const locale of ["fa", "de", "en"] as const)
  it(`requires cancellation before editing and creates a new intent in ${locale}`, async () => {
    const L = composerMailboxMessages(locale);
    const E = emailMessagesForLocale(locale);
    render(
      <LocaleProvider locale={locale}>
        <Composer
          accountId="first"
          fromAddress="first@example.com"
          mailboxes={mailboxes}
          draft={{
            ...draft,
            sendOutcome: {
              status: "failed",
              attemptId: "attempt",
              deliveryOutcome: { state: "rejected" },
            },
          }}
        />
      </LocaleProvider>,
    );
    const body = screen.getByRole("textbox", { name: E._extra.email_body });
    expect(body).toHaveAttribute("readonly");
    fireEvent.click(screen.getByRole("button", { name: L.editDraft }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveAccessibleName(L.editTitle);
    fireEvent.click(within(dialog).getByRole("button", { name: L.editDraft }));
    await waitFor(() => expect(body).not.toHaveAttribute("readonly"));
    expect(cancel).toHaveBeenCalledWith("csrf", { attemptId: "attempt" });
    expect(body).toHaveValue(draft.bodyHtml);
    fireEvent.change(body, { target: { value: "<p>اصلاح پیام / Korrigierte Nachricht</p>" } });
    fireEvent.click(screen.getByRole("button", { name: E.send }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    const input = (send.mock.calls as unknown[][])[0]?.[1] as {
      idempotencyKey: string;
      bodyHtml: string;
    };
    expect(input.idempotencyKey).not.toBe(draft.sendIntentId);
    expect(input.bodyHtml).toContain("Korrigierte Nachricht");
    expect(save.mock.calls.at(-1)?.[1]).toMatchObject({
      id: "old-draft",
      sendIntentId: input.idempotencyKey,
    });
  });
