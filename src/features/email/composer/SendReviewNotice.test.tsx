// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { composerMailboxMessages } from "./mailboxMessages";
import { SendReviewNotice } from "./SendReviewNotice";

afterEach(cleanup);
for (const locale of ["fa", "de", "en"] as const) {
  it(`explains partial acceptance and preserves the checking workflow in ${locale}`, () => {
    const L = composerMailboxMessages(locale);
    const onCheck = vi.fn();
    const onDone = vi.fn();
    render(
      <LocaleProvider locale={locale}>
        <SendReviewNotice
          outcome={{
            status: "needs_review",
            messageId: "message",
            deliveryOutcome: {
              state: "partial",
              accepted: ["customer@example.com"],
              rejected: ["refused@example.com"],
            },
          }}
          busy={false}
          onCheck={onCheck}
          onDone={onDone}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(L.partialTitle);
    expect(screen.getByText("customer@example.com")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("refused@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: L.checkStatus }));
    expect(onCheck).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: L.done }));
    expect(onDone).toHaveBeenCalledOnce();
  });
  it(`makes an unknown outcome distinct from rejection in ${locale}`, () => {
    const L = composerMailboxMessages(locale);
    const onKeep = vi.fn();
    render(
      <LocaleProvider locale={locale}>
        <SendReviewNotice
          outcome={{ status: "needs_review", deliveryOutcome: { state: "unknown" } }}
          busy={false}
          onCheck={vi.fn()}
          onDone={vi.fn()}
          onKeepDraft={onKeep}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(L.unknownDescription);
    expect(screen.queryByRole("button", { name: L.done })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: L.closeKeepDraft }));
    expect(onKeep).toHaveBeenCalledOnce();
  });
  it(`shows Sent-copy failure without claiming another message needs sending in ${locale}`, () => {
    const L = composerMailboxMessages(locale);
    render(
      <LocaleProvider locale={locale}>
        <SendReviewNotice
          outcome={{
            status: "sent",
            messageId: "message",
            deliveryOutcome: { state: "accepted" },
            sentCopy: { state: "failed", folderPath: "ارسالی‌ها" },
          }}
          busy={false}
          onCheck={vi.fn()}
          onDone={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(L.sentCopyFailed);
    expect(screen.getByText("ارسالی‌ها")).toBeInTheDocument();
  });
}
