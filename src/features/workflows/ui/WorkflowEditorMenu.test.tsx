// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/Button";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import german from "../messages/workflows.de.json";
import english from "../messages/workflows.en.json";
import persian from "../messages/workflows.fa.json";
import { WorkflowEditorMenu } from "./WorkflowEditorMenu";

afterEach(cleanup);

it.each([
  { locale: "en", messages: english },
  { locale: "de", messages: german },
  { locale: "fa", messages: persian },
] as const)(
  "opens by keyboard, skips disabled actions, and selects once in $locale",
  async ({ locale, messages }) => {
    const user = userEvent.setup();
    const disabled = vi.fn();
    const versions = vi.fn();
    const duplicate = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();
    render(
      <LocaleProvider locale={locale}>
        <WorkflowEditorMenu triggerRef={triggerRef}>
          <Button disabled onClick={disabled}>
            {messages.live}
          </Button>
          <Button onClick={versions}>{messages.versions}</Button>
          <Button onClick={duplicate}>{messages.duplicate}</Button>
        </WorkflowEditorMenu>
      </LocaleProvider>,
    );
    const trigger = screen.getByRole("button", { name: messages.workflowOptions });
    expect(triggerRef.current).toBe(trigger);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    trigger.focus();
    await user.keyboard("{ArrowDown}");

    const versionItem = screen.getByRole("menuitem", { name: messages.versions });
    expect(screen.getByRole("menuitem", { name: messages.live })).toBeDisabled();
    await waitFor(() => expect(versionItem).toHaveFocus());
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: messages.duplicate })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(versionItem).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(versions).toHaveBeenCalledTimes(1);
    expect(disabled).not.toHaveBeenCalled();
    expect(duplicate).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  },
);

it("dismisses with Escape and restores the stable options trigger without selecting", async () => {
  const user = userEvent.setup();
  const choose = vi.fn();
  render(
    <LocaleProvider locale="en">
      <WorkflowEditorMenu>
        <Button onClick={choose}>{english.versions}</Button>
      </WorkflowEditorMenu>
    </LocaleProvider>,
  );
  const trigger = screen.getByRole("button", { name: english.workflowOptions });
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("menuitem", { name: english.versions })).toHaveFocus();
  await user.keyboard("{Escape}");

  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(choose).not.toHaveBeenCalled();
});

it("omits an options trigger when no actions are available", () => {
  render(
    <LocaleProvider locale="en">
      <WorkflowEditorMenu>{null}</WorkflowEditorMenu>
    </LocaleProvider>,
  );
  expect(screen.queryByRole("button", { name: english.workflowOptions })).not.toBeInTheDocument();
});
