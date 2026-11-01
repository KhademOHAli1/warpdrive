import { afterEach, expect, it, vi } from "vitest";
import {
  readPrivateIntakeSummary,
  reviewPrivateIntakeSummary,
} from "./privateIntakeTransport.client";
import {
  boundedIntakeTransport,
  deferredIntakeTransport,
  intakeTransportIds as ids,
  intakeTransportResponse,
  malformedIntakeSuccess,
  intakeTransportRead as readInput,
  intakeTransportReview as reviewInput,
  intakeTransportSummary as summary,
} from "./privateIntakeTransport.fixtures";

const { csrf, readCsrf } = vi.hoisted(() => {
  const csrf = { value: "current-csrf" as string | null };
  return { csrf, readCsrf: vi.fn(() => csrf.value) };
});
vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: readCsrf }));
const signal = () => new AbortController().signal;
afterEach(() => {
  vi.unstubAllGlobals();
  readCsrf.mockClear();
  csrf.value = "current-csrf";
});

it("reads both account and intake selectors with native credentials and no mutation token", async () => {
  csrf.value = null;
  const request = intakeTransportResponse({ ok: true, value: summary }, 201);
  const s = signal();
  expect(await readPrivateIntakeSummary(readInput, s)).toEqual({ ok: true, value: summary });
  expect(request).toHaveBeenCalledExactlyOnceWith(
    `/api/email/private-intake?accountId=${ids.account}&intakeId=${ids.intake}`,
    { method: "GET", credentials: "same-origin", cache: "no-store", signal: s, headers: {} },
  );
  expect(readCsrf).not.toHaveBeenCalled();
});

it.each(["keep_private", "dismiss", "restore_private"] as const)(
  "saves only the exact %s decision and next revision",
  async (decision) => {
    const input = { ...reviewInput, decision };
    const saved = { ...summary, revision: 5, decision };
    const request = intakeTransportResponse({ ok: true, value: saved });
    const s = signal();
    expect(await reviewPrivateIntakeSummary(input, s)).toEqual({ ok: true, value: saved });
    expect(request).toHaveBeenCalledExactlyOnceWith("/api/email/private-intake", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: s,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": "current-csrf" },
      body: JSON.stringify(input),
    });
    expect(readCsrf).toHaveBeenCalledTimes(1);
  },
);

it.each([null, ""])("blocks mutation without CSRF (%s)", async (token) => {
  csrf.value = token;
  const request = intakeTransportResponse({ ok: true, value: summary });
  expect(await reviewPrivateIntakeSummary(reviewInput, signal())).toEqual({
    ok: false,
    error: "forbidden",
  });
  expect(request).not.toHaveBeenCalled();
});

it.each([
  null,
  {},
  { intakeId: ids.intake },
  { ...readInput, accountId: "bad" },
  { ...readInput, intakeId: "bad" },
  { ...readInput, attemptId: ids.intake },
])("rejects invalid read input before browser work: %j", async (input) => {
  const request = intakeTransportResponse({ ok: true, value: summary });
  expect(await readPrivateIntakeSummary(input, signal())).toEqual({
    ok: false,
    error: "unavailable",
  });
  expect(request).not.toHaveBeenCalled();
  expect(readCsrf).not.toHaveBeenCalled();
});

it.each([
  null,
  { ...reviewInput, accountId: "bad" },
  { ...reviewInput, expectedRevision: -1 },
  { ...reviewInput, expectedRevision: 0.5 },
  { ...reviewInput, expectedRevision: 2_147_483_647 },
  { ...reviewInput, expectedRevision: "4" },
  { ...reviewInput, decision: "associate" },
  { ...reviewInput, confirmationAttemptId: ids.intake },
])("rejects invalid review input before token or fetch access: %j", async (input) => {
  const request = intakeTransportResponse({ ok: true, value: summary });
  expect(await reviewPrivateIntakeSummary(input, signal())).toEqual({
    ok: false,
    error: "unavailable",
  });
  expect(request).not.toHaveBeenCalled();
  expect(readCsrf).not.toHaveBeenCalled();
});

it.each(malformedIntakeSuccess)(
  "withholds malformed or mismatched success: %s",
  async (_label, body) => {
    const request = intakeTransportResponse(body);
    expect(await readPrivateIntakeSummary(readInput, signal())).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it.each([
  [401, "forbidden"],
  [403, "forbidden"],
  [404, "not_found"],
  [409, "conflict"],
  [400, "unavailable"],
  [429, "unavailable"],
  [408, "unavailable"],
  [500, "unavailable"],
] as const)(
  "maps authoritative HTTP %s to %s without accepting a success body",
  async (status, error) => {
    const request = intakeTransportResponse(
      { ok: true, value: { ...summary, revision: 5, decision: "keep_private" } },
      status,
    );
    expect(await reviewPrivateIntakeSummary(reviewInput, signal())).toEqual({ ok: false, error });
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it.each([
  ["old revision", { ...summary, decision: "keep_private" }],
  ["skipped revision", { ...summary, revision: 6, decision: "keep_private" }],
  ["other decision", { ...summary, revision: 5, decision: "dismiss" }],
  ["other intake", { ...summary, id: ids.otherIntake, revision: 5, decision: "keep_private" }],
] as const)("rejects a mismatched review acknowledgment: %s", async (_label, value) => {
  intakeTransportResponse({ ok: true, value });
  expect(await reviewPrivateIntakeSummary(reviewInput, signal())).toEqual({
    ok: false,
    error: "unavailable",
  });
});

it("does not cache or coalesce distinct mailbox and intake reads", async () => {
  const request = intakeTransportResponse({ ok: true, value: summary });
  await readPrivateIntakeSummary(readInput, signal());
  await readPrivateIntakeSummary({ ...readInput, accountId: ids.otherAccount }, signal());
  await readPrivateIntakeSummary({ ...readInput, intakeId: ids.otherIntake }, signal());
  expect(request).toHaveBeenCalledTimes(3);
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    `/api/email/private-intake?accountId=${ids.account}&intakeId=${ids.intake}`,
    `/api/email/private-intake?accountId=${ids.otherAccount}&intakeId=${ids.intake}`,
    `/api/email/private-intake?accountId=${ids.account}&intakeId=${ids.otherIntake}`,
  ]);
});

it.each(["fetch", "json"] as const)("sanitizes a %s failure without retrying", async (stage) => {
  const response = Response.json({});
  if (stage === "json")
    vi.spyOn(response, "json").mockRejectedValue(new TypeError("private JSON details"));
  const request = vi.fn<typeof fetch>();
  if (stage === "fetch") request.mockRejectedValue(new TypeError("private provider address"));
  else request.mockResolvedValue(response);
  vi.stubGlobal("fetch", request);
  expect(await readPrivateIntakeSummary(readInput, signal())).toEqual({
    ok: false,
    error: "unavailable",
  });
  expect(request).toHaveBeenCalledTimes(1);
});

it.each(["fetch", "json"] as const)("preserves a native AbortError from %s", async (stage) => {
  const reason = new DOMException("Native cancellation", "AbortError");
  const response = Response.json({});
  if (stage === "json") vi.spyOn(response, "json").mockRejectedValue(reason);
  const request = vi.fn<typeof fetch>();
  if (stage === "fetch") request.mockRejectedValue(reason);
  else request.mockResolvedValue(response);
  vi.stubGlobal("fetch", request);
  await expect(readPrivateIntakeSummary(readInput, signal())).rejects.toBe(reason);
});

it.each(["read", "review"] as const)(
  "pre-aborts %s without CSRF or fetch access",
  async (operation) => {
    const request = intakeTransportResponse({ ok: true, value: summary });
    const controller = new AbortController();
    const reason = new DOMException("Reader left", "AbortError");
    controller.abort(reason);
    const pending =
      operation === "read"
        ? readPrivateIntakeSummary(readInput, controller.signal)
        : reviewPrivateIntakeSummary(reviewInput, controller.signal);
    await expect(pending).rejects.toBe(reason);
    expect(request).not.toHaveBeenCalled();
    expect(readCsrf).not.toHaveBeenCalled();
  },
);

it.each([
  ["fetch", "success"],
  ["fetch", "rejection"],
  ["json", "success"],
  ["json", "rejection"],
] as const)(
  "cancels promptly during ignored %s work and observes its late %s",
  async (stage, completion) => {
    const fetchWork = deferredIntakeTransport<Response>(),
      jsonWork = deferredIntakeTransport<unknown>();
    const response = Response.json({});
    const decode = vi.spyOn(response, "json").mockImplementation(() => jsonWork.promise);
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        stage === "fetch" ? fetchWork.promise : Promise.resolve(response),
      );
    vi.stubGlobal("fetch", request);
    const controller = new AbortController();
    const pending = reviewPrivateIntakeSummary(reviewInput, controller.signal);
    const observed = pending.then(
      (value) => value,
      (error: unknown) => error,
    );
    const unhandled: unknown[] = [];
    const observeUnhandled = (error: unknown) => {
      unhandled.push(error);
    };
    process.on("unhandledRejection", observeUnhandled);
    try {
      await vi.waitFor(
        () => expect(stage === "fetch" ? request : decode).toHaveBeenCalledTimes(1),
        { timeout: 500, interval: 1 },
      );
      const reason = new DOMException("Scope changed", "AbortError");
      controller.abort(reason);
      expect(await boundedIntakeTransport(observed)).toBe(reason);
      if (completion === "rejection") {
        if (stage === "fetch") fetchWork.reject(new TypeError("late private upstream"));
        else jsonWork.reject(new TypeError("late private JSON"));
      } else {
        const value = { ok: true, value: { ...summary, revision: 5, decision: "keep_private" } };
        if (stage === "fetch") fetchWork.resolve(Response.json(value));
        else jsonWork.resolve(value);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
      expect(request).toHaveBeenCalledTimes(1);
      if (stage === "fetch") expect(decode).not.toHaveBeenCalled();
    } finally {
      controller.abort();
      fetchWork.resolve(response);
      jsonWork.resolve({ ok: true, value: summary });
      await boundedIntakeTransport(observed);
      process.off("unhandledRejection", observeUnhandled);
    }
  },
);
