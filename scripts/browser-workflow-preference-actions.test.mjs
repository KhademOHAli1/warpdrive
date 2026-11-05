import assert from "node:assert/strict";
import test from "node:test";
import {
  createPreferenceProbe,
  decodePreferenceResult,
} from "./browser-workflow-preference-actions.mjs";

const bytes = (value) => new TextEncoder().encode(value);

await test("reads only the action result selected by root a", () => {
  assert.deepEqual(
    decodePreferenceResult(bytes('1:{"ok":false,"error":{"id":"E_OTHER"}}\n0:{"a":{"ok":true}}\n')),
    { ok: true },
  );
});

await test("resolves forward action and error references", () => {
  assert.deepEqual(
    decodePreferenceResult(
      bytes('0:{"a":"$@1"}\n1:{"ok":false,"error":"$2"}\n2:{"id":"E_AUTH_CSRF"}\n'),
    ),
    { ok: false, error: { id: "E_AUTH_CSRF" } },
  );
});

await test("skips length-framed text containing misleading result JSON", () => {
  const text = '0:{"a":{"ok":false}}\n';
  const framed = `2:T${bytes(text).length.toString(16)},${text}`;
  assert.deepEqual(decodePreferenceResult(bytes(`${framed}0:{"a":{"ok":true}}\n`)), {
    ok: true,
  });
});

for (const [name, body] of [
  ["unselected successful model", '0:{"f":"tree"}\n1:{"ok":true}\n'],
  ["missing referenced result", '0:{"a":"$@1"}\n'],
  ["cyclic result references", '0:{"a":"$1"}\n1:"$2"\n2:"$1"\n'],
  ["untyped truthy result", '0:{"a":{"ok":1}}\n'],
  ["extra success fields", '0:{"a":{"ok":true,"ignored":true}}\n'],
  ["denial without typed error", '0:{"a":{"ok":false}}\n'],
  ["non-string error identity", '0:{"a":{"ok":false,"error":{"id":5}}}\n'],
  ["extra error fields", '0:{"a":{"ok":false,"error":{"id":"E_AUTH_CSRF","raw":"x"}}}\n'],
  ["duplicate JSON model identity", '0:{"a":{"ok":true}}\n0:{"a":{"ok":true}}\n'],
  ["truncated length-framed row", "2:Tff,short"],
  ["unterminated JSON row", '0:{"a":{"ok":true}}'],
  ["invalid hexadecimal model identity", 'z:{"a":{"ok":true}}\n'],
]) {
  await test(`rejects ${name}`, () => {
    assert.throws(() => decodePreferenceResult(bytes(body)));
  });
}

await test("rejects oversized and invalid UTF-8 bodies", () => {
  assert.throws(() => decodePreferenceResult(new Uint8Array(2_097_153)));
  assert.throws(() => decodePreferenceResult(Uint8Array.from([48, 58, 255, 10])));
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// These fake routes verify helper custody only. They establish no native browser behavior.
function probeFixture({ failFulfill = false, input = { enabled: true }, rawBody } = {}) {
  const url = "https://127.0.0.1:3443/settings/workflow";
  const fulfillment = deferred();
  const fulfillStarted = deferred();
  const state = { fetches: 0, fulfills: 0, disposals: 0, aborts: [] };
  const request = {
    url: () => url,
    method: () => "POST",
    headers: () => ({ "next-action": "synthetic-action-identity" }),
    postData: () => rawBody ?? JSON.stringify([input, null]),
  };
  const response = {
    status: () => 200,
    body: () => Promise.resolve(bytes('0:{"a":{"ok":true}}\n')),
    dispose: () => {
      state.disposals += 1;
      return Promise.resolve();
    },
  };
  const page = { url: () => url };
  const route = {
    request: () => request,
    fetch: (options) => {
      assert.deepEqual(options, { timeout: 10_000, maxRedirects: 0 });
      state.fetches += 1;
      return Promise.resolve(response);
    },
    fulfill: ({ response: actual }) => {
      assert.equal(actual, response);
      state.fulfills += 1;
      fulfillStarted.resolve();
      if (failFulfill) throw new Error("Synthetic route fulfillment refused");
      return fulfillment.promise;
    },
    abort: (reason) => {
      state.aborts.push(reason);
      return Promise.resolve();
    },
  };
  const probe = createPreferenceProbe(page, { origin: url });
  assert.equal(probe.matches(request), true);
  assert.equal(probe.matches({ ...request, method: () => "GET" }), false);
  assert.equal(probe.matches({ ...request, headers: () => ({}) }), false);
  assert.equal(
    probe.matches({ ...request, url: () => "https://127.0.0.1:3443/settings/profile" }),
    false,
  );
  assert.equal(
    probe.matches({ ...request, url: () => "https://example.invalid/settings/workflow" }),
    false,
  );
  return {
    probe,
    request,
    state,
    fulfillment,
    fulfillStarted,
    dispatch: () => probe.handle(route),
  };
}

await test("attributes only the exact request after successful fulfillment settles", async () => {
  const fixture = probeFixture();
  const { probe, request } = fixture;
  const hold = probe.expect({ kind: "won", value: true, ok: true });
  const running = fixture.dispatch();
  const unrelatedRequest = { ...request };
  try {
    await hold.reached();
    assert.equal(probe.deliveredObservation(request), undefined);
    hold.release();
    await Promise.race([
      fixture.fulfillStarted.promise,
      running.then(() => assert.fail("Route finished before fulfillment started")),
    ]);
    // Simulate inspection at the requestfailed race, before fulfill's promise continuation.
    assert.equal(probe.deliveredObservation(request), undefined);
    assert.equal(probe.deliveredObservation(unrelatedRequest), undefined);
    fixture.fulfillment.resolve();
    await hold.delivered();
    await running;
    assert.deepEqual(probe.deliveredObservation(request), {
      sequence: 1,
      kind: "won",
      value: true,
      outcome: { ok: true },
    });
    assert.equal(probe.deliveredObservation(unrelatedRequest), undefined);
    assert.equal(fixture.state.fetches, 1);
    assert.equal(fixture.state.disposals, 1);
    probe.assertHealthy();
  } finally {
    fixture.fulfillment.resolve();
    hold.release();
    await running;
    await probe.close();
  }
});

await test("failed fulfillment never qualifies and fails health and cleanup", async () => {
  const fixture = probeFixture({ failFulfill: true });
  const { probe, request } = fixture;
  const hold = probe.expect({ kind: "won", value: true, ok: true });
  const running = fixture.dispatch();
  try {
    await hold.reached();
    hold.release();
    await assert.rejects(hold.delivered(), /Workflow preference action probe:/);
    await running;
    assert.equal(probe.deliveredObservation(request), undefined);
    assert.throws(() => probe.assertHealthy(), /Workflow preference action probe:/);
    assert.equal(fixture.state.fulfills, 1);
    assert.equal(fixture.state.disposals, 1);
    assert.deepEqual(fixture.state.aborts, ["failed"]);
  } finally {
    fixture.fulfillment.resolve();
    hold.release();
    await running;
    await assert.rejects(probe.close(), /Workflow preference action probe:/);
  }
});

await test("transport abort never fetches upstream or qualifies as fulfilled", async () => {
  const fixture = probeFixture();
  const { probe, request } = fixture;
  const hold = probe.expect({
    kind: "won",
    value: true,
    ok: false,
    transportAbort: true,
  });
  const running = fixture.dispatch();
  try {
    assert.deepEqual(await hold.reached(), {
      sequence: 1,
      kind: "won",
      value: true,
      outcome: { transport: "aborted_before_upstream" },
    });
    assert.equal(probe.deliveredObservation(request), undefined);
    hold.release();
    await hold.delivered();
    await running;
    assert.equal(probe.deliveredObservation(request), undefined);
    assert.equal(fixture.state.fetches, 0);
    assert.equal(fixture.state.fulfills, 0);
    assert.equal(fixture.state.disposals, 0);
    assert.deepEqual(fixture.state.aborts, ["failed"]);
    probe.assertHealthy();
  } finally {
    hold.release();
    await running;
    await probe.close();
  }
});

/** @type {Array<[unknown, string, boolean | string]>} */
const supportedInputs = [
  [{ key: "usPhoneFormat", value: false }, "usPhoneFormat", false],
  [{ key: "winSound", value: true }, "winSound", true],
  [{ key: "scheduleFollowUpAfterDone", value: true }, "scheduleFollowUpAfterDone", true],
  [{ enabled: false }, "won", false],
  [{ leadDeal: true, person: false, org: true }, "details", "[true,false,true]"],
];
for (const [input, kind, value] of supportedInputs) {
  await test(`admits the exact supported ${kind} shape before observing its genuine result`, async () => {
    const f = probeFixture({ input });
    const hold = f.probe.expect({ kind, value, ok: true });
    const running = f.dispatch();
    try {
      assert.deepEqual(await hold.reached(), { sequence: 1, kind, value, outcome: { ok: true } });
      assert.equal(f.state.fetches, 1);
      hold.release();
      f.fulfillment.resolve();
      await hold.delivered();
      await running;
      assert.equal(f.state.disposals, 1);
    } finally {
      hold.release();
      f.fulfillment.resolve();
      await running;
      await f.probe.close();
    }
  });
}

/** @type {Array<[string, unknown]>} */
const refusedInputs = [
  ["mail flag", { key: "emailLinksNewTab", value: true }],
  ["unknown flag", { key: "arbitrary", value: true }],
  ["textual Boolean", { key: "winSound", value: "true" }],
  ["extra flag field", { key: "winSound", value: true, extra: true }],
  ["extra Won field", { enabled: true, extra: true }],
  ["incomplete details", { leadDeal: true, person: false }],
  ["textual detail", { leadDeal: true, person: "false", org: true }],
  ["extra detail", { leadDeal: true, person: false, org: true, extra: true }],
  ["array input", [true, false, true]],
];
for (const [name, input] of refusedInputs) {
  await test(`blocks ${name} before any upstream request`, async () => {
    const f = probeFixture({ input });
    const hold = f.probe.expect({ kind: "won", value: true, ok: true });
    const running = f.dispatch();
    hold.release();
    f.fulfillment.resolve();
    await assert.rejects(hold.reached(), /Workflow preference action probe:/);
    await running;
    assert.equal(f.state.fetches, 0);
    assert.equal(f.state.fulfills, 0);
    assert.deepEqual(f.state.aborts, ["failed"]);
    await assert.rejects(f.probe.close(), /Workflow preference action probe:/);
  });
}

for (const rawBody of ["[{}]", '[{"enabled":true},{}]', "not JSON"]) {
  await test(`refuses malformed action argument envelope ${rawBody}`, async () => {
    const f = probeFixture({ rawBody });
    const hold = f.probe.expect({ kind: "won", value: true, ok: true });
    const running = f.dispatch();
    hold.release();
    f.fulfillment.resolve();
    await assert.rejects(hold.reached(), /Workflow preference action probe:/);
    await running;
    assert.equal(f.state.fetches, 0);
    await assert.rejects(f.probe.close(), /Workflow preference action probe:/);
  });
}
