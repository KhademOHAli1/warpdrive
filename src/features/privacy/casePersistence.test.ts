import { expect, test } from "vitest";
import { privacyStorageOperation } from "./casePersistence";

test("C06: cancellation remains cancellation rather than an ordinary storage retry", async () => {
  const signal = AbortSignal.abort();
  await expect(
    privacyStorageOperation(signal, () => Promise.resolve({ ok: true, value: true } as const)),
  ).rejects.toMatchObject({ name: "AbortError" });
});

test("C11: storage errors are minimized while programmer errors remain visible", async () => {
  const signal = AbortSignal.timeout(1000);
  const driver = Object.assign(new Error("PRIVATE-DRIVER-SENTINEL"), { code: "23514" });
  expect(
    await privacyStorageOperation(signal, () =>
      Promise.reject(Object.assign(new Error("DrizzleQueryError"), { cause: driver })),
    ),
  ).toEqual({ ok: false, error: "storage_unavailable" });
  await expect(
    privacyStorageOperation(signal, () => Promise.reject(new TypeError("programmer invariant"))),
  ).rejects.toThrow(TypeError);
});
