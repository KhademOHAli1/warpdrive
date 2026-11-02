import { expect, test } from "vitest";
import { prepareNativeAuthRequest } from "./prepareNativeAuthRequest";

const signal = () => AbortSignal.timeout(1000);
const limits = { maxBytes: 1024, timeoutMs: 100 };

function streamed(source: UnderlyingDefaultSource<Uint8Array>, requestSignal?: AbortSignal) {
  const request = new Request("https://app.example.com/api/auth/sign-in/email?returnTo=%2Fdeals", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.example.com" },
    body: new ReadableStream(source, { highWaterMark: 0 }),
    signal: requestSignal,
    // Node's Fetch requires duplex for an actual incoming stream; Bun accepts the same option.
    ...{ duplex: "half" },
  });
  return request;
}

test.each([
  ["application/json", '{"password":"ی+%00"}'],
  ["application/x-www-form-urlencoded", "password=a%2Bb&code=123"],
  [
    "multipart/form-data; boundary=x",
    '--x\r\nContent-Disposition: form-data; name="code"\r\n\r\n123\r\n--x--\r\n',
  ],
  ["application/octet-stream", "\u0000\u0001\u00ff"],
])("preserves exact native %s bytes, headers, URL and method", async (contentType, text) => {
  const bytes = new TextEncoder().encode(text);
  const incoming = new Request("https://app.example.com/api/auth/test?raw=%2B", {
    method: "POST",
    headers: {
      "content-type": contentType,
      cookie: "synthetic=fixture",
      "x-auth-fixture": "exact",
    },
    body: bytes,
  });
  const result = await prepareNativeAuthRequest(incoming, signal(), limits);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("body not admitted");
  expect(result.value.url).toBe(incoming.url);
  expect(result.value.method).toBe(incoming.method);
  expect([...result.value.headers]).toEqual([...incoming.headers]);
  expect(new Uint8Array(await result.value.arrayBuffer())).toEqual(bytes);
  expect(incoming.body?.locked).toBe(false);
});

test("deadline cancels an actual pending read and awaits transport cancellation before408", async () => {
  let cancelled = false;
  let retired = false;
  const request = streamed({
    cancel: () => {
      cancelled = true;
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          retired = true;
          resolve();
        }, 5),
      );
    },
  });
  expect(await prepareNativeAuthRequest(request, signal(), { ...limits, timeoutMs: 10 })).toEqual({
    ok: false,
    error: 408,
  });
  expect(cancelled).toBe(true);
  expect(retired).toBe(true);
  expect(request.body?.locked).toBe(false);
});

test("caller and actual client abort cancel pending input before return", async () => {
  for (const clientAbort of [false, true]) {
    const abort = new AbortController();
    let cancelled = 0;
    const request = streamed(
      {
        cancel: () => {
          cancelled++;
        },
      },
      clientAbort ? abort.signal : undefined,
    );
    const result = prepareNativeAuthRequest(request, clientAbort ? signal() : abort.signal, limits);
    abort.abort();
    expect(await result).toEqual({ ok: false, error: 408 });
    expect(cancelled).toBe(1);
    expect(request.body?.locked).toBe(false);
  }
});

test.each([false, true])(
  "oversize declared=%s cancels input and returns413 before parsing",
  async (declared) => {
    let cancelled = 0;
    const request = streamed({
      start: (controller) => controller.enqueue(new Uint8Array(9)),
      cancel: () => {
        cancelled++;
      },
    });
    if (declared) request.headers.set("content-length", "9");
    expect(await prepareNativeAuthRequest(request, signal(), { ...limits, maxBytes: 8 })).toEqual({
      ok: false,
      error: 413,
    });
    expect(cancelled).toBe(1);
    expect(request.body?.locked).toBe(false);
  },
);

test("a re-used producer buffer cannot change the admitted raw bytes", async () => {
  const buffer = new Uint8Array([1]);
  let pulls = 0;
  const request = streamed({
    pull: (controller) => {
      if (++pulls <= 2) {
        buffer[0] = pulls;
        controller.enqueue(buffer);
      } else controller.close();
    },
  });
  const result = await prepareNativeAuthRequest(request, signal(), limits);
  if (!result.ok) throw new Error("body not admitted");
  expect(new Uint8Array(await result.value.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
});

test("failed underlying cancellation is operational and does not report clean408", async () => {
  const request = streamed({
    cancel: () => Promise.reject(new Error("fixture cancellation failure")),
  });
  await expect(
    prepareNativeAuthRequest(request, signal(), { ...limits, timeoutMs: 5 }),
  ).rejects.toMatchObject({ id: "E_AUTH_009" });
  expect(request.body?.locked).toBe(false);
});
