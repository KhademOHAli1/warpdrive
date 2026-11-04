// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, assert, beforeEach, expect, it, type Mock, vi } from "vitest";
import type { RouterOutputs } from "@/lib/trpc-client";
import type { WorkflowNode } from "../schemas";
import type { ConfigurationOptionsPage, ConfigurationPage } from "./configurationMetadataView";
import { useWorkflowConfiguration } from "./useWorkflowConfiguration";

type ReadPage = RouterOutputs["workflows"]["configuration"];
interface ReadIO {
  data: ReadPage | undefined;
  fetching: boolean;
  loading: boolean;
  error: unknown;
  updated: number;
  refetch: Mock<() => Promise<unknown>>;
  fields: Mock<(input: unknown) => Promise<ReadPage>>;
  options: Mock<(input: unknown) => Promise<RouterOutputs["workflows"]["configurationOptions"]>>;
}
const io = vi.hoisted(
  (): ReadIO => ({
    data: undefined,
    fetching: false,
    loading: false,
    error: null,
    updated: 1,
    refetch: vi.fn<() => Promise<unknown>>(),
    fields: vi.fn<(input: unknown) => Promise<ReadPage>>(),
    options:
      vi.fn<(input: unknown) => Promise<RouterOutputs["workflows"]["configurationOptions"]>>(),
  }),
);
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    workflows: {
      configuration: {
        useQuery: () => ({
          data: io.data,
          isLoading: io.loading,
          isFetching: io.fetching,
          isError: io.error !== null,
          error: io.error,
          dataUpdatedAt: io.updated,
          refetch: io.refetch,
        }),
      },
    },
    useUtils: () => ({
      workflows: {
        configuration: { fetch: io.fields },
        configurationOptions: { fetch: io.options },
      },
    }),
  },
}));
const a = "0d68fa78-fbb5-49ea-8473-e5f58f73ac78";
const b = "0331b96b-df36-45c1-9ae2-1938efee0b57";
const firstId = "693dd0e7-6324-42f1-918f-dbf7fc6167c9";
const secondId = "b80edf24-f97b-4505-a986-e4f6aa045f7f";
const fingerprint = "a".repeat(64);
const cursor = Buffer.from(
  JSON.stringify({
    v: 1,
    scope: "d".repeat(64),
    snapshot: fingerprint,
    key: { kind: "fields", order: 0, id: firstId },
  }),
).toString("base64url");
const node: WorkflowNode = {
  id: "task",
  type: "activity.create",
  version: 1,
  name: "Task",
  config: { subject: { kind: "value", value: "Follow up" } },
};
const descriptor = (id = firstId, name = "Current field"): ConfigurationPage["items"][number] => ({
  id,
  name,
  key: id === firstId ? "current" : "next",
  type: "text",
  order: id === firstId ? 0 : 1,
  isRequired: false,
  isImportant: false,
  optionCount: 0,
});
function page(overrides: Partial<ConfigurationPage> = {}): ConfigurationPage {
  return {
    state: "page",
    workflowId: a,
    type: "activity.create",
    version: 1,
    fingerprint,
    items: [descriptor()],
    nextCursor: cursor,
    totalFields: 2,
    capabilities: { edit: true },
    executionReasons: [],
    ...overrides,
  };
}
function tail(overrides: Partial<ConfigurationPage> = {}) {
  return page({
    items: [descriptor(secondId, "Continuation field")],
    nextCursor: null,
    ...overrides,
  });
}
function held<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function options(
  items: ConfigurationOptionsPage["items"],
  nextCursor: string | null,
): ConfigurationOptionsPage {
  return {
    state: "page",
    workflowId: a,
    type: "activity.create",
    version: 1,
    fieldId: firstId,
    fingerprint,
    query: "",
    items,
    nextCursor,
    totalOptions: 2,
  };
}

afterEach(cleanup);
beforeEach(() => {
  io.data = page();
  io.fetching = false;
  io.loading = false;
  io.error = null;
  io.updated = 1;
  io.fields.mockReset();
  io.options.mockReset();
  io.refetch.mockReset();
});

it("claims complete only after an uninterrupted current field-page chain", async () => {
  io.fields.mockResolvedValue(tail());
  const hook = renderHook(() => useWorkflowConfiguration(a, node));
  expect(hook.result.current.metadata.status).toBe("incomplete");
  assert(hook.result.current.loadMore !== undefined);
  await act(async () => {
    await hook.result.current.loadMore?.();
  });
  expect(hook.result.current.metadata.status).toBe("complete");
  expect(hook.result.current.metadata.defs?.map((def) => def.id)).toEqual([firstId, secondId]);
  expect(io.fields).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ workflowId: a, cursor, fingerprint }),
  );
});

it("ignores a held continuation success after A to B to A even when the schema fingerprint is unchanged", async () => {
  const pending = held<ReadPage>();
  io.fields.mockReturnValue(pending.promise);
  const hook = renderHook(({ id }) => useWorkflowConfiguration(id, node), {
    initialProps: { id: a },
  });
  let request: Promise<void> | undefined;
  try {
    act(() => {
      request = hook.result.current.loadMore?.();
    });
    io.data = page({ workflowId: b });
    hook.rerender({ id: b });
    io.data = page();
    hook.rerender({ id: a });
    await act(async () => {
      pending.resolve(tail());
      await request;
    });
    expect(hook.result.current.metadata.status).toBe("incomplete");
    expect(hook.result.current.metadata.defs?.map((def) => def.id)).toEqual([firstId]);
  } finally {
    await act(async () => {
      pending.resolve(tail());
      await request;
    });
  }
});

it("ignores an old-scope denial after A to B to A instead of hiding a newly confirmed scope", async () => {
  const pending = held<ReadPage>();
  io.fields.mockReturnValue(pending.promise);
  const hook = renderHook(({ id }) => useWorkflowConfiguration(id, node), {
    initialProps: { id: a },
  });
  let request: Promise<void> | undefined;
  try {
    act(() => {
      request = hook.result.current.loadMore?.();
    });
    io.data = page({ workflowId: b });
    hook.rerender({ id: b });
    io.data = page();
    hook.rerender({ id: a });
    await act(async () => {
      pending.reject({ data: { code: "FORBIDDEN" } });
      await request;
    });
    expect(hook.result.current.metadata.status).toBe("incomplete");
    expect(hook.result.current.authoring).toBe(true);
  } finally {
    await act(async () => {
      pending.resolve(tail());
      await request;
    });
  }
});

it("ignores a held old-fingerprint error after the current first-page fingerprint changes", async () => {
  const pending = held<ReadPage>();
  io.fields.mockReturnValue(pending.promise);
  const hook = renderHook(() => useWorkflowConfiguration(a, node));
  let request: Promise<void> | undefined;
  try {
    act(() => {
      request = hook.result.current.loadMore?.();
    });
    io.data = page({
      fingerprint: "b".repeat(64),
      items: [descriptor(firstId, "Fresh renamed field")],
    });
    io.updated = 2;
    hook.rerender();
    await act(async () => {
      pending.reject(new Error("Old continuation failed"));
      await request;
    });
    expect(hook.result.current.metadata.status).toBe("incomplete");
    expect(hook.result.current.metadata.defs?.[0]?.name).toBe("Fresh renamed field");
  } finally {
    await act(async () => {
      pending.resolve(tail());
      await request;
    });
  }
});

it("invalidates an older continuation error after a fresh first read even when the schema fingerprint stays equal", async () => {
  const pending = held<ReadPage>();
  io.fields.mockReturnValue(pending.promise);
  const hook = renderHook(() => useWorkflowConfiguration(a, node));
  let request: Promise<void> | undefined;
  try {
    act(() => {
      request = hook.result.current.loadMore?.();
    });
    io.updated = 2;
    hook.rerender();
    await act(async () => {
      pending.reject({ data: { code: "FORBIDDEN" } });
      await request;
    });
    expect(hook.result.current.metadata.status).toBe("incomplete");
    expect(hook.result.current.authoring).toBe(true);
  } finally {
    await act(async () => {
      pending.resolve(tail());
      await request;
    });
  }
});

it("keeps denied continuation labels hidden during a held Retry until a fresh current first read succeeds", async () => {
  io.fields.mockRejectedValue({ data: { code: "FORBIDDEN" } });
  const hook = renderHook(() => useWorkflowConfiguration(a, node));
  await act(async () => {
    await hook.result.current.loadMore?.();
  });
  expect(hook.result.current.metadata).toEqual({ status: "denied" });
  io.refetch.mockResolvedValueOnce({
    isError: true,
    error: { data: { code: "INTERNAL_SERVER_ERROR" } },
    data: page(),
    dataUpdatedAt: 1,
  });
  await act(async () => {
    await hook.result.current.retry();
  });
  expect(hook.result.current.metadata).toEqual({ status: "denied" });
  io.refetch.mockClear();
  const pending = held<unknown>();
  io.refetch.mockReturnValue(pending.promise);
  io.fetching = true;
  let retry: Promise<void> | undefined;
  try {
    act(() => {
      retry = hook.result.current.retry();
    });
    expect(hook.result.current.metadata.defs).toBeUndefined();
    expect(hook.result.current.authoring).toBe(false);
    expect(io.refetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      io.fetching = false;
      io.updated = 2;
      pending.resolve({ data: page(), isError: false, dataUpdatedAt: 2 });
      await retry;
    });
    expect(hook.result.current.metadata.status).toBe("incomplete");
    expect(hook.result.current.metadata.defs?.[0]?.name).toBe("Current field");
  } finally {
    await act(async () => {
      pending.resolve({ isError: true });
      await retry;
    });
  }
});

it("retains only same-key cached context on operational failure or stale response and hides it on denial", () => {
  const hook = renderHook(({ id }) => useWorkflowConfiguration(id, node), {
    initialProps: { id: a },
  });
  io.error = { data: { code: "INTERNAL_SERVER_ERROR" } };
  hook.rerender({ id: a });
  expect(hook.result.current.metadata.status).toBe("error");
  expect(hook.result.current.metadata.defs?.[0]?.id).toBe(firstId);
  io.error = null;
  io.data = { state: "stale", fingerprint: "b".repeat(64), restart: true };
  hook.rerender({ id: a });
  expect(hook.result.current.metadata.status).toBe("stale");
  expect(hook.result.current.metadata.defs?.[0]?.id).toBe(firstId);
  io.error = { data: { code: "FORBIDDEN" } };
  hook.rerender({ id: a });
  expect(hook.result.current.metadata).toEqual({ status: "denied" });
  io.error = { data: { code: "INTERNAL_SERVER_ERROR" } };
  hook.rerender({ id: a });
  expect(hook.result.current.metadata).toEqual({ status: "denied" });
  io.error = null;
  hook.rerender({ id: b });
  expect(hook.result.current.metadata.defs).toBeUndefined();
});

it("loads one unfiltered option continuation per request and cannot claim complete from the first option page", async () => {
  io.data = page({
    items: [{ ...descriptor(), type: "single_option", optionCount: 2 }],
    nextCursor: null,
    totalFields: 1,
  });
  const pending = held<RouterOutputs["workflows"]["configurationOptions"]>();
  io.options
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(options([{ id: "second", label: "Second" }], null));
  const hook = renderHook(() => useWorkflowConfiguration(a, node));
  let first: Promise<void> | undefined;
  try {
    act(() => {
      first = hook.result.current.loadMore?.();
      void hook.result.current.loadMore?.();
    });
    expect(io.options).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(options([{ id: "first", label: "First" }], "option-tail"));
      await first;
    });
    expect(hook.result.current.metadata.status).toBe("incomplete");
    await act(async () => {
      await hook.result.current.loadMore?.();
    });
    expect(hook.result.current.metadata.status).toBe("complete");
    expect(hook.result.current.metadata.defs?.[0]?.options).toEqual([
      { id: "first", label: "First" },
      { id: "second", label: "Second" },
    ]);
  } finally {
    await act(async () => {
      pending.resolve(options([], null));
      await first;
    });
  }
});

it("allows a new scope request while an old one is held and prevents old cleanup clearing the new busy state", async () => {
  const old = held<ReadPage>();
  const current = held<ReadPage>();
  io.fields.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const hook = renderHook(({ id }) => useWorkflowConfiguration(id, node), {
    initialProps: { id: a },
  });
  let oldRequest: Promise<void> | undefined;
  let newRequest: Promise<void> | undefined;
  try {
    act(() => {
      oldRequest = hook.result.current.loadMore?.();
    });
    io.data = page({ workflowId: b });
    hook.rerender({ id: b });
    act(() => {
      newRequest = hook.result.current.loadMore?.();
    });
    expect(io.fields).toHaveBeenCalledTimes(2);
    await act(async () => {
      old.resolve(tail());
      await oldRequest;
    });
    expect(hook.result.current.busy).toBe(true);
    await act(async () => {
      current.resolve(tail({ workflowId: b }));
      await newRequest;
    });
    expect(hook.result.current.busy).toBe(false);
    expect(hook.result.current.metadata.status).toBe("complete");
  } finally {
    await act(async () => {
      old.resolve(tail());
      current.resolve(tail({ workflowId: b }));
      await Promise.all([oldRequest, newRequest]);
    });
  }
});
