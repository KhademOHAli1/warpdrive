// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_IDS } from "@/constants/errorIds";
import { LocaleProvider } from "@/features/i18n/LocaleProvider";
import { initialDefinition } from "../editorModel";
import { useWorkflowEditor, type WorkflowDetail } from "./useWorkflowEditor";
import { WorkflowEditor } from "./WorkflowEditor";

const actions = vi.hoisted(() => ({ save: vi.fn(), push: vi.fn() }));
vi.mock("./useWorkflowConfiguration", () => ({
  useWorkflowConfiguration: () => ({
    metadata: { status: "complete", defs: [] },
    authoring: true,
    busy: false,
    loadMore: undefined,
    retry: () => Promise.resolve(),
  }),
}));

vi.mock("../actions", () => ({
  saveWorkflowAction: actions.save,
  publishWorkflowAction: vi.fn(),
  pauseWorkflowAction: vi.fn(),
  cancelWorkflowAction: vi.fn(),
  runWorkflowAction: vi.fn(),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      workflows: { runs: { invalidate: vi.fn() }, runsPage: { invalidate: vi.fn() } },
    }),
    workflows: {
      runsPage: {
        useQuery: () => ({
          data: { items: [], nextCursor: null },
          isLoading: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
        }),
      },
      run: { useQuery: () => ({ data: undefined, isLoading: false, isError: false }) },
    },
    search: {
      query: { useQuery: () => ({ data: { deals: [] }, isFetching: false, isError: false }) },
    },
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: actions.push, refresh: vi.fn() }) }));
vi.mock("./WorkflowCanvas", () => ({
  WorkflowCanvas: () => <div>Canvas omitted from navigation regression</div>,
}));
vi.mock("@/features/observability/capture", () => ({
  capture: vi.fn(),
  currentRoute: () => "/workflows/test",
}));

const route = "/workflows/6ef69ee6-a029-476c-9f26-020fa475cdec";
type AppLocale = ComponentProps<typeof LocaleProvider>["locale"];
let links: HTMLDivElement;
beforeEach(() => {
  actions.save.mockReset();
  actions.push.mockReset();
  vi.spyOn(window, "confirm").mockImplementation(() => {
    throw new Error("Workflow navigation must use the themed ConfirmDialog");
  });
  window.history.replaceState({ workflowEntry: "original" }, "", route);
  links = document.createElement("div");
  document.body.append(links);
});
afterEach(() => {
  cleanup();
  links.remove();
  vi.restoreAllMocks();
});

function fixture(): WorkflowDetail {
  return {
    id: "6ef69ee6-a029-476c-9f26-020fa475cdec",
    ownerId: "c5fdc435-a3f8-4108-84e9-5d5ced7e4d44",
    name: "Follow up",
    revision: 1,
    draft: initialDefinition({ start: "Start", read: "Read", task: "Task", subject: "Call" }),
    active: false,
    publishedNumber: null,
    archivedAt: null,
    createdAt: new Date("2026-11-02T12:00:00Z"),
    updatedAt: new Date("2026-11-02T12:00:00Z"),
    capabilities: {
      edit: true,
      publish: true,
      run: true,
      cancel: true,
      unarchive: false,
      duplicate: true,
      restore: true,
    },
  };
}
function mount() {
  const initial = fixture();
  return {
    ...renderHook(() => useWorkflowEditor(initial), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <LocaleProvider locale="en">{children}</LocaleProvider>
      ),
    }),
    initial,
  };
}
function link(href = "/workflows") {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.innerHTML = "<span>Leave editor</span>";
  links.append(anchor);
  return anchor;
}
function simulateRoute(anchor: HTMLAnchorElement) {
  const navigate = vi.fn();
  anchor.addEventListener("click", (event) => {
    if (!event.defaultPrevented) {
      navigate(anchor.pathname);
      window.history.pushState({ destination: true }, "", anchor.href);
    }
    event.preventDefault(); // Test-owned commitment, not a running Next router.
  });
  return navigate;
}

it("allows clean navigation without a leave request (positive route control)", () => {
  const { result } = mount();
  const anchor = link();
  const navigate = simulateRoute(anchor);
  act(() => anchor.click());
  expect(navigate).toHaveBeenCalledExactlyOnceWith("/workflows");
  expect(window.location.pathname).toBe("/workflows");
  expect(result.current.leaveRequest).toBeNull();
});

it.each(["/workflows", "/inbox"])(
  "cancel retains the dirty draft and history entry for %s",
  (destination) => {
    const { result } = mount();
    act(() => result.current.setName("Unsaved authored name"));
    const definition = result.current.definition;
    const state: unknown = window.history.state;
    const length = window.history.length;
    const anchor = link(destination);
    const navigate = simulateRoute(anchor);
    act(() => anchor.querySelector("span")?.click());
    expect(result.current.leaveRequest).toEqual({ link: anchor, href: anchor.href });
    act(() => result.current.cancelLeave());
    expect(result.current.leaveRequest).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(route);
    expect(window.history.state).toEqual(state);
    expect(window.history.length).toBe(length);
    expect(result.current.name).toBe("Unsaved authored name");
    expect(result.current.definition).toBe(definition);
    expect(result.current.dirty).toBe(true);
    expect(actions.save).not.toHaveBeenCalled();
  },
);

it("preserves first intent, replays it once, and guards the next click again", async () => {
  const { result } = mount();
  act(() => result.current.setName("Unsaved"));
  const anchor = link("/inbox");
  const other = link("/calendar");
  const navigate = simulateRoute(anchor);
  const otherNavigate = simulateRoute(other);
  act(() => anchor.click());
  act(() => other.click());
  expect(result.current.leaveRequest).toEqual({ link: anchor, href: anchor.href });
  await act(() => {
    result.current.confirmLeave();
    return Promise.resolve();
  });
  expect(navigate).toHaveBeenCalledExactlyOnceWith("/inbox");
  expect(otherNavigate).not.toHaveBeenCalled();
  expect(result.current.leaveRequest).toBeNull();
  window.history.replaceState({ workflowEntry: "original" }, "", route);
  act(() => anchor.click());
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(result.current.leaveRequest?.link).toBe(anchor);
  expect(actions.save).not.toHaveBeenCalled();
});

it.each(["disconnected", "changed href", "new tab", "download"] as const)(
  "rejects a stale %s anchor",
  async (mutation) => {
    const { result } = mount();
    act(() => result.current.setName("Unsaved"));
    const anchor = link();
    const navigate = simulateRoute(anchor);
    act(() => anchor.click());
    if (mutation === "disconnected") anchor.remove();
    else if (mutation === "changed href") anchor.href = "/calendar";
    else if (mutation === "new tab") anchor.target = "_blank";
    else anchor.download = "workflow.json";
    await act(() => {
      result.current.confirmLeave();
      return Promise.resolve();
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.leaveRequest).toBeNull();
    expect(result.current.dirty).toBe(true);
    expect(window.location.pathname).toBe(route);
  },
);

it("retains protection after conflict and clears stale intent after acknowledged save", async () => {
  const { result, initial } = mount();
  act(() => result.current.setName("Changed"));
  const anchor = link();
  const navigate = simulateRoute(anchor);
  actions.save.mockResolvedValueOnce({ ok: false, error: ERROR_IDS.WORKFLOW_CONFLICT });
  await act(() => result.current.perform("save"));
  act(() => anchor.click());
  expect(result.current.leaveRequest?.link).toBe(anchor);
  expect(navigate).not.toHaveBeenCalled();
  expect(result.current.dirty).toBe(true);
  actions.save.mockResolvedValueOnce({
    ok: true,
    value: { ...initial, name: "Changed", revision: 2 },
  });
  await act(() => result.current.perform("save"));
  expect(result.current.dirty).toBe(false);
  expect(result.current.leaveRequest).toBeNull();
  await act(() => {
    result.current.confirmLeave();
    return Promise.resolve();
  });
  expect(navigate).not.toHaveBeenCalled();
  act(() => anchor.click());
  expect(navigate).toHaveBeenCalledExactlyOnceWith("/workflows");
});

it("clears stale leave intent when undo restores the saved graph", async () => {
  const { result } = mount();
  const edited = structuredClone(result.current.definition);
  edited.nodes[1]!.name = "Changed read step";
  act(() => result.current.setDefinition(edited));
  const anchor = link();
  const navigate = simulateRoute(anchor);
  act(() => anchor.click());
  expect(result.current.leaveRequest?.link).toBe(anchor);
  act(() => result.current.history.undo());
  expect(result.current.dirty).toBe(false);
  expect(result.current.leaveRequest).toBeNull();
  await act(() => {
    result.current.confirmLeave();
    return Promise.resolve();
  });
  expect(navigate).not.toHaveBeenCalled();
});

it("keeps a pending save alive and clears its leave request on success", async () => {
  const { result, initial } = mount();
  act(() => result.current.setName("Saving changes"));
  let finish!: (value: { ok: true; value: WorkflowDetail }) => void;
  actions.save.mockReturnValueOnce(
    new Promise<{ ok: true; value: WorkflowDetail }>((resolve) => {
      finish = resolve;
    }),
  );
  let operation = Promise.resolve();
  act(() => {
    operation = result.current.perform("save");
  });
  expect(result.current.pending).toBe(true);
  const anchor = link();
  const navigate = simulateRoute(anchor);
  act(() => anchor.click());
  expect(result.current.leaveRequest?.link).toBe(anchor);
  expect(navigate).not.toHaveBeenCalled();
  expect(actions.save).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ ok: true, value: { ...initial, name: "Saving changes", revision: 2 } });
    await operation;
  });
  expect(result.current.pending).toBe(false);
  expect(result.current.dirty).toBe(false);
  expect(result.current.leaveRequest).toBeNull();
  act(() => anchor.click());
  expect(navigate).toHaveBeenCalledExactlyOnceWith("/workflows");
});

it("leaves modified/new-tab/download, middle and same-editor fragment clicks unchanged", () => {
  const { result } = mount();
  act(() => result.current.setName("Unsaved"));
  const newTab = link();
  newTab.target = "_blank";
  const download = link("/workflows/export");
  download.download = "workflow.json";
  for (const [anchor, options] of [
    [newTab, {}],
    [download, {}],
    [link(), { metaKey: true }],
    [link(), { ctrlKey: true }],
    [link(), { shiftKey: true }],
    [link(), { altKey: true }],
    [link(), { button: 1 }],
    [link(`${route}#steps`), {}],
  ] as const) {
    let intercepted: boolean | undefined;
    anchor.addEventListener("click", (event) => {
      intercepted = event.defaultPrevented;
      event.preventDefault();
    });
    act(() => {
      anchor.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, ...options }),
      );
    });
    expect(intercepted).toBe(false);
    expect(result.current.leaveRequest).toBeNull();
  }
});

it("respects another guard's cancellation and invalid/external links", () => {
  const { result } = mount();
  act(() => result.current.setName("Unsaved"));
  const cancelled = new MouseEvent("click", { bubbles: true, cancelable: true });
  cancelled.preventDefault();
  act(() => {
    link().dispatchEvent(cancelled);
  });
  for (const href of ["https://elsewhere.example.test", "http://["]) {
    const anchor = link(href);
    let intercepted: boolean | undefined;
    anchor.addEventListener("click", (event) => {
      intercepted = event.defaultPrevented;
      event.preventDefault();
    });
    act(() => anchor.click());
    expect(intercepted).toBe(false);
  }
  expect(result.current.leaveRequest).toBeNull();
});

it("retains dirty beforeunload protection and removes all guards on unmount", () => {
  const { result, unmount } = mount();
  expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  act(() => result.current.setName("Unsaved"));
  expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
  unmount();
  expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  const anchor = link();
  const navigate = simulateRoute(anchor);
  anchor.click();
  expect(navigate).toHaveBeenCalledExactlyOnceWith("/workflows");
});

describe("actual WorkflowEditor with the shared ConfirmDialog", () => {
  function mountEditor(locale: AppLocale = "en") {
    render(
      <LocaleProvider locale={locale}>
        <WorkflowEditor initial={fixture()} />
      </LocaleProvider>,
    );
  }
  it.each(["Escape", "Stay here"] as const)(
    "%s cancels, restores link focus and retains the draft",
    async (dismissal) => {
      mountEditor();
      const user = userEvent.setup();
      const name = screen.getByRole("textbox", { name: "Workflow name" });
      await user.clear(name);
      await user.type(name, "Authored unsaved workflow");
      const back = screen.getByRole("link", { name: "All workflows" });
      const navigate = simulateRoute(back as HTMLAnchorElement);
      const state: unknown = window.history.state;
      const length = window.history.length;
      await user.click(back);
      const dialog = await screen.findByRole("alertdialog", { name: "Leave this workflow?" });
      const stay = within(dialog).getByRole("button", { name: "Stay here" });
      expect(stay).toHaveFocus();
      expect(dialog).toHaveAccessibleDescription(
        "You have unsaved workflow changes. Leave without saving?",
      );
      expect(navigate).not.toHaveBeenCalled();
      if (dismissal === "Escape") await user.keyboard("{Escape}");
      else await user.click(stay);
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        expect(back).toHaveFocus();
      });
      expect(name).toHaveValue("Authored unsaved workflow");
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
      expect(window.location.pathname).toBe(route);
      expect(window.history.state).toEqual(state);
      expect(window.history.length).toBe(length);
      expect(actions.save).not.toHaveBeenCalled();
      expect(navigate).not.toHaveBeenCalled();
    },
  );
  it("confirming through the real dialog replays the editor link exactly once", async () => {
    mountEditor();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Workflow name" }), " changed");
    const back = screen.getByRole("link", { name: "All workflows" });
    const navigate = simulateRoute(back as HTMLAnchorElement);
    await user.click(back);
    const dialog = await screen.findByRole("alertdialog", { name: "Leave this workflow?" });
    await user.click(within(dialog).getByRole("button", { name: "Leave workflow" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledExactlyOnceWith("/workflows"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/workflows");
    expect(actions.save).not.toHaveBeenCalled();
    expect(actions.push).not.toHaveBeenCalled();
  });
  it("describes an in-flight save honestly and clears intent on acknowledged success", async () => {
    mountEditor();
    const user = userEvent.setup();
    const name = screen.getByRole("textbox", { name: "Workflow name" });
    await user.type(name, " saving");
    let finish!: (value: { ok: true; value: WorkflowDetail }) => void;
    actions.save.mockReturnValueOnce(
      new Promise<{ ok: true; value: WorkflowDetail }>((resolve) => {
        finish = resolve;
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    const back = screen.getByRole("link", { name: "All workflows" });
    const navigate = simulateRoute(back as HTMLAnchorElement);
    await user.click(back);
    const dialog = await screen.findByRole("alertdialog", { name: "Leave this workflow?" });
    expect(dialog).toHaveAccessibleDescription(
      "A workflow change is still in progress. Leaving will not cancel it. Leave?",
    );
    expect(within(dialog).getByRole("button", { name: "Stay here" })).toHaveFocus();
    expect(actions.save).toHaveBeenCalledTimes(1);
    await act(() => {
      finish({ ok: true, value: { ...fixture(), name: "Follow up saving", revision: 2 } });
      return Promise.resolve();
    });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(name).toHaveValue("Follow up saving");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(navigate).not.toHaveBeenCalled();
    expect(actions.save).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["de", "Du hast ungespeicherte Änderungen am Workflow. Ohne Speichern verlassen?"],
    ["fa", "تغییرات گردش‌کار هنوز ذخیره نشده‌اند. بدون ذخیره خارج شوید؟"],
  ] as const)("uses %s dialog copy without changing authored content", async (locale, prompt) => {
    mountEditor(locale);
    const user = userEvent.setup();
    const name = screen.getAllByRole("textbox")[0]!;
    await user.clear(name);
    await user.type(name, "پیگیری – Rückruf – Follow up");
    const back = document.querySelector<HTMLAnchorElement>('a[href="/workflows"]');
    if (!back) throw new Error("Editor back link missing");
    const navigate = simulateRoute(back);
    await user.click(back);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleDescription(prompt);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(name).toHaveValue("پیگیری – Rückruf – Follow up");
    expect(navigate).not.toHaveBeenCalled();
  });
});
