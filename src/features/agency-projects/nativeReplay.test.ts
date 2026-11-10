import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { createProjectReplayCodec } from "./nativeReplay";

test("native replay binds the complete context and semantic input without storing plaintext", async () => {
  const codec = createProjectReplayCodec(randomBytes(32));
  const context = {
    actorUserId: randomUUID(),
    operation: "create" as const,
    intentId: randomUUID(),
    projectId: randomUUID(),
    revision: 0,
    historyId: randomUUID(),
  };
  const input = {
    intentId: context.intentId,
    ownerUserId: context.actorUserId,
    title: "Private client project",
    dealId: null,
    personId: null,
    orgId: randomUUID(),
  };
  const signal = AbortSignal.timeout(5000);
  const sealed = await codec.seal(context, input, signal);
  expect(sealed.ok).toBe(true);
  if (!sealed.ok) return;
  expect(sealed.value.bytes.toString()).not.toContain(input.title);
  expect(await codec.compare(context, sealed.value, input, signal)).toEqual({
    ok: true,
    value: true,
  });
  expect(
    await codec.compare(context, sealed.value, { ...input, title: "Changed" }, signal),
  ).toEqual({ ok: true, value: false });
  expect(
    await codec.compare({ ...context, actorUserId: randomUUID() }, sealed.value, input, signal),
  ).toEqual({ ok: true, value: false });
  expect(
    await createProjectReplayCodec(randomBytes(32)).compare(context, sealed.value, input, signal),
  ).toEqual({ ok: false, error: "project_unavailable" });
  expect(
    await codec.compare(context, { ...sealed.value, bytes: Buffer.from("broken") }, input, signal),
  ).toEqual({ ok: false, error: "project_unavailable" });
  await expect(codec.seal(context, input, AbortSignal.abort())).rejects.toThrow();
});
