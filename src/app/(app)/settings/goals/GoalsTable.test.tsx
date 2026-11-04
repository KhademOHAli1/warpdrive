// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "@/db/schema/goals";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";
import { GoalsTable } from "./GoalsTable";

type DeleteResult = { ok: true; value: { id: string } } | { ok: false; error: { id: string } };
type GoalMessages = ReturnType<typeof settingsMessagesForLocale>;

const actions = vi.hoisted(() => ({
  deleteGoalAction: vi.fn<(id: string, token: string | null) => Promise<DeleteResult>>(),
}));
vi.mock("@/features/goals/actions", () => actions);
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));

beforeEach(() => {
  actions.deleteGoalAction.mockReset();
  actions.deleteGoalAction.mockResolvedValue({ ok: true, value: { id: "g1" } });
});
afterEach(cleanup);

function goal(overrides: Partial<Goal>): Goal {
  return {
    id: "g1",
    subject: "activity",
    action: "completed",
    metric: "count",
    assigneeKind: "company",
    assigneeId: null,
    pipelineId: null,
    activityTypeId: null,
    interval: "monthly",
    target: "200.00",
    currency: "USD",
    startsOn: "2026-08-24",
    endsOn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("GoalsTable", () => {
  it("keeps a goal visible and reports a rejected delete for retry", async () => {
    actions.deleteGoalAction.mockRejectedValueOnce(new Error("offline"));
    render(
      <GoalsTable goals={[goal({})]} assigneeNames={{}} onChanged={vi.fn()} onEdit={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Delete/ }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save the goal.");
    expect(screen.getByText("200")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Delete: / })).toBeEnabled());
  });

  it("states a count target as a whole number", () => {
    render(
      <GoalsTable goals={[goal({})]} assigneeNames={{}} onChanged={() => {}} onEdit={() => {}} />,
    );
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  it("drops the empty cents from a whole-money target", () => {
    render(
      <GoalsTable
        goals={[goal({ subject: "deal", action: "won", metric: "value", target: "20000.00" })]}
        assigneeNames={{}}
        onChanged={() => {}}
        onEdit={() => {}}
      />,
    );
    expect(screen.getByText("20,000 USD")).toBeInTheDocument();
  });
});

it("uses a complete Persian goal phrase and localized unknown assignee labels", async () => {
  const { LocaleProvider } = await import("@/features/i18n/LocaleProvider");
  render(
    <LocaleProvider locale="fa">
      <GoalsTable
        goals={[
          goal({ assigneeKind: "user", assigneeId: "missing-user" }),
          goal({ id: "g2", assigneeKind: "team", assigneeId: "missing-team" }),
        ]}
        assigneeNames={{}}
        onChanged={() => {}}
        onEdit={() => {}}
      />
    </LocaleProvider>,
  );
  expect(screen.getAllByText("فعالیت‌های انجام‌شده، ماهانه")).toHaveLength(2);
  expect(screen.getByText("کاربر نامشخص")).toBeInTheDocument();
  expect(screen.getByText("تیم نامشخص")).toBeInTheDocument();
});

function table(
  locale: "en" | "de" | "fa",
  goals: Goal[],
  onChanged: () => void,
  onEdit: (selected: Goal) => void,
) {
  return (
    <LocaleProvider locale={locale}>
      <GoalsTable goals={goals} assigneeNames={{}} onChanged={onChanged} onEdit={onEdit} />
    </LocaleProvider>
  );
}

function rowDelete(row: HTMLElement, messages: GoalMessages) {
  return within(row).getByRole("button", {
    name: (name) => name.startsWith(`${messages.goalDelete}: `),
  });
}

async function openDelete(
  user: ReturnType<typeof userEvent.setup>,
  row: HTMLElement,
  messages: GoalMessages,
) {
  await user.click(rowDelete(row, messages));
  const dialog = screen.getByRole("alertdialog", { name: messages.goalDelete });
  expect(within(dialog).getByText(messages.goalDeleteConfirm)).toBeVisible();
  return within(dialog).getByRole("button", { name: messages.goalDelete });
}

it.each(["en", "de", "fa"] as const)(
  "keeps an acknowledged delete successful when the parent refresh throws in %s",
  async (locale) => {
    const messages = settingsMessagesForLocale(locale);
    const onChanged = vi.fn(() => {
      throw new Error("refresh unavailable");
    });
    const onEdit = vi.fn();
    const goals = [goal({})];
    const user = userEvent.setup();
    const view = render(table(locale, goals, onChanged, onEdit));
    const row = screen.getByRole("listitem");
    const remove = rowDelete(row, messages);
    const confirm = await openDelete(user, row, messages);
    expect(actions.deleteGoalAction).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();

    await user.click(confirm);
    await waitFor(() => expect(remove).toBeEnabled());

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(actions.deleteGoalAction).toHaveBeenCalledTimes(1);
    expect(actions.deleteGoalAction).toHaveBeenCalledWith("g1", "csrf");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledWith();
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("listitem")).toBe(row);
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "false");

    await openDelete(user, row, messages);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(actions.deleteGoalAction).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);

    view.rerender(table(locale, [], onChanged, onEdit));

    expect(screen.getByText(messages.goalsEmpty)).toBeVisible();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(actions.deleteGoalAction).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);
  },
);

for (const failure of ["denied result", "rejection"] as const) {
  it.each(["en", "de", "fa"] as const)(
    `preserves a genuine delete ${failure} and retries the same goal in %s`,
    async (locale) => {
      if (failure === "denied result") {
        actions.deleteGoalAction.mockResolvedValueOnce({
          ok: false,
          error: { id: "E_PERM_001" },
        });
      } else {
        actions.deleteGoalAction.mockRejectedValueOnce(new Error("delete unavailable"));
      }
      const messages = settingsMessagesForLocale(locale);
      const onChanged = vi.fn();
      const onEdit = vi.fn();
      const user = userEvent.setup();
      render(table(locale, [goal({})], onChanged, onEdit));
      const row = screen.getByRole("listitem");
      const remove = rowDelete(row, messages);

      await user.click(await openDelete(user, row, messages));
      await waitFor(() => expect(remove).toBeEnabled());

      expect(screen.getByRole("alert")).toHaveTextContent(messages.goalSaveFailed);
      expect(screen.getByRole("listitem")).toBe(row);
      expect(actions.deleteGoalAction).toHaveBeenCalledTimes(1);
      expect(actions.deleteGoalAction).toHaveBeenCalledWith("g1", "csrf");
      expect(onChanged).not.toHaveBeenCalled();
      expect(onEdit).not.toHaveBeenCalled();

      await user.click(await openDelete(user, row, messages));
      await waitFor(() => expect(remove).toBeEnabled());

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.getByRole("listitem")).toBe(row);
      expect(actions.deleteGoalAction).toHaveBeenCalledTimes(2);
      expect(actions.deleteGoalAction).toHaveBeenNthCalledWith(1, "g1", "csrf");
      expect(actions.deleteGoalAction).toHaveBeenNthCalledWith(2, "g1", "csrf");
      expect(onChanged).toHaveBeenCalledTimes(1);
      expect(onEdit).not.toHaveBeenCalled();
    },
  );
}

it("holds all row actions until ACK and releases the next goal's lock", async () => {
  const messages = settingsMessagesForLocale("en");
  let acknowledge!: (value: DeleteResult) => void;
  actions.deleteGoalAction.mockReturnValueOnce(
    new Promise<DeleteResult>((resolve) => {
      acknowledge = resolve;
    }),
  );
  const onChanged = vi.fn();
  const onEdit = vi.fn();
  const secondGoal = goal({ id: "g2", target: "350.00" });
  const goals = [goal({}), secondGoal];
  const user = userEvent.setup();
  const view = render(table("en", goals, onChanged, onEdit));
  const [firstRow, secondRow] = screen.getAllByRole("listitem");
  if (firstRow === undefined || secondRow === undefined) throw new Error("Both goals must exist");
  const secondDelete = rowDelete(secondRow, messages);

  await user.click(await openDelete(user, firstRow, messages));

  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");
  for (const button of within(screen.getByRole("list")).getAllByRole("button")) {
    expect(button).toBeDisabled();
  }
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(actions.deleteGoalAction).toHaveBeenCalledTimes(1);
  expect(actions.deleteGoalAction).toHaveBeenCalledWith("g1", "csrf");
  expect(onChanged).not.toHaveBeenCalled();
  await user.click(secondDelete);
  expect(actions.deleteGoalAction).toHaveBeenCalledTimes(1);
  expect(onEdit).not.toHaveBeenCalled();

  await act(() => {
    acknowledge({ ok: true, value: { id: "g1" } });
    return Promise.resolve();
  });

  expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "false");
  expect(secondDelete).toBeEnabled();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(onChanged).toHaveBeenCalledTimes(1);
  view.rerender(table("en", [secondGoal], onChanged, onEdit));
  actions.deleteGoalAction.mockResolvedValueOnce({ ok: true, value: { id: "g2" } });

  await user.click(await openDelete(user, screen.getByRole("listitem"), messages));
  await waitFor(() => expect(secondDelete).toBeEnabled());

  expect(actions.deleteGoalAction).toHaveBeenCalledTimes(2);
  expect(actions.deleteGoalAction).toHaveBeenNthCalledWith(2, "g2", "csrf");
  expect(onChanged).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(onEdit).not.toHaveBeenCalled();
});

it("does not delete a goal when its confirmation is dismissed", async () => {
  const messages = settingsMessagesForLocale("en");
  const onChanged = vi.fn();
  const onEdit = vi.fn();
  const user = userEvent.setup();
  render(table("en", [goal({})], onChanged, onEdit));

  await openDelete(user, screen.getByRole("listitem"), messages);
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

  expect(screen.getByRole("listitem")).toBeInTheDocument();
  expect(actions.deleteGoalAction).not.toHaveBeenCalled();
  expect(onChanged).not.toHaveBeenCalled();
  expect(onEdit).not.toHaveBeenCalled();
});
