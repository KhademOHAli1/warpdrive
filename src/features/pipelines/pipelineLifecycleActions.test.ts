import { expect, test, vi } from "vitest";

const guard = vi.hoisted(() => vi.fn(() => Promise.resolve({ ok: true })));
vi.mock("@/features/identity/actions/shared", () => ({ guardCsrf: guard }));
vi.mock("@/config/env", async (original) => {
  const value = await original<{ env: Record<string, unknown> }>();
  return { ...value, env: { ...value.env, SALES_PIPELINE_LIFECYCLE_ENABLED: false } };
});

import { archivePipelineAction, restorePipelineAction } from "./pipelineLifecycleActions";

test("disabled lifecycle rejects writes even when clients submit an enable flag", async () => {
  expect(await archivePipelineAction({ enabled: true }, "csrf")).toEqual({
    ok: false,
    error: "unavailable",
  });
  expect(await restorePipelineAction({}, "csrf")).toEqual({ ok: false, error: "unavailable" });
  expect(guard).toHaveBeenCalledWith("csrf");
});

test("CSRF failure denies the mutation before feature admission", async () => {
  guard.mockResolvedValueOnce({ ok: false });
  expect(await archivePipelineAction({}, "bad-csrf")).toEqual({ ok: false, error: "denied" });
});
