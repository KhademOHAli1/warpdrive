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
  return screen.getByRole("button", { name: label });
}

function actionTitles(copy: Copy) {
  return [copy.read, copy.task, copy.notification, copy.condition, copy.iterator, copy.delay];
}

function fixture(locale: Locale = "en", read: PaletteRead = readyPaletteRead(), editable = true) {
  const definition = paletteDefinition();
  const before = structuredClone(definition);
  const onChoose = vi.fn<(selection: PickerSelection) => void>();
  const onClose = vi.fn<() => void>();
  function view(nextRead = read, nextEditable = editable, open = true, trigger = false) {
    const model = buildPaletteView(
      definition,
      trigger ? { kind: "replace", nodeId: "start" } : { kind: "detached" },
      nextRead,
      nextEditable,
    );
    return (
      <LocaleProvider locale={locale}>
        <NodePalette open={open} onClose={onClose} model={model} onChoose={onChoose} />
      </LocaleProvider>
    );
  }
  return { definition, before, onChoose, onClose, view };
}

it.each(paletteLocales)(
  "presents localized action groups and accessible descriptions without search in $locale",
  ({ locale, copy }) => {
    const test = fixture(locale);
    render(test.view());
    expect(screen.getByRole("dialog", { name: copy.selectAction })).toBeVisible();
    for (const category of [
      copy.nodeCategoryData,
      copy.nodeCategoryFlow,
      copy.nodeCategoryCore,
      copy.nodeCategoryHumanInput,
    ])
      expect(screen.getByRole("heading", { name: category })).toBeVisible();
    for (const label of actionTitles(copy)) expect(entry(label)).toBeVisible();
    expect(entry(copy.read)).toHaveAccessibleDescription(
      expect.stringContaining(copy.readActionHint),
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.clearSearch })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.paletteManual })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: copy.paletteRecordTrigger }),
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
    const mounted = render(test.view());
    const read = entry(copy.read);
    expect(read).toHaveAccessibleDescription(expect.stringContaining(copy.paletteNoProvider));
    expect(read).not.toHaveAccessibleDescription(
      expect.stringContaining(copy.paletteProviderNotAssessed),
    );
    const notification = entry(copy.notification);
    expect(notification).toHaveAttribute("aria-disabled", "true");
    expect(notification).toHaveAccessibleDescription(
      expect.stringContaining(copy.paletteUnavailable),
    );
    expect(notification).toHaveAccessibleDescription(
      expect.stringContaining(copy.paletteProviderNotAssessed),
    );
    expect(notification).not.toHaveAccessibleDescription(
      expect.stringContaining(copy.paletteNoProvider),
    );
    await user.click(notification);
    mounted.rerender(test.view(undefined, true, true, true));
    const recordTrigger = entry(copy.paletteRecordTrigger);
    expect(recordTrigger).toHaveAttribute("aria-disabled", "true");
    expect(recordTrigger).toHaveAccessibleDescription(
      expect.stringContaining(copy.paletteUnavailable),
    );
    expect(recordTrigger).toHaveAccessibleDescription(
      expect.stringContaining(copy.paletteProviderNotAssessed),
    );
    expect(recordTrigger).not.toHaveAccessibleDescription(
      expect.stringContaining(copy.paletteNoProvider),
    );
    await user.click(recordTrigger);
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
    for (const label of actionTitles(copy))
      expect(entry(label)).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(entry(copy.task));
    expect(test.onChoose).not.toHaveBeenCalled();
    const warning = paletteSnapshot();
    for (const state of warning.entries) {
      if (state.type === "activity.create")
        state.executionReasons = ["activity-create-required", "task-type-unavailable"];
    }
    mounted.rerender(test.view({ ...readyPaletteRead(), data: warning }));
    expect(entry(copy.task)).toHaveAccessibleDescription(
      expect.stringContaining(copy.paletteActivityRequired),
    );
    expect(entry(copy.task)).toHaveAccessibleDescription(
      expect.stringContaining(copy.paletteTaskTypeUnavailable),
    );
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
  "shows trigger choices only when replacing a trigger in $locale",
  async ({ locale, copy }) => {
    const test = fixture(locale);
    const user = userEvent.setup();
    const mounted = render(test.view());
    expect(screen.queryByRole("button", { name: copy.paletteManual })).not.toBeInTheDocument();
    mounted.rerender(test.view(undefined, true, true, true));
    expect(screen.getByRole("dialog", { name: copy.selectTrigger })).toBeVisible();
    expect(screen.getByRole("heading", { name: copy.triggerGroupOthers })).toBeVisible();
    expect(screen.getByRole("heading", { name: copy.nodeCategoryData })).toBeVisible();
    expect(entry(copy.paletteManual)).toBeVisible();
    expect(entry(copy.scheduledTrigger)).toBeVisible();
    expect(entry(copy.paletteRecordTrigger)).toBeVisible();
    for (const label of actionTitles(copy))
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    await user.click(entry(copy.paletteManual));
    expect(test.onChoose).toHaveBeenCalledExactlyOnceWith({
      kind: "configure",
      type: "trigger.manual",
      version: 1,
      nodeId: "start",
    });
    expect(test.definition).toStrictEqual(test.before);
  },
);

it("lets fresh server denial and current editor read-only state override stale positives", () => {
  const test = fixture();
  const mounted = render(test.view());
  expect(entry(english.task)).not.toHaveAttribute("aria-disabled", "true");
  mounted.rerender(
    test.view(
      readyPaletteRead({ authoring: { allowed: false, reason: "workflow-edit-required" } }),
    ),
  );
  fireEvent.click(entry(english.task));
  expect(entry(english.task)).toHaveAttribute("aria-disabled", "true");
  mounted.rerender(test.view(readyPaletteRead(), false));
  fireEvent.click(entry(english.task));
  expect(entry(english.task)).toHaveAttribute("aria-disabled", "true");
  mounted.rerender(
    test.view(readyPaletteRead({ authoring: { allowed: false, reason: "workflow-archived" } })),
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
  expect(screen.queryByRole("button", { name: english.read })).not.toBeInTheDocument();
  expect(test.onChoose).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

it("retains cached descriptions on transient read error with one read-only Retry", () => {
  const retry = vi.fn<() => Promise<unknown>>();
  const test = fixture("en", { ...readyPaletteRead(), status: "error", retry });
  render(test.view());
  expect(screen.getByRole("alert")).toHaveTextContent(english.paletteReadError);
  expect(screen.getAllByRole("button", { name: english.retry })).toHaveLength(1);
  expect(entry(english.read)).toHaveAccessibleDescription(
    expect.stringContaining(english.readActionHint),
  );
  expect(entry(english.read)).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(entry(english.read));
  expect(test.onChoose).not.toHaveBeenCalled();
  expect(screen.queryByText(english.noNodes)).not.toBeInTheDocument();
  expect(retry).not.toHaveBeenCalled();
});

it("hides cached metadata after confirmed denial while retaining the local draft", () => {
  const test = fixture();
  const mounted = render(test.view());
  expect(entry(english.read)).toBeVisible();
  mounted.rerender(test.view({ ...readyPaletteRead(), status: "denied" }));
  expect(screen.getByRole("alert")).toHaveTextContent(english.paletteDenied);
  expect(screen.queryByRole("button", { name: english.read })).not.toBeInTheDocument();
  expect(screen.queryByText(english.readActionHint)).not.toBeInTheDocument();
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
  expect(screen.queryByRole("button", { name: english.read })).not.toBeInTheDocument();
  expect(screen.queryByText(english.noNodes)).not.toBeInTheDocument();
  expect(test.onChoose).not.toHaveBeenCalled();
});

it("keeps unavailable choices keyboard-discoverable without dispatching keyboard or DOM clicks", async () => {
  const test = fixture();
  const user = userEvent.setup();
  render(test.view());
  const unavailable = entry(english.notification);
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

it("unmounts the closed inline dialog without dispatching a choice or a read retry", () => {
  const retry = vi.fn<() => Promise<unknown>>();
  const test = fixture("en", { ...readyPaletteRead(), retry });
  render(test.view(undefined, true, false));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: english.read })).not.toBeInTheDocument();
  expect(test.onChoose).not.toHaveBeenCalled();
  expect(test.onClose).not.toHaveBeenCalled();
  expect(retry).not.toHaveBeenCalled();
});

it("preserves the draft and cached choices through one deferred read Retry without selecting", async () => {
  const held = deferred<unknown>();
  const retry = vi.fn<() => Promise<unknown>>().mockReturnValue(held.promise);
  const read: PaletteRead = { ...readyPaletteRead(), status: "error", retry };
  const test = fixture("en", read);
  const user = userEvent.setup();
  const mounted = render(test.view());
  try {
    const retryButton = screen.getByRole("button", { name: english.retry });
    await user.click(retryButton);
    fireEvent.click(retryButton);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retryButton).toBeDisabled();
    expect(entry(english.read)).toHaveAttribute("aria-disabled", "true");
    expect(entry(english.read)).toHaveAccessibleDescription(
      expect.stringContaining(english.readActionHint),
    );
    fireEvent.click(entry(english.read));
    expect(test.onChoose).not.toHaveBeenCalled();
    await act(async () => {
      held.resolve({ isError: false });
      await held.promise;
    });
    mounted.rerender(test.view({ ...readyPaletteRead(), retry }));
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
