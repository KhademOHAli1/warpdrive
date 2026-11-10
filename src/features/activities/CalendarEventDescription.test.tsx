// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ComponentProps, useRef, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CalendarEventDescription } from "./CalendarEventDescription";
import { calendarEventDraft } from "./calendarEventDraft";
import { isBlankHtml } from "./isBlankHtml";
import { useCalendarDraftGuard } from "./useCalendarDraftGuard";

// Replace only Next's lazy loader. TipTap, sanitization, Calendar's description boundary
// and the real draft guard/confirmation dialog run unchanged in this regression.
const rawEmitted = vi.hoisted(() => vi.fn());
vi.mock("@/features/email/composer/RichTextBodyLazy", async () => {
  const { RichTextBody } = await import("@/features/email/composer/RichTextBody");
  return {
    RichTextBody: (props: ComponentProps<typeof RichTextBody>) => (
      <>
        <RichTextBody
          {...props}
          onChange={(html) => {
            rawEmitted(html);
            props.onChange(html);
          }}
        />
        <button type="button" onClick={() => props.onChange("<p><br></p>")}>
          Emit blank editor update
        </button>
      </>
    ),
  };
});
afterEach(() => {
  cleanup();
  rawEmitted.mockReset();
});

function Draft({
  initialNote,
  onClose,
  observed,
}: {
  initialNote: string;
  onClose: () => void;
  observed: (html: string) => void;
}) {
  const [initial] = useState(() => ({
    ...calendarEventDraft({ date: "2031-02-07", timeZone: "UTC" }),
    note: initialNote,
  }));
  const [draft, setDraft] = useState(initial);
  const fields = useRef<HTMLFieldSetElement>(null);
  const guard = useCalendarDraftGuard({ draft, initial, fields, pending: false, onClose });
  return (
    <LocaleProvider locale="en" timeZone="UTC">
      <fieldset ref={fields}>
        <CalendarEventDescription
          value={draft.note}
          expanded
          onChange={(note) => {
            observed(note);
            setDraft((current) => ({ ...current, note }));
          }}
        />
        <output aria-label="Draft note">{draft.note}</output>
        <button type="button" onClick={guard.requestClose}>
          Close event
        </button>
      </fieldset>
      <ConfirmDialog
        open={guard.open}
        onOpenChange={guard.setOpen}
        title="Discard unsaved changes?"
        description="Unsaved event draft"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={guard.discard}
      />
    </LocaleProvider>
  );
}

it.each(["", "<p></p>", "<p><br></p>"])(
  "does not treat real TipTap blank mount normalization as an unsaved edit: %s",
  async (initialNote) => {
    const onClose = vi.fn();
    const observed = vi.fn();
    render(<Draft initialNote={initialNote} onClose={onClose} observed={observed} />);
    await waitFor(() => expect(rawEmitted).toHaveBeenCalled());
    expect(screen.getByLabelText("Draft note").textContent).toBe(initialNote);
    expect(observed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close event" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  },
);

it.each(["<p>Keep this note</p>", '<p><img src="https://example.invalid/image.png"></p>'])(
  "preserves nonblank initial description content: %s",
  async (initialNote) => {
    const observed = vi.fn();
    render(<Draft initialNote={initialNote} onClose={vi.fn()} observed={observed} />);
    await waitFor(() => expect(observed).toHaveBeenCalled());
    expect(screen.getByLabelText("Draft note").textContent).toContain(
      initialNote.includes("img") ? "<img" : "Keep this note",
    );
  },
);

it("retains a genuine note deletion and requires explicit discard before closing", async () => {
  const onClose = vi.fn();
  const observed = vi.fn();
  render(<Draft initialNote="<p>Original note</p>" onClose={onClose} observed={observed} />);
  await waitFor(() => expect(observed).toHaveBeenCalled());
  observed.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Emit blank editor update" }));
  expect(observed).toHaveBeenCalledWith("<p><br></p>");
  expect(isBlankHtml(screen.getByLabelText("Draft note").textContent ?? "")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Close event" }));
  expect(screen.getByRole("alertdialog")).toHaveTextContent("Discard unsaved changes?");
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(onClose).toHaveBeenCalledOnce();
});
