import assert from "node:assert/strict";
import test from "node:test";
import { verifySdkSwitch } from "./web_sdk_switch_fixture.mjs";

const revision = "a".repeat(40);
const generation = `wd-${revision}`;
const path = "https://127.0.0.1:42317/settings/workflow";
const input = [{ key: "winSound", value: true }, "synthetic-fixture-token"];
const flight = new TextEncoder().encode('0:{"a":"$@1"}\n1:{"ok":true}\n');

function fixture({
  initialUrl = "https://127.0.0.1:42317/pipeline",
  candidateGeneration = generation,
  actionGeneration = generation,
  responseGeneration = generation,
  postData = input,
  posts = 1,
  persisted = true,
  body = flight,
} = {}) {
  const calls = [];
  const listeners = new Set();
  let currentUrl = initialUrl;
  let currentChecked = false;
  let focused = false;
  let pending;
  const response = (status, stamp, request) => ({
    status: () => status,
    headers: () => ({ "x-warpdrive-fixture-web-generation": stamp }),
    request: () => request,
    body: () => Promise.resolve(body),
  });
  const request = {
    url: () => path,
    method: () => "POST",
    headers: () => ({
      "next-action": "c".repeat(42),
      "x-deployment-id": actionGeneration,
    }),
    postData: () => JSON.stringify(postData),
  };
  const control = {
    waitFor: ({ state }) => Promise.resolve(assert.equal(state, "visible")),
    getAttribute: (name) =>
      Promise.resolve({ "aria-checked": String(currentChecked), type: "button" }[name]),
    focus: () => {
      focused = true;
      return Promise.resolve();
    },
    elementHandle: () =>
      Promise.resolve({
        dispose: () => {
          calls.push("focus-handle-disposed");
          return Promise.resolve();
        },
      }),
    and: (selector) => {
      assert.equal(selector, '[role="switch"][aria-checked="true"]');
      return {
        waitFor: () =>
          currentChecked
            ? Promise.resolve()
            : Promise.reject(Error("Switch did not remain checked")),
      };
    },
  };
  const page = {
    url: () => currentUrl,
    goto: (url) => {
      assert.equal(url, path);
      calls.push("goto");
      currentUrl = url;
      return Promise.resolve(response(200, candidateGeneration));
    },
    reload: () => {
      calls.push("reload");
      currentChecked = persisted;
      return Promise.resolve(response(200, generation));
    },
    getByRole: (role, options) => {
      assert.equal(role, "switch");
      assert.deepEqual(options, {
        name: "Play a coins sound after every won deal",
        exact: true,
      });
      return control;
    },
    locator: (selector) => selector,
    waitForFunction: () => Promise.resolve(assert.equal(focused, true)),
    on: (event, listener) => {
      assert.equal(event, "request");
      listeners.add(listener);
    },
    off: (event, listener) => {
      assert.equal(event, "request");
      assert.equal(listeners.delete(listener), true);
    },
    waitForResponse: (match) =>
      new Promise((resolve) => {
        pending = (reply) => {
          assert.equal(match(reply), true);
          resolve(reply);
        };
      }),
    keyboard: {
      press: (key) => {
        assert.equal(key, "Enter");
        calls.push("Enter");
        assert.equal(focused, true);
        currentChecked = true;
        for (let index = 0; index < posts; index += 1) {
          for (const listener of listeners) listener(request);
        }
        pending(response(200, responseGeneration, request));
        return Promise.resolve();
      },
    },
  };
  return { page, calls, listeners };
}

void test("candidate Switch reports one native action and stored state after reload", async () => {
  const { page, calls, listeners } = fixture();
  const facts = await verifySdkSwitch(page, { sourceRevision: revision });
  assert.deepEqual(facts, {
    schemaVersion: 1,
    activatedByKeyboard: true,
    savedByCandidate: true,
    persistedAfterReload: true,
    actionPosts: 1,
  });
  assert.deepEqual(calls, ["goto", "focus-handle-disposed", "Enter", "reload"]);
  assert.equal(listeners.size, 0);
});

void test("rejects foreign origins or incorrect candidate document stamps before mutation", async () => {
  for (const options of [
    { initialUrl: "https://example.test/settings/workflow" },
    { candidateGeneration: `wd-${"b".repeat(40)}` },
  ]) {
    const { page, calls, listeners } = fixture(options);
    await assert.rejects(verifySdkSwitch(page, { sourceRevision: revision }), /browser evidence/u);
    assert.ok(!calls.includes("Enter"));
    assert.equal(listeners.size, 0);
  }
});

void test("rejects duplicate, cross-generation, misdirected, denied or nonpersistent results", async () => {
  for (const options of [
    { posts: 2 },
    { actionGeneration: `wd-${"b".repeat(40)}` },
    { responseGeneration: `wd-${"b".repeat(40)}` },
    {
      postData: [{ key: "usPhoneFormat", value: true }, "synthetic-fixture-token"],
    },
    {
      body: new TextEncoder().encode('0:{"a":{"ok":false,"error":{"id":"E_AUTH_CSRF"}}}\n'),
    },
    { persisted: false },
  ]) {
    const { page, listeners } = fixture(options);
    await assert.rejects(verifySdkSwitch(page, { sourceRevision: revision }));
    assert.equal(listeners.size, 0);
  }
});
