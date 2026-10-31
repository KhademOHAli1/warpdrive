// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, test } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);
function Example() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Suspend colleague
      </button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Confirm suspension"
        description="This ends their sessions."
        confirmLabel="Suspend"
        cancelLabel="Keep access"
        onConfirm={() => setOpen(false)}
      />
    </>
  );
}
test("cancelling a controlled confirmation returns focus to the original action", async () => {
  render(
    <LocaleProvider locale="en">
      <Example />
    </LocaleProvider>,
  );
  const trigger = screen.getByRole("button", { name: "Suspend colleague" });
  trigger.focus();
  fireEvent.click(trigger);
  const cancel = await screen.findByRole("button", { name: "Keep access" });
  expect(cancel).toHaveFocus();
  fireEvent.click(cancel);
  await waitFor(() => expect(trigger).toHaveFocus());
});
