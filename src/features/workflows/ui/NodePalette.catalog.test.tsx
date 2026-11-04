// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import english from "../messages/workflows.en.json";
import type { PickerSelection } from "../paletteContext";
import { NodePalette } from "./NodePalette";
import {
  deferred,
  paletteDefinition,
  paletteLocales,
  paletteSnapshot,
  paletteWorkflowId,
  readyPaletteRead,
} from "./palette.TestHelpers";
import { buildPaletteView, type PaletteRead } from "./paletteView";

afterEach(cleanup);

type Copy = (typeof paletteLocales)[number]["copy"];
type Locale = (typeof paletteLocales)[number]["locale"];

function entry(label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return screen.getByRole("button", { name: new RegExp(escaped, "i") });
}

function titles(copy: Copy) {
  return [
    copy.paletteManual,
    copy.paletteRecordTrigger,
    copy.read,
    copy.task,
    copy.notification,
    copy.condition,
    copy.delay,
  ];
}

function fixture(locale: Locale = "en", read: PaletteRead = readyPaletteRead(), editable = true) {
  const definition = paletteDefinition();
  const before = structuredClone(definition);
  const onChoose = vi.fn<(selection: PickerSelection) => void>();
  const onClose = vi.fn<() => void>();
  function view(nextRead = read, nextEditable = editable, open = true) {
    const model = buildPaletteView(definition, { kind: "detached" }, nextRead, nextEditable);
    return (
      <LocaleProvider locale={locale}>
        <NodePalette open={open} onClose={onClose} model={model} onChoose={onChoose} />
      </LocaleProvider>
    );
  }
  return { definition, before, onChoose, onClose, view };
}

it.each(paletteLocales)(
  "searches localized category, title and description in $locale",
  async ({ locale, copy }) => {
    const test = fixture(locale);
    const user = userEvent.setup();
    render(test.view());
    for (const category of [
      copy.paletteCategoryTriggers,
      copy.paletteCategoryCrm,
      copy.paletteCategoryLogic,
      copy.paletteCategoryTiming,
    ])
      expect(screen.getByRole("heading", { name: category })).toBeVisible();
    const search = screen.getByLabelText(copy.searchNodes);
    await user.type(search, copy.paletteCategoryLogic);
    expect(entry(copy.condition)).toBeVisible();
    expect(screen.queryByRole("button", { name: new RegExp(copy.read) })).not.toBeInTheDocument();
    await user.clear(search);
    const title = locale === "fa" ? copy.read.replaceAll("ی", "ي").replaceAll("ک", "ك") : copy.read;
    await user.type(search, title);
    expect(entry(copy.read)).toBeVisible();
    await user.clear(search);
    await user.type(search, copy.readActionHint);
    expect(entry(copy.read)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: new RegExp(copy.condition) }),
    ).not.toBeInTheDocument();
    expect(test.onChoose).not.toHaveBeenCalled();
    expect(test.definition).toStrictEqual(test.before);
  },
);

it.each(paletteLocales)(
  "distinguishes unavailable handlers from local provider-free paths in $locale",
  async ({ locale, copy }) => {
    const test = fixture(locale);
    const user = userEvent.setup();
    render(test.view());
    expect(entry(copy.read)).toHaveTextContent(copy.paletteNoProvider);
    expect(entry(copy.read)).not.toHaveTextContent(copy.paletteProviderNotAssessed);
    for (const label of [copy.paletteRecordTrigger, copy.notification]) {
      const unavailable = entry(label);
      expect(unavailable).toHaveAttribute("aria-disabled", "true");
      expect(unavailable).toHaveTextContent(copy.paletteUnavailable);
      expect(unavailable).toHaveTextContent(copy.paletteProviderNotAssessed);
      expect(unavailable).not.toHaveTextContent(copy.paletteNoProvider);
      await user.click(unavailable);
    }
    expect(test.onChoose).not.toHaveBeenCalled();
    expect(test.onClose).not.toHaveBeenCalled();
  },
);

it.each(paletteLocales)(
  "separates edit denial from activity execution warnings in $locale",
  async ({ locale, copy }) => {
    const read = readyPaletteRead({
      authoring: { allowed: false, reason: "workflow-edit-required" },
    });
    const test = fixture(locale, read);
    const user = userEvent.setup();
    const mounted = render(test.view());
    expect(screen.getAllByText(copy.paletteEditRequired).length).toBeGreaterThan(0);
    for (const label of [copy.paletteManual, copy.read, copy.task, copy.condition, copy.delay])
      expect(entry(label)).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(entry(copy.task));
    expect(test.onChoose).not.toHaveBeenCalled();
    const warning = paletteSnapshot();
    for (const state of warning.entries) {
      if (state.type === "activity.create")
        state.executionReasons = ["activity-create-required", "task-type-unavailable"];
    }
    mounted.rerender(test.view({ ...readyPaletteRead(), data: warning }));
    expect(entry(copy.task)).toHaveTextContent(copy.paletteActivityRequired);
    expect(entry(copy.task)).toHaveTextContent(copy.paletteTaskTypeUnavailable);
    expect(entry(copy.task)).not.toHaveAttribute("aria-disabled", "true");
    await user.click(entry(copy.task));
    expect(test.onChoose).toHaveBeenCalledExactlyOnceWith({
      kind: "insert",
      type: "activity.create",
      version: 1,
    });
    expect(test.definition).toStrictEqual(test.before);
  },
);

it.each(paletteLocales)(
  "keeps no-match feedback and Clear search usable in $locale",
  async ({ locale, copy }) => {
    const test = fixture(locale);
    const user = userEvent.setup();
    render(test.view());
    const search = screen.getByLabelText(copy.searchNodes);
    await user.type(search, "zz-no-workflow-action-8273");
    expect(screen.getByRole("status")).toHaveTextContent(copy.noNodes);
    expect(screen.queryByRole("button", { name: new RegExp(copy.read) })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.clearSearch }));
    expect(search).toHaveValue("");
    for (const label of titles(copy)) expect(entry(label)).toBeVisible();
    expect(test.onChoose).not.toHaveBeenCalled();
    expect(test.onClose).not.toHaveBeenCalled();
  },
);

it("lets fresh server denial and current editor read-only state override stale positives", () => {
  const test = fixture();
  const mounted = render(test.view());
  expect(entry(english.task)).not.toHaveAttribute("aria-disabled", "true");
  mounted.rerender(
    test.view(
      readyPaletteRead({
        authoring: { allowed: false, reason: "workflow-edit-required" },
      }),
    ),
  );
  fireEvent.click(entry(english.task));
  expect(entry(english.task)).toHaveAttribute("aria-disabled", "true");
  mounted.rerender(test.view(readyPaletteRead(), false));
  fireEvent.click(entry(english.task));
  expect(entry(english.task)).toHaveAttribute("aria-disabled", "true");
  mounted.rerender(
    test.view(
      readyPaletteRead({
        authoring: { allowed: false, reason: "workflow-archived" },
      }),
    ),
  );
  expect(screen.getAllByText(english.paletteArchived).length).toBeGreaterThan(0);
  expect(entry(english.task)).toHaveAttribute("aria-disabled", "true");
  expect(test.onChoose).not.toHaveBeenCalled();
  expect(test.definition).toStrictEqual(test.before);
});

it("shows initial unconfirmed loading without presenting an empty or selectable catalog", () => {
  const retry = vi.fn<() => Promise<unknown>>();
  const test = fixture("en", { status: "loading", workflowId: paletteWorkflowId, retry });
  render(test.view());
  expect(screen.getByRole("status")).toHaveTextContent(english.paletteLoading);
  expect(screen.queryByText(english.noNodes)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: new RegExp(english.read) })).not.toBeInTheDocument();
  expect(test.onChoose).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

it("retains cached descriptions on transient read error with one read-only Retry", () => {
  const retry = vi.fn<() => Promise<unknown>>();
  const test = fixture("en", { ...readyPaletteRead(), status: "error", retry });
  render(test.view());
  expect(screen.getByRole("alert")).toHaveTextContent(english.paletteReadError);
  expect(screen.getAllByRole("button", { name: english.retry })).toHaveLength(1);
  expect(entry(english.read)).toHaveTextContent(english.readActionHint);
  expect(entry(english.read)).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(entry(english.read));
  expect(test.onChoose).not.toHaveBeenCalled();
  expect(screen.queryByText(english.noNodes)).not.toBeInTheDocument();
  expect(retry).not.toHaveBeenCalled();
});

it("hides cached metadata after confirmed denial while retaining the search and draft", async () => {
  const test = fixture();
  const user = userEvent.setup();
  const mounted = render(test.view());
  await user.type(screen.getByLabelText(english.searchNodes), english.read);
  expect(entry(english.read)).toBeVisible();
  mounted.rerender(test.view({ ...readyPaletteRead(), status: "denied" }));
  expect(screen.getByRole("alert")).toHaveTextContent(english.paletteDenied);
  expect(screen.getByLabelText(english.searchNodes)).toHaveValue(english.read);
  expect(screen.queryByRole("button", { name: new RegExp(english.read) })).not.toBeInTheDocument();
  expect(screen.queryByText(english.noNodes)).not.toBeInTheDocument();
  expect(test.onChoose).not.toHaveBeenCalled();
  expect(test.definition).toStrictEqual(test.before);
});

it("does not use another workflow's ready response as this query key's confirmation", () => {
  const test = fixture("en", {
    ...readyPaletteRead(),
    workflowId: paletteWorkflowId,
    data: paletteSnapshot({ workflowId: "a814e1d0-407a-460e-aedd-ed823b73392b" }),
  });
  render(test.view());
  expect(screen.getByRole("status")).toHaveTextContent(english.paletteLoading);
  expect(screen.queryByRole("button", { name: new RegExp(english.read) })).not.toBeInTheDocument();
  expect(screen.queryByText(english.noNodes)).not.toBeInTheDocument();
  expect(test.onChoose).not.toHaveBeenCalled();
});

it("keeps unavailable choices keyboard-discoverable without dispatching keyboard or DOM clicks", async () => {
  const test = fixture();
  const user = userEvent.setup();
  render(test.view());
  const unavailable = entry(english.paletteRecordTrigger);
  expect(unavailable).toHaveAttribute("aria-disabled", "true");
  unavailable.focus();
  expect(unavailable).toHaveFocus();
  await user.keyboard("{Enter} ");
  fireEvent.click(unavailable);
  expect(test.onChoose).not.toHaveBeenCalled();
  await user.click(entry(english.read));
  expect(test.onChoose).toHaveBeenCalledExactlyOnceWith({
    kind: "insert",
    type: "record.read",
    version: 1,
  });
});

it("unmounts the closed shared dialog without dispatching a choice or a read retry", () => {
  const retry = vi.fn<() => Promise<unknown>>();
  const test = fixture("en", { ...readyPaletteRead(), retry });
  render(test.view(undefined, true, false));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(english.searchNodes)).not.toBeInTheDocument();
  expect(test.onChoose).not.toHaveBeenCalled();
  expect(test.onClose).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

it("preserves search and the local draft through a deferred read Retry without selecting", async () => {
  const held = deferred<unknown>();
  const retry = vi.fn<() => Promise<unknown>>().mockReturnValue(held.promise);
  const read: PaletteRead = { ...readyPaletteRead(), status: "error", retry };
  const test = fixture("en", read);
  const user = userEvent.setup();
  const mounted = render(test.view());
  try {
    await user.type(screen.getByLabelText(english.searchNodes), english.read);
    await user.click(screen.getByRole("button", { name: english.retry }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(english.searchNodes)).toHaveValue(english.read);
    expect(test.onChoose).not.toHaveBeenCalled();
    await act(async () => {
      held.resolve({ isError: false });
      await held.promise;
    });
    mounted.rerender(test.view({ ...readyPaletteRead(), retry }));
    expect(screen.getByLabelText(english.searchNodes)).toHaveValue(english.read);
    expect(entry(english.read)).not.toHaveAttribute("aria-disabled", "true");
    expect(test.onChoose).not.toHaveBeenCalled();
    expect(test.onClose).not.toHaveBeenCalled();
    expect(test.definition).toStrictEqual(test.before);
  } finally {
    await act(async () => {
      held.resolve({ isError: false });
      await held.promise;
    });
  }
});
