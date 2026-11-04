import assert from "node:assert/strict";
import test from "node:test";
import { decodePreferenceResult } from "./browser-appearance-actions.mjs";

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
