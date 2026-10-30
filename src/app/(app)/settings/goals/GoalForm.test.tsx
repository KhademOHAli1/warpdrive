// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_STRINGS } from "@/constants/settingsStrings";
import type { Goal } from "@/db/schema/goals";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { GoalForm } from "./GoalForm";

afterEach(cleanup);

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
    fireEvent.click(screen.getByRole("button", { name: "Commit" }));
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
