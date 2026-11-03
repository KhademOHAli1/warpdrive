// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { NativeStageMoveFeedback } from "./NativeStageMoveFeedback";
import { nativeStageMoveInput } from "./nativeStageTypes";
import type { useDealMove } from "./useDealMove";

afterEach(cleanup);
const input = nativeStageMoveInput.parse({
  protocolVersion: 1,
  expectedActorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  dealId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  pipelineId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  toStageId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  expectedWriteVersion: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  beforePosition: null,
  afterPosition: null,
});
function view(
  phase: "unknown" | "conflict" | "confirmed" | "pending",
  notice: ReturnType<typeof useDealMove>["notice"] = null,
) {
  const load = vi.fn(async () => {});
  render(
    <NativeStageMoveFeedback
      move={{
        state: { id: "local-attempt", input, phase },
        notice,
        busy: phase === "pending",
        blocked: true,
        move: vi.fn(),
        loadCurrentState: load,
      }}
    />,
  );
  return load;
}
test("unknown outcome offers a read action rather than retry or a false failed/success state", () => {
  const load = view("unknown");
  expect(screen.getByRole("alert").textContent).toContain("could not confirm");
  fireEvent.click(screen.getByRole("button", { name: "Load current state" }));
  expect(load).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: /retry/i })).toBeNull();
});
test("current-state recovery explicitly cannot attest the earlier request", () => {
  view("unknown", "current");
  expect(screen.getByText(/does not confirm whether an earlier move completed/)).toBeTruthy();
});
test("stale conflict and acknowledged refresh failure have distinct truthful messages", () => {
  view("conflict");
  expect(screen.getByRole("alert").textContent).toContain("changed before your move was saved");
  cleanup();
  view("confirmed");
  expect(screen.getByRole("status").textContent).toContain("move was saved");
});
test("pending state has no recover/retry action", () => {
  view("pending");
  expect(screen.getByRole("status").textContent).toContain("Saving");
  expect(screen.queryByRole("button")).toBeNull();
});
