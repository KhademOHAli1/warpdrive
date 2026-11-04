// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkflowPaletteSnapshot } from "../paletteCatalog";
import { paletteSnapshot } from "./palette.TestHelpers";
import { useWorkflowPalette } from "./useWorkflowPalette";

const io = vi.hoisted(() => ({
  data: undefined as WorkflowPaletteSnapshot | undefined,
  fetching: false,
  loading: false,
  error: null as unknown,
  refetch: vi.fn<() => Promise<unknown>>(),
  calls: vi.fn<(input: unknown, options: unknown) => void>(),
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    workflows: {
      palette: {
        useQuery: (input: unknown, options: unknown) => {
          io.calls(input, options);
          return {
            data: io.data,
            isFetching: io.fetching,
            isLoading: io.loading,
            isError: io.error !== null,
            error: io.error,
            refetch: io.refetch,
          };
        },
      },
    },
  },
}));
const id = "52f6b244-2ea8-400a-92c9-b584c938562f";
afterEach(cleanup);
beforeEach(() => {
  io.calls.mockClear();
  io.refetch.mockReset();
  io.refetch.mockResolvedValue({ isError: false });
  io.data = paletteSnapshot();
  io.fetching = false;
  io.loading = false;
  io.error = null;
});

it("disables metadata networking while closed or without a valid workflow identity", () => {
  const hook = renderHook(({ open, workflowId }) => useWorkflowPalette(workflowId, open), {
    initialProps: { open: false, workflowId: id },
  });
  expect(io.calls.mock.lastCall?.[1]).toMatchObject({ enabled: false });
  hook.rerender({ open: true, workflowId: "not-a-workflow" });
  expect(io.calls.mock.lastCall?.[1]).toMatchObject({ enabled: false });
  expect(io.refetch).not.toHaveBeenCalled();
  expect(hook.result.current.status).not.toBe("ready");
});

it("uses only a confirmed current read and revalidates each open rather than authoring from cached data", () => {
  const hook = renderHook(() => useWorkflowPalette(id, true));
  expect(io.calls.mock.lastCall?.[0]).toEqual({ id });
  expect(io.calls.mock.lastCall?.[1]).toMatchObject({ enabled: true, refetchOnMount: "always" });
  expect(hook.result.current).toMatchObject({ status: "ready", workflowId: id, data: io.data });
  io.fetching = true;
  hook.rerender();
  expect(hook.result.current.status).toBe("loading");
});

it("does not reuse a metadata snapshot from a different workflow key", () => {
  io.data = paletteSnapshot({ workflowId: "52f6b244-2ea8-400a-92c9-b584c9385630" });
  const hook = renderHook(() => useWorkflowPalette(id, true));
  expect(hook.result.current.status).toBe("loading");
  expect(hook.result.current.data).toBeUndefined();
});

it("clears confirmed denied metadata but retains same-key review context for an operational failure", () => {
  io.error = { data: { code: "FORBIDDEN" } };
  const hook = renderHook(() => useWorkflowPalette(id, true));
  expect(hook.result.current.status).toBe("denied");
  expect(hook.result.current.data).toBeUndefined();
  io.error = { data: { code: "INTERNAL_SERVER_ERROR" } };
  hook.rerender();
  expect(hook.result.current.status).toBe("error");
  expect(hook.result.current.data).toBe(io.data);
});

it("admits one read-only retry at a time and does not turn the retry acknowledgement into authority", async () => {
  let resolve: (value: unknown) => void = () => undefined;
  const held = new Promise<unknown>((done) => {
    resolve = done;
  });
  io.error = { data: { code: "INTERNAL_SERVER_ERROR" } };
  io.refetch.mockReturnValue(held);
  const hook = renderHook(() => useWorkflowPalette(id, true));
  try {
    await act(async () => {
      const first = hook.result.current.retry();
      const repeated = hook.result.current.retry();
      resolve({ isError: false, data: io.data });
      await Promise.all([first, repeated]);
    });
    expect(io.refetch).toHaveBeenCalledTimes(1);
    expect(hook.result.current.status).toBe("error");
  } finally {
    await act(async () => {
      resolve({ isError: true });
      await held;
    });
  }
});
