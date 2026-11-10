import assert from "node:assert/strict";
import { expect, test } from "vitest";
import { ok, type Result } from "@/types/result";
import type { ProviderAdapter, ProviderFailure, ProviderInput, ProviderOutput } from "./contract";
import { invokeProvider } from "./invoke";

type CheckResult = Result<ProviderOutput<"check">, ProviderFailure>;
const checkInput = {
  credential: { id: "f030286b-9f21-445c-88ec-de119b3787ce", generation: 1 },
};
const checkValue = { checkedAt: 1000, grantedScopes: ["read"], accountId: "account-one" };
const reasons = [
  { name: "object", create: () => ({ marker: "synthetic-private-caller-abort-object" }) },
  { name: "string", create: () => "synthetic-private-caller-abort-string" },
  { name: "null", create: () => null },
];

function adapter(check: ProviderAdapter["operations"]["check"]): ProviderAdapter {
  return {
    id: "fixture",
    operations: {
      authorize: { mode: "unsupported" },
      exchange: { mode: "unsupported" },
      refresh: { mode: "unsupported" },
      listResources: { mode: "unsupported" },
      check,
      disconnect: { mode: "unsupported" },
      discoverCapabilities: { mode: "unsupported" },
    },
  };
}

test.each(reasons)(
  "preserves an exact $name caller reason before adapter entry",
  async ({ create }) => {
    const reason = create();
    const controller = new AbortController();
    controller.abort(reason);
    let calls = 0;
    const run = () => {
      calls++;
      return Promise.resolve(ok(checkValue));
    };
    const [outcome] = await Promise.allSettled([
      invokeProvider(adapter({ mode: "supported", run }), "check", checkInput, {
        signal: controller.signal,
        timeoutMs: 1000,
      }),
    ]);
    expect(calls).toBe(0);
    expect(controller.signal.reason === reason).toBe(true);
    assert(outcome !== undefined);
    expect(outcome.status === "rejected").toBe(true);
    assert(outcome.status === "rejected");
    // Identity booleans keep deliberately private caller-owned reasons out of RED output.
    expect(outcome.reason === reason).toBe(true);
  },
);

test.each(reasons)(
  "preserves an exact $name caller reason after adapter entry",
  async ({ create }) => {
    const reason = create();
    const controller = new AbortController();
    const entered: { calls: number; signal?: AbortSignal } = { calls: 0 };
    const gate: { finish?: (value: CheckResult) => void } = {};
    const held = new Promise<CheckResult>((resolve) => {
      gate.finish = resolve;
    });
    let adapterSettled = false;
    const adapterSettlement = held.then(
      () => {
        adapterSettled = true;
      },
      () => {
        adapterSettled = true;
      },
    );
    const run = (_input: ProviderInput<"check">, signal: AbortSignal) => {
      entered.calls++;
      entered.signal = signal;
      // Intentionally noncooperative: only this test's finally block can settle the adapter.
      return held;
    };
    const invocation = invokeProvider(adapter({ mode: "supported", run }), "check", checkInput, {
      signal: controller.signal,
      timeoutMs: 1000,
    });
    const settled = Promise.allSettled([invocation]);
    try {
      await Promise.resolve();
      expect(entered.calls).toBe(1);
      const captured = entered.signal;
      expect(captured instanceof AbortSignal).toBe(true);
      assert(captured !== undefined);
      expect(adapterSettled).toBe(false);
      controller.abort(reason);
      const [outcome] = await settled;
      expect(captured.aborted).toBe(true);
      expect(captured.reason === reason).toBe(true);
      expect(adapterSettled).toBe(false);
      assert(outcome !== undefined);
      expect(outcome.status === "rejected").toBe(true);
      assert(outcome.status === "rejected");
      expect(outcome.reason === reason).toBe(true);
    } finally {
      if (!controller.signal.aborted) controller.abort(reason);
      assert(gate.finish !== undefined);
      gate.finish(ok(checkValue));
      await Promise.allSettled([held, invocation, adapterSettlement, settled]);
      await Promise.resolve();
    }
  },
);
