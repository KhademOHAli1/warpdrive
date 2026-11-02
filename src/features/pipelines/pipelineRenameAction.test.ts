import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  rename: vi.fn(),
  context: vi.fn(),
  revalidate: vi.fn(),
  headers: new Headers({ cookie: "native-session" }),
  db: {},
}));
vi.mock("@/db/client", () => ({ db: mocks.db }));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: mocks.guard }));
vi.mock("@/server/trpc/context", () => ({ createContext: mocks.context }));
vi.mock("next/headers", () => ({ headers: () => Promise.resolve(mocks.headers) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("./pipelineActions", () => ({
  renamePipeline: mocks.rename,
  createPipelineWithStages: vi.fn(),
  createStage: vi.fn(),
  reorderStages: vi.fn(),
}));
vi.mock("./stageActions", () => ({ deleteStage: vi.fn(), updateStage: vi.fn() }));

import { renamePipelineAction } from "./pipelineEditActions";

const input = {
  pipelineId: "b016190d-f5ba-4c0f-8387-b080c705288a",
  name: "فروش / Vertrieb",
  expectedUpdatedAt: "2026-10-31T14:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ ok: true });
  mocks.context.mockResolvedValue({ actor: { id: "u1", type: "admin", flags: new Set() } });
  mocks.rename.mockResolvedValue({
    ok: true,
    value: {
      id: input.pipelineId,
      name: input.name,
      updatedAt: new Date("2026-10-31T14:00:01Z"),
      visibilityGroupId: "not-for-client",
    },
  });
});
test("rename wrapper passes only native headers and input through the guarded command", async () => {
  expect(await renamePipelineAction(input, "csrf")).toEqual({
    ok: true,
    value: { id: input.pipelineId, name: input.name, updatedAt: "2026-10-31T14:00:01.000Z" },
  });
  expect(mocks.rename).toHaveBeenCalledWith(
    mocks.db,
    mocks.headers,
    input,
    expect.any(AbortSignal),
  );
  expect(mocks.context).not.toHaveBeenCalled();
  expect(mocks.revalidate).toHaveBeenCalledWith("/settings/company/pipelines");
  expect(mocks.revalidate).toHaveBeenCalledWith("/pipeline");
});
test("CSRF rejection stops before rename command admission", async () => {
  mocks.guard.mockResolvedValue({ ok: false });
  expect(await renamePipelineAction(input, "bad-csrf")).toMatchObject({
    ok: false,
    error: { id: "E_AUTH_CSRF" },
  });
  expect(mocks.rename).not.toHaveBeenCalled();
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
