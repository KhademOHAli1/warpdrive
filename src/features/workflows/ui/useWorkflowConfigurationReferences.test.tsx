// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, type Mock, vi } from "vitest";
import type {
  ConfigurationReferencesInput,
  ConfigurationReferencesPage,
} from "../configurationLookups";
import {
  useWorkflowConfigurationReferences,
  type WorkflowConfigurationReferencesInput,
} from "./useWorkflowConfigurationReferences";

type Page = Extract<ConfigurationReferencesPage, { state: "page" }>;
interface QueryState {
  data: ConfigurationReferencesPage | undefined;
  at: number;
  error: unknown;
  fetching: boolean;
  refetch: Mock<() => Promise<unknown>>;
}
const io = vi.hoisted(() => ({
  search: { data: undefined, at: 1, error: null, fetching: false, refetch: vi.fn() } as QueryState,
  selected: {
    data: undefined,
    at: 1,
    error: null,
    fetching: false,
    refetch: vi.fn(),
  } as QueryState,
  calls: vi.fn<(input: ConfigurationReferencesInput, options: unknown) => void>(),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    workflows: {
      configurationReferences: {
        useQuery(input: ConfigurationReferencesInput, options: unknown) {
          io.calls(input, options);
          const state = io[input.mode];
          return {
            data: state.data,
            dataUpdatedAt: state.at,
            isError: state.error !== null,
            error: state.error,
            isFetching: state.fetching,
            isLoading: false,
            refetch: state.refetch,
          };
        },
      },
    },
  },
}));

const workflowId = "52f6b244-2ea8-400a-92c9-b584c938562f";
const otherWorkflow = "52f6b244-2ea8-400a-92c9-b584c9385630";
const selectedId = "5dc59eb9-9b65-4da6-b7d1-dfbbe21f99e7";
const otherId = "0d54b7e5-5ea0-4149-8006-159a2bb792ec";
const thirdId = "f1853c8f-7c4e-46f0-8265-2775eb6c3d87";
const fingerprint = "a".repeat(64);
const input: WorkflowConfigurationReferencesInput = {
  workflowId,
  type: "record.read",
  selector: { kind: "builtin", name: "recordId" },
  enabled: true,
};
const page = (overrides: Partial<Page> = {}): Page => ({
  state: "page",
  workflowId,
  type: "record.read",
  version: 1,
  fingerprint,
  field: { kind: "builtin", name: "recordId" },
  mode: "search",
  query: "",
  items: [{ id: selectedId, label: "Visible deal" }],
  nextCursor: null,
  ...overrides,
});
const lastInput = (mode: "search" | "selected") =>
  io.calls.mock.calls.filter(([value]) => value.mode === mode).at(-1)?.[0];
const lastOptions = (mode: "search" | "selected") =>
  io.calls.mock.calls.filter(([value]) => value.mode === mode).at(-1)?.[1];

afterEach(cleanup);
beforeEach(() => {
  io.calls.mockClear();
  for (const state of [io.search, io.selected]) {
    state.at = 1;
    state.error = null;
    state.fetching = false;
    state.refetch.mockReset();
    state.refetch.mockResolvedValue({ isError: false });
  }
  io.search.data = page();
  io.selected.data = page({ mode: "selected" });
});

it("disables both reads outside a valid enabled profile/selector scope", () => {
  const hook = renderHook((props) => useWorkflowConfigurationReferences(props), {
    initialProps: { ...input, enabled: false },
  });
  expect(lastOptions("search")).toMatchObject({ enabled: false });
  expect(lastOptions("selected")).toMatchObject({ enabled: false });
  hook.rerender({ ...input, workflowId: "invalid" });
  expect(lastOptions("search")).toMatchObject({ enabled: false });
  hook.rerender({
    ...input,
    type: "activity.create",
    selector: { kind: "custom", fieldId: selectedId },
  });
  expect(lastOptions("search")).toMatchObject({ enabled: false });
  expect(hook.result.current.options).toEqual([]);
});

it("sends separate bounded search and selected reads and merges only confirmed safe labels", () => {
  io.selected.data = page({ mode: "selected", items: [{ id: otherId, label: "Selected deal" }] });
  const hook = renderHook(() =>
    useWorkflowConfigurationReferences({ ...input, selectedId: otherId }),
  );
  expect(lastInput("search")).toEqual({
    workflowId,
    type: "record.read",
    version: 1,
    field: input.selector,
    mode: "search",
    query: "",
    limit: 25,
  });
  expect(lastInput("selected")).toEqual({
    workflowId,
    type: "record.read",
    version: 1,
    field: input.selector,
    mode: "selected",
    ids: [otherId],
  });
  expect(hook.result.current).toMatchObject({
    status: "ready",
    selected: { id: otherId, label: "Selected deal" },
    unavailable: false,
  });
  expect(hook.result.current.options).toEqual([
    { id: selectedId, label: "Visible deal" },
    { id: otherId, label: "Selected deal" },
  ]);
});

it("bounds search at 200 characters and normalizes query without discarding raw whitespace", () => {
  const hook = renderHook(() => useWorkflowConfigurationReferences(input));
  act(() => hook.result.current.onSearch("  Ada  "));
  expect(lastInput("search")).toMatchObject({ query: "Ada", limit: 25 });
  expect(hook.result.current.search).toBe("  Ada  ");
  act(() => hook.result.current.onSearch("x".repeat(210)));
  expect(hook.result.current.search).toHaveLength(200);
  expect(lastInput("search")).toMatchObject({ query: "x".repeat(200) });
});

it("paginates explicitly, retains first-page rows, deduplicates and resets the cursor on search", () => {
  io.search.data = page({
    items: [
      { id: selectedId, label: "Visible deal" },
      { id: otherId, label: "Overlap deal" },
    ],
    nextCursor: "next",
  });
  const hook = renderHook(() => useWorkflowConfigurationReferences(input));
  act(() => hook.result.current.onMore?.());
  expect(lastInput("search")).toMatchObject({ cursor: "next", limit: 25 });
  expect(hook.result.current.status).not.toBe("ready");
  io.search.data = page({
    items: [
      { id: otherId, label: "Overlap deal" },
      { id: thirdId, label: "Second page deal" },
    ],
  });
  io.search.at = 2;
  hook.rerender();
  expect(hook.result.current.options).toEqual([
    { id: selectedId, label: "Visible deal" },
    { id: otherId, label: "Overlap deal" },
    { id: thirdId, label: "Second page deal" },
  ]);
  act(() => hook.result.current.onSearch("new"));
  expect(lastInput("search")).not.toHaveProperty("cursor");
  expect(hook.result.current.options).toEqual([]);
});

it("rejects mismatched workflow/type/version/field/query/fingerprint and selected mode contexts", () => {
  const hook = renderHook(() =>
    useWorkflowConfigurationReferences({ ...input, fingerprint, selectedId }),
  );
  for (const wrong of [
    page({ workflowId: otherWorkflow }),
    page({ type: "activity.create" }),
    { ...page(), version: 2 },
    page({ field: { kind: "builtin", name: "dealId" } }),
    page({ query: "elsewhere" }),
    page({ fingerprint: "b".repeat(64) }),
    page({ mode: "selected" }),
  ]) {
    io.search.data = wrong as Page;
    io.search.at += 1;
    hook.rerender();
    expect(hook.result.current.status).not.toBe("ready");
    expect(hook.result.current.options).toEqual([]);
  }
});

it("hides denied cached labels until a fresh current read is observed", () => {
  const hook = renderHook(() => useWorkflowConfigurationReferences(input));
  expect(hook.result.current.status).toBe("ready");
  io.search.error = { data: { code: "FORBIDDEN" } };
  hook.rerender();
  expect(hook.result.current).toMatchObject({ status: "denied", options: [] });
  io.search.error = null;
  hook.rerender();
  expect(hook.result.current.status).not.toBe("ready");
  expect(hook.result.current.options).toEqual([]);
  io.search.at += 1;
  hook.rerender();
  expect(hook.result.current.status).toBe("ready");
});

it("does not authorize selection from cached data after an operational read failure", () => {
  io.search.error = { data: { code: "INTERNAL_SERVER_ERROR" } };
  const hook = renderHook(() => useWorkflowConfigurationReferences(input));
  expect(hook.result.current).toMatchObject({ status: "error", options: [] });
  expect(hook.result.current.selected).toBeUndefined();
});

it("marks hidden selected IDs unavailable and never reuses an old selection label", () => {
  io.selected.data = page({ mode: "selected", items: [] });
  const hook = renderHook(
    (props: WorkflowConfigurationReferencesInput) => useWorkflowConfigurationReferences(props),
    { initialProps: { ...input, selectedId } },
  );
  expect(hook.result.current).toMatchObject({ status: "ready", unavailable: true });
  expect(hook.result.current.selected).toBeUndefined();
  expect(hook.result.current.options.some((option) => option.id === selectedId)).toBe(false);
  io.selected.data = page({
    mode: "selected",
    items: [{ id: selectedId, label: "Earlier selection" }],
  });
  io.selected.at += 1;
  hook.rerender({ ...input, selectedId: otherId });
  expect(hook.result.current.selected).toBeUndefined();
  expect(hook.result.current.options.some((option) => option.label === "Earlier selection")).toBe(
    false,
  );
});

it("retains search on stale metadata without exposing the stale labels", () => {
  const hook = renderHook(() => useWorkflowConfigurationReferences(input));
  act(() => hook.result.current.onSearch("Ada"));
  io.search.data = { state: "stale", fingerprint: "b".repeat(64), restart: true };
  io.search.at += 1;
  hook.rerender();
  expect(hook.result.current).toMatchObject({
    status: "error",
    stale: true,
    search: "Ada",
    options: [],
  });
});

it("ignores a held old-scope retry result after workflow and selector changes", async () => {
  let resolve: (value: unknown) => void = () => undefined;
  const held = new Promise<unknown>((done) => {
    resolve = done;
  });
  io.search.refetch.mockReturnValue(held);
  const hook = renderHook(
    (props: WorkflowConfigurationReferencesInput) => useWorkflowConfigurationReferences(props),
    { initialProps: input },
  );
  let retry: Promise<void> | undefined;
  try {
    act(() => {
      retry = hook.result.current.retry();
    });
    io.search.data = page({
      workflowId: otherWorkflow,
      type: "activity.create",
      field: { kind: "builtin", name: "dealId" },
    });
    io.search.at += 1;
    hook.rerender({
      ...input,
      workflowId: otherWorkflow,
      type: "activity.create",
      selector: { kind: "builtin", name: "dealId" },
    });
    await act(async () => {
      resolve({ isError: true });
      await retry;
    });
    expect(hook.result.current.status).toBe("ready");
    expect(io.search.refetch).toHaveBeenCalledOnce();
  } finally {
    await act(async () => {
      resolve({ isError: true });
      await held;
      await retry;
    });
  }
});

it("does not treat a failed or successful retry acknowledgement as a fresh read", async () => {
  const hook = renderHook(() => useWorkflowConfigurationReferences(input));
  io.search.refetch.mockResolvedValue({ isError: true });
  await act(async () => {
    await hook.result.current.retry();
  });
  expect(hook.result.current).toMatchObject({ status: "error", options: [] });
  io.search.refetch.mockResolvedValue({ isError: false, data: page() });
  await act(async () => {
    await hook.result.current.retry();
  });
  expect(hook.result.current.status).not.toBe("ready");
  io.search.at += 1;
  hook.rerender();
  expect(hook.result.current.status).toBe("ready");
});

it("resets cursor and labels on fingerprint/field changes while issuing only the current custom selector", () => {
  io.search.data = page({
    type: "activity.create",
    field: { kind: "custom", fieldId: selectedId },
    nextCursor: "next",
  });
  const custom: WorkflowConfigurationReferencesInput = {
    ...input,
    type: "activity.create",
    selector: { kind: "custom", fieldId: selectedId },
    fingerprint,
  };
  const hook = renderHook(
    (props: WorkflowConfigurationReferencesInput) => useWorkflowConfigurationReferences(props),
    { initialProps: custom },
  );
  act(() => hook.result.current.onMore?.());
  hook.rerender({
    ...custom,
    selector: { kind: "custom", fieldId: otherId },
    fingerprint: "b".repeat(64),
  });
  expect(lastInput("search")).toMatchObject({
    field: { kind: "custom", fieldId: otherId },
    fingerprint: "b".repeat(64),
  });
  expect(lastInput("search")).not.toHaveProperty("cursor");
  expect(hook.result.current.options).toEqual([]);
});

it("matches semantic selectors independently of JSON property order", () => {
  io.search.data = page({ field: { name: "recordId", kind: "builtin" } });
  const hook = renderHook(() => useWorkflowConfigurationReferences(input));
  expect(hook.result.current.status).toBe("ready");
  expect(hook.result.current.options).toEqual([{ id: selectedId, label: "Visible deal" }]);
});

it("keeps a failed selected retry blocked when only search receives a fresh success", async () => {
  io.selected.data = page({ mode: "selected", items: [{ id: otherId, label: "Earlier label" }] });
  const hook = renderHook(() =>
    useWorkflowConfigurationReferences({ ...input, selectedId: otherId }),
  );
  expect(hook.result.current.selected?.label).toBe("Earlier label");
  io.search.refetch.mockImplementation(() => {
    io.search.data = page({ items: [{ id: selectedId, label: "Fresh search result" }] });
    io.search.at += 1;
    return Promise.resolve({ isError: false, data: io.search.data });
  });
  io.selected.refetch.mockResolvedValue({ isError: true });
  await act(async () => {
    await hook.result.current.retry();
  });
  hook.rerender();
  expect(hook.result.current).toMatchObject({ status: "error", options: [] });
  expect(hook.result.current.selected).toBeUndefined();
  io.search.at += 1;
  hook.rerender();
  expect(hook.result.current.status).toBe("error");
  io.selected.data = page({
    mode: "selected",
    items: [{ id: otherId, label: "Fresh selected label" }],
  });
  io.selected.at += 1;
  hook.rerender();
  expect(hook.result.current).toMatchObject({
    status: "ready",
    selected: { id: otherId, label: "Fresh selected label" },
  });
});
