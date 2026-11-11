// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { TRPCClientError } from "@trpc/client";
import { afterEach, expect, it, vi } from "vitest";
import { useRealtimeChannel } from "./useRealtimeChannel";
import type * as MultiplexerModule from "./wsMultiplexer";
import { TicketAuthorizationDenied, type TicketMinter } from "./wsMultiplexer";

const state = vi.hoisted(() => ({
  minter: null as TicketMinter | null,
  mutate: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("@/config/clientEnv", () => ({ clientEnv: { WS_PUBLIC_URL: "same-origin" } }));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({ client: { realtime: { ticket: { mutate: state.mutate } } } }),
  },
}));
vi.mock("./wsMultiplexer", async (importOriginal) => {
  const original = await importOriginal<typeof MultiplexerModule>();
  return {
    ...original,
    WsMultiplexer: class {
      constructor(...args: [string, TicketMinter]) {
        state.minter = args[1];
      }
      subscribe() {
        return state.unsubscribe;
      }
    },
  };
});
afterEach(() => vi.clearAllMocks());

it("mints through the abortable raw client and classifies only confirmed tRPC authorization refusals", async () => {
  const hook = renderHook(() => useRealtimeChannel("user:u1", vi.fn()));
  const signal = new AbortController().signal;
  state.mutate.mockResolvedValueOnce({ ticket: "fresh-ticket" });
  await expect(state.minter?.(signal)).resolves.toBe("fresh-ticket");
  expect(state.mutate).toHaveBeenCalledExactlyOnceWith(undefined, { signal });

  for (const code of ["UNAUTHORIZED", "FORBIDDEN"]) {
    const refusal = new TRPCClientError("refused", {
      result: { error: { code: -32001, message: "refused", data: { code } } },
    });
    state.mutate.mockRejectedValueOnce(refusal);
    await expect(state.minter?.(signal)).rejects.toBeInstanceOf(TicketAuthorizationDenied);
  }
  const ordinaryFailure = Object.assign(new Error("network failure"), {
    data: { code: "UNAUTHORIZED" },
  });
  state.mutate.mockRejectedValueOnce(ordinaryFailure);
  await expect(state.minter?.(signal)).rejects.toBe(ordinaryFailure);
  hook.unmount();
  expect(state.unsubscribe).toHaveBeenCalledOnce();
});
