// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { CampaignEditor } from "./CampaignEditor";
import { type Campaign, campaign } from "./model";

const { push, read, write } = vi.hoisted(() => ({
  push: vi.fn(),
  read: vi.fn<(operation: string) => unknown>(),
  write: vi.fn<(operation: string, input: unknown) => Promise<void>>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/components/shell/WorkspaceShellProvider", () => ({
  useWorkspaceShell: () => ({ campaignCapabilities: { edit: false, operate: true, send: true } }),
}));
vi.mock("@/features/newsletter/ui/client", async () => {
  const { useState } = await import("react");
  return {
    useNewsletterRead: (operation: string) => ({ data: read(operation), isLoading: false }),
    useNewsletterWrite: () => {
      const [isPending, setPending] = useState(false);
      return {
        isPending,
        async run(operation: string, input: unknown) {
          setPending(true);
          try {
            await write(operation, input);
          } finally {
            setPending(false);
          }
        },
      };
    },
  };
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderCampaign(status: Campaign["status"] = "draft", locale: "en" | "de" = "en") {
  const item = campaign.parse({
    id: 42,
    name: "Monthly update",
    subject: "The latest news",
    type: "regular",
    status,
    body: "News for subscribers",
    content_type: "plain",
    from_email: "sender@example.invalid",
    messenger: "email",
    lists: [{ id: 1, name: "Subscribers" }],
    media: [],
    send_at: null,
    template_id: null,
    tags: [],
    headers: [],
    attribs: null,
    archive: false,
    archive_slug: null,
    archive_template_id: null,
    archive_meta: null,
    sent: 0,
    to_send: 0,
    views: 0,
    clicks: 0,
    bounces: 0,
    updated_at: "2026-11-13T08:00:00Z",
  });
  const results: Record<string, unknown> = {
    "campaigns.detail": item,
    "campaigns.config": { from_email: item.from_email, messengers: ["email"] },
    "lists.minimal": item.lists,
    "system.status": { deliveryEnabled: true },
  };
  read.mockImplementation((operation) => results[operation]);
  render(
    <LocaleProvider locale={locale}>
      <CampaignEditor campaignId={item.id} />
    </LocaleProvider>,
  );
  return userEvent.setup();
}

it("dismisses delete without a write, restores focus, and confirms delete once", async () => {
  const user = renderCampaign();
  const pending = Promise.withResolvers<void>();
  write.mockReturnValue(pending.promise);
  const trigger = screen.getByRole("button", { name: "Delete", exact: true });
  await user.click(trigger);
  let dialog = screen.getByRole("alertdialog", { name: "Delete this item?" });
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  expect(dialog).toHaveAccessibleDescription("This item will be permanently removed.");
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  expect(cancel).toHaveFocus();
  await user.click(cancel);
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(write).toHaveBeenCalledTimes(0);

  await user.keyboard("{Enter}");
  dialog = screen.getByRole("alertdialog", { name: "Delete this item?" });
  const confirm = within(dialog).getByRole("button", { name: "Delete" });
  expect(confirm).toHaveClass("bg-destructive");
  await user.dblClick(confirm);
  expect(write.mock.calls).toEqual([["campaigns.delete", { id: 42, confirmed: true }]]);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(trigger).toBeDisabled();
  expect(push).toHaveBeenCalledTimes(0);
  await act(() => pending.resolve());
  expect(push.mock.calls).toEqual([["/campaigns"]]);
});

it("switches from dismissed delete to test delivery and sends the selected recipients once", async () => {
  const user = renderCampaign();
  const pending = Promise.withResolvers<void>();
  write.mockReturnValue(pending.promise);
  const remove = screen.getByRole("button", { name: "Delete", exact: true });
  await user.click(remove);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(remove).toHaveFocus());
  expect(write).toHaveBeenCalledTimes(0);

  await user.type(
    screen.getByRole("textbox", { name: "Subscriber email addresses, separated by commas" }),
    "one@example.invalid, one@example.invalid two@example.invalid",
  );
  const trigger = screen.getByRole("button", { name: "Send a test" });
  await user.click(trigger);
  const dialog = screen.getByRole("alertdialog", { name: "Send a test message?" });
  expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
  expect(dialog).toHaveAccessibleDescription(
    "A message will be sent to the selected subscriber addresses.",
  );
  const cancel = within(dialog).getByRole("button", { name: "Cancel" });
  expect(cancel).toHaveFocus();
  await user.click(cancel);
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(write).toHaveBeenCalledTimes(0);

  await user.keyboard("{Enter}");
  const confirm = within(
    screen.getByRole("alertdialog", { name: "Send a test message?" }),
  ).getByRole("button", { name: "Send a test" });
  expect(confirm).toHaveClass("bg-primary");
  await user.dblClick(confirm);
  expect(write.mock.calls).toEqual([
    [
      "campaigns.test",
      { id: 42, confirmed: true, subscribers: ["one@example.invalid", "two@example.invalid"] },
    ],
  ]);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(trigger).toBeDisabled();
  await act(() => pending.resolve());
  expect(screen.getByText("Test message queued.")).toBeVisible();
});

it("retains localized destructive campaign cancellation with a single status write", async () => {
  const user = renderCampaign("paused", "de");
  write.mockResolvedValue(undefined);
  const trigger = screen.getByRole("button", { name: "Kampagne abbrechen" });
  await user.click(trigger);
  const dialog = screen.getByRole("alertdialog", { name: "Diese Kampagnenaktion ausführen?" });
  expect(dialog).toHaveAccessibleDescription(
    "Listmonk wendet diese Aktion auf die gespeicherte Kampagne und ihre ausgewählten Listen an.",
  );
  expect(within(dialog).getByRole("button", { name: "Abbrechen", exact: true })).toHaveFocus();
  const confirm = within(dialog).getByRole("button", { name: "Kampagne abbrechen" });
  expect(confirm).toHaveClass("bg-destructive");
  await user.click(confirm);
  expect(write.mock.calls).toEqual([
    ["campaigns.status", { id: 42, confirmed: true, status: "cancelled" }],
  ]);
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByText("Änderungen gespeichert.")).toBeVisible();
});
