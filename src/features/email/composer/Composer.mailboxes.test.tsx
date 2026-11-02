// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  cancelOutboxAction: () => Promise.resolve({ ok: true, value: { id: "attempt" } }),
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
});
for (const locale of ["fa", "de", "en"] as const)
  it(`copies a draft to another sender without remounting or losing its content, BCC or attachment in ${locale}`, async () => {
    const L = composerMailboxMessages(locale);
    const E = emailMessagesForLocale(locale);
    render(
      <LocaleProvider locale={locale}>
        <Composer
          accountId="first"
          fromAddress="first@example.com"
          mailboxes={mailboxes}
          draft={draft}
        />
      </LocaleProvider>,
    );
    const body = screen.getByRole("textbox", { name: E._extra.email_body });
    fireEvent.change(body, { target: { value: "<p>آخرین تغییر / Neuester Stand</p>" } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: L.chooseSender }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: /second@example.com/ }));
    expect(screen.getByRole("dialog")).toHaveAccessibleName(L.copyTitle);
    fireEvent.click(screen.getByRole("button", { name: L.copyConfirm }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: E._extra.email_body })).toBe(body);
    expect(body).toHaveValue("<p>آخرین تغییر / Neuester Stand</p>");
    expect(screen.getByText("پیشنهاد.pdf")).toBeInTheDocument();
    expect(screen.getByText("private@example.com")).toBeInTheDocument();
    const target = save.mock.calls.find((call) => call[1].accountId === "second")?.[1];
    expect(target).toMatchObject({
      accountId: "second",
      threadId: null,
      bodyHtml: "<p>آخرین تغییر / Neuester Stand</p>",
      bccEmails: ["private@example.com"],
      attachments: [{ fileId: "file" }],
      trackOpens: true,
    });
    expect(target?.id).toBeUndefined();
    expect(target?.createId).toMatch(/^[a-f0-9-]{36}$/);
    expect(target?.sendIntentId).not.toBe(draft.sendIntentId);
    expect(save.mock.calls[0]?.[1]).toMatchObject({
      id: "old-draft",
      accountId: "first",
      sendIntentId: draft.sendIntentId,
    });
    expect(send).not.toHaveBeenCalled();
  });
it("keeps a reply tied to its original mailbox", () => {
  const L = composerMailboxMessages("en");
  render(
    <Composer
      accountId="first"
      fromAddress="first@example.com"
      mailboxes={mailboxes}
      threadId="thread"
      draft={{ ...draft, threadId: "thread" }}
    />,
  );
  expect(screen.queryByRole("combobox", { name: L.chooseSender })).not.toBeInTheDocument();
  expect(screen.getByText(L.replyLocked)).toBeInTheDocument();
});
it("restores review state and rechecks the same persisted send intent", async () => {
  const L = composerMailboxMessages("fa");
  render(
    <LocaleProvider locale="fa">
      <Composer
        accountId="first"
        fromAddress="first@example.com"
        mailboxes={mailboxes}
        draft={{
          ...draft,
          sendOutcome: { status: "needs_review", deliveryOutcome: { state: "unknown" } },
        }}
      />
    </LocaleProvider>,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(L.unknownTitle);
  fireEvent.click(screen.getByRole("button", { name: L.checkStatus }));
  await waitFor(() => expect(status).toHaveBeenCalledOnce());
  const input = (status.mock.calls as unknown[][])[0]?.[1] as { idempotencyKey: string };
  expect(input.idempotencyKey).toBe(draft.sendIntentId);
  expect(
    screen.getByRole("textbox", { name: emailMessagesForLocale("fa")._extra.email_body }),
  ).toHaveAttribute("readonly");
  expect(screen.getByText("پیشنهاد.pdf")).toBeInTheDocument();
});

it("returns focus to the sender and preserves the original draft when a copy dialog is cancelled", async () => {
  const L = composerMailboxMessages("de");
  const E = emailMessagesForLocale("de");
  render(
    <LocaleProvider locale="de">
      <Composer
        accountId="first"
        fromAddress="first@example.com"
        mailboxes={mailboxes}
        draft={draft}
      />
    </LocaleProvider>,
  );
  const picker = screen.getByRole("combobox", { name: L.chooseSender });
  const body = screen.getByRole("textbox", { name: E._extra.email_body });
  fireEvent.keyDown(picker, { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: /second@example.com/ }));
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(picker).toHaveFocus();
  expect(body).toHaveValue(draft.bodyHtml);
  expect(save).not.toHaveBeenCalled();
});

it("keeps the original mailbox after a copy failure and retries with the same copy identity", async () => {
  const L = composerMailboxMessages("fa");
  let fail = true;
  save.mockImplementation((_csrf, input) => {
    if (input.accountId === "second" && fail) {
      fail = false;
      return Promise.resolve({ ok: false, error: { id: "E_DB_003" } });
    }
    return Promise.resolve({ ok: true, value: { id: String(input.id ?? input.createId) } });
  });
  render(
    <LocaleProvider locale="fa">
      <Composer
        accountId="first"
        fromAddress="first@example.com"
        mailboxes={mailboxes}
        draft={draft}
      />
    </LocaleProvider>,
  );
  fireEvent.keyDown(screen.getByRole("combobox", { name: L.chooseSender }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: /second@example.com/ }));
  fireEvent.click(screen.getByRole("button", { name: L.copyConfirm }));
  await screen.findByText(L.copyError);
  fireEvent.click(screen.getByRole("button", { name: L.copyConfirm }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const attempts = save.mock.calls.filter((call) => call[1].accountId === "second");
  expect(attempts).toHaveLength(2);
  expect(attempts[0]?.[1].createId).toBe(attempts[1]?.[1].createId);
  expect(attempts[0]?.[1].sendIntentId).toBe(attempts[1]?.[1].sendIntentId);
  expect(screen.getByText("private@example.com")).toBeInTheDocument();
});
