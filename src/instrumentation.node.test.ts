import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { registerNode } from "./instrumentation.node";

const startup = vi.hoisted(() => vi.fn());
vi.mock("@/jobs/appInstrumentation", () => ({ startAppBoss: startup }));
vi.mock("@/config/env", () => ({
  env: {
    DATABASE_URL: "postgres://fixture:synthetic-startup-secret@127.0.0.1/unused",
    NODE_ENV: "test",
  },
}));
beforeEach(() => {
  startup.mockReset();
});
afterEach(() => vi.restoreAllMocks());

it("rejects fatally with a registered sanitized error without exposing the original to Next", async () => {
  const secret = "synthetic-startup-secret";
  const original = Object.assign(new Error(`postgres://fixture:${secret}@127.0.0.1/unused`), {
    cause: { password: secret },
  });
  startup.mockRejectedValue(original);
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined);

  const failure: unknown = await registerNode().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(AppError);
  expect(failure).not.toBe(original);
  expect(failure).toMatchObject({
    id: ERROR_IDS.DB_WRITE_FAILED,
    message: "background queue startup failed",
  });
  expect(failure).not.toHaveProperty("cause");
  expect(JSON.stringify(failure)).not.toContain(secret);
  expect(String(failure)).not.toContain(secret);
  expect(report).toHaveBeenCalledExactlyOnceWith("FATAL: app pg-boss failed to start", {
    id: ERROR_IDS.DB_WRITE_FAILED,
  });
  expect(JSON.stringify(report.mock.calls)).not.toContain(secret);
});

it("keeps startup fatal and sanitized even if its diagnostics sink fails", async () => {
  startup.mockRejectedValue(new Error("synthetic-startup-secret"));
  vi.spyOn(console, "error").mockImplementation(() => {
    throw new Error("synthetic-sink-secret");
  });
  await expect(registerNode()).rejects.toMatchObject({
    id: ERROR_IDS.DB_WRITE_FAILED,
    message: "background queue startup failed",
  });
});

it("keeps successful producer startup unchanged", async () => {
  startup.mockResolvedValue(undefined);
  const report = vi.spyOn(console, "error").mockImplementation(() => undefined);
  await expect(registerNode()).resolves.toBeUndefined();
  expect(startup).toHaveBeenCalledTimes(1);
  expect(report).not.toHaveBeenCalled();
});
