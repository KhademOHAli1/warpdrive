// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import type { Goal } from "@/db/schema/goals";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { GoalForm } from "./GoalForm";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const goal: Goal = {
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
};

describe("GoalForm", () => {
  it("does not open criteria dropdowns while the same goal is being saved", async () => {
    let finish: (result: { ok: true }) => void = vi.fn();
    render(
      <GoalForm
        users={[]}
        teams={[]}
        pipelines={[]}
        activityTypes={[]}
        initial={goal}
        submitLabel="Commit"
        onSubmit={() =>
          new Promise((resolve) => {
            finish = resolve;
          })
        }
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    fireEvent.pointerDown(screen.getByRole("combobox", { name: SETTINGS_STRINGS.goalSubject }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
    const opened = screen.queryByRole("listbox");
    await act(async () => {
      finish({ ok: true });
      await Promise.resolve();
    });
    expect(opened).toBeNull();
  });

  it.each([
    ["2026-10-31T23:30:00Z", "Europe/Berlin", "01.11.2026"],
    ["2026-11-01T01:30:00Z", "America/Los_Angeles", "31.10.2026"],
  ])("starts a new goal on the account's civil day at %s in %s", (now, timeZone, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(now));
    render(
      <LocaleProvider locale="de" timeZone={timeZone}>
        <GoalForm
          users={[]}
          teams={[]}
          pipelines={[]}
          activityTypes={[]}
          submitLabel="Commit"
          onSubmit={vi.fn()}
          onDone={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("button", { name: "Beginn" })).toHaveTextContent(expected);
  });

  it("shows persistent visible labels for goal criteria", () => {
    render(
      <GoalForm
        users={[]}
        teams={[]}
        pipelines={[]}
        activityTypes={[]}
        initial={goal}
        submitLabel="Commit"
        onSubmit={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    for (const label of [
      SETTINGS_STRINGS.goalSubject,
      SETTINGS_STRINGS.goalAction,
      SETTINGS_STRINGS.goalMetric,
      SETTINGS_STRINGS.goalAssignee,
      SETTINGS_STRINGS.goalPipeline,
      SETTINGS_STRINGS.goalInterval,
      SETTINGS_STRINGS.goalTarget,
      SETTINGS_STRINGS.goalStartsOn,
      SETTINGS_STRINGS.goalEndsOn,
    ]) {
      expect(screen.getByText(label, { exact: true })).toBeVisible();
    }
  });

  it("keeps the target editable and reports a rejected save for retry", async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error("offline")));
    render(
      <GoalForm
        users={[]}
        teams={[]}
        pipelines={[]}
        activityTypes={[]}
        initial={goal}
        submitLabel="Commit"
        onSubmit={onSubmit}
        onDone={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Target"), { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(SETTINGS_STRINGS.goalSaveFailed);
    expect(screen.getByLabelText("Target")).toHaveValue("250");
    await waitFor(() => expect(screen.getByRole("button", { name: "Commit" })).toBeEnabled());
  });

  it("localizes a canonical German seed without parsing it as grouped input", async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true }));
    render(
      <LocaleProvider locale="de">
        <GoalForm
          users={[]}
          teams={[]}
          pipelines={[]}
          activityTypes={[]}
          initial={{ ...goal, metric: "value", target: "1.234" }}
          submitLabel="Commit"
          onSubmit={onSubmit}
          onDone={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(screen.getByLabelText("Zielwert")).toHaveValue("1,234");
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ target: "1.234" })),
    );
  });

  it("retains an authored German target across language changes and failed retries", async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ ok: false }));
    const tree = (locale: Locale) => (
      <LocaleProvider locale={locale}>
        <GoalForm
          users={[]}
          teams={[]}
          pipelines={[]}
          activityTypes={[]}
          initial={goal}
          submitLabel="Commit"
          onSubmit={onSubmit}
          onDone={vi.fn()}
        />
      </LocaleProvider>
    );
    const view = render(tree("de"));
    fireEvent.change(screen.getByLabelText("Zielwert"), { target: { value: "1,234" } });
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
    await screen.findByRole("alert");
    view.rerender(tree("en"));
    expect(screen.getByLabelText("Target")).toHaveValue("1,234");
    fireEvent.click(await screen.findByRole("button", { name: "Commit" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit).toHaveBeenNthCalledWith(1, expect.objectContaining({ target: "1.234" }));
    expect(onSubmit).toHaveBeenNthCalledWith(2, expect.objectContaining({ target: "1.234" }));
  });
  it("opens an edited count target as the whole number it was entered as", () => {
    render(
      <GoalForm
        users={[]}
        teams={[]}
        pipelines={[]}
        activityTypes={[]}
        initial={goal}
        submitLabel="Save"
        onSubmit={() => Promise.resolve({ ok: true })}
        onDone={() => {}}
      />,
    );
    expect(screen.getByLabelText(SETTINGS_STRINGS.goalTarget)).toHaveValue("200");
  });
});
