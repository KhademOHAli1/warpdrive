import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { workItems } from "./schema";
import { WorkService } from "./service";
import { type WorkFixture, workFixture } from "./work.test-helpers";

let f: WorkFixture;
beforeEach(async () => {
  f = await workFixture();
});
afterEach(async () => {
  await f.close();
});
it("tombstones an unknown UUID and permanently rejects a delayed original write", async () => {
  const type = (await f.install()).workTypes[0]!;
  const original = { action: "create_item" as const, requestId: randomUUID(), item: f.draft(type) };
  const cancel = {
    action: "cancel_operation" as const,
    requestId: randomUUID(),
    targetRequestId: original.requestId,
  };
  expect(await f.run(cancel)).toMatchObject({
    ok: true,
    value: { status: "canceled", requestId: original.requestId },
  });
  expect(await f.run(original)).toMatchObject({ ok: false, error: { code: "replay_conflict" } });
  expect(
    await new WorkService(f.db, f.admin, f.signal()).operation(original.requestId),
  ).toMatchObject({ ok: true, value: { status: "canceled", requestId: original.requestId } });
  expect(await f.db.select().from(workItems)).toHaveLength(0);
});
it("returns the completed original when it commits before cancellation", async () => {
  const type = (await f.install()).workTypes[0]!;
  const original = { action: "create_item" as const, requestId: randomUUID(), item: f.draft(type) };
  const created = await f.run(original);
  expect(created.ok).toBe(true);
  expect(
    await f.run({
      action: "cancel_operation",
      requestId: randomUUID(),
      targetRequestId: original.requestId,
    }),
  ).toMatchObject({
    ok: true,
    value: { status: "complete", data: { title: original.item.title } },
  });
  expect(await f.db.select().from(workItems)).toHaveLength(1);
});
it("serializes a simultaneous original/cancel into one committed result or one tombstone", async () => {
  const type = (await f.install()).workTypes[0]!;
  const original = { action: "create_item" as const, requestId: randomUUID(), item: f.draft(type) };
  const [create, cancel] = await Promise.all([
    f.run(original),
    f.run({
      action: "cancel_operation",
      requestId: randomUUID(),
      targetRequestId: original.requestId,
    }),
  ]);
  expect(cancel.ok).toBe(true);
  if (!cancel.ok) throw Error(cancel.error.code);
  const ack = cancel.value as { status: string };
  expect((await f.db.select().from(workItems)).length).toBe(ack.status === "complete" ? 1 : 0);
  expect(create.ok).toBe(ack.status === "complete");
});
