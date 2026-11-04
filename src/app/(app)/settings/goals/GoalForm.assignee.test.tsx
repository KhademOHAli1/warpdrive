// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "@/db/schema/goals";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import type { Locale } from "@/features/i18n/registry";
import { settingsMessagesForLocale } from "@/features/identity/settingsMessages";
import { type GoalDraft, GoalForm } from "./GoalForm";

vi.mock("@/features/i18n/actions", () => ({ saveLocalePreferencesAction: vi.fn() }));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
  document.documentElement.removeAttribute("lang");
});

type SaveResult = { ok: boolean; errorId?: string };
const locales = ["en", "de", "fa"] as const;
const cases = locales.flatMap((locale) =>
  (["user", "team"] as const).map((kind) => ({ locale, kind })),
);
const longNames = {
  en: {
    user: "Alexandra Morgan — International enterprise account management and customer renewals",
    team: "International enterprise account management and customer renewals — Northern region",
  },
  de: {
    user: "Alexandra Morgan — Internationale Unternehmenskundenbetreuung und Vertragsverlängerungen",
    team: "Internationale Unternehmenskundenbetreuung und Vertragsverlängerungen — Region Nord",
  },
  fa: {
    user: "الکساندرا مورگان — مدیریت حساب‌های سازمانی بین‌المللی و تمدید قرارداد مشتریان",
    team: "تیم مدیریت حساب‌های سازمانی بین‌المللی و تمدید قرارداد مشتریان — منطقهٔ شمال",
  },
};

const goal: Goal = {
  id: "goal-existing",
  subject: "activity",
  action: "completed",
  metric: "count",
  assigneeKind: "company",
  assigneeId: null,
  pipelineId: null,
  activityTypeId: null,
  interval: "monthly",
  target: "200.00",
  currency: "EUR",
  startsOn: "2026-08-24",
  endsOn: null,
  createdAt: new Date("2026-08-24T12:00:00Z"),
  updatedAt: new Date("2026-08-24T12:00:00Z"),
  deletedAt: null,
};

function optionsFor(locale: Locale) {
  const firstUser = { id: "user-north", name: longNames[locale].user };
  const secondUser = { id: "user-south", name: `${longNames[locale].user} — 2` };
  const firstTeam = { id: "team-north", name: longNames[locale].team };
  const secondTeam = { id: "team-south", name: `${longNames[locale].team} — 2` };
  return {
    firstUser,
    secondUser,
    firstTeam,
    users: [firstUser, secondUser],
    teams: [firstTeam, secondTeam],
  };
}

async function choose(label: string, option: string) {
  await userEvent.click(screen.getByRole("combobox", { name: label }));
  await userEvent.click(screen.getByRole("option", { name: option }));
}

describe("Goal assignee picker context", () => {
  it.each(cases)(
    "identifies the selected $kind and retains its exact draft through failure and retry in $locale",
    async ({ locale, kind }) => {
      const L = settingsMessagesForLocale(locale);
      const options = optionsFor(locale);
      const selected = kind === "user" ? options.firstUser : options.firstTeam;
      const kindLabel = kind === "user" ? L._extra.one_person : L._extra.a_team;
      const identityLabel = `${L.goalAssignee}: ${kindLabel}`;
      const submit = vi
        .fn<(draft: GoalDraft) => Promise<SaveResult>>()
        .mockResolvedValue({ ok: true });
      if (kind === "user") submit.mockResolvedValueOnce({ ok: false, errorId: "E_GOAL_001" });
      else submit.mockRejectedValueOnce(new Error("private service diagnostic"));
      const done = vi.fn();
      render(
        <LocaleProvider locale={locale}>
          <GoalForm
            users={options.users}
            teams={options.teams}
            pipelines={[]}
            activityTypes={[]}
            initial={goal}
            submitLabel={L.goalSave}
            onSubmit={submit}
            onDone={done}
          />
        </LocaleProvider>,
      );

      await choose(L.goalAssignee, kindLabel);
      expect(screen.getByText(identityLabel)).toBeVisible();
      expect(screen.getByRole("combobox", { name: L.goalAssignee })).toHaveTextContent(kindLabel);
      expect(screen.getByRole("combobox", { name: identityLabel })).toHaveTextContent(
        L._extra.select,
      );
      await choose(identityLabel, selected.name);
      expect(screen.getByRole("combobox", { name: identityLabel })).toHaveTextContent(
        selected.name,
      );
      const rawTarget = locale === "fa" ? "۲۵۰" : "250";
      fireEvent.change(screen.getByRole("textbox", { name: L.goalTarget }), {
        target: { value: rawTarget },
      });
      const save = screen.getByRole("button", { name: L.goalSave });
      fireEvent.click(save);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        kind === "user" ? L.goalInvalid : L.goalSaveFailed,
      );
      await waitFor(() => expect(save).toBeEnabled());
      expect(done).not.toHaveBeenCalled();
      expect(screen.getByRole("combobox", { name: identityLabel })).toHaveTextContent(
        selected.name,
      );
      expect(screen.getByRole("combobox", { name: L.goalAssignee })).toHaveTextContent(kindLabel);
      expect(screen.getByRole("textbox", { name: L.goalTarget })).toHaveValue(rawTarget);
      expect(screen.queryByText("private service diagnostic")).not.toBeInTheDocument();
      const payload = {
        subject: "activity",
        action: "completed",
        metric: "count",
        assigneeKind: kind,
        assigneeId: selected.id,
        pipelineId: null,
        activityTypeId: null,
        interval: "monthly",
        currency: "EUR",
        target: "250",
        startsOn: "2026-08-24",
        endsOn: null,
      };
      expect(submit).toHaveBeenNthCalledWith(1, payload);
      fireEvent.click(save);
      await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
      expect(submit).toHaveBeenCalledTimes(2);
      expect(submit).toHaveBeenNthCalledWith(2, payload);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(document.documentElement.dir).toBe(locale === "fa" ? "rtl" : "ltr");
    },
  );

  it.each(locales)("resets the identity when its kind changes in %s", async (locale) => {
    const L = settingsMessagesForLocale(locale);
    const options = optionsFor(locale);
    const userLabel = `${L.goalAssignee}: ${L._extra.one_person}`;
    const teamLabel = `${L.goalAssignee}: ${L._extra.a_team}`;
    const submit = vi
      .fn<(draft: GoalDraft) => Promise<SaveResult>>()
      .mockResolvedValue({ ok: true });
    const done = vi.fn();
    render(
      <LocaleProvider locale={locale}>
        <GoalForm
          users={options.users}
          teams={options.teams}
          pipelines={[]}
          activityTypes={[]}
          initial={{ ...goal, assigneeKind: "user", assigneeId: options.firstUser.id }}
          submitLabel={L.goalSave}
          onSubmit={submit}
          onDone={done}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole("combobox", { name: userLabel })).toHaveTextContent(
      options.firstUser.name,
    );
    await choose(L.goalAssignee, L._extra.a_team);
    expect(screen.queryByRole("combobox", { name: userLabel })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: teamLabel })).toHaveTextContent(L._extra.select);
    await choose(teamLabel, options.firstTeam.name);
    await choose(L.goalAssignee, L._extra.one_person);
    expect(screen.queryByRole("combobox", { name: teamLabel })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: userLabel })).toHaveTextContent(L._extra.select);
    await choose(userLabel, options.secondUser.name);
    await choose(L.goalAssignee, L._extra.whole_company);
    expect(screen.queryByRole("combobox", { name: userLabel })).not.toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: L.goalSave }));
    await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledExactlyOnceWith({
      subject: "activity",
      action: "completed",
      metric: "count",
      assigneeKind: "company",
      assigneeId: null,
      pipelineId: null,
      activityTypeId: null,
      interval: "monthly",
      currency: "EUR",
      target: "200",
      startsOn: "2026-08-24",
      endsOn: null,
    });
  });
});
