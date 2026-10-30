// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import Link from "next/link";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./ThreadPane", () => ({
  ThreadPane: ({
    threadId,
    onComposerChange,
  }: {
    threadId: string;
    onComposerChange: (id: string, open: boolean, subject?: string) => void;
  }) => {
    const [open, setOpen] = useState(false);
    return (
      <div data-testid={threadId}>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            onComposerChange(threadId, true, `Subject ${threadId}`);
          }}
        >
          Reply
        </button>
        {open && <textarea aria-label="Reply body" />}
      </div>
    );
  },
}));

import { InboxReaderStack } from "./InboxReaderStack";

afterEach(cleanup);
describe("InboxReaderStack", () => {
  it("starts with an empty reader instead of automatically opening a conversation", () => {
    render(<InboxReaderStack threadId={null} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Choose a conversation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reply" })).not.toBeInTheDocument();
  });
  it("retains an unfinished reply across conversation switches and closing the reader", () => {
    const props = { onClose: vi.fn(), onChanged: vi.fn(), onSelect: vi.fn() };
    const { rerender } = render(<InboxReaderStack {...props} threadId="a" />);
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "My unsent reply" } });
    rerender(<InboxReaderStack {...props} threadId="b" />);
    expect(screen.getByTestId("a").parentElement).toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("button", { name: "Continue reply: Subject a" }));
    expect(props.onSelect).toHaveBeenCalledWith("a");
    expect(screen.getByTestId("a").parentElement).toHaveAttribute("inert");
    rerender(<InboxReaderStack {...props} threadId={null} />);
    rerender(<InboxReaderStack {...props} threadId="a" />);
    expect(within(screen.getByTestId("a")).getByRole("textbox")).toHaveValue("My unsent reply");
  });
  it("blocks leaving an open reply through a profile link", () => {
    render(
      <>
        <Link href="/contacts/people/person">Profile</Link>
        <InboxReaderStack threadId="a" onClose={vi.fn()} onChanged={vi.fn()} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      screen.getByRole("link", { name: "Profile" }).dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
