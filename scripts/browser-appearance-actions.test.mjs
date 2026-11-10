import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createPreferenceProbe, decodePreferenceResult } from "./browser-appearance-actions.mjs";
import { observeScriptRequests } from "./browser-script-requests.mjs";

const bytes = (value) => new TextEncoder().encode(value);

await test("classifies a cancelled script only after the identical asset finishes loading", () => {
  const page = new EventEmitter();
  const origin = "https://127.0.0.1:3443";
  const scripts = observeScriptRequests(page, origin);
  const request = (url) => ({ url: () => url, method: () => "GET", resourceType: () => "script" });
  const prefix = `${origin}/_next/static/chunks/`;
  const loaded = { path: "/loaded.js", failure: "net::ERR_ABORTED" };
  const incomplete = { path: "/incomplete.js", failure: "net::ERR_ABORTED" };
  const differentQuery = { path: "/versioned.js", failure: "net::ERR_ABORTED" };
  assert.equal(scripts.deferCancellation(request(`${prefix}loaded.js`), loaded), true);
  assert.equal(scripts.deferCancellation(request(`${prefix}incomplete.js`), incomplete), true);
  assert.equal(
    scripts.deferCancellation(request(`${prefix}versioned.js?v=1`), differentQuery),
    true,
  );
  for (const file of ["loaded.js", "incomplete.js", "versioned.js?v=2"]) {
    const actual = request(`${prefix}${file}`);
    page.emit("response", { request: () => actual, ok: () => true });
    if (file !== "incomplete.js") page.emit("requestfinished", actual);
  }
  assert.equal(
    scripts.deferCancellation(
      request("https://example.invalid/_next/static/chunks/loaded.js"),
      loaded,
    ),
    false,
  );
  assert.deepEqual(scripts.classifyCancellations(), {
    loaded: [loaded],
    failed: [incomplete, differentQuery],
  });
  assert.deepEqual(scripts.classifyCancellations(), { loaded: [], failed: [] });
});

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
function probeFixture({ failFulfill = false } = {}) {
  const url = "https://127.0.0.1:3443/settings/appearance";
  const fulfillment = deferred();
  const fulfillStarted = deferred();
  const state = { fetches: 0, fulfills: 0, disposals: 0, aborts: [] };
  const request = {
    url: () => url,
    method: () => "POST",
    headers: () => ({ "next-action": "synthetic-action-identity" }),
    postData: () => JSON.stringify([{ appearance: "night" }, null]),
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
    probe.matches({ ...request, url: () => "https://example.invalid/settings/appearance" }),
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
  const hold = probe.expect({ kind: "appearance", value: "night", ok: true });
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
      kind: "appearance",
      value: "night",
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
  const hold = probe.expect({ kind: "appearance", value: "night", ok: true });
  const running = fixture.dispatch();
  try {
    await hold.reached();
    hold.release();
    await assert.rejects(hold.delivered(), /Appearance action probe:/);
    await running;
    assert.equal(probe.deliveredObservation(request), undefined);
    assert.throws(() => probe.assertHealthy(), /Appearance action probe:/);
    assert.equal(fixture.state.fulfills, 1);
    assert.equal(fixture.state.disposals, 1);
    assert.deepEqual(fixture.state.aborts, ["failed"]);
  } finally {
    fixture.fulfillment.resolve();
    hold.release();
    await running;
    await assert.rejects(probe.close(), /Appearance action probe:/);
  }
});

await test("transport abort never fetches upstream or qualifies as fulfilled", async () => {
  const fixture = probeFixture();
  const { probe, request } = fixture;
  const hold = probe.expect({
    kind: "appearance",
    value: "night",
    ok: false,
    transportAbort: true,
  });
  const running = fixture.dispatch();
  try {
    assert.deepEqual(await hold.reached(), {
      sequence: 1,
      kind: "appearance",
      value: "night",
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
