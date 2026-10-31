// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { MailboxDraftCopyDialog } from "./MailboxDraftCopyDialog";
import { composerMailboxMessages } from "./mailboxMessages";

afterEach(cleanup);
for (const locale of ["fa", "de", "en"] as const)
  it(`explains draft copy and allows safe cancellation in ${locale}`, () => {
    const L = composerMailboxMessages(locale);
    const cancel = vi.fn();
    const confirm = vi.fn();
    render(
      <LocaleProvider locale={locale}>
        <MailboxDraftCopyDialog
          open
          sourceAddress="original@example.com"
          targetAddress="new@example.com"
          busy={false}
          error={null}
          onCancel={cancel}
          onConfirm={confirm}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("dialog")).toHaveAccessibleName(L.copyTitle);
    expect(screen.getByText(L.copyDescription)).toBeInTheDocument();
    expect(screen.getByText("new@example.com")).toHaveAttribute("dir", "ltr");
    fireEvent.click(screen.getByRole("button", { name: L.cancel }));
    expect(cancel).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: L.copyConfirm }));
    expect(confirm).toHaveBeenCalledOnce();
  });
