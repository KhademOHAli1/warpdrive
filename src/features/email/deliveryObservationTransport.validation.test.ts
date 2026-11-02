import { afterEach, expect, it, vi } from "vitest";
import {
  listDeliveryObservationReviewTargets,
  readDeliveryObservationReports,
  reviewDeliveryObservation,
} from "./deliveryObservationTransport.client";
import {
  transportIds as ids,
  transportAssociatedReport,
  transportReport,
  transportResponse,
  transportReview,
  transportSaved,
  transportTargets,
} from "./deliveryObservationTransport.fixtures";

vi.mock("@/utils/csrfCookie", () => ({ readCsrfToken: () => "current-csrf" }));
const signal = () => new AbortController().signal;
afterEach(() => {
  vi.unstubAllGlobals();
});

it.each([
  { accountId: "not-an-account", sourceMessageId: ids.source },
  { accountId: ids.account, sourceMessageId: "https://untrusted.example.test" },
  { accountId: ids.account },
  { accountId: ids.account, sourceMessageId: ids.source, attemptId: ids.attempt },
  { accountId: ids.account, sourceMessageId: ids.source, actorId: "forged" },
  { accountId: ids.account, reportId: ids.report },
])("rejects invalid read scope before fetch: %#", async (input) => {
  const request = transportResponse({ ok: true, value: [] });
  expect(await readDeliveryObservationReports(input, signal())).toEqual({
    ok: false,
    error: "invalid_input",
  });
  expect(request).not.toHaveBeenCalled();
});

it.each([
  { ...transportReview, actorId: "forged" },
  { ...transportReview, confirmUnverified: false },
  { ...transportReview, expectedRevision: -1 },
  { ...transportReview, recipientIndex: 100 },
])("rejects forged or incomplete review input before fetch: %#", async (input) => {
  const request = transportResponse({ ok: true, value: transportSaved });
  expect(await reviewDeliveryObservation({ accountId: ids.account, input }, signal())).toEqual({
    ok: false,
    error: "invalid_input",
  });
  expect(request).not.toHaveBeenCalled();
});

it.each([
  ["verified trust", { ...transportReport, trust: "verified" }],
  ["no review required", { ...transportReport, requiresReview: false }],
  ["unknown private field", { ...transportReport, privatePayload: "not a DTO field" }],
  ["unsupported media", { ...transportReport, mediaType: "text/html" }],
  ["foreign source", { ...transportReport, sourceMessageId: ids.secondAttempt }],
  [
    "invalid recipient index",
    { ...transportReport, recipients: [{ ...transportReport.recipients[0], index: 100 }] },
  ],
  [
    "duplicate recipient indices",
    {
      ...transportReport,
      recipients: [transportReport.recipients[0], transportReport.recipients[0]],
    },
  ],
  [
    "HTML diagnostic",
    {
      ...transportReport,
      recipients: [
        {
          ...transportReport.recipients[0],
          diagnostic: { type: "smtp", text: "private", display: "html" },
        },
      ],
    },
  ],
  [
    "impossible review state",
    {
      ...transportReport,
      recipients: [
        {
          ...transportReport.recipients[0],
          review: { revision: 0, decision: "associated", target: transportSaved.target },
        },
      ],
    },
  ],
] as const)("fails closed on malformed report data: %s", async (_name, report) => {
  transportResponse({ ok: true, value: [report] });
  expect(
    await readDeliveryObservationReports(
      { accountId: ids.account, sourceMessageId: ids.source },
      signal(),
    ),
  ).toEqual({ ok: false, error: "unknown" });
});

it.each([
  ["unreviewed report", transportReport],
  [
    "another attempt",
    {
      ...transportAssociatedReport,
      recipients: [
        {
          ...transportAssociatedReport.recipients[0],
          review: {
            ...transportSaved,
            target: { ...transportSaved.target, attemptId: ids.secondAttempt },
          },
        },
      ],
    },
  ],
] as const)(
  "rejects an attempt response outside the exact reviewed selector: %s",
  async (_name, report) => {
    transportResponse({ ok: true, value: [report] });
    expect(
      await readDeliveryObservationReports(
        { accountId: ids.account, attemptId: ids.attempt },
        signal(),
      ),
    ).toEqual({ ok: false, error: "unknown" });
  },
);

it.each([
  { value: [transportTargets[0], transportTargets[0]] },
  { value: [{ ...transportTargets[0], sentAt: "not-an-instant" }] },
  { value: [{ ...transportTargets[0], password: "private field" }] },
])("rejects duplicate, malformed or unexpected target DTOs: %#", async ({ value }) => {
  transportResponse({ ok: true, value });
  expect(
    await listDeliveryObservationReviewTargets(
      { accountId: ids.account, reportId: ids.report },
      signal(),
    ),
  ).toEqual({ ok: false, error: "unknown" });
});

it.each([
  { ...transportSaved, revision: 2 },
  { ...transportSaved, target: { ...transportSaved.target, attemptId: ids.secondAttempt } },
  { ...transportSaved, target: { ...transportSaved.target, recipient: "kunde@example.test" } },
  { revision: 1, decision: "dismissed", target: null },
])("never accepts a different or stale review acknowledgement: %#", async (value) => {
  transportResponse({ ok: true, value });
  expect(
    await reviewDeliveryObservation({ accountId: ids.account, input: transportReview }, signal()),
  ).toEqual({ ok: false, error: "unknown" });
});

it("preserves diagnostic markup only as plain text", async () => {
  const report = {
    ...transportReport,
    recipients: [
      {
        ...transportReport.recipients[0],
        localizedDiagnostics: [],
        diagnostic: {
          type: "smtp",
          text: '<img src="https://untrusted.example.test/pixel">',
          display: "plain_text",
        },
      },
    ],
  };
  transportResponse({ ok: true, value: [report] });
  expect(
    await readDeliveryObservationReports(
      { accountId: ids.account, sourceMessageId: ids.source },
      signal(),
    ),
  ).toEqual({ ok: true, value: [report] });
});

it.each([200, 500])(
  "rejects an unsuccessful or HTTP-invalid success envelope: %s",
  async (status) => {
    transportResponse(
      status === 200 ? { ok: false, error: "permission" } : { ok: true, value: [transportReport] },
      status,
    );
    expect(
      await readDeliveryObservationReports(
        { accountId: ids.account, sourceMessageId: ids.source },
        signal(),
      ),
    ).toEqual({ ok: false, error: "unknown" });
  },
);

it("maps non-JSON conflict responses and never leaks their body", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("private upstream diagnostics", { status: 409 })),
  );
  expect(
    await reviewDeliveryObservation({ accountId: ids.account, input: transportReview }, signal()),
  ).toEqual({ ok: false, error: "conflict" });
});

it("does not invent a fresh-auth workflow or retain unexpected error details", async () => {
  transportResponse({ ok: false, error: "fresh_auth_required", diagnostic: "private secret" }, 403);
  expect(
    await reviewDeliveryObservation({ accountId: ids.account, input: transportReview }, signal()),
  ).toEqual({ ok: false, error: "permission" });
});
