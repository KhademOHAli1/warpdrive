import { EventEmitter } from "node:events";
import { Pool, type PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { AppError, ERROR_IDS } from "@/constants/errorIds";
import { observe } from "./privateIntakeLocalReadConnection";
import { ownPrivateReadLifecycle } from "./privateIntakeLocalReadLifecycle";
import { cleanupPrivateRead, performPrivateRead } from "./privateIntakeLocalReadTransaction";

const SETTLEMENT_CEILING_MS = 4500;
const EMPTY_RESULT = { rows: [] };

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const pending = new Promise<Value>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { pending, resolve, reject };
}

// This is a driver scheduling test, not a database or backend-cleanup proof.
// No SQL work callback runs and an attempted real backend observation is refused.
function commitDriver(rejectReceiptOnEnd = true) {
  const events = new EventEmitter();
  const dispatched = deferred<void>();
  const receipt = deferred<typeof EMPTY_RESULT>();
  const state = { status: "I", commits: 0, ends: 0, rollbacks: 0, releases: [] as boolean[] };
  const client = Object.assign(events, {
    pipeline: false,
    getTransactionStatus: () => state.status,
    query: (statement: string) => {
      if (statement.startsWith("BEGIN")) state.status = "T";
      if (statement.startsWith("SELECT pid"))
        return Promise.resolve({
          rows: [
            {
              pid: 123,
              started: "1",
              database_oid: "2",
              database_name: "driver-only",
              server_started: "3",
              address: "127.0.0.1",
              port: 5432,
            },
          ],
        });
      if (statement === "COMMIT") {
        state.commits += 1;
        dispatched.resolve();
        return receipt.pending;
      }
      if (statement === "ROLLBACK") {
        state.rollbacks += 1;
        state.status = "I";
      }
      return Promise.resolve(EMPTY_RESULT);
    },
    end: () => {
      state.ends += 1;
      if (rejectReceiptOnEnd) receipt.reject(new Error("Connection terminated"));
      queueMicrotask(() => events.emit("end"));
      return Promise.resolve();
    },
    release: (destroy = false) => state.releases.push(destroy),
  }) as unknown as PoolClient;
  const pool = new Pool();
  const observer = vi
    .spyOn(pool, "connect")
    .mockRejectedValue(new Error("Driver test has no real backend to observe"));
  const action = new AbortController();
  const life = ownPrivateReadLifecycle(client, action.signal);
  const pending = observe(performPrivateRead(life, pool, () => Promise.resolve("work-value")));
  return {
    action,
    client,
    dispatched: dispatched.pending,
    life,
    observer,
    pending,
    receipt,
    state,
    acknowledge() {
      state.status = "I";
      receipt.resolve(EMPTY_RESULT);
    },
    async close() {
      state.status = "I";
      receipt.resolve(EMPTY_RESULT);
      await pending;
      await cleanupPrivateRead(life);
      observer.mockRestore();
      await pool.end();
    },
  };
}

async function withinCeiling<Value>(pending: Promise<Value>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending.then((value) => ({ settled: true as const, value })),
      new Promise<{ settled: false }>((resolve) => {
        timer = setTimeout(() => resolve({ settled: false }), SETTLEMENT_CEILING_MS);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function expectCommitUncertainty(outcome: Awaited<ReturnType<typeof observe>>) {
  expect(outcome.ok).toBe(false);
  if (outcome.ok) return;
  expect(outcome.error).toBeInstanceOf(AppError);
  expect(outcome.error).toMatchObject({
    id: ERROR_IDS.DB_WRITE_FAILED,
    context: { phase: "commit-receipt" },
  });
}

describe("private local-read COMMIT receipt", () => {
  it.each([false, true])(
    "bounds a stalled receipt independently of caller abort (abort=%s)",
    async (abort) => {
      const driver = commitDriver();
      try {
        await driver.dispatched;
        const reason = new Error("Caller stopped after COMMIT dispatch");
        if (abort) driver.action.abort(reason);
        const completed = await withinCeiling(driver.pending);
        expect(
          completed.settled,
          "COMMIT acknowledgement must have a finite independent budget",
        ).toBe(true);
        if (!completed.settled) return;
        expectCommitUncertainty(completed.value);
        if (!completed.value.ok) expect(completed.value.error).not.toBe(reason);
        expect(driver.state.commits).toBe(1);
        expect(driver.state.rollbacks).toBe(0);
        expect(driver.state.ends).toBe(1);
      } finally {
        await driver.close();
      }
    },
  );

  it("does not release the pool slot before the actual stalled query settles", async () => {
    const driver = commitDriver(false);
    try {
      await driver.dispatched;
      driver.action.abort(new Error("Caller stopped after COMMIT dispatch"));
      const completed = await withinCeiling(driver.pending);
      expect(
        completed.settled,
        "Lost COMMIT receipt must return uncertainty before query settlement",
      ).toBe(true);
      if (!completed.settled) return;
      expectCommitUncertainty(completed.value);
      expect(driver.state.releases).toEqual([]);
      expect(driver.state.ends).toBe(1);
      expect(driver.state.rollbacks).toBe(0);
      driver.receipt.reject(new Error("Connection terminated"));
      await vi.waitFor(() => expect(driver.state.releases).toEqual([true]));
    } finally {
      await driver.close();
    }
  });

  it("retains an acknowledged success when the caller aborts after dispatch", async () => {
    const driver = commitDriver();
    try {
      await driver.dispatched;
      driver.action.abort(new Error("Caller stopped after COMMIT dispatch"));
      driver.acknowledge();
      expect(await driver.pending).toEqual({ ok: true, value: "work-value" });
      expect(driver.state.ends).toBe(0);
      expect(driver.state.commits).toBe(1);
    } finally {
      await driver.close();
    }
  });

  it("retains the original native COMMIT error instead of a late caller abort", async () => {
    const driver = commitDriver();
    try {
      await driver.dispatched;
      const native = Object.assign(new Error("Synthetic native COMMIT rejection"), {
        code: "40001",
      });
      driver.action.abort(new Error("Caller stopped after COMMIT dispatch"));
      driver.receipt.reject(native);
      expect(await driver.pending).toEqual({ ok: false, error: native });
      expect(driver.state.commits).toBe(1);
    } finally {
      await driver.close();
    }
  });
});
