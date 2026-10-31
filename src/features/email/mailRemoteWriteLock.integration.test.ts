import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { withTestDb } from "@/db/testing";
import { lockMailRemoteWrites } from "./mailRemoteWriteLock";

it("serializes remote artifact writes per account and releases on transaction completion", async () => {
  await withTestDb(async (db) => {
    const id = randomUUID();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let announce = () => {};
    const ready = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const first = db.transaction(async (tx) => {
      await lockMailRemoteWrites(tx, id, AbortSignal.timeout(5000));
      announce();
      await held;
    });
    await ready;
    let entered = false;
    const waiting = db.transaction(async (tx) => {
      await lockMailRemoteWrites(tx, id, AbortSignal.timeout(5000));
      entered = true;
    });
    try {
      await db.transaction((tx) =>
        lockMailRemoteWrites(tx, randomUUID(), AbortSignal.timeout(5000)),
      );
      expect(entered).toBe(false);
    } finally {
      release();
      await Promise.all([first, waiting]);
    }
    expect(entered).toBe(true);
  });
});

it("cancels a lock waiter without retaining locks or stalling another account", async () => {
  await withTestDb(async (db) => {
    const id = randomUUID();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let announce = () => {};
    const ready = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const first = db.transaction(async (tx) => {
      await lockMailRemoteWrites(tx, id, AbortSignal.timeout(5000));
      announce();
      await held;
    });
    await ready;
    try {
      await expect(
        db.transaction((tx) => lockMailRemoteWrites(tx, id, AbortSignal.timeout(80))),
      ).rejects.toMatchObject({ name: "TimeoutError" });
    } finally {
      release();
      await first;
    }
    await db.transaction((tx) => lockMailRemoteWrites(tx, id, AbortSignal.timeout(1000)));
  });
});
