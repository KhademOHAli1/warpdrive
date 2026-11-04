// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRowSelection } from "@/components/data-table/useRowSelection";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import english from "./messages/activities.en.json";
import { type ActivityBulkActions, useActivityBulkActions } from "./useActivityBulkActions";

type ActionResult = { ok: true } | { ok: false; error: { id: string } };
type Action = (input: { id: string; done?: boolean }, csrf: string | null) => Promise<ActionResult>;
type Verb = "complete" | "delete";

const api = vi.hoisted(() => ({
  complete: vi.fn<Action>(),
  delete: vi.fn<Action>(),
  dayLoad: vi.fn<() => Promise<void>>(),
  listRows: vi.fn<() => Promise<void>>(),
}));

vi.mock("./actions", () => ({
  completeActivityAction: api.complete,
  deleteActivityAction: api.delete,
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      activities: {
        dayLoad: { invalidate: api.dayLoad },
        listRows: { invalidate: api.listRows },
      },
    }),
  },
}));

const acknowledgedId = "00000000-0000-4000-8000-000000000001";
const deniedId = "00000000-0000-4000-8000-000000000002";
const selectedIds = [acknowledgedId, deniedId];
const acknowledged: ActionResult = { ok: true };
const denied: ActionResult = { ok: false, error: { id: "E_PERM_001" } };

function EnglishLocale({ children }: { children: ReactNode }) {
  return <LocaleProvider locale="en">{children}</LocaleProvider>;
}

function renderActions(ids: readonly string[] = selectedIds) {
  const view = renderHook(
    () => {
      const selection = useRowSelection();
      return { selection, actions: useActivityBulkActions(selection) };
    },
    { wrapper: EnglishLocale },
  );
  act(() => view.result.current.selection.toggleAll(ids));
  return view;
}

function run(actions: ActivityBulkActions, verb: Verb): Promise<void> {
  return verb === "complete" ? actions.bulkMarkDone() : actions.bulkDelete();
}

function actionFor(verb: Verb) {
  return verb === "complete" ? api.complete : api.delete;
}

function failureMessage(verb: Verb): string {
  return verb === "complete" ? english.bulkDoneFailed : english.bulkDeleteFailed;
}

function expectActionIds(verb: Verb, ids: readonly string[]) {
  const action = actionFor(verb);
  expect(action).toHaveBeenCalledTimes(ids.length);
  expect(action.mock.calls).toEqual(
    ids.map((id) => [verb === "complete" ? { id, done: true } : { id }, "csrf"]),
  );
  expect(verb === "complete" ? api.delete : api.complete).not.toHaveBeenCalled();
}

beforeEach(() => {
  api.complete.mockReset().mockResolvedValue({ ok: true });
  api.delete.mockReset().mockResolvedValue({ ok: true });
  api.dayLoad.mockReset().mockResolvedValue(undefined);
  api.listRows.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

const refreshFailures = [
  { outcome: "mixed", target: "dayLoad", failure: "rejection" },
  { outcome: "mixed", target: "dayLoad", failure: "synchronous throw" },
  { outcome: "mixed", target: "listRows", failure: "rejection" },
  { outcome: "mixed", target: "listRows", failure: "synchronous throw" },
  { outcome: "all-success", target: "dayLoad", failure: "rejection" },
  { outcome: "all-success", target: "listRows", failure: "synchronous throw" },
] as const;

for (const verb of ["complete", "delete"] as const) {
  it(`commits mixed ${verb} ACK selection before pending invalidation settles`, async () => {
    actionFor(verb).mockImplementation(({ id }) =>
      Promise.resolve(id === deniedId ? denied : acknowledged),
    );
    let finishRefresh!: () => void;
    api.dayLoad.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishRefresh = resolve;
      }),
    );
    const { result } = renderActions();
    let operation!: Promise<void>;

    await act(async () => {
      operation = run(result.current.actions, verb);
      await Promise.resolve();
    });
    await waitFor(() => expect(api.dayLoad).toHaveBeenCalledTimes(1));

    try {
      expect(api.listRows).toHaveBeenCalledTimes(1);
      expectActionIds(verb, selectedIds);
      // Read dispatch proves both action replies settled; do not wait for the desired selection.
      expect([...result.current.selection.selected]).toEqual([deniedId]);
      expect(result.current.actions.error).toBe(failureMessage(verb));
    } finally {
      // Also settle the original implementation when its direct selection assertion fails.
      await act(async () => {
        finishRefresh();
        await operation;
      });
    }

    actionFor(verb).mockResolvedValue({ ok: true });
    await act(() => run(result.current.actions, verb));

    expectActionIds(verb, [...selectedIds, deniedId]);
    expect(result.current.selection.count).toBe(0);
    expect(result.current.actions.error).toBeNull();
    expect(api.dayLoad).toHaveBeenCalledTimes(2);
    expect(api.listRows).toHaveBeenCalledTimes(2);
  });

  it.each(refreshFailures)(
    `preserves ${verb} $outcome ACKs after $target $failure and replays no success`,
    async ({ outcome, target, failure }) => {
      actionFor(verb).mockImplementation(({ id }) =>
        Promise.resolve(outcome === "mixed" && id === deniedId ? denied : acknowledged),
      );
      const refreshError = new Error("raw refresh diagnostic");
      if (failure === "rejection") api[target].mockRejectedValueOnce(refreshError);
      else {
        api[target].mockImplementationOnce(() => {
          throw refreshError;
        });
      }
      const { result } = renderActions();

      await act(() => run(result.current.actions, verb));

      expectActionIds(verb, selectedIds);
      expect([...result.current.selection.selected]).toEqual(outcome === "mixed" ? [deniedId] : []);
      expect(result.current.actions.error).toBe(outcome === "mixed" ? failureMessage(verb) : null);
      expect(api.dayLoad).toHaveBeenCalledTimes(1);
      // The unchanged helper evaluates dayLoad first; its synchronous throw skips listRows.
      expect(api.listRows).toHaveBeenCalledTimes(
        target === "dayLoad" && failure === "synchronous throw" ? 0 : 1,
      );

      actionFor(verb).mockResolvedValue({ ok: true });
      await act(() => run(result.current.actions, verb));

      expectActionIds(verb, outcome === "mixed" ? [...selectedIds, deniedId] : selectedIds);
      expect(result.current.selection.count).toBe(0);
      expect(result.current.actions.error).toBeNull();
    },
  );

  it(`retries only returned-denied ${verb} IDs after another explicit action`, async () => {
    actionFor(verb).mockResolvedValue(denied);
    const { result } = renderActions();

    await act(() => run(result.current.actions, verb));

    expectActionIds(verb, selectedIds);
    expect([...result.current.selection.selected]).toEqual(selectedIds);
    expect(result.current.actions.error).toBe(failureMessage(verb));
    expect(api.dayLoad).not.toHaveBeenCalled();
    expect(api.listRows).not.toHaveBeenCalled();

    actionFor(verb).mockResolvedValue({ ok: true });
    await act(() => run(result.current.actions, verb));

    expectActionIds(verb, [...selectedIds, ...selectedIds]);
    expect(result.current.selection.count).toBe(0);
    expect(result.current.actions.error).toBeNull();
    expect(api.dayLoad).toHaveBeenCalledTimes(1);
    expect(api.listRows).toHaveBeenCalledTimes(1);
  });

  it(`preserves ${verb} mutation rejection without refresh or replay`, async () => {
    const transportError = new Error("action acknowledgement unavailable");
    actionFor(verb).mockImplementation(({ id }) =>
      id === deniedId ? Promise.reject(transportError) : Promise.resolve(acknowledged),
    );
    const { result } = renderActions();

    await act(async () => {
      await expect(run(result.current.actions, verb)).rejects.toBe(transportError);
    });

    expectActionIds(verb, selectedIds);
    expect([...result.current.selection.selected]).toEqual(selectedIds);
    expect(result.current.actions.error).toBeNull();
    expect(api.dayLoad).not.toHaveBeenCalled();
    expect(api.listRows).not.toHaveBeenCalled();
  });

  it(`dispatches no ${verb} action or refresh for an empty real selection`, async () => {
    const { result } = renderActions([]);

    await act(() => run(result.current.actions, verb));

    expectActionIds(verb, []);
    expect(result.current.selection.count).toBe(0);
    expect(result.current.actions.error).toBeNull();
    expect(api.dayLoad).not.toHaveBeenCalled();
    expect(api.listRows).not.toHaveBeenCalled();
  });
}
