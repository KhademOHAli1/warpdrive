// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

it("offers an optional action that can save without dismissing the confirmation first", async () => {
  const user = userEvent.setup();
  const save = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Unsaved changes"
      description="Save your edits or discard them before switching."
      confirmLabel="Discard"
      onConfirm={vi.fn()}
      onOpenChange={onOpenChange}
      secondaryAction={{ label: "Save and switch", onClick: save }}
    />,
  );
  await user.click(screen.getByRole("button", { name: "Save and switch" }));
  expect(save).toHaveBeenCalledTimes(1);
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
});

it("locks the optional action, confirm and cancel together while a save is pending", () => {
  render(
    <ConfirmDialog
      open
      pending
      title="Unsaved changes"
      description="Wait for the save result."
      confirmLabel="Discard"
      onConfirm={vi.fn()}
      onOpenChange={vi.fn()}
      secondaryAction={{ label: "Save and switch", onClick: vi.fn() }}
    />,
  );
  expect(screen.getByRole("button", { name: "Save and switch" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
});

it("keeps the original two-action confirmation when the optional action is omitted", () => {
  render(
    <ConfirmDialog
      open
      title="Delete team"
      description="Remove this team?"
      confirmLabel="Delete"
      onConfirm={vi.fn()}
      onOpenChange={vi.fn()}
    />,
  );
  expect(screen.getAllByRole("button")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Delete" })).toBeEnabled();
});
