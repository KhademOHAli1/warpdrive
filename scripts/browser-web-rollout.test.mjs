import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  failureRecord,
  ROLLOUT_TIMING,
  RolloutProofError,
  switchControl,
} from "./browser-web-rollout.mjs";

function fixture(t) {
  const source = new PassThrough();
  const clock = { value: 0 };
  const control = switchControl(source, {
    now: () => clock.value,
    sleep: (milliseconds) => {
      clock.value += milliseconds;
      return Promise.resolve();
    },
  });
  t.after(() => {
    control.input.close();
    source.destroy();
  });
  const send = (command) => source.write(`${JSON.stringify({ command })}\n`);
  return { source, clock, control, send };
}

const reason = (expected) => (error) =>
  error instanceof RolloutProofError && error.reason === expected;

await test("health preflight can exceed 45 seconds before the explicit armed boundary", async (t) => {
  const { clock, control, send } = fixture(t);
  control.expect("arm-pre-switch");
  clock.value = 60000;
  send("arm-pre-switch");
  await control.wait(ROLLOUT_TIMING.total);
  control.expect("pre-switch");
  clock.value += 44000;
  send("pre-switch");
  await control.wait(ROLLOUT_TIMING.armed);
  control.expect("switched");
  send("switched");
  await control.wait(ROLLOUT_TIMING.switched);
  assert.equal(control.elapsed(), 104000);
  assert.deepEqual(ROLLOUT_TIMING, { total: 180000, armed: 45000, switched: 15000 });
  assert.ok(Object.isFrozen(ROLLOUT_TIMING));
});

await test("arming never resets the original 180 second overall deadline", async (t) => {
  const { clock, control, send } = fixture(t);
  control.expect("arm-pre-switch");
  clock.value = 170000;
  send("arm-pre-switch");
  await control.wait(ROLLOUT_TIMING.total);
  control.expect("pre-switch");
  await assert.rejects(control.wait(ROLLOUT_TIMING.armed), reason("global-deadline"));
  assert.equal(clock.value, 180000);
});

await test("unarmed coordination remains bounded by the same overall deadline", async (t) => {
  const { control } = fixture(t);
  control.expect("arm-pre-switch");
  await assert.rejects(control.wait(ROLLOUT_TIMING.total), reason("global-deadline"));
});

await test("armed and switched command windows retain their exact bounds", async (t) => {
  for (const phase of ["pre-switch", "switched"]) {
    await t.test(phase, async (child) => {
      const { clock, control, send } = fixture(child);
      control.expect("arm-pre-switch");
      send("arm-pre-switch");
      await control.wait(ROLLOUT_TIMING.total);
      control.expect("pre-switch");
      if (phase === "switched") {
        send("pre-switch");
        await control.wait(ROLLOUT_TIMING.armed);
        control.expect("switched");
      }
      const timeout = phase === "pre-switch" ? ROLLOUT_TIMING.armed : ROLLOUT_TIMING.switched;
      await assert.rejects(control.wait(timeout), reason("command-timeout"));
      assert.equal(clock.value, timeout);
    });
  }
});

await test("control rejects early, wrong, duplicate, ambiguous and extra commands", async (t) => {
  for (const [name, raw, early] of [
    ["early", '{"command":"arm-pre-switch"}\n', true],
    ["wrong-order", '{"command":"pre-switch"}\n'],
    ["unknown", '{"command":"retry"}\n'],
    ["duplicate", '{"command":"arm-pre-switch"}\n{"command":"arm-pre-switch"}\n'],
    ["duplicate-key", '{"command":"switched","command":"arm-pre-switch"}\n'],
    ["extra-field", '{"command":"arm-pre-switch","detail":"private"}\n'],
    ["null", "null\n"],
    ["incomplete", "not-json\n"],
    ["oversized", `${" ".repeat(129)}\n`],
  ]) {
    await t.test(name, async (child) => {
      const { control, source } = fixture(child);
      if (!early) control.expect("arm-pre-switch");
      source.write(raw);
      await assert.rejects(control.wait(ROLLOUT_TIMING.total), reason("control-invalid"));
    });
  }
});

await test("end of control input holds before any switch instruction", async (t) => {
  const { control, source } = fixture(t);
  control.expect("arm-pre-switch");
  source.end();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(control.wait(ROLLOUT_TIMING.total), reason("control-eof"));
});

await test("the proof guard still runs even when the requested command is already available", async (t) => {
  const { control, send } = fixture(t);
  control.expect("arm-pre-switch");
  send("arm-pre-switch");
  await assert.rejects(
    control.wait(ROLLOUT_TIMING.total, () => {
      throw new RolloutProofError("page-error");
    }),
    reason("page-error"),
  );
});

await test("failure diagnostics contain only fixed reasons, stages and bounded monotonic durations", () => {
  const secret = "https://private.invalid/?ticket=do-not-record";
  const unknown = failureRecord(secret, new Error(secret), Number.NaN, Number.POSITIVE_INFINITY);
  assert.deepEqual(unknown, {
    event: "browser.web-rollout.failed",
    stage: "profile",
    reason: "unclassified-proof-failure",
    elapsedMs: 0,
    phaseElapsedMs: 0,
  });
  assert.ok(!JSON.stringify(unknown).includes(secret));
  assert.deepEqual(
    failureRecord("pre-switch-socket", new RolloutProofError("control-eof"), 123.9, 45.1),
    {
      event: "browser.web-rollout.failed",
      stage: "pre-switch-socket",
      reason: "control-eof",
      elapsedMs: 123,
      phaseElapsedMs: 45,
    },
  );
  assert.equal(
    failureRecord("profile", new RolloutProofError(secret), -1, 9000000).reason,
    "unclassified-proof-failure",
  );
  assert.equal(
    failureRecord("profile", new RolloutProofError(secret), -1, 9000000).phaseElapsedMs,
    3600000,
  );
});
