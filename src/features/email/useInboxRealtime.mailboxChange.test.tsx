// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { WsFrame } from "@/features/realtime/wsMultiplexer";
import { useInboxRealtime } from "./useInboxRealtime";

const state = vi.hoisted(() => ({
  frame: undefined as ((frame: WsFrame) => void) | undefined,
  inbox: vi.fn(),
  thread: vi.fn(),
  changed: vi.fn(),
}));
vi.mock("@/features/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (_channel: string, callback: (frame: WsFrame) => void) => {
    state.frame = callback;
  },
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: {
    useUtils: () => ({
      email: {
        inbox: { list: { invalidate: state.inbox } },
        thread: { get: { invalidate: state.thread } },
      },
    }),
  },
}));

it("refreshes folder and open-thread state for remote flag/deletion changes", () => {
  renderHook(() =>
    useInboxRealtime({
      selfActorId: "owner",
      openThreadId: "open-thread",
      onMailboxChanged: state.changed,
    }),
  );
  state.frame?.({
    kind: "event",
    event: {
      seq: 1,
      type: "email_mailbox_changed",
      data: { accountId: "owned-account" },
    },
  });
  expect(state.changed).toHaveBeenCalledOnce();
  expect(state.inbox).toHaveBeenCalledOnce();
  expect(state.thread).toHaveBeenCalledWith({ threadId: "open-thread" });
});
