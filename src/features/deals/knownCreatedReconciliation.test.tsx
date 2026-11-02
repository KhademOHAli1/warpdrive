// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { NativeActorProvider } from "@/features/identity/NativeActorProvider";
import { initialAddDealState } from "./addDealState";
import { nativeDealCreateEnvelopeV1 } from "./nativeCreateIntentV1";
import { clearRetainedCreation, readRetainedCreation } from "./retainedCreation";
import { useNativeDealCreation } from "./useNativeDealCreation";

const { action, currentRead, oldBoardRead, created } = vi.hoisted(() => ({
  action: vi.fn(),
  currentRead: vi.fn(),
  oldBoardRead: vi.fn(() => Promise.resolve({ cards: [] })),
  created: vi.fn(),
}));
vi.mock("./nativeCreateAction", () => ({
  createNativeDealAction: action,
  readNativeDealCreationAction: currentRead,
}));
vi.mock("@/lib/trpc-client", () => ({
  trpc: { useUtils: () => ({ client: { deal: { board: { query: oldBoardRead } } } }) },
}));
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "csrf" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  pipeline = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  stage = "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  deal = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
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
      <span>{flow.hiddenTitle === null ? "not hidden" : "hidden notice"}</span>
      <button
        type="button"
        disabled={flow.pending}
        onClick={() =>
          void flow.submit((id) =>
            Promise.resolve({
              form: { ...initialAddDealState(pipeline, stage), title: "Preserved deal" },
              currency: "USD",
              valueLocale: "en" as const,
              deal: nativeDealCreateEnvelopeV1.parse({
                protocolVersion: 1,
                expectedActorId: actor,
                creationOperationId: id,
                deal: { title: "Preserved deal", pipelineId: pipeline, stageId: stage },
              }).deal,
            }),
          )
        }
      >
        Save
      </button>
    </>
  );
}
afterEach(() => {
  cleanup();
  const held = readRetainedCreation(actor);
  if (held) clearRetainedCreation(actor, held.id);
  vi.clearAllMocks();
});
test.each(["visible won deal", "visible moved deal"])(
  "known-created reconciliation resolves current ID for %s absent from original open board",
  async () => {
    const ack = {
      id: deal,
      updatedAt: "2026-11-02T00:00:00.000Z",
      writeVersion: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    };
    action.mockResolvedValueOnce({ ok: true, deal: ack, replayed: false });
    currentRead.mockResolvedValueOnce({
      ok: true,
      deal: { ...ack, writeVersion: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
      replayed: true,
    });
    render(
      <NativeActorProvider actorId={actor}>
        <Probe />
      </NativeActorProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(deal, "Preserved deal"));
    expect(screen.queryByText("hidden notice")).toBeNull();
    expect(oldBoardRead).not.toHaveBeenCalled();
    expect(currentRead).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(1);
  },
);

test("only an authorized null current-ID result clears known-created recovery as unavailable", async () => {
  action.mockResolvedValueOnce({
    ok: true,
    replayed: false,
    deal: { id: deal, updatedAt: "2026-11-02T00:00:00.000Z", writeVersion: stage },
  });
  currentRead.mockResolvedValueOnce({ ok: true, replayed: true, deal: null });
  render(
    <NativeActorProvider actorId={actor}>
      <Probe />
    </NativeActorProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText("hidden notice");
  expect(created).not.toHaveBeenCalled();
  expect(readRetainedCreation(actor)).toBeNull();
});

test("current-ID authorization/read denial retains the known-created key and never retries creation", async () => {
  action.mockResolvedValueOnce({
    ok: true,
    replayed: false,
    deal: { id: deal, updatedAt: "2026-11-02T00:00:00.000Z", writeVersion: stage },
  });
  currentRead.mockResolvedValue({ ok: false, error: { id: "E_AUTH_003" }, outcome: "unresolved" });
  render(
    <NativeActorProvider actorId={actor}>
      <Probe />
    </NativeActorProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(currentRead).toHaveBeenCalledTimes(1));
  const saved = readRetainedCreation(actor);
  expect(saved?.phase).toBe("created");
  expect(screen.queryByText("hidden notice")).toBeNull();
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled());
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(currentRead).toHaveBeenCalledTimes(2));
  expect(readRetainedCreation(actor)?.id).toBe(saved?.id);
  expect(action).toHaveBeenCalledTimes(1);
  expect(created).not.toHaveBeenCalled();
});
