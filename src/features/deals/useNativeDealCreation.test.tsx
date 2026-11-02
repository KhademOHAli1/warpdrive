// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";
import { initialAddDealState } from "./addDealState";
import { nativeDealCreateEnvelopeV1 } from "./nativeCreateIntentV1";
import type { NativeDealCreateResult } from "./nativeCreateTypes";
import { clearRetainedCreation, readRetainedCreation } from "./retainedCreation";
import { useNativeDealCreation } from "./useNativeDealCreation";

const { action, read, created } = vi.hoisted(() => ({
  action: vi.fn<(raw: unknown, csrf: string | null) => Promise<NativeDealCreateResult>>(),
  read: vi.fn<(...args: unknown[]) => Promise<NativeDealCreateResult>>(() =>
    Promise.resolve({ ok: true, deal: null, replayed: true }),
  ),
  created: vi.fn(),
}));
vi.mock("./nativeCreateAction", () => ({
  createNativeDealAction: action,
  readNativeDealCreationAction: read,
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: { useUtils: () => ({ client: { deal: { board: { query: read } } } }) },
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  pipeline = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  stage = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
function Probe() {
  const flow = useNativeDealCreation({
    onCreated: created,
    onClose: vi.fn(),
    openDetails: false,
    suppressDetailNav: false,
    restoreForm: vi.fn(),
  });
  return (
    <>
      <span>{flow.actorId}</span>
      <span data-testid="phase">{flow.operation?.phase ?? "empty"}</span>
      <button
        type="button"
        disabled={flow.actorId === null || flow.pending}
        onClick={() =>
          void flow.submit((id) =>
            Promise.resolve({
              form: { ...initialAddDealState(pipeline, stage), title: "A original" },
              currency: "USD",
              valueLocale: "en" as const,
              deal: nativeDealCreateEnvelopeV1.parse({
                protocolVersion: 1,
                expectedActorId: flow.actorId,
                creationOperationId: id,
                deal: { title: "A original", pipelineId: pipeline, stageId: stage },
              }).deal,
            }),
          )
        }
      >
        Save fixture
      </button>
    </>
  );
}
afterEach(() => {
  cleanup();
  for (const actor of [a, b]) {
    const held = readRetainedCreation(actor);
    if (held) clearRetainedCreation(actor, held.id);
  }
  vi.clearAllMocks();
});
test("late A acknowledgement stays in A's partition and never mutates B's view or callbacks", async () => {
  let complete: (result: NativeDealCreateResult) => void = () => undefined;
  const response = new Promise<NativeDealCreateResult>((resolve) => {
    complete = resolve;
  });
  action.mockReturnValueOnce(response);
  const view = render(
    <NativeActorProvider key={a} actorId={a}>
      <Probe />
    </NativeActorProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save fixture" }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  view.rerender(
    <NativeActorProvider key={b} actorId={b}>
      <Probe />
    </NativeActorProvider>,
  );
  await act(() => {
    complete({
      ok: true,
      replayed: false,
      deal: {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        updatedAt: "2026-11-02T00:00:00.000Z",
        writeVersion: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      },
    });
    return response;
  });
  expect(screen.getByText(b)).toBeInTheDocument();
  expect(screen.getByTestId("phase")).toHaveTextContent("empty");
  expect(readRetainedCreation(a)?.phase).toBe("created");
  expect(readRetainedCreation(b)).toBeNull();
  expect(read).not.toHaveBeenCalled();
  expect(created).not.toHaveBeenCalled();
});
test("missing server-established account disables native creation", () => {
  render(<Probe />);
  expect(screen.getByRole("button", { name: "Save fixture" })).toBeDisabled();
  expect(action).not.toHaveBeenCalled();
});

test("two mounted same-account modals share one attempt through acknowledgement and failed-read recovery", async () => {
  let complete: (result: NativeDealCreateResult) => void = () => undefined;
  const response = new Promise<NativeDealCreateResult>((resolve) => {
    complete = resolve;
  });
  action.mockReturnValueOnce(response);
  read.mockRejectedValueOnce(new TypeError("qualification read failure"));
  render(
    <NativeActorProvider key={a} actorId={a}>
      <Probe />
      <Probe />
    </NativeActorProvider>,
  );
  const buttons = screen.getAllByRole("button", { name: "Save fixture" });
  fireEvent.click(buttons[0]!);
  fireEvent.click(buttons[1]!);
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  expect(buttons[0]).toBeDisabled();
  expect(buttons[1]).toBeDisabled();
  await act(() => {
    complete({
      ok: true,
      replayed: false,
      deal: { id: pipeline, updatedAt: "2026-11-02T00:00:00.000Z", writeVersion: stage },
    });
    return response;
  });
  expect(screen.getAllByTestId("phase").map((node) => node.textContent)).toEqual([
    "created",
    "created",
  ]);
  expect(readRetainedCreation(a)?.phase).toBe("created");
  read.mockResolvedValueOnce({
    ok: true,
    replayed: true,
    deal: { id: pipeline, updatedAt: "2026-11-02T00:00:00.000Z", writeVersion: stage },
  });
  fireEvent.click(buttons[1]!);
  await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
  expect(action).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(2);
});

test("a definitive later negative after uncertainty never releases the retained key for a new operation", async () => {
  action.mockRejectedValueOnce(new TypeError("qualification lost response"));
  action.mockResolvedValueOnce({ ok: false, error: { id: "E_PERM_001" }, outcome: "not_created" });
  render(
    <NativeActorProvider key={a} actorId={a}>
      <Probe />
      <Probe />
    </NativeActorProvider>,
  );
  const buttons = screen.getAllByRole("button", { name: "Save fixture" });
  fireEvent.click(buttons[0]!);
  await waitFor(() => expect(readRetainedCreation(a)?.phase).toBe("unknown"));
  const original = readRetainedCreation(a);
  fireEvent.click(buttons[1]!);
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(buttons[1]).not.toBeDisabled());
  expect(readRetainedCreation(a)?.id).toBe(original?.id);
  expect(readRetainedCreation(a)?.phase).toBe("unknown");
  expect(action.mock.calls[1]?.[0]).toEqual(action.mock.calls[0]?.[0]);
  expect(created).not.toHaveBeenCalled();
});
